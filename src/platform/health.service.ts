import { prisma } from '../../db.server';
import { IProjectRepository } from '../domain/project-repository.interface';
import { IAIService } from '../domain/ai.interface';
import { localGenerationStatus } from '../../server/modules/ai/generation/LocalGenerationPort';

export interface HealthStatus {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  timestamp: Date;
  components: {
    database: ComponentStatus;
    projectRepository: ComponentStatus;
    aiAdapter: ComponentStatus;
  };
}

export interface ComponentStatus {
  status: 'UP' | 'DOWN';
  message?: string;
  latencyMs?: number;
}

export class HealthService {
  constructor(
    private projectRepo: IProjectRepository,
    private aiService: IAIService,
  ) {}

  async check(): Promise<HealthStatus> {
    // 1. Kontrollera Databasen (Prisma)
    const dbStatus = await this.checkDatabase();

    // 2. Kontrollera Project Repository (Domänlager -> Infra)
    const repoStatus = await this.checkProjectRepo();

    // 3. Kontrollera AI Adapter (Externa beroenden)
    const aiStatus = await this.checkAI();

    const overallStatus =
      dbStatus.status === 'UP' && repoStatus.status === 'UP' && aiStatus.status === 'UP'
        ? 'UP'
        : dbStatus.status === 'DOWN'
          ? 'DOWN'
          : 'DEGRADED';

    return {
      status: overallStatus,
      timestamp: new Date(),
      components: {
        database: dbStatus,
        projectRepository: repoStatus,
        aiAdapter: aiStatus,
      },
    };
  }

  private async checkDatabase(): Promise<ComponentStatus> {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'UP', latencyMs: Date.now() - start };
    } catch (err: any) {
      return { status: 'DOWN', message: err.message };
    }
  }

  private async checkProjectRepo(): Promise<ComponentStatus> {
    try {
      // Vi provar att hämta ett icke-existerande projekt för att se att logiken svarar
      await this.projectRepo.findById('health-check-id');
      return { status: 'UP' };
    } catch (err: any) {
      return { status: 'DOWN', message: err.message };
    }
  }

  private async checkAI(): Promise<ComponentStatus> {
    const generation = localGenerationStatus();
    if (!generation.available) {
      return { status: 'DOWN', message: generation.blocker ?? 'LOCAL_GENERATION_UNAVAILABLE' };
    }
    return {
      status: 'UP',
      message: `local runtime ${generation.runtime_id ?? 'unknown'} / model ${generation.model_id ?? 'unknown'}`,
    };
  }
}
