/**
 * Egenkontroll table structure for storage/sorting of excavated masses (K-94b).
 *
 * Structure and typical control points are derived from municipal self-monitoring and control
 * programmes in the corpus (14 documents, identified by sha256 only). No names, reference
 * numbers or verbatim text from them are used: the point names below are generic wording.
 * The six columns follow the fullest programmes (control point, frequency, method, responsible,
 * documentation, deviation); the cells are the user's task, filled only from the user's own
 * underlag (B2/C2 in the demo) and otherwise "användarens uppgift – ej ifylld".
 */
export const EGENKONTROLL_TEMPLATE_ID = 'egenkontroll-struktur-v1';
export const EGENKONTROLL_SOURCE_NOTE = 'struktur ur kommunala egenkontrollprogram i korpusen';

export const CONTROL_FIELDS = ['frekvens', 'metod', 'ansvarig', 'dokumentation', 'avvikelse'] as const;
export type ControlField = (typeof CONTROL_FIELDS)[number];

export const CONTROL_FIELD_LABEL: Record<ControlField, string> = {
  frekvens: 'Frekvens',
  metod: 'Metod',
  ansvarig: 'Ansvarig',
  dokumentation: 'Dokumentation',
  avvikelse: 'Avvikelse',
};

/** The corpus programmes the structure was derived from (sha256 of each PDF). */
export const EGENKONTROLL_SOURCE_DOCUMENTS = [
  '01d056d5d42c640e472dc00be3ed1a8ccb8c38a5e4cf83bd250dcbf704fdaa8b',
  '08e0601c399f793e4136a393d010b9241e409bc6f2885f4bd9658c0416094d30',
  '114d194880e43b48523a168b3443797f8871d8c2e0d5bfaf6a2e55259bd1f4a7',
  '152a7a559902b022eeac503a2bcc1149c9fee6b81220efb4a3888bc43c45dbe1',
  '1f47e03b5d5c0a7436b84abbc91ca6df9faed3a633d3401c5bce2502b0731aee',
  '454533f1d78ee718ee629b6662609dfdda14c02dc338a58745efd66de68fc664',
  '59e16a6bf3b0530f01fb438ba04022069b6a3a31c5a6ab98408be7a0a187458f',
  '71d4e962db4bf3079e7c0062d46834054b1d9c4e621be8368bbbeef7a6d27578',
  'ab24611cb30d75ac69396da3f2560eb40334d46996e5915f06656c461fe6d726',
  'bdea491dec5bf4b2740eb6a373aff07e9e729d03dcbac8c7cf4b7ce60d0244a0',
  'd01042c03d90388c038bcbb68c7e462bb769ef13dfcca7c9a8f4ee0118c2906f',
  'd35a354112ee9838808186227c555a7990714f7cd464dfe6a6e411cd778e341e',
  'e18e57bc209c8f234fb6e4b6eabac745be1cace1ff932a69e6cdf6e7943afe7c',
  'fa0a705473dfc9dfc7847feb4a0563aeaffefcb2569fc41ef385a40871043ca5',
] as const;

export interface EgenkontrollPoint {
  id: string;
  kontrollpunkt: string;
}

export const EGENKONTROLL_POINTS: readonly EgenkontrollPoint[] = [
  { id: 'mottagning', kontrollpunkt: 'Mottagningskontroll av inkommande massor' },
  { id: 'provtagning', kontrollpunkt: 'Provtagning och analys av massor' },
  { id: 'journal', kontrollpunkt: 'Journalföring av mottagna och utlevererade massor' },
  { id: 'mangd', kontrollpunkt: 'Lagrad mängd och lagringstid' },
  { id: 'yta', kontrollpunkt: 'Okulär kontroll av lagrings- och körytor' },
  { id: 'dagvatten', kontrollpunkt: 'Dagvatten, diken och sedimentation' },
  { id: 'damm', kontrollpunkt: 'Damning' },
  { id: 'buller', kontrollpunkt: 'Buller' },
  { id: 'spill', kontrollpunkt: 'Spill och läckage av olja och drivmedel' },
  { id: 'maskiner', kontrollpunkt: 'Underhåll och kontroll av maskiner och utrustning' },
  { id: 'klagomal', kontrollpunkt: 'Klagomål från omgivningen' },
  { id: 'avvikelser', kontrollpunkt: 'Avvikelser och tillbud' },
  { id: 'uppfoljning', kontrollpunkt: 'Årlig genomgång av egenkontrollen och riskbedömningen' },
  { id: 'rapportering', kontrollpunkt: 'Rapportering till tillsynsmyndigheten' },
];
