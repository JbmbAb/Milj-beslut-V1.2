import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const classify = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'storage/manifests/review-classification.json'), 'utf8'),
);
const quarantined = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'storage/manifests/review-quarantine-execute.json'), 'utf8')).log.map(
    (l) => l.folder,
  ),
);

const manual = classify.allFolders.filter(
  (e) => e.action === 'manual_review' && !quarantined.has(e.folder),
);

function suggest(name) {
  const n = name.toLowerCase();
  if (/^analys_|geofysik|gron_infrastruktur|gtiff/i.test(n)) {
    return ['SGU', 'geofysik_analys', 'promote', 'high'];
  }
  if (/svar|avrinningsomrad|vattenforekomst|hydro/i.test(n)) {
    return ['SMHI', 'SVAR2022', 'promote', 'high'];
  }
  if (/vatmark|myrskydd|betesmark|naturtyp|trad|skog|nmd|preciserad|potentiella|satellitbaserad/i.test(n)) {
    return ['Naturvardsverket', name.slice(0, 60), 'promote', 'med'];
  }
  if (/^msb|inspiremsb|svaro|varo|pfra|olyckor|stabilitet/i.test(n)) {
    return ['MSB', name.slice(0, 60), 'promote', 'high'];
  }
  if (/vardetrakt|buller|platser/i.test(n)) {
    return ['Naturvardsverket', name.slice(0, 60), 'promote', 'med'];
  }
  if (/bolagsverket|scb/i.test(n)) {
    return ['_quarantine', 'admin_bulkfil', 'quarantine', 'high'];
  }
  if (/seveso/i.test(n)) {
    return ['MSB', 'seveso', 'promote', 'med'];
  }
  if (/jordart|berg|grund|brunn|sgu|cykel/i.test(n)) {
    return ['SGU', name.slice(0, 60), 'promote', 'med'];
  }
  if (/mätdata|matdata|senaste-gpkg|senaste-csv/i.test(n)) {
    return ['Lantmateriet', 'Fastighet_Senaste', 'promote', 'med'];
  }
  if (
    /storuman|torsby|harnosand|solleftea|ostersund|mullsj|hultsfred|stromsund|vilhelmina|sundsvall|historik|malung|habo|krokom|are-/i.test(n) ||
    /^\d{4}/.test(n) ||
    /^[A-Za-zÅÄÖåäö]+[- ]?\d{4}/.test(name)
  ) {
    return ['Lantmateriet', `KommunHistorik/${name.slice(0, 50)}`, 'promote_kommun', 'med'];
  }
  return ['', '', 'manual_review', 'low'];
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const rows = manual
  .sort((a, b) => b.sizeGB - a.sizeGB)
  .map((e) => {
    const [provider, dataset, action, confidence] = suggest(e.folder);
    return [
      e.folder,
      e.sizeGB,
      e.fileCount,
      provider,
      dataset,
      action,
      confidence,
      '',
    ];
  });

const header = [
  'folder',
  'size_gb',
  'file_count',
  'suggested_provider',
  'suggested_dataset',
  'suggested_action',
  'confidence',
  'approved',
];
const out = path.join(ROOT, 'storage/manifests/review-manual-review-proposal.csv');
fs.writeFileSync(out, [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'utf8');

const summary = {
  total: manual.length,
  totalGB: Number(manual.reduce((s, e) => s + e.sizeGB, 0).toFixed(2)),
  high: rows.filter((r) => r[6] === 'high').length,
  med: rows.filter((r) => r[6] === 'med').length,
  low: rows.filter((r) => r[6] === 'low').length,
  autoPromote: rows.filter((r) => r[5] === 'promote' || r[5] === 'promote_kommun').length,
  quarantine: rows.filter((r) => r[5] === 'quarantine').length,
  needsOpen: rows.filter((r) => r[5] === 'manual_review').length,
};

console.log(JSON.stringify(summary, null, 2));
console.log(`CSV: ${out}`);
