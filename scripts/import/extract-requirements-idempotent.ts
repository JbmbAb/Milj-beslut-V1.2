import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
const prisma = new PrismaClient();

type ParseArgs = {
  projectId?: string;
  limit: number;
  dryRun: boolean;
};

type QueueRow = {
  attachment_hash: string;
  document_id: string;
  filename: string;
  stored_path: string | null;
  canonical_message_id: string;
  project_id: string;
  organisation_id: string;
  municipality: string | null;
  decision_type: string | null;
  subject: string;
  legal_status: string | null;
  search_text: string | null;
};

type Counters = {
  queueRows: number;
  processedDocs: number;
  requirementUpserts: number;
  citationUpserts: number;
  attachmentsMarkedParsed: number;
  warnings: number;
};

const REQUIREMENT_KEYWORDS = [
  'ska',
  'skall',
  'maste',
  'far inte',
  'kravs',
  'bor',
  'krav',
  'villkor',
];

function arg(name: string): string | undefined {
  const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (!entry) return undefined;
  return entry.slice(name.length + 3).trim();
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArgs(): ParseArgs {
  const projectId = arg('project-id') || undefined;
  const limit = Math.max(1, Math.min(5000, Number(arg('limit') || 500)));
  const dryRun = flag('dry-run');
  return { projectId, limit, dryRun };
}

function createRunId(prefix: string): string {
  const iso = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${prefix}_${iso}`;
}

async function ensureTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ingest_runs (
      run_id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      notes TEXT
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS email_messages (
      message_id TEXT PRIMARY KEY,
      sender TEXT,
      subject TEXT,
      received_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'NEW',
      run_id TEXT REFERENCES ingest_runs(run_id)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS attachments (
      attachment_hash TEXT PRIMARY KEY,
      canonical_message_id TEXT NOT NULL REFERENCES email_messages(message_id),
      filename TEXT NOT NULL,
      filesize BIGINT,
      checksum_sha256 TEXT NOT NULL,
      stored_path TEXT,
      parsed BOOLEAN NOT NULL DEFAULT FALSE,
      document_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS attachment_occurrences (
      message_id TEXT NOT NULL REFERENCES email_messages(message_id),
      attachment_hash TEXT NOT NULL REFERENCES attachments(attachment_hash),
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, attachment_hash)
    );
  `);
}

async function fetchQueueRows(projectId: string | undefined, limit: number): Promise<QueueRow[]> {
  return prisma.$queryRawUnsafe<QueueRow[]>(
    `
      SELECT
        a.attachment_hash,
        COALESCE(a.document_id, '') AS document_id,
        a.filename,
        a.stored_path,
        a.canonical_message_id,
        COALESCE(d."projectId", '') AS project_id,
        COALESCE(d."organisationId", '') AS organisation_id,
        d."municipality" AS municipality,
        d."decisionType" AS decision_type,
        COALESCE(d.subject, a.filename) AS subject,
        d."legalStatus" AS legal_status,
        dc."searchText" AS search_text
      FROM attachments a
      LEFT JOIN "DocumentRecord" d ON d.id = a.document_id
      LEFT JOIN "DocumentContent" dc ON dc."documentId" = d.id
      WHERE a.parsed = FALSE
        AND a.document_id IS NOT NULL
        AND ($1::text IS NULL OR d."projectId" = $1)
      ORDER BY a.created_at ASC
      LIMIT $2;
    `,
    projectId || null,
    limit
  );
}

function normalizeText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function loadTextFromFile(filePath: string | null): Promise<string> {
  if (!filePath) return '';
  try {
    const bytes = await fs.readFile(filePath);
    const asUtf8 = normalizeText(bytes.toString('utf8'));
    if (asUtf8.length > 0) return asUtf8;
  } catch {
    return '';
  }
  return '';
}

function splitSegments(text: string): string[] {
  const lines = normalizeText(text)
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 25 && line.length <= 900);
  return Array.from(new Set(lines));
}

function isRequirementCandidate(segment: string): boolean {
  const lower = segment.toLowerCase();
  return REQUIREMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferCategory(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower.includes('dagvatten') || lower.includes('lakvatten') || lower.includes('oljeavskiljare')) {
    return 'DagvattenLakvatten';
  }
  if (lower.includes('platta') || lower.includes('tat') || lower.includes('infiltration') || lower.includes('invall')) {
    return 'Ytkonstruktion';
  }
  if (lower.includes('lagringstid') || lower.includes('ton') || lower.includes('mangd')) {
    return 'LagringVolymTid';
  }
  if (lower.includes('provtag') || lower.includes('analys') || lower.includes('kontrollprogram')) {
    return 'KontrollProvtagning';
  }
  if (lower.includes('buller') || lower.includes('damm') || lower.includes('lukt')) {
    return 'Storningsskydd';
  }
  return 'Ovrigt';
}

