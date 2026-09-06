import {
  buildCorpusSnapshot,
  createStaticAuthorizedSourceCatalog,
  projectDocument,
  type AuthorizedSourceBinding,
  type CorpusDocumentInput,
  type CorpusDocumentProjection,
  type CorpusSnapshot,
} from '@miljobeslut/mps-knowledge-corpus';
import type { TextExtractorPort } from '@miljobeslut/mps-text-projection';

/** ⚠️ TEST FIXTURES, NOT AUTHORITY. */
export const ORIGIN = 'static:<fixture:mps-knowledge-index>';

export const SFS: AuthorizedSourceBinding = {
  source_id: 'regeringskansliet-sfs-1998-808',
  registry_artifact_id: 'reg-rk-sfs-1998-808-002',
  registry_source_content_hash: 'a'.repeat(64),
  authority_name: 'Regeringskansliet',
  authority_type: 'other',
  artifact_types: ['LAW'],
  adapter: 'SINGLE_ENDPOINT_V1',
};
export const MPF: AuthorizedSourceBinding = {
  source_id: 'regeringskansliet-sfs-2013-251',
  registry_artifact_id: 'reg-rk-sfs-2013-251-002',
  registry_source_content_hash: 'b'.repeat(64),
  authority_name: 'Regeringskansliet',
  authority_type: 'other',
  artifact_types: ['ORDINANCE'],
  adapter: 'SINGLE_ENDPOINT_V1',
};
export const PUH: AuthorizedSourceBinding = {
  source_id: 'domstolsverket-puh-mmod',
  registry_artifact_id: 'reg-dv-puh-mmod-004',
  registry_source_content_hash: 'c'.repeat(64),
  authority_name: 'Domstolsverket',
  authority_type: 'court',
  artifact_types: ['decision'],
  adapter: 'PUH_RATTSPRAXIS_V1',
};
export const MHN: AuthorizedSourceBinding = {
  source_id: 'falkenbergs-kommun-mhn-decisions',
  registry_artifact_id: 'reg-falkenberg-mhn-decisions-001',
  registry_source_content_hash: 'd'.repeat(64),
  authority_name: 'Falkenbergs kommun',
  authority_type: 'municipality',
  artifact_types: ['decision'],
  adapter: 'ARCHIVE_IMPORT_V1',
};
export const SGU: AuthorizedSourceBinding = {
  source_id: 'sgu-well-drilling-guidance',
  registry_artifact_id: 'reg-sgu-well-drilling-guidance-002',
  registry_source_content_hash: 'e'.repeat(64),
  authority_name: 'SGU',
  authority_type: 'other',
  artifact_types: ['AGENCY_GUIDANCE'],
  adapter: 'SINGLE_ENDPOINT_V1',
};

export const catalog = createStaticAuthorizedSourceCatalog([SFS, MPF, PUH, MHN, SGU], ORIGIN);

export const utf8: TextExtractorPort = {
  async extract(_s, bytes) {
    const text = new TextDecoder().decode(bytes);
    return { text, method: 'plain_text', version: 'plain-text@test', succeeded: text.length > 0 };
  },
};

export const LAW_MB = [
  '1 kap. Tillämpningsområde',
  '1 § Bestämmelserna i denna balk syftar till att främja en hållbar utveckling som innebär att nuvarande och kommande generationer tillförsäkras en hälsosam och god miljö.',
  '2 kap. Allmänna hänsynsregler',
  '3 § Alla som bedriver en verksamhet ska utföra de skyddsåtgärder och iaktta de begränsningar som behövs för att förebygga olägenheter för människors hälsa eller miljön.',
  '7 § Kraven i 2-5 §§ gäller i den utsträckning det inte kan anses orimligt att uppfylla dem; vid bedömningen ska nyttan av skyddsåtgärder jämföras med kostnaderna.',
  '9 kap. Miljöfarlig verksamhet och hälsoskydd',
  '1 § Med miljöfarlig verksamhet avses utsläpp av avloppsvatten, fasta ämnen eller gas från mark, byggnader eller anläggningar i mark, vattenområden eller grundvatten.',
  '6 § Regeringen får meddela föreskrifter om att det ska vara förbjudet att utan tillstånd bedriva miljöfarlig verksamhet.',
  '26 kap. Tillsyn',
  '9 § En tillsynsmyndighet får i det enskilda fallet besluta om de förelägganden och förbud som behövs för att denna balk ska följas.',
].join(' ');

export const ORD_MPF = [
  '1 kap. Miljöprövningsförordningens tillämpning',
  '1 § Denna förordning innehåller bestämmelser om tillståndsplikt och anmälningsplikt för verksamheter och åtgärder som avses i 9 kap. miljöbalken.',
  '4 kap. Berg, naturgrus och andra jordarter',
  '2 § Tillståndsplikt B och verksamhetskod 10.10 gäller för täkt av berg med ett verksamhetsområde som är större än 25 hektar.',
  '3 § Anmälningsplikt C och verksamhetskod 10.30 gäller för täkt för markinnehavarens husbehov av mer än 10 000 ton naturgrus.',
].join(' ');

export const COURT_A = [
  'DOMSLUT',
  'Mark- och miljööverdomstolen avslår överklagandet och fastställer mark- och miljödomstolens dom om bullervillkor för bergtäkten.',
  '',
  'BAKGRUND',
  'Bolaget bedriver bergtäkt i Mora kommun med stöd av tillstånd enligt 9 kap. miljöbalken.',
  '',
  'DOMSKÄL',
  'Mark- och miljööverdomstolen konstaterar att bullervillkoret 50 dBA vid bostäder följer av 2 kap. 3 § miljöbalken och att bolaget inte visat att villkoret är orimligt enligt 2 kap. 7 §.',
].join('\n');

