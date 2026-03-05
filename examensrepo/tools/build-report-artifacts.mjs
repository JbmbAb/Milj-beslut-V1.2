#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { INPUT_FILENAMES, REPORT_HEADERS } from './contracts.mjs';
import { ensureDir, normalizeText, readCsvFile, timestampSlug, toUpper, writeCsvFile, writeJsonFile, yesNoToBool } from './lib.mjs';

const EXAM_TITLE = 'Kartlaggning av kravstallan for mellanlagringsplattor';
const EXAM_PROBLEM_STATEMENT = 'Kartlaggning av kravstallan formulerade av myndighet utifran anmalningsarenden for mellanlagringsplattor i ett stort antal svenska kommuner. Kartlaggningen visar krav pa konstruktion och omhandertagande av lakvatten for mellanlagring av olika avfallstyper.';

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dataset: './working/current',
    out: `./output/release-${timestampSlug()}`,
    author: 'Jimmy Bruce (Nitoves)',
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) parsed.dataset = arg.slice('--dataset='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg.startsWith('--author=')) parsed.author = arg.slice('--author='.length);
  }

  return parsed;
}

function isRequirementVerified(row) {
  return toUpper(row.Verifieringsstatus) === 'VERIFIED' && yesNoToBool(row.VerifieradJaNej);
}

function isCitationUsable(row) {
  const hasAnchor = normalizeText(row.PageNumber) !== '' || normalizeText(row.Kommentar) !== '';
  return yesNoToBool(row.VerifieradJaNej) && normalizeText(row.VerifieradAv) !== '' && normalizeText(row.VerifieradDatum) !== '' && hasAnchor;
}

