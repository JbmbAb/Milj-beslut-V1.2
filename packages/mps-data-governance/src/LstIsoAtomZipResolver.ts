import {
  GovernedDownloadError,
  type DownloadTransport,
  type ResolvedDownloadPlan,
} from './GovernedDownloadContracts';
import type { SourceAwareTargetResolver } from './DownloadTargetResolvers';
import type { VerifiedSourceDefinition } from './SourceRegistry';

/**
 * LST_ISO_ATOM_ZIP_V1 — signed ISO record, then the ATOM feed that record names, then one ZIP.
 *
 * The registry endpoint is the current ISO 19139 document. The signed distribution
 * binding is that document's fileIdentifier. ATOM is taken from the ISO online
 * resource whose protocol is HTTP:Nedladdning:Atom, not from a back-link inside
 * the feed. The feed's own metadata href is ignored.
 *
 * The resolver reports the fileIdentifier it read. DownloadTargetResolverRegistry
 * compares that observation with the signed binding before a target leaves the
 * boundary. This resolver also stops before the ATOM request when the identifier
 * already differs, so a stale binding cannot follow a distribution link.
 *
 * Terms come from the same ISO record. ATOM `<rights>` is not a license.
 * No strong-ETag capability is declared, so prefetch fetches the bytes.
 */

export const LST_ISO_ATOM_ZIP_ADAPTER_ID = 'LST_ISO_ATOM_ZIP_V1' as const;
export const ISO_19115_FILE_IDENTIFIER_KIND = 'iso-19115-file-identifier' as const;
const ATOM_DOWNLOAD_PROTOCOL = 'HTTP:Nedladdning:Atom';

const SOURCE_METADATA_ISO_FILE_IDENTIFIER = 'iso_file_identifier';
const SOURCE_METADATA_TERMS_REFERENCE = 'terms_reference';
const SOURCE_METADATA_ATOM_UPDATED = 'atom_updated';
const SOURCE_METADATA_ATOM_ENTRY_LOCATOR = 'atom_entry_locator';

export class LstIsoAtomZipTargetResolver implements SourceAwareTargetResolver {
  constructor(private readonly transport: DownloadTransport) {}

  async resolve(source: VerifiedSourceDefinition): Promise<ResolvedDownloadPlan> {
    const endpoint = source.endpointUrl;
    if (!endpoint) {
      throw new GovernedDownloadError(
        `REJECT_SOURCE_ENDPOINT: source '${source.sourceId}' has no endpoint_url.`,
        'REJECT_SOURCE_ENDPOINT',
      );
    }

    const signed = source.distributionBinding;
    if (!signed || signed.kind !== ISO_19115_FILE_IDENTIFIER_KIND) {
      throw new GovernedDownloadError(
        `REJECT_DISTRIBUTION_IDENTITY: source '${source.sourceId}' is not signed to an ` +
          `'${ISO_19115_FILE_IDENTIFIER_KIND}' distribution.`,
        'REJECT_DISTRIBUTION_IDENTITY',
      );
    }

    const isoResponse = await this.transport.get(endpoint, {
      timeout_ms: 30_000,
      max_bytes: source.policy.max_object_size_bytes,
    });
    if (isoResponse.status < 200 || isoResponse.status >= 300) {
      throw new GovernedDownloadError(
        `REJECT_LISTING_STATUS: ${isoResponse.status} from '${endpoint}'.`,
        'REJECT_HTTP_STATUS',
      );
    }

    const iso = parseIsoDistributionRecord(new TextDecoder().decode(isoResponse.bytes), endpoint);
    if (iso.fileIdentifier !== signed.value) {
      throw new GovernedDownloadError(
        `REJECT_DISTRIBUTION_IDENTITY: source '${source.sourceId}' observed ` +
          `'${ISO_19115_FILE_IDENTIFIER_KIND}' / '${iso.fileIdentifier}', signed ` +
          `'${signed.kind}' / '${signed.value}'.`,
        'REJECT_DISTRIBUTION_IDENTITY',
      );
    }

    const atomResponse = await this.transport.get(iso.atomUrl, {
      timeout_ms: 30_000,
      max_bytes: source.policy.max_object_size_bytes,
    });
    if (atomResponse.status < 200 || atomResponse.status >= 300) {
      throw new GovernedDownloadError(
        `REJECT_LISTING_STATUS: ${atomResponse.status} from '${iso.atomUrl}'.`,
        'REJECT_HTTP_STATUS',
      );
    }

    const atom = parseAtomFeed(new TextDecoder().decode(atomResponse.bytes), iso.atomUrl);

    return {
      kind: 'TARGETS',
      observedDistributionIdentity: {
        kind: ISO_19115_FILE_IDENTIFIER_KIND,
        value: iso.fileIdentifier,
      },
      targets: [{
        url: atom.zipUrl,
        file_name: fileNameFromUrl(atom.zipUrl),
        source_metadata: {
          [SOURCE_METADATA_ISO_FILE_IDENTIFIER]: iso.fileIdentifier,
          [SOURCE_METADATA_TERMS_REFERENCE]: iso.termsReference,
          [SOURCE_METADATA_ATOM_UPDATED]: atom.updated,
          [SOURCE_METADATA_ATOM_ENTRY_LOCATOR]: atom.zipUrl,
        },
      }],
    };
  }
}