function inferRisk(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower.includes('lakvatten') || lower.includes('dagvatten')) return 'Vattenfororening';
  if (lower.includes('buller')) return 'Buller';
  if (lower.includes('damm')) return 'Damm';
  if (lower.includes('lukt')) return 'Lukt';
  if (lower.includes('brand')) return 'Brand';
  return 'GenerellMiljorisk';
}

function inferLevel(segment: string): 'MANDATORY' | 'GUIDANCE' {
  const lower = segment.toLowerCase();
  if (
    lower.includes('ska') ||
    lower.includes('skall') ||
    lower.includes('maste') ||
    lower.includes('far inte') ||
    lower.includes('kravs')
  ) {
    return 'MANDATORY';
  }
  return 'GUIDANCE';
}

function extractLegalReference(segment: string): string | null {
  const lower = segment.toLowerCase();
  const lawMatch = lower.match(
    /(miljobalken|avfallsforordningen|miljoprovningsforordningen|sfs\s*\d{4}:\d+)/
  );
  const chapterMatch = segment.match(/\b\d+\s*kap\.\s*\d+\s*(?:paragraf|\u00A7)?\b/i);
  if (!lawMatch && !chapterMatch) return null;
  const left = lawMatch ? lawMatch[1] : 'Svensk miljolagstiftning';
  const right = chapterMatch ? chapterMatch[0] : '';
  return `${left}${right ? `, ${right}` : ''}`;
}

function extractEwc(segment: string): string | null {
  const match = segment.match(/\b\d{2}\s?\d{2}\s?\d{2}\*?\b/);
  if (!match) return null;
  return match[0].replace(/\s+/g, ' ').trim();
}