function stableSort(records, keys) {
  return [...records].sort((a, b) => {
    for (const key of keys) {
      const av = normalizeText(a[key]);
      const bv = normalizeText(b[key]);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

function percent(part, total) {
  if (!total) return '0.0';
  return ((part / total) * 100).toFixed(1);
}

function mapCounts(records, keyBuilder) {
  const map = new Map();
  for (const record of records) {
    const key = keyBuilder(record);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

async function main() {
  const options = parseArgs(process.argv);
  const datasetDir = path.resolve(process.cwd(), options.dataset);
  const outputDir = path.resolve(process.cwd(), options.out);

  const [casesCsv, requirementsCsv, citationsCsv] = await Promise.all([
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.cases)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.requirements)),
    readCsvFile(path.join(datasetDir, INPUT_FILENAMES.citations)),
  ]);

  const caseById = new Map(casesCsv.records.map((row) => [normalizeText(row.CaseId), row]));

  const verifiedRequirements = requirementsCsv.records.filter(isRequirementVerified);
  if (verifiedRequirements.length === 0) {
    throw new Error('No VERIFIED requirements found. Report generation is blocked.');
  }

  const citationsByRequirement = new Map();
  for (const citation of citationsCsv.records) {
    const requirementId = normalizeText(citation.RequirementId);
    if (!requirementId) continue;
    const list = citationsByRequirement.get(requirementId) || [];
    list.push(citation);
    citationsByRequirement.set(requirementId, list);
  }

  const usableRequirementRows = verifiedRequirements.filter((row) => {
    const reqId = normalizeText(row.RequirementId);
    const citations = citationsByRequirement.get(reqId) || [];
    return citations.some(isCitationUsable);
  });

  if (usableRequirementRows.length === 0) {
    throw new Error('No verified requirements with verified citations found.');
  }

  const caseScope = new Map();
  for (const row of usableRequirementRows) {
    const caseId = normalizeText(row.CaseId);
    if (!caseScope.has(caseId) && caseById.has(caseId)) {
      caseScope.set(caseId, caseById.get(caseId));
    }
  }

  const tableAKey = (row) => [normalizeText(row.Kommun), normalizeText(row.Myndighet), normalizeText(row.Dokumenttyp)].join('||');
  const tableAMap = mapCounts([...caseScope.values()], tableAKey);
  const tableA = stableSort(
    [...tableAMap.entries()].map(([key, count]) => {
      const [Kommun, Myndighet, Dokumenttyp] = key.split('||');
      return { Kommun, Myndighet, Dokumenttyp, AntalArenden: String(count) };
    }),
    ['Kommun', 'Myndighet', 'Dokumenttyp']
  );

  const totalRequirements = usableRequirementRows.length;
  const tableBMap = mapCounts(usableRequirementRows, (row) => normalizeText(row.Kravkategori) || 'Okand');
  const tableB = stableSort(
    [...tableBMap.entries()].map(([category, count]) => ({
      Kravkategori: category,
      AntalKrav: String(count),
      AndelProcent: percent(count, totalRequirements),
    })),
    ['Kravkategori']
  );

  const kommunStats = new Map();
  for (const req of usableRequirementRows) {
    const caseRow = caseById.get(normalizeText(req.CaseId));
    const kommun = normalizeText(caseRow?.Kommun) || 'Okand';
    const existing = kommunStats.get(kommun) || {
      Kommun: kommun,
      YtkonstruktionAntal: 0,
      DagvattenLakvattenAntal: 0,
      TotaltVerifieradeKrav: 0,
    };
    const category = toUpper(req.Kravkategori);
    existing.TotaltVerifieradeKrav += 1;
    if (category === 'YTKONSTRUKTION') existing.YtkonstruktionAntal += 1;
    if (category === 'DAGVATTENLAKVATTEN') existing.DagvattenLakvattenAntal += 1;
    kommunStats.set(kommun, existing);
  }

  const tableC = stableSort(
    [...kommunStats.values()].map((row) => ({
      Kommun: row.Kommun,
      YtkonstruktionAntal: String(row.YtkonstruktionAntal),
      DagvattenLakvattenAntal: String(row.DagvattenLakvattenAntal),
      TotaltVerifieradeKrav: String(row.TotaltVerifieradeKrav),
      AndelYtkonstruktionProcent: percent(row.YtkonstruktionAntal, row.TotaltVerifieradeKrav),
      AndelDagvattenLakvattenProcent: percent(row.DagvattenLakvattenAntal, row.TotaltVerifieradeKrav),
    })),
    ['Kommun']
  );

  const tableDMap = mapCounts(usableRequirementRows, (row) => [normalizeText(row.Avfallsslag) || 'Ej angivet', normalizeText(row.EWC) || 'Ej angivet'].join('||'));
  const tableD = stableSort(
    [...tableDMap.entries()].map(([key, count]) => {
      const [Avfallsslag, EWC] = key.split('||');
      return { Avfallsslag, EWC, AntalKrav: String(count) };
    }),
    ['Avfallsslag', 'EWC']
  );

  const evidenceIndex = [];
  for (const req of usableRequirementRows) {
    const requirementId = normalizeText(req.RequirementId);
    const citations = (citationsByRequirement.get(requirementId) || []).filter(isCitationUsable);
    const caseRow = caseById.get(normalizeText(req.CaseId));
    for (const citation of citations) {
      evidenceIndex.push({
        RequirementId: requirementId,
        CitationId: normalizeText(citation.CitationId),
        CaseId: normalizeText(req.CaseId),
        DocumentId: normalizeText(req.DocumentId),
        Kommun: normalizeText(caseRow?.Kommun),
        Myndighet: normalizeText(caseRow?.Myndighet),
        Dokumenttyp: normalizeText(caseRow?.Dokumenttyp),
        Kravkategori: normalizeText(req.Kravkategori),
        Kravsubkategori: normalizeText(req.Kravsubkategori),
        Kravniva: normalizeText(req.Kravniva),
        RattsligHanvisning: normalizeText(req.RattsligHanvisning),
        VerifieradAv: normalizeText(req.VerifieradAv),
        VerifieradDatum: normalizeText(req.VerifieradDatum),
        PageNumber: normalizeText(citation.PageNumber),
        Kommentar: normalizeText(citation.Kommentar),
        KallfilRef: `${normalizeText(caseRow?.KallaFil)}#${normalizeText(citation.PageNumber) || 'comment'}`,
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    author: options.author,
    title: EXAM_TITLE,
    requirementCount: totalRequirements,
    caseCount: caseScope.size,
    municipalityCount: new Set([...caseScope.values()].map((row) => normalizeText(row.Kommun))).size,
    categories: tableB,
    focusCategories: tableC,
  };

  const topCategory = tableB[0]?.Kravkategori || 'okand kategori';
  const report = [
    `# ${EXAM_TITLE}`,
    '',
    `**Forfattare:** ${options.author}`,
    `**Datum:** ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## 1. Inledning',
    EXAM_PROBLEM_STATEMENT,
    '',
    '## 2. Metod',
    '- Datakalla: verifierad kravmatris (endast VERIFIED).',
    '- Analysen omfattar anmalningsarenden for mellanlagringsplattor.',
    '- Human-in-the-loop: samtliga inkluderade rader ar manuellt verifierade med citatspar.',
    '',
    '## 3. Resultat',
    `- Antal verifierade krav: **${summary.requirementCount}**.`,
    `- Antal arenden i underlag: **${summary.caseCount}**.`,
    `- Antal kommuner i underlag: **${summary.municipalityCount}**.`,
    `- Vanligaste kravkategori: **${topCategory}**.`,
    '',
    'Resultattabeller A-D finns i samma releasepaket.',
    '',
    '## 4. Diskussion',
    'Resultaten ska tolkas mot urvalets sammansattning per kommun, dokumenttyp och avfallsslag.',
    'Skillnader mellan kommuner i kategorierna Ytkonstruktion och DagvattenLakvatten ska bedomas med fokus pa lokal tillsynspraxis.',
    '',
    '## 5. Slutsats',
    'Studien identifierar vilka krav som aterkommer, hur de varierar mellan kommuner och hur konstruktion/lakvatten hanteras i praktiken.',
    'Slutsatserna i denna version baseras enbart pa verifierade kravrader.',
    '',
    '## 6. Referenser',
    'Harvard svensk tillampas i slutredigeringen.',
    '',
    '## 7. Bilagor',
    '- Bilaga A: Verifierad kravmatris.',
    '- Bilaga B: Evidensindex.',
  ].join('\n');

  await ensureDir(outputDir);
  await Promise.all([
    writeCsvFile(path.join(outputDir, 'table_a_arenden_per_myndighet.csv'), REPORT_HEADERS.tableA, tableA),
    writeCsvFile(path.join(outputDir, 'table_b_kravfrekvens_per_kategori.csv'), REPORT_HEADERS.tableB, tableB),
    writeCsvFile(path.join(outputDir, 'table_c_kommunskillnader_yt_lakvatten.csv'), REPORT_HEADERS.tableC, tableC),
    writeCsvFile(path.join(outputDir, 'table_d_krav_per_avfall_ewc.csv'), REPORT_HEADERS.tableD, tableD),
    writeCsvFile(path.join(outputDir, 'evidensindex.csv'), REPORT_HEADERS.evidenceIndex, stableSort(evidenceIndex, ['RequirementId', 'CitationId'])),
    writeJsonFile(path.join(outputDir, 'report_summary.json'), summary),
    writeJsonFile(path.join(outputDir, 'report_artifacts_manifest.json'), {
      generatedAt: new Date().toISOString(),
      datasetDir,
      outputDir,
      files: [
        'table_a_arenden_per_myndighet.csv',
        'table_b_kravfrekvens_per_kategori.csv',
        'table_c_kommunskillnader_yt_lakvatten.csv',
        'table_d_krav_per_avfall_ewc.csv',
        'evidensindex.csv',
        'report_summary.json',
        'examensrapport_utkast.md',
      ],
    }),
  ]);

  await fs.writeFile(path.join(outputDir, 'examensrapport_utkast.md'), `${report}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({ ok: true, outputDir, requirementCount: totalRequirements })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});




