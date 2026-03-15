import crypto from 'node:crypto';
import { prisma } from '../../server/db/prisma';

type Args = {
  projectId?: string;
  activityName: string;
  dryRun: boolean;
  limit: number;
};

type Counters = {
  requirementsRead: number;
  nodesUpserted: number;
  edgesUpserted: number;
};

function arg(name: string): string | undefined {
  const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (!entry) return undefined;
  return entry.slice(name.length + 3).trim();
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArgs(): Args {
  const projectId = arg('project-id') || undefined;
  const activityName = arg('activity') || 'mellanlagring av avfall';
  const limit = Math.max(1, Math.min(100000, Number(arg('limit') || 10000)));
  const dryRun = flag('dry-run');
  return { projectId, activityName, dryRun, limit };
}

function createRunId(prefix: string): string {
  const iso = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${prefix}_${iso}`;
}

function normalizeName(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function hash24(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function nodeId(nodeType: string, name: string): string {
  return `${nodeType}:${hash24(`${nodeType}|${name.toLowerCase()}`)}`;
}

function edgeId(source: string, relation: string, target: string): string {
  return `edge:${hash24(`${source}|${relation}|${target}`)}`;
}

async function ensureGraphTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS graph_runs (
      run_id TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      notes TEXT
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(node_type, name)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      edge_id TEXT PRIMARY KEY,
      source_node TEXT NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
      target_node TEXT NOT NULL REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_node, target_node, relation_type)
    );
  `);

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_graph_edges_rel ON graph_edges(relation_type);`);
}

async function upsertNode(nodeType: string, name: string, metadata: Record<string, unknown>, dryRun: boolean) {
  const normalizedType = normalizeName(nodeType);
  const normalizedName = normalizeName(name);
  const id = nodeId(normalizedType, normalizedName);
  if (dryRun) return id;
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO graph_nodes (node_id, node_type, name, metadata, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (node_id)
      DO UPDATE SET
        metadata = graph_nodes.metadata || EXCLUDED.metadata,
        updated_at = NOW();
    `,
    id,
    normalizedType,
    normalizedName,
    JSON.stringify(metadata || {})
  );
  return id;
}