interface IsoObservation {
  readonly fileIdentifier: string;
  readonly termsReference: string;
  readonly atomUrl: string;
}

interface AtomObservation {
  readonly zipUrl: string;
  readonly updated: string;
}

function parseIsoDistributionRecord(xml: string, sourceUrl: string): IsoObservation {
  const identifiers = elementBodies(xml, 'fileIdentifier')
    .map((body) => elementText(body, 'CharacterString'))
    .filter((value): value is string => value !== undefined);
  if (identifiers.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_DISTRIBUTION_IDENTITY: '${sourceUrl}' contained ${identifiers.length} fileIdentifier values.`,
      'REJECT_DISTRIBUTION_IDENTITY',
    );
  }
  const fileIdentifier = identifiers[0];
  if (!fileIdentifier) {
    throw new GovernedDownloadError(
      `REJECT_DISTRIBUTION_IDENTITY: '${sourceUrl}' contained no fileIdentifier.`,
      'REJECT_DISTRIBUTION_IDENTITY',
    );
  }

  const legalBlocks = elementBodies(xml, 'MD_LegalConstraints')
    .filter((block) => elementBodies(block, 'useConstraints').length > 0);
  if (legalBlocks.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained ${legalBlocks.length} use-constraint blocks. ` +
        'ATOM rights are not a substitute for the ISO terms reference.',
      'REJECT_LISTING_SHAPE',
    );
  }
  const terms = anchorHrefs(elementBodies(legalBlocks[0] ?? '', 'otherConstraints').join(''));
  if (terms.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' useConstraints contained ${terms.length} terms anchors.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  const termsReference = terms[0];
  if (!termsReference) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' useConstraints contained no terms anchor.`,
      'REJECT_LISTING_SHAPE',
    );
  }

  const atomUrls = elementBodies(xml, 'CI_OnlineResource').flatMap((resource) => {
    const protocol = elementText(elementBodies(resource, 'protocol')[0] ?? '', 'CharacterString');
    if (protocol !== ATOM_DOWNLOAD_PROTOCOL) return [];
    const url = directText(elementBodies(resource, 'linkage')[0] ?? '', 'URL');
    return url ? [url] : [];
  });
  if (atomUrls.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained ${atomUrls.length} ` +
        `'${ATOM_DOWNLOAD_PROTOCOL}' resources.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  const atomUrl = atomUrls[0];
  if (!atomUrl) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained no ATOM distribution URL.`,
      'REJECT_LISTING_SHAPE',
    );
  }

  return { fileIdentifier, termsReference, atomUrl };
}

function parseAtomFeed(xml: string, sourceUrl: string): AtomObservation {
  const entries = elementBodies(xml, 'entry');
  if (entries.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained ${entries.length} ATOM entries. ` +
        'This adapter accepts one distribution, not a collection.',
      'REJECT_LISTING_SHAPE',
    );
  }
  const entry = entries[0] ?? '';
  const zipUrls = atomZipLinks(entry);
  if (zipUrls.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained ${zipUrls.length} ZIP links.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  const zipUrl = zipUrls[0];
  if (!zipUrl) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' contained no ZIP link.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  const updated = elementText(entry, 'updated');
  if (!updated) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' entry has no updated timestamp.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  return { zipUrl, updated };
}

function atomZipLinks(entryXml: string): readonly string[] {
  const hrefs: string[] = [];
  for (const match of entryXml.matchAll(/<(?:[\w.-]+:)?link\b([^>]*)\/?>/g)) {
    const attrs = match[1] ?? '';
    const type = attribute(attrs, 'type');
    const href = attribute(attrs, 'href');
    if (!href) continue;
    if (type?.toLowerCase() === 'application/zip') hrefs.push(decodeXml(href));
  }
  return hrefs;
}

function anchorHrefs(xml: string): readonly string[] {
  const hrefs: string[] = [];
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?Anchor\b([^>]*)\/?>/g)) {
    const href = attribute(match[1] ?? '', 'xlink:href');
    if (href) hrefs.push(decodeXml(href));
  }
  return hrefs;
}

function elementBodies(xml: string, localName: string): readonly string[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`,
    'g',
  );
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '');
}

function elementText(xml: string, localName: string): string | undefined {
  const body = elementBodies(xml, localName)[0];
  if (body === undefined) return undefined;
  const text = decodeXml(body).trim();
  return text.length > 0 ? text : undefined;
}

function directText(xml: string, localName: string): string | undefined {
  const body = elementBodies(xml, localName)[0];
  if (body === undefined) return undefined;
  const text = decodeXml(body).replace(/<[^>]+>/g, '').trim();
  return text.length > 0 ? text : undefined;
}

function attribute(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attrs.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match?.[1] ?? match?.[2];
}

function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function fileNameFromUrl(url: string): string {
  let last: string | undefined;
  try {
    last = new URL(url).pathname.split('/').filter(Boolean).pop();
  } catch {
    last = undefined;
  }
  if (!last) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: ZIP locator '${url}' has no file name.`,
      'REJECT_LISTING_SHAPE',
    );
  }
  return last;
}
