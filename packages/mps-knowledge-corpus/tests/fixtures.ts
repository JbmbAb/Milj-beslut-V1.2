import type { ExtractionResult, TextExtractorPort } from '@miljobeslut/mps-text-projection';

import {
  createStaticAuthorizedSourceCatalog,
  type AuthorizedSourceBinding,
  type AuthorizedSourceCatalog,
} from '../src';

/**
 * ⚠️ TEST FIXTURES, NOT AUTHORITY. Bindings here are hand-written; the production catalog is
 * built from `loadVerifiedSourceRegistry` on the server side of the package boundary.
 */
export const FIXTURE_CATALOG_ORIGIN = 'static:<fixture:mps-knowledge-corpus>';

export const SFS_HASH = 'a'.repeat(64);
export const PUH_HASH = 'b'.repeat(64);
export const MHN_HASH = 'c'.repeat(64);
export const SGU_HASH = 'd'.repeat(64);
export const BOVERKET_HASH = 'e'.repeat(64);

export const SFS: AuthorizedSourceBinding = {
  source_id: 'regeringskansliet-sfs-1998-808',
  registry_artifact_id: 'reg-rk-sfs-1998-808-002',
  registry_source_content_hash: SFS_HASH,
  authority_name: 'Regeringskansliet',
  authority_type: 'other',
  artifact_types: ['LAW'],
  adapter: 'SINGLE_ENDPOINT_V1',
  channel_type: 'WEBSITE',
};
export const PUH: AuthorizedSourceBinding = {
  source_id: 'domstolsverket-puh-mmod',
  registry_artifact_id: 'reg-dv-puh-mmod-004',
  registry_source_content_hash: PUH_HASH,
  authority_name: 'Domstolsverket',
  authority_type: 'court',
  artifact_types: ['decision'],
  adapter: 'PUH_RATTSPRAXIS_V1',
  channel_type: 'API',
};
export const MHN: AuthorizedSourceBinding = {
  source_id: 'falkenbergs-kommun-mhn-decisions',
  registry_artifact_id: 'reg-falkenberg-mhn-decisions-001',
  registry_source_content_hash: MHN_HASH,
  authority_name: 'Falkenbergs kommun, Miljö- och hälsoskyddsnämnden',
  authority_type: 'municipality',
  artifact_types: ['decision'],
  adapter: 'ARCHIVE_IMPORT_V1',
  channel_type: 'ARCHIVE_IMPORT',
};
export const SGU: AuthorizedSourceBinding = {
  source_id: 'sgu-well-drilling-guidance',
  registry_artifact_id: 'reg-sgu-well-drilling-guidance-002',
  registry_source_content_hash: SGU_HASH,
  authority_name: 'Sveriges geologiska undersökning',
  authority_type: 'other',
  artifact_types: ['AGENCY_GUIDANCE'],
  adapter: 'SINGLE_ENDPOINT_V1',
  channel_type: 'WEBSITE',
};
export const BOVERKET_DATASET: AuthorizedSourceBinding = {
  source_id: 'boverket-planbestammelser',
  registry_artifact_id: 'reg-boverket-planbestammelser-002',
  registry_source_content_hash: BOVERKET_HASH,
  authority_name: 'Boverket',
  authority_type: 'other',
  artifact_types: ['REFERENCE_DATASET'],
  adapter: 'SINGLE_ENDPOINT_V1',
  channel_type: 'API',
};

export function fixtureCatalog(): AuthorizedSourceCatalog {
  return createStaticAuthorizedSourceCatalog([SFS, PUH, MHN, SGU, BOVERKET_DATASET], FIXTURE_CATALOG_ORIGIN);
}

export const LAW_TEXT = [
  '1 kap. Tillämpningsområde',
  '1 § Bestämmelserna i denna balk syftar till att främja en hållbar utveckling som innebär att nuvarande och kommande generationer tillförsäkras en hälsosam och god miljö.',
  '2 § Bestämmelserna i denna balk tillämpas på all verksamhet och alla åtgärder som kan påverka miljön.',
  '2 kap. Allmänna hänsynsregler',
  '3 § Alla som bedriver eller avser att bedriva en verksamhet ska utföra de skyddsåtgärder och iaktta de begränsningar som behövs för att förebygga olägenheter för människors hälsa eller miljön.',
  '6 § Verksamheter och åtgärder ska bedrivas och vidtas på ett sådant sätt att olägenheter begränsas i så stor utsträckning som möjligt, se 26 kap. 9 § miljöbalken.',
].join(' ');

export const COURT_TEXT = [
  'DOMSLUT',
  'Mark- och miljööverdomstolen avslår överklagandet och fastställer mark- och miljödomstolens dom i dess helhet.',
  '',
  'YRKANDEN',
  'Bolaget har yrkat att tillståndet ska ändras så att bullervillkoret om 50 dBA vid bostäder upphävs.',
  '',
  'DOMSKÄL',
  'Mark- och miljööverdomstolen konstaterar att bullervillkoret grundas på 2 kap. 3 § miljöbalken och att bolaget inte visat att villkoret är orimligt.',
].join('\n');

export const DECISION_TEXT = [
  'Verksamhetsutövare: Mora Bergtäkt AB',
  'Verksamhetskod (MPF): 10.10',
  '',
  '1. BESLUTETS INNEBÖRD OCH OMFATTNING',
  'Myndigheten godkänner täkten inom angivet verksamhetsområde.',
  '',
  '2. VILLKOR OCH FÖRSIKTIGHETSMÅTT',
  'VILLKOR 1: Buller får inte överstiga 50 dBA vid bostäder.',
  'VILLKOR 2: Grundvattennivån i GW-1 ska mätas månadsvis enligt bolagets kontrollprogram.',
  '',
  '3. UPPLYSNINGAR OCH ÖVERKLAGANDEHÄNVISNING',
  'Detta beslut kan överklagas till mark- och miljödomstolen.',
].join('\n');

export const STANDARD_TEXT = [
  'Vägledning för att borra brunn. Innan borrning påbörjas bör fastighetsägaren undersöka de geologiska förutsättningarna på platsen och ta hänsyn till närliggande brunnar.',
  '',
  'Borrhålet bör tätas mot ytligt grundvatten för att minska risken för förorening av dricksvattnet. Kontakta kommunens miljökontor vid osäkerhet.',
].join('\n');

/** Deterministic byte extractor for tests: decodes UTF-8 bytes as the projected text. */
export function utf8Extractor(overrides: Partial<ExtractionResult> = {}): TextExtractorPort {
  return {
    async extract(_source, bytes) {
      const text = new TextDecoder('utf-8').decode(bytes);
      return {
        text,
        method: 'plain_text',
        version: 'plain-text@test',
        succeeded: text.length > 0,
        ...overrides,
      };
    },
  };
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