async function upsertEdge(
  sourceNode: string,
  relationType: string,
  targetNode: string,
  metadata: Record<string, unknown>,
  dryRun: boolean
) {
  const normalizedRelation = normalizeName(relationType);
  const id = edgeId(sourceNode, normalizedRelation, targetNode);
  if (dryRun) return id;
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO graph_edges (edge_id, source_node, target_node, relation_type, metadata, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (edge_id)
      DO UPDATE SET
        metadata = graph_edges.metadata || EXCLUDED.metadata,
        updated_at = NOW();
    `,
    id,
    sourceNode,
    targetNode,
    normalizedRelation,
    JSON.stringify(metadata || {})
  );
  return id;
}

function inferRestrictionFromText(input: { requirementText: string }): string | null {
  const text = String(input.requirementText || '').toLowerCase();
  if (text.includes('strandskydd')) return 'Strandskydd';
  if (text.includes('naturreservat')) return 'Naturreservat';
  if (text.includes('riksintresse')) return 'Riksintresse';
  if (text.includes('grundvatten')) return 'Grundvatten skydd';
  if (text.includes('fornlämning') || text.includes('kulturmiljö')) return 'Kulturmiljö/Fornlämning';
  return null;
}

const RISK_WEIGHTS: Record<string, number> = {
  'Farligt Avfall': 5,
  'Lab-overskridande': 4,
  'Vattenskyddsomrade': 3,
  'Dokumentationsbrist': 2,
  'Volym-Risk': 2,
  'GenerellMiljorisk': 1
};

function inferRiskFromRequirement(input: { category: string; requirementText: string; activityCode?: string | null }): { type: string; weight: number } {
  const text = String(input.requirementText || '').toLowerCase();
  if (text.includes('farligt avfall') || text.includes('hazardous') || input.activityCode?.startsWith('90.40')) {
    return { type: 'Farligt Avfall', weight: RISK_WEIGHTS['Farligt Avfall'] };
  }
  if (text.includes('riktvärde') || text.includes('överskridande') || text.includes('halt') || text.includes('analys')) {
    return { type: 'Lab-overskridande', weight: RISK_WEIGHTS['Lab-overskridande'] };
  }
  if (text.includes('vattenskydd') || text.includes('grundvatten') || text.includes('invallning')) {
    return { type: 'Vattenskyddsomrade', weight: RISK_WEIGHTS['Vattenskyddsomrade'] };
  }
  if (text.includes('journal') || text.includes('redovisning') || text.includes('rapportering') || text.includes('dokumentation')) {
    return { type: 'Dokumentationsbrist', weight: RISK_WEIGHTS['Dokumentationsbrist'] };
  }
  if (text.includes('mängd') || text.includes('volym') || text.includes('ton ')) {
    return { type: 'Volym-Risk', weight: RISK_WEIGHTS['Volym-Risk'] };
  }

  return { type: 'GenerellMiljorisk', weight: RISK_WEIGHTS['GenerellMiljorisk'] };
}

const ACTIVITY_NAME_MAP: Record<string, string> = {
  '90.40': 'Mellanlagring av avfall',
  '90.30': 'Mellanlagring av schaktmassor',
  '90.10': 'Behandling av avfall',
  '06.00': 'Vindkraft',
  '07.00': 'Solenergi',
  '10.50': 'Krossning/sortering av berg',
};

function getActivityName(code: string | null | undefined): string {
  if (code && ACTIVITY_NAME_MAP[code]) return ACTIVITY_NAME_MAP[code];
  return code || 'Okänd verksamhet';
}

async function main() {
  const args = parseArgs();
  await ensureGraphTables();

  const runId = createRunId('graph');
  if (!args.dryRun) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO graph_runs (run_id, status, notes) VALUES ($1, 'RUNNING', $2);`,
      runId,
      'Build knowledge graph from verified requirement corpus'
    );
  }

  const counters: Counters = {
    requirementsRead: 0,
    nodesUpserted: 0,
    edgesUpserted: 0,
  };

  try {
    const requirements = await prisma.requirementRecord.findMany({
      where: {
        ...(args.projectId ? { projectId: args.projectId } : {}),
      },
      include: {
        case: true,
        document: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: args.limit,
    });
    counters.requirementsRead = requirements.length;

    for (const req of requirements) {
      const municipalityName = normalizeName(req.case?.municipality || req.document?.municipality || 'Okand kommun');
      const caseName = normalizeName(req.case?.caseKey || `CASE-${req.documentId}`);
      const activityName = normalizeName(getActivityName(req.document?.activityCode));
      const ewcName = normalizeName(req.ewcCode || 'Okand EWC');
      const requirementName = normalizeName(req.interpretedRequirement || req.requirementTextQuote || req.requirementCode);
      const risk = inferRiskFromRequirement({
        category: req.category,
        requirementText: requirementName,
        activityCode: req.document?.activityCode
      });
      const legalName = normalizeName(req.legalReference || 'Svensk miljolagstiftning');
      const documentName = normalizeName(req.document?.originalName || req.documentId);

      const nodeMunicipality = await upsertNode('Kommun', municipalityName, {}, args.dryRun);
      const _nodeCase = await upsertNode('Arende', caseName, { documentId: req.documentId }, args.dryRun);
      const nodeActivity = await upsertNode('Verksamhet', activityName, { activityCode: req.document?.activityCode }, args.dryRun);
      const nodeWaste = await upsertNode('Avfallskod', ewcName, {}, args.dryRun);
      const nodeRequirement = await upsertNode(
        'Miljokrav',
        requirementName,
        { category: req.category, level: req.level, requirementCode: req.requirementCode },
        args.dryRun
      );
      const nodeRisk = await upsertNode('Risktyp', risk.type, { baseWeight: risk.weight }, args.dryRun);
      const nodeLaw = await upsertNode('Lagregel', legalName, {}, args.dryRun);
      const nodeDocument = await upsertNode('Dokument', documentName, { documentId: req.documentId }, args.dryRun);

      counters.nodesUpserted += 8;

      // Add RESTRICTION node if inferred
      const restrictionName = inferRestrictionFromText({ requirementText: requirementName });
      if (restrictionName) {
        const nodeRestriction = await upsertNode('Restriktion', restrictionName, {}, args.dryRun);
        counters.nodesUpserted += 1;
        await upsertEdge(nodeRestriction, 'regulated_by', nodeLaw, {}, args.dryRun);
        await upsertEdge(nodeLaw, 'generates', nodeRequirement, {}, args.dryRun);
      }

      await upsertEdge(nodeMunicipality, 'applies', nodeRequirement, {}, args.dryRun);
      await upsertEdge(nodeRequirement, 'relevant_for', nodeActivity, {}, args.dryRun);
      await upsertEdge(nodeActivity, 'generates_waste', nodeWaste, {}, args.dryRun);
      await upsertEdge(nodeRequirement, 'motivates', nodeLaw, {}, args.dryRun);
      await upsertEdge(nodeRequirement, 'handles_risk', nodeRisk, { weight: risk.weight }, args.dryRun);
      await upsertEdge(nodeDocument, 'contains_requirement', nodeRequirement, {}, args.dryRun);

      counters.edgesUpserted += 8;
    }

    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE graph_runs SET finished_at = NOW(), status = 'DONE' WHERE run_id = $1;`,
        runId
      );
    }
  } catch (error) {
    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE graph_runs SET finished_at = NOW(), status = 'FAILED', notes = $2 WHERE run_id = $1;`,
        runId,
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }

  console.log('Knowledge graph build summary');
  console.log(JSON.stringify({ runId, dryRun: args.dryRun, ...counters }, null, 2));
}

main()
  .catch((error) => {
    console.error('Graph build failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
