import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../server/db/prisma';
import { upsertDocumentFromManifest } from '../../server/repositories/searchRepository';

type CsvRow = Record<string, string>;

type IngestArgs = {
  inputPath: string;
  attachmentsDir?: string;
  projectId: string;
  organisationId: string;
  dryRun: boolean;
};

type IngestCounters = {
  rowsRead: number;
  messagesUpserted: number;
  attachmentsInserted: number;
  attachmentsDuplicate: number;
  documentsLinked: number;
  documentsSkippedAsDuplicate: number;
  warnings: number;
};

function arg(name: string): string | undefined {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) return undefined;
  return value.slice(name.length + 3).trim();
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArgs(): IngestArgs {
  const inputPath = arg('input') || '';
  const projectId = arg('project-id') || '';
  const organisationId = arg('organisation-id') || '';
  const attachmentsDir = arg('attachments-dir') || process.env.OUTLOOK_BASE_DIR || undefined;
  const dryRun = flag('dry-run');

  if (!inputPath) throw new Error('Missing --input=PATH');
  if (!projectId) throw new Error('Missing --project-id=PROJECT_ID');
  if (!organisationId) throw new Error('Missing --organisation-id=ORG_ID');

  return {
    inputPath,
    attachmentsDir,
    projectId,
    organisationId,
    dryRun,
  };
}

function parseCsvLine(line: string, delimiter: ';' | ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

function detectDelimiter(headerLine: string): ';' | ',' {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

async function readCsv(inputPath: string): Promise<CsvRow[]> {
  const raw = await fs.readFile(inputPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i], delimiter);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function pick(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const val = String(row[key] || '').trim();
    if (val) return val;
  }
  return '';
}

function parseDate(value: string): Date | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function normalizeHex64(value: string): string {
  const cleaned = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(cleaned) ? cleaned : '';
}

function syntheticMessageId(sender: string, subject: string, receivedAt: Date | null): string {
  const seed = `${sender}|${subject}|${receivedAt ? receivedAt.toISOString() : ''}`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return `synthetic:${hash}`;
}

function createRunId(prefix: string): string {
  const iso = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${prefix}_${iso}`;
}

async function sha256FromFile(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeExt(filename: string, fallbackExt: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext) return ext;
  const fromFallback = String(fallbackExt || '').trim().toLowerCase();
  if (!fromFallback) return '';
  return fromFallback.startsWith('.') ? fromFallback : `.${fromFallback}`;
}

async function ensureIdempotentTables(): Promise<void> {
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

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_attachments_parsed ON attachments(parsed);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_attachments_document ON attachments(document_id);`);
}

async function upsertEmailMessage(input: {
  messageId: string;
  sender: string;
  subject: string;
  receivedAt: Date | null;
  runId: string;
  dryRun: boolean;
}): Promise<void> {
  if (input.dryRun) return;
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO email_messages (message_id, sender, subject, received_at, processed_at, status, run_id)
      VALUES ($1, $2, $3, $4, NOW(), 'NEW', $5)
      ON CONFLICT (message_id)
      DO UPDATE SET
        sender = EXCLUDED.sender,
        subject = EXCLUDED.subject,
        received_at = COALESCE(email_messages.received_at, EXCLUDED.received_at),
        processed_at = NOW(),
        run_id = EXCLUDED.run_id;
    `,
    input.messageId,
    input.sender || null,
    input.subject || null,
    input.receivedAt,
    input.runId
  );
}

async function upsertAttachmentCanonical(input: {
  attachmentHash: string;
  messageId: string;
  filename: string;
  fileSize: bigint | null;
  storedPath: string;
  dryRun: boolean;
}): Promise<'INSERTED' | 'EXISTING'> {
  if (input.dryRun) return 'INSERTED';
  const row = await prisma.$queryRawUnsafe<Array<{ inserted: boolean }>>(
    `
      WITH ins AS (
        INSERT INTO attachments (
          attachment_hash,
          canonical_message_id,
          filename,
          filesize,
          checksum_sha256,
          stored_path,
          parsed,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $1, $5, FALSE, NOW())
        ON CONFLICT (attachment_hash) DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM ins) AS inserted;
    `,
    input.attachmentHash,
    input.messageId,
    input.filename,
    input.fileSize,
    input.storedPath
  );
  return row[0]?.inserted ? 'INSERTED' : 'EXISTING';
}

async function upsertAttachmentOccurrence(messageId: string, attachmentHash: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO attachment_occurrences (message_id, attachment_hash)
      VALUES ($1, $2)
      ON CONFLICT (message_id, attachment_hash) DO NOTHING;
    `,
    messageId,
    attachmentHash
  );
}

async function findDocumentByHash(projectId: string, fileSha256: string) {
  return prisma.documentRecord.findFirst({
    where: {
      projectId,
      fileSha256,
    },
    select: {
      id: true,
      diskName: true,
    },
  });
}

async function setAttachmentDocumentId(attachmentHash: string, documentId: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await prisma.$executeRawUnsafe(
    `
      UPDATE attachments
      SET document_id = $2, updated_at = NOW()
      WHERE attachment_hash = $1;
    `,
    attachmentHash,
    documentId
  );
}

async function setEmailStatus(messageId: string, status: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await prisma.$executeRawUnsafe(
    `
      UPDATE email_messages
      SET status = $2, processed_at = NOW()
      WHERE message_id = $1;
    `,
    messageId,
    status
  );
}

