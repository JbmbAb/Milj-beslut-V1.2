import { prisma } from "../db/prisma";

const db = prisma as any;
let vectorTypeAvailable: boolean | null = null;
let vectorColumnAvailable: boolean | null = null;

const ACTIVE_JOB_STATUSES = ["PENDING", "RUNNING"] as const;

function normalizeProjectId(projectId?: string): string | null {
  const normalized = String(projectId || "").trim();
  return normalized || null;
}

function payloadDocumentId(payload: Record<string, unknown> | null | undefined): string {
  const raw = payload && typeof payload.documentId === "string" ? payload.documentId : "";
  return String(raw || "").trim();
}

function countByStatus(rows: Array<{ status: string; _count: { _all: number } }>): Map<string, number> {
  return new Map(rows.map((row) => [String(row.status), Number(row._count?._all || 0)]));
}

async function probeVectorTypeAvailability(): Promise<boolean> {
  if (vectorTypeAvailable !== null) {
    return vectorTypeAvailable;
  }

  try {
    const probe = await db.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') AS exists`
    );
    const exists = Array.isArray(probe) && probe.length > 0 ? Boolean((probe[0] as { exists?: unknown }).exists) : false;
    vectorTypeAvailable = exists;
  } catch {
    vectorTypeAvailable = false;
  }

  return vectorTypeAvailable;
}

