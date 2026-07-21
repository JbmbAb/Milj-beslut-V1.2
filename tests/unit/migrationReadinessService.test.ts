import { describe, expect, it } from 'vitest';
import { buildMigrationReadinessReport } from '../../server/services/migrationReadinessService';

describe('migrationReadinessService', () => {
  it('returns a structured report with items', () => {
    const report = buildMigrationReadinessReport();
    expect(report.checkedAt).toMatch(/T/);
    expect(Array.isArray(report.items)).toBe(true);
    expect(report.items.length).toBeGreaterThan(5);
    expect(Array.isArray(report.integrations)).toBe(true);
    expect(report.integrations.length).toBeGreaterThan(0);
  });
});