function extractDiarie(subject: string, legalStatus: string | null): string | null {
  const joined = `${subject || ''} ${legalStatus || ''}`;
  const m = joined.match(/\b(?:dnr|diarie(?:nummer)?)\s*[:-]?\s*([a-z0-9./-]+)/i);
  if (!m) return null;
  return String(m[1] || '').trim();
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function upsertRequirementCase(input: {
  documentId: string;
  projectId: string;
  organisationId: string;
  municipality: string | null;
  sourceFile: string;
  sourceSubject: string;
  decisionType: string | null;
  diarienummer: string | null;
  dryRun: boolean;
}) {
  if (input.dryRun) {
    return {
      id: `dry_case_${input.documentId}`,
    };
  }
  return prisma.requirementCase.upsert({
    where: {
      documentId: input.documentId,
    },
    create: {
      caseKey: `CASE-${input.documentId}`,
      projectId: input.projectId,
      documentId: input.documentId,
      organisationId: input.organisationId,
      municipality: input.municipality,
      authorityType: 'Kommun',
      authorityName: input.municipality,
      diarienummer: input.diarienummer,
      documentType: input.decisionType,
      sourceFile: input.sourceFile,
      sourceSubject: input.sourceSubject,
    },
    update: {
      municipality: input.municipality,
      authorityName: input.municipality,
      diarienummer: input.diarienummer,
      documentType: input.decisionType,
      sourceFile: input.sourceFile,
      sourceSubject: input.sourceSubject,
    },
    select: {
      id: true,
    },
  });
}

async function markAttachmentParsed(attachmentHash: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await prisma.$executeRawUnsafe(
    `UPDATE attachments SET parsed = TRUE, updated_at = NOW() WHERE attachment_hash = $1;`,
    attachmentHash
  );
}

async function updateEmailStatusesForAttachment(attachmentHash: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const rows = await prisma.$queryRawUnsafe<Array<{ message_id: string }>>(
    `
      SELECT message_id
      FROM attachment_occurrences
      WHERE attachment_hash = $1;
    `,
    attachmentHash
  );
  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE email_messages em
        SET status = CASE
          WHEN NOT EXISTS (
            SELECT 1
            FROM attachment_occurrences ao
            JOIN attachments a ON a.attachment_hash = ao.attachment_hash
            WHERE ao.message_id = em.message_id
              AND a.parsed = FALSE
          )
          THEN 'COMPLETE'
          ELSE 'DOCUMENT_PARSED'
        END,
        processed_at = NOW()
        WHERE em.message_id = $1;
      `,
      row.message_id
    );
  }
}

async function main() {
  const args = parseArgs();
  await ensureTables();

  const runId = createRunId('parse');
  if (!args.dryRun) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ingest_runs (run_id, run_type, status, notes) VALUES ($1, 'PARSE', 'RUNNING', $2);`,
      runId,
      'Requirement extraction run'
    );
  }

  const counters: Counters = {
    queueRows: 0,
    processedDocs: 0,
    requirementUpserts: 0,
    citationUpserts: 0,
    attachmentsMarkedParsed: 0,
    warnings: 0,
  };

  try {
    const queue = await fetchQueueRows(args.projectId, args.limit);
    counters.queueRows = queue.length;

    for (const row of queue) {
      if (!row.document_id || !row.project_id || !row.organisation_id) {
        counters.warnings += 1;
        continue;
      }

      const sourceText = normalizeText(row.search_text || '') || (await loadTextFromFile(row.stored_path));
      const segments = splitSegments(sourceText).filter(isRequirementCandidate);
      const diarie = extractDiarie(row.subject, row.legal_status);

      const caseRow = await upsertRequirementCase({
        documentId: row.document_id,
        projectId: row.project_id,
        organisationId: row.organisation_id,
        municipality: row.municipality,
        sourceFile: row.filename,
        sourceSubject: row.subject,
        decisionType: row.decision_type,
        diarienummer: diarie,
        dryRun: args.dryRun,
      });

      console.log(`Processing doc ${row.document_id} with ${segments.length} segments`);
      for (const segment of segments) {
        const normalizedSegment = normalizeText(segment);
        const requirementCode = `REQ-${shortHash(`${row.document_id}|${normalizedSegment}`)}`;
        console.log(`- Segment hash: ${requirementCode}`);
        const requirementHash = shortHash(`${caseRow.id}|${normalizedSegment}`);
        const category = inferCategory(normalizedSegment);
        const risk = inferRisk(normalizedSegment);
        const level = inferLevel(normalizedSegment);
        const legalReference = extractLegalReference(normalizedSegment);
        const ewcCode = extractEwc(normalizedSegment);
        const confidence = legalReference ? 'HIGH' : level === 'MANDATORY' ? 'MEDIUM' : 'LOW';

        let requirementId = `dry_req_${requirementCode}`;
        if (!args.dryRun) {
          const existingReq = await prisma.requirementRecord.findUnique({
            where: { requirementCode }
          });

          if (existingReq) {
            const updated = await prisma.requirementRecord.update({
              where: { requirementCode },
              data: {
                requirementHash,
                category,
                subcategory: risk,
                interpretedRequirement: normalizedSegment,
                level,
                legalReference: legalReference || null,
                ewcCode: ewcCode || null,
                codingConfidence: confidence,
              },
              select: { id: true }
            });
            requirementId = updated.id;
          } else {
            const created = await prisma.requirementRecord.create({
              data: {
                requirementCode,
                requirementHash,
                caseId: caseRow.id,
                documentId: row.document_id,
                projectId: row.project_id,
                sourceType: 'AUTO_PDF',
                category,
                subcategory: risk,
                requirementTextQuote: normalizedSegment,
                interpretedRequirement: normalizedSegment,
                level,
                legalReference: legalReference || null,
                wasteType: row.decision_type || null,
                ewcCode: ewcCode || null,
                minimumRequirement: level === 'MANDATORY',
                municipalitySpecific: false,
                codingConfidence: confidence,
              },
              select: { id: true }
            });
            requirementId = created.id;
          }
        }
        counters.requirementUpserts += 1;

        const citationCode = `CIT-${shortHash(`${requirementCode}|1`)}`;
        if (!args.dryRun) {
          await prisma.requirementCitation.upsert({
            where: {
              citationCode,
            },
            create: {
              citationCode,
              requirementId,
              caseId: caseRow.id,
              documentId: row.document_id,
              quoteText: normalizedSegment,
              extractor: 'keyword_rule_v1',
              comment: legalReference || null,
            },
            update: {
              quoteText: normalizedSegment,
              comment: legalReference || null,
            },
          });
        }
        counters.citationUpserts += 1;
      }

      await markAttachmentParsed(row.attachment_hash, args.dryRun);
      counters.attachmentsMarkedParsed += 1;
      await updateEmailStatusesForAttachment(row.attachment_hash, args.dryRun);
      counters.processedDocs += 1;
    }

    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs SET finished_at = NOW(), status = 'DONE' WHERE run_id = $1;`,
        runId
      );
    }
  } catch (error: any) {
    console.error(`Extraction failed:`);
    const errorLog = JSON.stringify(error, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2);
    await fs.writeFile('extract_error.txt', errorLog);
    console.error('Full error written to extract_error.txt');

    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs SET finished_at = NOW(), status = 'FAILED', notes = $2 WHERE run_id = $1;`,
        runId,
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }

  console.log('Requirement extraction summary');
  console.log(JSON.stringify({ runId, dryRun: args.dryRun, ...counters }, null, 2));
}

main()
  .catch((error) => {
    console.error('Extraction failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