async function probeVectorColumnAvailability(): Promise<boolean> {
  if (vectorColumnAvailable !== null) {
    return vectorColumnAvailable;
  }

  try {
    const probe = await db.$queryRawUnsafe(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'DocumentChunk'
           AND column_name = 'embeddingVector'
       ) AS exists`
    );
    const exists = Array.isArray(probe) && probe.length > 0 ? Boolean((probe[0] as { exists?: unknown }).exists) : false;
    vectorColumnAvailable = exists;
  } catch {
    vectorColumnAvailable = false;
  }

  return vectorColumnAvailable;
}

export interface ManifestDocumentInput {
  projectId: string;
  organisationId: string;
  entryId: string;
  receivedTime: Date | null;
  subject: string;
  originalName: string;
  diskName: string;
  absolutePath: string;
  fileSize?: bigint | null;
  fileSha256?: string | null;
  mimeType?: string | null;
  decisionType?: string | null;
  municipality?: string | null;
  wasteType?: string | null;
  hazardousFlag?: boolean | null;
  activityCode?: string | null;
  legalStatus?: string | null;
  manifestMeta?: Record<string, unknown> | null;
  preserveStatusOnUpdate?: boolean;
}

export async function upsertDocumentFromManifest(input: ManifestDocumentInput) {
  return db.documentRecord.upsert({
    where: { diskName: input.diskName },
    create: {
      projectId: input.projectId,
      organisationId: input.organisationId,
      entryId: input.entryId,
      receivedTime: input.receivedTime,
      subject: input.subject,
      originalName: input.originalName,
      diskName: input.diskName,
      absolutePath: input.absolutePath,
      fileSize: input.fileSize || null,
      fileSha256: input.fileSha256 || null,
      mimeType: input.mimeType || null,
      decisionType: input.decisionType || null,
      municipality: input.municipality || null,
      wasteType: input.wasteType || null,
      hazardousFlag: input.hazardousFlag ?? null,
      activityCode: input.activityCode || null,
      legalStatus: input.legalStatus || null,
      manifestMeta: input.manifestMeta || undefined,
      status: "METADATA_ONLY",
    },
    update: {
      projectId: input.projectId,
      organisationId: input.organisationId,
      entryId: input.entryId,
      receivedTime: input.receivedTime,
      subject: input.subject,
      originalName: input.originalName,
      absolutePath: input.absolutePath,
      fileSize: input.fileSize || null,
      fileSha256: input.fileSha256 || null,
      mimeType: input.mimeType || null,
      decisionType: input.decisionType || null,
      municipality: input.municipality || null,
      wasteType: input.wasteType || null,
      hazardousFlag: input.hazardousFlag ?? null,
      activityCode: input.activityCode || null,
      legalStatus: input.legalStatus || null,
      manifestMeta: input.manifestMeta || undefined,
      ...(input.preserveStatusOnUpdate ? {} : { status: "METADATA_ONLY" }),
    },
  });
}

export async function findDocumentByDiskName(diskName: string) {
  return db.documentRecord.findUnique({
    where: { diskName },
    include: { content: true },
  });
}

export async function enqueueSearchJob(input: {
  type: "SYNC_MANIFEST" | "EXTRACT_TEXT" | "EMBED_DOC";
  projectId?: string;
  payload: Record<string, unknown>;
}) {
  const projectId = normalizeProjectId(input.projectId);
  const documentId = payloadDocumentId(input.payload);
  const activeJobs = await db.searchJob.findMany({
    where: {
      type: input.type,
      projectId,
      status: { in: Array.from(ACTIVE_JOB_STATUSES) },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const existing = activeJobs.find((job: { payload?: Record<string, unknown> | null }) => {
    const existingDocumentId = payloadDocumentId(job.payload || {});
    if (documentId) {
      return existingDocumentId === documentId;
    }
    return !existingDocumentId;
  });

  if (existing) {
    return existing;
  }

  return db.searchJob.create({
    data: {
      type: input.type,
      projectId,
      payload: input.payload,
      status: "PENDING",
    },
  });
}

export async function getNextPendingJob(preferredType?: "SYNC_MANIFEST" | "EXTRACT_TEXT" | "EMBED_DOC") {
  if (preferredType) {
    const prioritized = await db.searchJob.findFirst({
      where: { status: "PENDING", type: preferredType },
      orderBy: { createdAt: "asc" },
    });
    if (prioritized) {
      return prioritized;
    }
  }

  return db.searchJob.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

export async function markJobRunning(jobId: string) {
  return db.searchJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: new Date(),
      error: null,
    },
  });
}

export async function markJobDone(jobId: string) {
  return db.searchJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
    },
  });
}

export async function markJobFailed(jobId: string, error: string) {
  return db.searchJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      error,
      finishedAt: new Date(),
    },
  });
}

export async function markJobFailedOrRetry(jobId: string, error: string, maxAttempts: number = 3) {
  const allowedAttempts = Math.max(1, Math.min(10, Number(maxAttempts || 3)));
  const job = await db.searchJob.findUnique({
    where: { id: jobId },
    select: { attempts: true },
  });

  if (!job) {
    return { status: "FAILED" as const, attempts: 0 };
  }

  if (Number(job.attempts || 0) < allowedAttempts) {
    await db.searchJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        error,
        startedAt: null,
        finishedAt: null,
      },
    });
    return { status: "REQUEUED" as const, attempts: Number(job.attempts || 0) };
  }

  await markJobFailed(jobId, error);
  return { status: "FAILED" as const, attempts: Number(job.attempts || 0) };
}

export async function getDocumentById(documentId: string) {
  return db.documentRecord.findUnique({
    where: { id: documentId },
    include: {
      content: true,
    },
  });
}

export async function deleteDocumentById(documentId: string) {
  const existing = await db.documentRecord.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      projectId: true,
      organisationId: true,
      originalName: true,
      absolutePath: true,
      mimeType: true,
    },
  });

  if (!existing) {
    return null;
  }

  let deletedSearchJobs = 0;
  await db.$transaction(async (tx: any) => {
    const result = await tx.$executeRawUnsafe(
      `DELETE FROM "SearchJob" WHERE payload->>'documentId' = $1`,
      documentId
    );
    deletedSearchJobs = Number(result || 0);

    await tx.documentRecord.delete({
      where: { id: documentId },
    });
  });

  return {
    ...existing,
    deletedSearchJobs,
  };
}

export async function setDocumentStatus(documentId: string, status: "METADATA_ONLY" | "TEXT_EXTRACTED" | "EMBEDDED" | "FAILED") {
  return db.documentRecord.update({
    where: { id: documentId },
    data: { status },
  });
}

export async function upsertDocumentContent(input: {
  documentId: string;
  contentCiphertext: string;
  contentIv: string;
  contentTag: string;
  keyVersion: number;
  searchText: string;
}) {
  return db.documentContent.upsert({
    where: { documentId: input.documentId },
    create: input,
    update: {
      contentCiphertext: input.contentCiphertext,
      contentIv: input.contentIv,
      contentTag: input.contentTag,
      keyVersion: input.keyVersion,
      searchText: input.searchText,
    },
  });
}

export async function replaceDocumentChunks(input: {
  documentId: string;
  chunks: Array<{ chunkIndex: number; chunkText: string; embeddingJson?: number[] | null }>;
}) {
  await db.documentChunk.deleteMany({
    where: { documentId: input.documentId },
  });

  for (const chunk of input.chunks) {
    await db.documentChunk.create({
      data: {
        documentId: input.documentId,
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        embeddingJson: chunk.embeddingJson ?? undefined,
      },
    });
  }
}

export async function updateChunkVector(documentChunkId: string, vectorLiteral: string) {
  if (vectorTypeAvailable === false || vectorColumnAvailable === false) {
    return;
  }

  const [hasVectorType, hasVectorColumn] = await Promise.all([
    probeVectorTypeAvailability(),
    probeVectorColumnAvailability(),
  ]);
  if (!hasVectorType || !hasVectorColumn) {
    return;
  }

  try {
    await db.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET "embeddingVector" = $1::vector WHERE id = $2`,
      vectorLiteral,
      documentChunkId
    );
  } catch {
    // Optional optimization path: keep going with JSON embeddings when vector column/extension is unavailable.
    vectorColumnAvailable = false;
  }
}

