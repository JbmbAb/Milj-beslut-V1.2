import { prisma } from '../db/prisma';
import { normalizeProjectPlan, PROJECT_STRUCTURE_SCHEMA_VERSION } from '../../services/projectStructure';
import type { ProjectPlan, ProjectStorageArea, StorageAreaContents } from '../../types';

export type { StorageAreaContents } from '../../types';

type ProjectPlanStateDelegate = {
  findUnique(args: {
    where: { projectId: string };
    select: { plan: true };
  }): Promise<{ plan: unknown } | null>;
  upsert(args: {
    where: { projectId: string };
    create: { projectId: string; schemaVersion: number; plan: ProjectPlan };
    update: { schemaVersion: number; plan: ProjectPlan };
  }): Promise<unknown>;
};

type StorageAreaPlanTx = {
  projectPlanState: ProjectPlanStateDelegate;
};

const createStorageAreaId = () => `STORAGE-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const asStorageAreaPlanTx = (value: unknown): StorageAreaPlanTx => value as StorageAreaPlanTx;

async function loadProjectPlan(tx: StorageAreaPlanTx, projectId: string): Promise<ProjectPlan> {
  const row = await tx.projectPlanState.findUnique({
    where: { projectId },
    select: { plan: true },
  });

  if (!row?.plan || typeof row.plan !== 'object') {
    return normalizeProjectPlan(undefined);
  }

  return normalizeProjectPlan(row.plan as Partial<ProjectPlan>);
}

async function persistProjectPlan(tx: StorageAreaPlanTx, projectId: string, plan: ProjectPlan) {
  await tx.projectPlanState.upsert({
    where: { projectId },
    create: {
      projectId,
      schemaVersion: PROJECT_STRUCTURE_SCHEMA_VERSION,
      plan,
    },
    update: {
      schemaVersion: PROJECT_STRUCTURE_SCHEMA_VERSION,
      plan,
    },
  });
}

export async function createStorageArea(data: {
  projectId: string;
  name: string;
  capacityM3: number;
  description?: string;
  geometry?: unknown;
}): Promise<ProjectStorageArea> {
  return prisma.$transaction(async (tx) => {
    const plan = await loadProjectPlan(asStorageAreaPlanTx(tx), data.projectId);
    const normalizedName = data.name.trim();

    if (!normalizedName) {
      throw new Error('Storage area name is required.');
    }

    const duplicate = plan.storageAreas.some(
      (area) => area.projectId === data.projectId && area.name.toLowerCase() === normalizedName.toLowerCase(),
    );

    if (duplicate) {
      throw new Error(`Storage area "${normalizedName}" already exists for this project.`);
    }

    const timestamp = new Date().toISOString();
    const area: ProjectStorageArea = {
      id: createStorageAreaId(),
      projectId: data.projectId,
      name: normalizedName,
      description: data.description?.trim() || null,
      capacityM3: Math.max(0, Number(data.capacityM3 || 0)),
      contents: {},
      geometry: data.geometry,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await persistProjectPlan(asStorageAreaPlanTx(tx), data.projectId, {
      ...plan,
      storageAreas: [...plan.storageAreas, area],
    });

    return area;
  });
}

export async function listStorageAreasForProject(projectId: string): Promise<ProjectStorageArea[]> {
  const plan = await loadProjectPlan(asStorageAreaPlanTx(prisma), projectId);
  return [...plan.storageAreas].sort((left, right) => left.name.localeCompare(right.name, 'sv'));
}

export async function adjustMassVolume(
  projectId: string,
  storageAreaId: string,
  wasteCode: string,
  volumeDelta: number,
): Promise<ProjectStorageArea> {
  return prisma.$transaction(async (tx) => {
    const plan = await loadProjectPlan(asStorageAreaPlanTx(tx), projectId);
    const index = plan.storageAreas.findIndex((area) => area.id === storageAreaId);

    if (index === -1) {
      throw new Error(`StorageArea with ID ${storageAreaId} not found.`);
    }

    const currentArea = plan.storageAreas[index];
    const contents: StorageAreaContents = { ...((currentArea.contents as StorageAreaContents | null) ?? {}) };
    const currentVolume = contents[wasteCode] ?? 0;
    const newVolume = currentVolume + volumeDelta;

    if (newVolume > 0) {
      contents[wasteCode] = Number(newVolume.toFixed(3));
    } else {
      delete contents[wasteCode];
    }

    const updatedArea: ProjectStorageArea = {
      ...currentArea,
      contents,
      updatedAt: new Date().toISOString(),
    };

    const storageAreas = [...plan.storageAreas];
    storageAreas[index] = updatedArea;

    await persistProjectPlan(asStorageAreaPlanTx(tx), projectId, {
      ...plan,
      storageAreas,
    });

    return updatedArea;
  });
}
