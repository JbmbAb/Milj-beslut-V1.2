import {
  GovernedDownloadError,
  type DownloadTarget,
  type DownloadTransport,
  type ResolvedDownloadPlan,
} from './GovernedDownloadContracts';
import type { SourceAwareTargetResolver } from './DownloadTargetResolvers';
import type { VerifiedSourceDefinition } from './SourceRegistry';

/**
 * 🜃 PUH_RATTSPRAXIS_V1 — Domstolsverket's rättspraxis API.
 *
 * The first adapter built against a real GOVERNOR-signed source rather than a fixture.
 *
 * Two-stage by nature, which is why it needed its own adapter:
 *
 *   GET /api/v1/publiceringar?...&page=N&pagesize=M   → publication metadata
 *        └── bilagaLista[].fillagringId               → the documents themselves
 *   GET /api/v1/bilagor/{lagringId}                   → application/pdf
 *
 * The listing carries no attachment URLs, so they are constructed from the source's own origin.
 * Constructing them from anything else would let the adapter reach outside the approved host
 * while still looking like governed collection.
 *
 * Every request — listing pages included — goes through the injected governed transport. The
 * adapter holds no fetch of its own; that was the defect class P2-AUTH-00 closed.
 *
 * @see docs/architecture — P2-SR-AUTHORITY-01
 * @see ./GovernedDownloadExecutor.ts
 */

/** Documented on GET /api/v1/publiceringar. */
interface PuhAttachment {
  readonly fillagringId?: string;
  readonly filnamn?: string;
}

interface PuhPublication {
  readonly id?: string;
  readonly avgorandedatum?: string;
  readonly domstol?: { readonly domstolKod?: string };
  readonly bilagaLista?: readonly PuhAttachment[];
}

/**
 * Safety bounds, NOT policy.
 *
 * `max_object_size_bytes` is the owner-frozen policy for object size; nothing in the frozen
 * policy bounds how many pages an enumeration may walk. These exist so a paging bug or a
 * server that ignores `page` cannot turn one harvest into an unbounded crawl. Exceeding them
 * FAILS the run rather than truncating it — a silently short harvest would look like a
 * complete one.
 */
export const PUH_PAGE_SIZE = 100;
export const PUH_MAX_PAGES = 100;

export class PuhRattspraxisTargetResolver implements SourceAwareTargetResolver {
  constructor(
    private readonly transport: DownloadTransport,
    private readonly pageSize: number = PUH_PAGE_SIZE,
    private readonly maxPages: number = PUH_MAX_PAGES,
  ) {}

  async resolve(source: VerifiedSourceDefinition): Promise<ResolvedDownloadPlan> {
    const endpoint = source.endpointUrl;
    if (!endpoint) {
      throw new GovernedDownloadError(
        `REJECT_SOURCE_ENDPOINT: source '${source.sourceId}' has no endpoint_url.`,
        'REJECT_SOURCE_ENDPOINT',
      );
    }

    const origin = new URL(endpoint).origin;
    const targets: DownloadTarget[] = [];
    let pagesExamined = 0;
    let itemsObserved = 0;
    const firstListingUrl = withPaging(endpoint, 0, this.pageSize);
    // The same document can be attached to more than one publication (a decision and its
    // referat). Fetching it twice would produce two quarantine entries for one object.
    const seen = new Set<string>();

    for (let page = 0; page < this.maxPages; page++) {
      const pageUrl = withPaging(endpoint, page, this.pageSize);

      const response = await this.transport.get(pageUrl, {
        timeout_ms: 30_000,
        max_bytes: source.policy.max_object_size_bytes,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new GovernedDownloadError(
          `REJECT_LISTING_STATUS: ${response.status} from '${pageUrl}'.`,
          'REJECT_HTTP_STATUS',
        );
      }

      const publications = parsePublications(new TextDecoder().decode(response.bytes), pageUrl);
      pagesExamined++;
      itemsObserved += publications.length;
      if (publications.length === 0) break;

      for (const publication of publications) {
        for (const attachment of publication.bilagaLista ?? []) {
          if (!attachment.fillagringId) continue;
          if (seen.has(attachment.fillagringId)) continue;
          seen.add(attachment.fillagringId);

          targets.push({
            url: `${origin}/api/v1/bilagor/${encodeURIComponent(attachment.fillagringId)}`,
            file_name: attachmentFileName(publication, attachment),
          });
        }
      }

      // A short page is the last page. Guarding on this rather than on an absent `total` field:
      // the listing endpoint returns a bare array with no envelope.
      if (publications.length < this.pageSize) break;

      if (page === this.maxPages - 1) {
        throw new GovernedDownloadError(
          `REJECT_PAGE_LIMIT: '${source.sourceId}' still returned full pages after ` +
            `${this.maxPages} pages. Stopping here would silently produce a partial harvest ` +
            'that looks complete.',
          'REJECT_PAGE_LIMIT',
        );
      }
    }

    if (targets.length === 0) {
      // P2-EMPTY-PLAN-01. Reached only after at least one listing page was fetched with a 2xx
      // and parsed successfully — a malformed or failing listing has already thrown above. So
      // this is an observation that the source had nothing to give, not an absence of looking.
      //
      // Covers both ordinary shapes: no publications at all, and publications carrying no
      // attachments (a notis often has none). Requiring publications to exist would fail on
      // perfectly normal days.
      return {
        kind: 'NO_CHANGES',
        evidence: {
          pages_examined: pagesExamined,
          items_observed: itemsObserved,
          targets_produced: 0,
          listing_url: firstListingUrl,
        },
      };
    }

    return { kind: 'TARGETS', targets };
  }
}

/**
 * Adds paging while preserving the approved scope.
 *
 * `domstolkod`, `publiceringstyper` and `publicerad_fran_och_med` live in `endpoint_url`, which
 * is inside the signed content hash. They are read from the URL and never rewritten here — an
 * adapter that could alter them would be able to harvest outside what was approved.
 */
export function withPaging(endpoint: string, page: number, pageSize: number): string {
  const url = new URL(endpoint);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pagesize', String(pageSize));
  return url.toString();
}

export function parsePublications(body: string, sourceUrl: string): readonly PuhPublication[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' did not return JSON.`,
      'REJECT_LISTING_SHAPE',
    );
  }

  // The GET listing returns a bare array. `{ total, publiceringLista }` is the POST /sok shape,
  // accepted here so a future switch to search-based enumeration does not silently yield zero.
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { publiceringLista?: unknown })?.publiceringLista;

  if (!Array.isArray(list)) {
    throw new GovernedDownloadError(
      `REJECT_LISTING_SHAPE: '${sourceUrl}' returned neither an array nor publiceringLista. ` +
        'A malformed listing must not be read as an empty one.',
      'REJECT_LISTING_SHAPE',
    );
  }

  return list as readonly PuhPublication[];
}

/**
 * Names the file after the court and decision date where available.
 *
 * The service's own `filnamn` (e.g. `1889-24.pdf`) is a case number without context; two courts
 * can publish the same one. The quarantine key is the content hash, so this only affects
 * legibility — but a name that needs a database lookup to interpret is not much of a name.
 */
function attachmentFileName(publication: PuhPublication, attachment: PuhAttachment): string {
  const base = attachment.filnamn?.replace(/\.[a-z0-9]+$/i, '') ?? attachment.fillagringId ?? 'bilaga';
  const court = publication.domstol?.domstolKod;
  const date = publication.avgorandedatum;
  const parts = [court, date, base].filter(Boolean).join('_');
  return `${sanitize(parts)}.pdf`;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'bilaga';
}