async function main() {
  const args = parseArgs();
  await ensureIdempotentTables();

  const runId = createRunId('ingest');
  if (!args.dryRun) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ingest_runs (run_id, run_type, status, notes) VALUES ($1, 'INGEST', 'RUNNING', $2);`,
      runId,
      'Idempotent Outlook ingestion run'
    );
  }

  const counters: IngestCounters = {
    rowsRead: 0,
    messagesUpserted: 0,
    attachmentsInserted: 0,
    attachmentsDuplicate: 0,
    documentsLinked: 0,
    documentsSkippedAsDuplicate: 0,
    warnings: 0,
  };

  try {
    const rows = await readCsv(args.inputPath);
    counters.rowsRead = rows.length;

    for (const row of rows) {
      const sender = pick(row, ['sender', 'Sender']);
      const subject = pick(row, ['subject', 'Subject']);
      const receivedRaw = pick(row, ['received_at', 'ReceivedTime', 'Date']);
      const receivedAt = parseDate(receivedRaw);
      const messageIdRaw = pick(row, ['message_id', 'MessageId', 'EntryID', 'EntryId']);
      const messageId = messageIdRaw || syntheticMessageId(sender, subject, receivedAt);
      const fileName = pick(row, ['filename', 'FileName', 'disk_name', 'DiskName']);
      const checksum = normalizeHex64(pick(row, ['checksum', 'Checksum', 'file_sha256', 'Sha256', 'Hash']));
      const ext = safeExt(fileName, pick(row, ['ext', 'Ext']));
      const absPathCandidate =
        pick(row, ['stored_path', 'AbsolutePath', 'FilePath', 'Path']) ||
        (args.attachmentsDir ? path.resolve(args.attachmentsDir, fileName) : '');
      const municipality = pick(row, ['municipality', 'Kommun', 'kommunnamn', 'Municipality']);
      const decisionType = pick(row, ['decision_type', 'Dokumenttyp', 'DecisionType']);
      const wasteType = pick(row, ['waste_type', 'EWC', 'WasteType', 'EwcCode']);
      const diarienummer = pick(row, ['case_number', 'Diarie', 'Diarienummer', 'CaseNumber']);
      const activityCode = pick(row, ['activity_code', 'Verksamhetskod', 'ActivityCode']);
      await upsertEmailMessage({
        messageId,
        sender,
        subject,
        receivedAt,
        runId,
        dryRun: args.dryRun,
      });
      counters.messagesUpserted += 1;

      if (!fileName) {
        counters.warnings += 1;
        continue;
      }

      let fileSize: bigint | null = null;
      let attachmentHash = checksum;
      let absolutePath = absPathCandidate;

      if (!attachmentHash && absolutePath) {
        try {
          const stat = await fs.stat(absolutePath);
          fileSize = BigInt(stat.size);
          attachmentHash = await sha256FromFile(absolutePath);
        } catch {
          counters.warnings += 1;
        }
      }

      if (!attachmentHash) {
        const fallbackSeed = `${messageId}|${fileName}|${receivedAt ? receivedAt.toISOString() : ''}`;
        attachmentHash = crypto.createHash('sha256').update(fallbackSeed).digest('hex');
        counters.warnings += 1;
      }

      if (!absolutePath) {
        absolutePath = args.attachmentsDir ? path.resolve(args.attachmentsDir, `${attachmentHash}${ext}`) : `${attachmentHash}${ext}`;
      }

      const canonicalState = await upsertAttachmentCanonical({
        attachmentHash,
        messageId,
        filename: fileName,
        fileSize,
        storedPath: absolutePath,
        dryRun: args.dryRun,
      });
      await upsertAttachmentOccurrence(messageId, attachmentHash, args.dryRun);

      if (canonicalState === 'INSERTED') counters.attachmentsInserted += 1;
      else counters.attachmentsDuplicate += 1;

      const existingDocument = await findDocumentByHash(args.projectId, attachmentHash);
      if (existingDocument) {
        counters.documentsSkippedAsDuplicate += 1;
        await setAttachmentDocumentId(attachmentHash, existingDocument.id, args.dryRun);
        await setEmailStatus(messageId, 'ATTACHMENTS_EXTRACTED', args.dryRun);
        continue;
      }

      const stableDiskName = `${attachmentHash}${ext}`;
      const document = await upsertDocumentFromManifest({
        projectId: args.projectId,
        organisationId: args.organisationId,
        entryId: messageId,
        receivedTime: receivedAt,
        subject: subject || fileName,
        originalName: fileName,
        diskName: stableDiskName,
        absolutePath,
        fileSize,
        fileSha256: attachmentHash,
        mimeType: null,
        decisionType: decisionType || null,
        municipality: municipality || null,
        wasteType: wasteType || null,
        hazardousFlag: pick(row, ['hazardous_flag', 'FarligtAvfall', 'HazardousFlag']).toLowerCase() === 'true' ? true : null,
        activityCode: activityCode || null,
        legalStatus: diarienummer ? `Diarie: ${diarienummer}` : null,
        manifestMeta: row,
        preserveStatusOnUpdate: true,
      });

      counters.documentsLinked += 1;
      await setAttachmentDocumentId(attachmentHash, String(document.id), args.dryRun);
      await setEmailStatus(messageId, 'ATTACHMENTS_EXTRACTED', args.dryRun);
    }

    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs SET finished_at = NOW(), status = 'DONE' WHERE run_id = $1;`,
        runId
      );
    }
  } catch (error) {
    if (!args.dryRun) {
      await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs SET finished_at = NOW(), status = 'FAILED', notes = $2 WHERE run_id = $1;`,
        runId,
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }

  console.log('Idempotent ingestion summary');
  console.log(JSON.stringify({ runId, dryRun: args.dryRun, ...counters }, null, 2));
}

main()
  .catch((error) => {
    console.error('Ingestion failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
