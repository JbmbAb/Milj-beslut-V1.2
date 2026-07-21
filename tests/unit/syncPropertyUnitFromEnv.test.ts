import { describe, expect, it, vi } from 'vitest';
import { syncPropertyUnitFromEnv } from '../../scripts/db/sync-property-unit-from-env';

describe('syncPropertyUnitFromEnv', () => {
  it('returns plan estimates without mutating core', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ relkind: 'v' }])
      .mockResolvedValueOnce(undefined);
    const executeRawUnsafe = vi.fn();

    const prisma = {
      $queryRaw: queryRaw,
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as Parameters<typeof syncPropertyUnitFromEnv>[0];

    vi.spyOn(
      { countRows: async () => 0 },
      'countRows',
    );

    // countRows is internal — mock via queryRawUnsafe for table counts
    queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = String(strings[0] ?? '');
      if (sql.includes('relkind')) return [{ relkind: 'v' }];
      return [];
    });

    executeRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('count(*)::bigint AS n FROM env.registerenhetsomradesytor WHERE')) {
        return undefined;
      }
      if (sql.includes('count(*)::bigint AS n FROM env.registerenhetsomradesytor')) {
        return undefined;
      }
      if (sql.includes('count(*)::bigint AS n FROM core.property_unit')) {
        return undefined;
      }
      return undefined;
    });

    // Simpler: mock countRows path using queryRawUnsafe only
    const mockPrisma = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = String(strings[0] ?? '');
        if (sql.includes('relkind')) return [{ relkind: 'v' }];
        return [];
      }),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT count(*)::bigint AS n FROM env.registerenhetsomradesytor WHERE')) {
          return [{ n: BigInt(100) }];
        }
        if (sql.startsWith('SELECT count(*)::bigint AS n FROM env.registerenhetsomradesytor')) {
          return [{ n: BigInt(4395642) }];
        }
        if (sql.startsWith('SELECT count(*)::bigint AS n FROM core.property_unit')) {
          return [{ n: BigInt(3480781) }];
        }
        return [];
      }),
      $executeRawUnsafe: vi.fn(),
    } as unknown as Parameters<typeof syncPropertyUnitFromEnv>[0];

    const result = await syncPropertyUnitFromEnv(mockPrisma, { execute: false });

    expect(result.mode).toBe('plan');
    expect(result.envRows).toBe(4395642);
    expect(result.coreRowsAfter).toBe(4395642 + 100);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