export const COURT_B = [
  'DOMSLUT',
  'Mark- och miljööverdomstolen upphäver mark- och miljödomstolens dom och återförvisar målet om enskilt avlopp för fortsatt handläggning.',
  '',
  'BAKGRUND',
  'Nämnden förbjöd utsläpp av avloppsvatten från fastigheten med stöd av 26 kap. 9 § miljöbalken.',
  '',
  'DOMSKÄL',
  'Utredningen om avloppsanordningens reningsförmåga är bristfällig och nämndens förbud saknar tillräckligt stöd.',
].join('\n');

export const DECISION_MORA = [
  'Verksamhetsutövare: Mora Bergtäkt AB',
  'Verksamhetskod (MPF): 10.10',
  '',
  '1. BESLUTETS INNEBÖRD OCH OMFATTNING',
  'Nämnden lämnar tillstånd till bergtäkt inom angivet verksamhetsområde till och med 2040.',
  '',
  '2. VILLKOR OCH FÖRSIKTIGHETSMÅTT',
  'VILLKOR 1: Buller från verksamheten får inte överstiga 50 dBA ekvivalent ljudnivå dagtid vid bostäder.',
  'VILLKOR 2: Grundvattennivån i observationsbrunn GW-1 ska mätas månadsvis enligt bolagets kontrollprogram.',
  'VILLKOR 3: Damning från krossning ska begränsas genom vattenbegjutning.',
  '',
  '3. UPPLYSNINGAR OCH ÖVERKLAGANDEHÄNVISNING',
  'Detta beslut kan överklagas till mark- och miljödomstolen inom tre veckor.',
].join('\n');

export const GUIDANCE_V1 = [
  'Vägledning för att borra brunn. Innan borrning påbörjas bör fastighetsägaren undersöka de geologiska förutsättningarna och ta hänsyn till närliggande brunnar och avloppsanläggningar.',
  '',
  'Borrhålet bör tätas mot ytligt grundvatten för att minska risken för förorening av dricksvattnet. Kontakta kommunens miljökontor vid osäkerhet om skyddsavstånd.',
].join('\n');

export const GUIDANCE_V2 = `${GUIDANCE_V1}\n\nReviderad utgåva: rekommenderat skyddsavstånd mellan brunn och avloppsanläggning är minst 50 meter i genomsläppliga jordarter.`;

export const GUIDANCE_LINEAGE_KEY = 'sgu:vagledning-for-att-borra-brunn';

export const NEAR_DUPLICATE_COURT_A = COURT_A.replace(
  'avslår överklagandet och fastställer',
  'avslår överklagandet i huvudsak och fastställer',
);

export interface FixtureCorpus {
  readonly snapshot: CorpusSnapshot;
  readonly keys: Readonly<Record<string, string>>;
  readonly docs: Readonly<Record<string, CorpusDocumentProjection>>;
}

async function project(input: CorpusDocumentInput): Promise<CorpusDocumentProjection> {
  const outcome = await projectDocument(input, { catalog, extractor: utf8 });
  if (outcome.kind !== 'PROJECTED') throw new Error(JSON.stringify(outcome));
  return outcome.document;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function fixtureCorpus(
  options: { readonly includeNearDuplicate?: boolean } = {},
): Promise<FixtureCorpus> {
  const docs: Record<string, CorpusDocumentProjection> = {
    law_mb: await project({ source_id: SFS.source_id, doc_name: 'sfst-1998-808', bytes: enc(LAW_MB) }),
    ord_mpf: await project({ source_id: MPF.source_id, doc_name: 'sfst-2013-251', bytes: enc(ORD_MPF) }),
    court_a: await project({ source_id: PUH.source_id, doc_name: 'MMOD_M_1001-25.pdf', bytes: enc(COURT_A) }),
    court_b: await project({ source_id: PUH.source_id, doc_name: 'MMOD_M_2002-25.pdf', bytes: enc(COURT_B) }),
    decision_mora: await project({
      source_id: MHN.source_id,
      doc_name: 'beslut-mora.pdf',
      bytes: enc(DECISION_MORA),
    }),
    // Two harvests of the SAME publication: a version lineage (keyed), v2 current.
    guidance_v1: await project({
      source_id: SGU.source_id,
      doc_name: 'vagledning',
      bytes: enc(GUIDANCE_V1),
      acquisition: { acquired_at: '2026-08-20T00:00:00.000Z' },
      source_version_label: 'utgåva 2024',
      version_lineage_key: GUIDANCE_LINEAGE_KEY,
    }),
    guidance_v2: await project({
      source_id: SGU.source_id,
      doc_name: 'vagledning',
      bytes: enc(GUIDANCE_V2),
      acquisition: { acquired_at: '2026-09-06T00:00:00.000Z' },
      source_version_label: 'utgåva 2026',
      version_lineage_key: GUIDANCE_LINEAGE_KEY,
    }),
  };
  if (options.includeNearDuplicate) {
    docs.court_a_near_duplicate = await project({
      source_id: PUH.source_id,
      doc_name: 'MMOD_M_1001-25-kopia.pdf',
      bytes: enc(NEAR_DUPLICATE_COURT_A),
    });
  }
  const snapshot = buildCorpusSnapshot(Object.values(docs), { catalog_origin: ORIGIN });
  const keys = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.document_id]));
  return { snapshot, keys, docs };
}