export async function setChunkEmbeddingJson(documentChunkId: string, embedding: number[]) {
  return db.documentChunk.update({
    where: { id: documentChunkId },
    data: { embeddingJson: embedding },
  });
}

export async function listChunksForProject(projectId?: string, limit: number = 2000) {
  return db.documentChunk.findMany({
    where: {
      document: {
        ...(projectId ? { projectId } : {}),
      },
    },
    include: {
      document: {
        select: {
          id: true,
          projectId: true,
          subject: true,
          originalName: true,
          receivedTime: true,
          decisionType: true,
          municipality: true,
          wasteType: true,
          hazardousFlag: true,
          legalStatus: true,
          status: true,
          project: {
            select: {
              id: true,
              propertyDesignation: true,
              organisation: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    take: limit,
  });
}

export async function listChunksForDocument(documentId: string, limit: number = 5000) {
  return db.documentChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    take: limit,
  });
}

export async function queryTopSemanticChunks(input: {
  queryEmbedding: number[];
  organisationId: string;
  projectId?: string;
  limit?: number;
}) {
  const values = Array.isArray(input.queryEmbedding) ? input.queryEmbedding : [];
  if (values.length === 0) {
    return [] as Array<{ documentId: string; chunkIndex: number; chunkText: string; similarity: number }>;
  }

  const [hasVectorType, hasVectorColumn] = await Promise.all([
    probeVectorTypeAvailability(),
    probeVectorColumnAvailability(),
  ]);
  if (!hasVectorType || !hasVectorColumn) {
    return [] as Array<{ documentId: string; chunkIndex: number; chunkText: string; similarity: number }>;
  }

  const limit = Math.max(1, Math.min(Number(input.limit || 5000), 20_000));
  const vectorLiteral = `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
  const projectId = normalizeProjectId(input.projectId);

  try {
    const rows = projectId
      ? await db.$queryRawUnsafe(
        `SELECT
             c."documentId" AS "documentId",
             c."chunkIndex" AS "chunkIndex",
             c."chunkText" AS "chunkText",
             1 - (c."embeddingVector" <=> $1::vector) AS "similarity"
           FROM "DocumentChunk" c
           INNER JOIN "DocumentRecord" d ON d.id = c."documentId"
           WHERE c."embeddingVector" IS NOT NULL
             AND d."projectId" = $2
             AND d."organisationId" = $3
           ORDER BY c."embeddingVector" <=> $1::vector
           LIMIT $4`,
        vectorLiteral,
        projectId,
        input.organisationId,
        limit
      )
      : await db.$queryRawUnsafe(
        `SELECT
             c."documentId" AS "documentId",
             c."chunkIndex" AS "chunkIndex",
             c."chunkText" AS "chunkText",
             1 - (c."embeddingVector" <=> $1::vector) AS "similarity"
           FROM "DocumentChunk" c
           INNER JOIN "DocumentRecord" d ON d.id = c."documentId"
           WHERE c."embeddingVector" IS NOT NULL
             AND d."organisationId" = $2
           ORDER BY c."embeddingVector" <=> $1::vector
           LIMIT $3`,
        vectorLiteral,
        input.organisationId,
        limit
      );

    if (!Array.isArray(rows)) {
      return [] as Array<{ documentId: string; chunkIndex: number; chunkText: string; similarity: number }>;
    }

    return rows
      .map((row) => ({
        documentId: String((row as { documentId?: unknown }).documentId || ""),
        chunkIndex: Number((row as { chunkIndex?: unknown }).chunkIndex || 0),
        chunkText: String((row as { chunkText?: unknown }).chunkText || ""),
        similarity: Number((row as { similarity?: unknown }).similarity || 0),
      }))
      .filter((row) => Boolean(row.documentId));
  } catch {
    vectorColumnAvailable = false;
    return [] as Array<{ documentId: string; chunkIndex: number; chunkText: string; similarity: number }>;
  }
}

export async function findDocumentsForProject(input: {
  organisationId: string;
  projectId?: string;
  query?: string;
  municipality?: string;
  decisionType?: string;
  wasteType?: string;
  status?: string;
  legalStatus?: string;
  hazardousFlag?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  take: number;
}) {
  const result = await db.documentRecord.findMany({
    where: {
      organisationId: input.organisationId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.query
        ? {
          OR: [
            { subject: { contains: input.query, mode: "insensitive" } },
            { originalName: { contains: input.query, mode: "insensitive" } },
            { diskName: { contains: input.query, mode: "insensitive" } },
          ],
        }
        : {}),
      ...(input.municipality ? { municipality: input.municipality } : {}),
      ...(input.decisionType ? { decisionType: input.decisionType } : {}),
      ...(input.wasteType ? { wasteType: input.wasteType } : {}),
      ...(input.status ? { status: input.status as any } : {}),
      ...(input.legalStatus ? { legalStatus: input.legalStatus } : {}),
      ...(typeof input.hazardousFlag === "boolean" ? { hazardousFlag: input.hazardousFlag } : {}),
      ...((input.dateFrom || input.dateTo)
        ? {
          receivedTime: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
        : {}),
    },
    include: {
      content: {
        select: {
          searchText: true,
        },
      },
      project: {
        select: {
          id: true,
          propertyDesignation: true,
          organisation: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ receivedTime: "desc" }, { createdAt: "desc" }],
    take: input.take,
  });
  return result;
}

export async function logSearchQuery(input: {
  userId: string;
  projectId: string;
  query: string;
  mode: "semantic" | "lexical" | "hybrid";
  topK: number;
  resultCount: number;
  elapsedMs: number;
}) {
  return db.searchQueryLog.create({
    data: input,
  });
}

export async function getSearchStatus(projectId?: string) {
  const projectWhere = projectId ? { projectId } : {};
  const staleCutoff = new Date(Date.now() - 30 * 60_000);

  const [docsByStatus, jobByStatus, documentsTotal, chunksTotal, embeddedChunks, staleRunningJobs] = await Promise.all([
    db.documentRecord.groupBy({
      by: ["status"],
      where: projectWhere,
      _count: { _all: true },
    }),
    db.searchJob.groupBy({
      by: ["status"],
      where: projectWhere,
      _count: { _all: true },
    }),
    db.documentRecord.count({ where: projectWhere }),
    db.documentChunk.count({
      where: {
        document: projectWhere,
      },
    }),
    db.documentChunk.count({
      where: {
        embeddingJson: { not: null },
        document: projectWhere,
      },
    }),
    db.searchJob.count({
      where: {
        ...projectWhere,
        status: "RUNNING",
        OR: [{ startedAt: null }, { startedAt: { lt: staleCutoff } }],
      },
    }),
  ]);

  const docCounts = countByStatus(docsByStatus);
  const jobCounts = countByStatus(jobByStatus);
  const chunkEmbeddingCoveragePct =
    chunksTotal === 0 ? 0 : Number(((Number(embeddedChunks || 0) / Number(chunksTotal || 0)) * 100).toFixed(1));

  return {
    documents: docsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    jobs: jobByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    summary: {
      documentsTotal: Number(documentsTotal || 0),
      metadataOnlyDocuments: Number(docCounts.get("METADATA_ONLY") || 0),
      textExtractedDocuments: Number(docCounts.get("TEXT_EXTRACTED") || 0),
      embeddedDocuments: Number(docCounts.get("EMBEDDED") || 0),
      failedDocuments: Number(docCounts.get("FAILED") || 0),
      jobsPending: Number(jobCounts.get("PENDING") || 0),
      jobsRunning: Number(jobCounts.get("RUNNING") || 0),
      jobsDone: Number(jobCounts.get("DONE") || 0),
      jobsFailed: Number(jobCounts.get("FAILED") || 0),
      staleRunningJobs: Number(staleRunningJobs || 0),
      totalChunks: Number(chunksTotal || 0),
      embeddedChunks: Number(embeddedChunks || 0),
      chunkEmbeddingCoveragePct,
    },
  };
}

export async function recoverStaleRunningJobs(input?: { projectId?: string; maxAgeMinutes?: number; limit?: number }) {
  const projectId = normalizeProjectId(input?.projectId);
  const maxAgeMinutes = Math.max(5, Math.min(24 * 60, Number(input?.maxAgeMinutes || 30)));
  const limit = Math.max(1, Math.min(1000, Number(input?.limit || 200)));
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);

  const staleJobs = await db.searchJob.findMany({
    where: {
      status: "RUNNING",
      ...(projectId ? { projectId } : {}),
      OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }],
    },
    select: { id: true },
    orderBy: { startedAt: "asc" },
    take: limit,
  });

  if (staleJobs.length === 0) {
    return 0;
  }

  await db.searchJob.updateMany({
    where: {
      id: {
        in: staleJobs.map((job: { id: string }) => String(job.id)),
      },
    },
    data: {
      status: "PENDING",
      error: "Recovered stale RUNNING job",
      startedAt: null,
      finishedAt: null,
    },
  });

  return staleJobs.length;
}

export async function requeueFailedJobs(projectId: string, limit: number = 100) {
  const jobs = await db.searchJob.findMany({
    where: {
      projectId,
      status: "FAILED",
    },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  if (jobs.length === 0) {
    return 0;
  }

  await db.searchJob.updateMany({
    where: {
      id: {
        in: jobs.map((job) => job.id),
      },
    },
    data: {
      status: "PENDING",
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  });
  return jobs.length;
}

export async function getProjectDocumentCount(projectId: string) {
  return db.documentRecord.count({ where: { projectId } });
}

export async function listProjectsForAdmin(organisationId: string) {
  return db.project.findMany({
    where: { organisationId },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
          orgNumber: true,
        },
      },
      _count: {
        select: {
          documents: true,
          members: true,
          accessLogs: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export async function createOrGetAdminProject(input: {
  organisationId: string;
  userId: string;
  propertyDesignation: string;
}) {
  const designation = String(input.propertyDesignation || "").trim();
  if (!designation) {
    throw new Error("propertyDesignation is required");
  }

  const existing = await db.project.findFirst({
    where: {
      organisationId: input.organisationId,
      propertyDesignation: designation,
      status: "ACTIVE",
    },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
          orgNumber: true,
        },
      },
      _count: {
        select: {
          documents: true,
          members: true,
          accessLogs: true,
        },
      },
    },
  });

  if (existing) {
    await db.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: existing.id,
          userId: input.userId,
        },
      },
      create: {
        projectId: existing.id,
        userId: input.userId,
        accessRole: "OWNER",
      },
      update: {},
    });

    return { project: existing, created: false as const };
  }

  const createdProject = await db.project.create({
    data: {
      organisationId: input.organisationId,
      propertyDesignation: designation,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await db.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: createdProject.id,
        userId: input.userId,
      },
    },
    create: {
      projectId: createdProject.id,
      userId: input.userId,
      accessRole: "OWNER",
    },
    update: {},
  });

  const project = await db.project.findUnique({
    where: { id: createdProject.id },
    select: {
      id: true,
      propertyDesignation: true,
      status: true,
      createdAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
          orgNumber: true,
        },
      },
      _count: {
        select: {
          documents: true,
          members: true,
          accessLogs: true,
        },
      },
    },
  });

  if (!project) {
    throw new Error("Failed to load created project");
  }

  return { project, created: true as const };
}
