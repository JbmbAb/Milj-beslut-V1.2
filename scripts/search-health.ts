import { prisma } from "../server/db/prisma";
import { enqueueSearchJob, recoverStaleRunningJobs } from "../server/repositories/searchRepository";

type CliOptions = {
  projectId?: string;
  repair: boolean;
  recoverStale: boolean;
  repairLimit: number;
  staleMinutes: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repair: false,
    recoverStale: false,
    repairLimit: 500,
    staleMinutes: 30,
  };

  for (const arg of argv) {
    if (arg === "--repair") options.repair = true;
    if (arg === "--recover-stale") options.recoverStale = true;
    if (arg.startsWith("--project-id=")) options.projectId = String(arg.split("=")[1] || "").trim() || undefined;
    if (arg.startsWith("--repair-limit=")) {
      options.repairLimit = Math.max(1, Math.min(5000, Number(arg.split("=")[1] || 500)));
    }
    if (arg.startsWith("--stale-minutes=")) {
      options.staleMinutes = Math.max(5, Math.min(24 * 60, Number(arg.split("=")[1] || 30)));
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectFilter = options.projectId ? `AND d."projectId" = '${options.projectId.replace(/'/g, "''")}'` : "";
  const jobProjectFilter = options.projectId ? `AND j."projectId" = '${options.projectId.replace(/'/g, "''")}'` : "";

  const documentSummary = await (prisma as any).$queryRawUnsafe(`
    SELECT d.status, COUNT(*)::int AS count
    FROM "DocumentRecord" d
    WHERE 1=1 ${projectFilter}
    GROUP BY d.status
    ORDER BY d.status;
  `);

  const jobSummary = await (prisma as any).$queryRawUnsafe(`
    SELECT j.status, COUNT(*)::int AS count
    FROM "SearchJob" j
    WHERE 1=1 ${jobProjectFilter}
    GROUP BY j.status
    ORDER BY j.status;
  `);

  const chunkSummary = await (prisma as any).$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total_chunks,
      COUNT(*) FILTER (WHERE c."embeddingJson" IS NOT NULL)::int AS embedded_chunks,
      COUNT(*) FILTER (WHERE c."embeddingJson" IS NULL)::int AS missing_chunks
    FROM "DocumentChunk" c
    JOIN "DocumentRecord" d ON d.id = c."documentId"
    WHERE 1=1 ${projectFilter};
  `);

  const docsNeedingEmbedding = await (prisma as any).$queryRawUnsafe(`
    SELECT d.id, d."projectId", d.status, d."originalName",
      COUNT(*) FILTER (WHERE c."embeddingJson" IS NULL)::int AS missing_chunks
    FROM "DocumentRecord" d
    JOIN "DocumentChunk" c ON c."documentId" = d.id
    WHERE 1=1 ${projectFilter}
    GROUP BY d.id, d."projectId", d.status, d."originalName"
    HAVING d.status = 'TEXT_EXTRACTED' OR COUNT(*) FILTER (WHERE c."embeddingJson" IS NULL) > 0
    ORDER BY missing_chunks DESC, d.status DESC
    LIMIT ${Math.max(1, Math.min(5000, options.repairLimit))};
  `);

  let recovered = 0;
  if (options.recoverStale) {
    recovered = await recoverStaleRunningJobs({
      projectId: options.projectId,
      maxAgeMinutes: options.staleMinutes,
      limit: options.repairLimit,
    });
  }

  let queued = 0;
  if (options.repair) {
    for (const doc of docsNeedingEmbedding as Array<{ id: string; projectId: string }>) {
      await enqueueSearchJob({
        type: "EMBED_DOC",
        projectId: String(doc.projectId),
        payload: { documentId: String(doc.id) },
      });
      queued += 1;
    }
  }

  const chunkRow = Array.isArray(chunkSummary) && chunkSummary.length > 0 ? chunkSummary[0] : { total_chunks: 0, embedded_chunks: 0, missing_chunks: 0 };
  const totalChunks = Number((chunkRow as { total_chunks?: unknown }).total_chunks || 0);
  const embeddedChunks = Number((chunkRow as { embedded_chunks?: unknown }).embedded_chunks || 0);
  const coverage = totalChunks === 0 ? 0 : Number(((embeddedChunks / totalChunks) * 100).toFixed(1));

  console.log(
    JSON.stringify(
      {
        projectId: options.projectId || "global",
        documentSummary,
        jobSummary,
        chunkSummary: {
          totalChunks,
          embeddedChunks,
          missingChunks: Number((chunkRow as { missing_chunks?: unknown }).missing_chunks || 0),
          coveragePct: coverage,
        },
        docsNeedingEmbedding: Array.isArray(docsNeedingEmbedding) ? docsNeedingEmbedding.length : 0,
        actions: {
          recoveredStaleJobs: recovered,
          queuedEmbedJobs: queued,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
