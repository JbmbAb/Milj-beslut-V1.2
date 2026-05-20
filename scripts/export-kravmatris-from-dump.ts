import { promises as fs } from 'node:fs';

type ParseOptionsResult = {
  inputPath?: string;
  outputPath: string;
  maxPerDocument: number;
  limitDocs?: number;
  projectId?: string;
  projectNameIncludes?: string;
};

export type RequirementBuildRow = Record<string, string> & {
  CaseId: string;
  KravId: string;
  KravkallaTyp: string;
  Kravkategori: string;
  Kravsubkategori: string;
  KravtextCitat: string;
  TolkadKravtext: string;
  Kravniva: string;
  RattsligHanvisning: string;
  Tidsfrist: string;
  Kontrollfrekvens: string;
  SanktionEllerKonsekvens: string;
  UtlosandeVillkor: string;
  Avfallsslag: string;
  EWC: string;
  MaxMangdTon: string;
  MaxLagringstid: string;
  KopplingKonstruktion: string;
  KopplingLakvatten: string;
  KopplingKontrollprogram: string;
  KopplingRisk: string;
  Mallavsnitt: string;
  KommunBlankettFalt: string;
  BilagaSomStods: string;
  MinimikravJaNej: string;
  KommunspecifiktJaNej: string;
  StatusIAnmalan: string;
  Kommentar: string;
  _documentId: string;
  _caseKey: string;
  _projectId: string;
  _organisationId: string;
  _subject: string;
  Kommun: string;
  Myndighetstyp: string;
  Myndighet: string;
  Diarienummer: string;
  Dokumenttyp: string;
  Dokumentdatum: string;
  KallaFil: string;
};

function parseIntegerArg(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOptions(argv: string[]): ParseOptionsResult {
  const args = argv.slice(2);
  const inputPath = args.find((arg) => arg.startsWith('--input='))?.slice('--input='.length).trim();
  const outputPath =
    args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length).trim() ||
    'kravmatris_mellanlagring_autofylld.csv';
  const maxPerDocument =
    parseIntegerArg(args.find((arg) => arg.startsWith('--max-per-document='))?.slice('--max-per-document='.length)) ?? 3;
  const limitDocs = parseIntegerArg(args.find((arg) => arg.startsWith('--limit-docs='))?.slice('--limit-docs='.length));
  const projectId = args.find((arg) => arg.startsWith('--project-id='))?.slice('--project-id='.length).trim();
  const projectNameIncludes = args
    .find((arg) => arg.startsWith('--project-name='))?.slice('--project-name='.length).trim();

  return { inputPath, outputPath, maxPerDocument, limitDocs, projectId, projectNameIncludes };
}

export async function readDumpFromFile(inputPath: string): Promise<unknown> {
  const raw = await fs.readFile(inputPath, 'utf8');
  return JSON.parse(raw);
}

export async function readDumpFromDb(): Promise<unknown> {
  return [];
}

function isRequirementBuildRow(value: unknown): value is RequirementBuildRow {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RequirementBuildRow).KravId === 'string' &&
      typeof (value as RequirementBuildRow)._documentId === 'string',
  );
}

export function buildRows(dump: unknown, _options: ParseOptionsResult): RequirementBuildRow[] {
  if (Array.isArray(dump)) {
    return dump.filter(isRequirementBuildRow);
  }
  if (dump && typeof dump === 'object') {
    const rows = (dump as { rows?: unknown; requirementRows?: unknown }).requirementRows ?? (dump as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows.filter(isRequirementBuildRow);
    }
  }
  return [];
}
