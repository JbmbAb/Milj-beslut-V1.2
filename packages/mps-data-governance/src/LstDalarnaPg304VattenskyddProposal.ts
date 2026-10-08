import type { SourceRegistryArtifact } from './SourceRegistry';
import {
  ISO_19115_FILE_IDENTIFIER_KIND,
  LST_ISO_ATOM_ZIP_ADAPTER_ID,
} from './LstIsoAtomZipResolver';

/**
 * Unsigned proposal for the Dalarna municipal water-protection ZIP.
 *
 * This is not an approval. It has no attestation and must not be copied into
 * source-registry/national-registry.json until a governor signs it.
 */

export const LST_DALARNA_PG304_FILE_IDENTIFIER = '7423bc91-affe-4b4d-aaab-70435393d501_C';

export const LST_DALARNA_PG304_ATOM_URL =
  'https://ext-dokument.lansstyrelsen.se/gemensamt/geodata/ATOM/ATOM_Lstw.PG304_Vattenskyddsomraden_lokala_foreskrifter.xml';

export const LST_DALARNA_PG304_ZIP_URL =
  'https://ext-dokument.lansstyrelsen.se/gemensamt/geodata/ShapeExport/Lstw.PG304_Vattenskyddsomraden_lokala_foreskrifter.zip';

export const LST_DALARNA_PG304_ISO_URL =
  'https://ext-geodatakatalog-forv.lansstyrelsen.se/PlaneringsKatalogen/GetMetaDataById?id=7423bc91-affe-4b4d-aaab-70435393d501_C&format=ISO_19139';

export const LST_DALARNA_PG304_TERMS_REFERENCE =
  'http://inspire.ec.europa.eu/metadata-codelist/ConditionsApplyingToAccessAndUse/noConditionsApply';

export const LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL: Omit<SourceRegistryArtifact, 'approval_attestation'> = {
  artifact_id: 'reg-lst-w-pg304-vattenskydd-unsigned',
  artifact_type: 'SOURCE_REGISTRY_ENTRY',
  source_id: 'lansstyrelsen-dalarna-pg304-vattenskydd-kommunala',
  producer: {
    producer_id: 'LST-W',
    name: 'Länsstyrelsen Dalarnas län',
    type: 'county_board',
  },
  channel: {
    channel_type: 'DATASET_PORTAL',
    endpoint_url: LST_DALARNA_PG304_ISO_URL,
    allowed_domains: [
      'ext-geodatakatalog-forv.lansstyrelsen.se',
      'ext-dokument.lansstyrelsen.se',
    ],
  },
  adapter: LST_ISO_ATOM_ZIP_ADAPTER_ID,
  artifact_types: ['geodata'],
  collection_frequency: 'YEARLY',
  change_detection: { strategy: 'CONTENT_HASH' },
  policy: {
    rate_limit_requests_per_second: 1,
    concurrency_limit: 1,
    politeness_delay_ms: 1000,
    max_object_size_bytes: 16_777_216,
    retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
  },
  geographic_scope: 'Dalarnas län',
  distribution_binding: {
    kind: ISO_19115_FILE_IDENTIFIER_KIND,
    value: LST_DALARNA_PG304_FILE_IDENTIFIER,
  },
  lifecycle_state: 'REGISTERED',
};
