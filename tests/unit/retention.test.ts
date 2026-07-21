import { describe, it, expect } from 'vitest';
import { retentionDateFromClose, findProjectsReadyForDeletion } from '../../server/compliance/retention';
import type { ProjectRetentionRecord } from '../../server/compliance/retention';

describe('retention', () => {
  describe('retentionDateFromClose', () => {
    it('beräknar retentionsdatum korrekt (10 år = 3650 dagar)', () => {
      const closedAt = new Date('2020-01-01T00:00:00Z');
      const result = retentionDateFromClose(closedAt, 3650);
      const expectedMs = closedAt.getTime() + 3650 * 24 * 60 * 60 * 1000;
      expect(result.getTime()).toBe(expectedMs);
    });

    it('beräknar retentionsdatum korrekt för 1 dag', () => {
      const closedAt = new Date('2024-01-01T00:00:00Z');
      const result = retentionDateFromClose(closedAt, 1);
      const expected = new Date('2024-01-02T00:00:00Z');
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('beräknar retentionsdatum korrekt för 0 dagar', () => {
      const closedAt = new Date('2024-06-15T12:00:00Z');
      const result = retentionDateFromClose(closedAt, 0);
      expect(result.getTime()).toBe(closedAt.getTime());
    });

    it('returnerar Date-objekt', () => {
      expect(retentionDateFromClose(new Date(), 365)).toBeInstanceOf(Date);
    });
  });

  describe('findProjectsReadyForDeletion', () => {
    const now = new Date('2025-01-01T00:00:00Z');

    const makeProject = (overrides: Partial<ProjectRetentionRecord>): ProjectRetentionRecord => ({
      id: 'proj-1',
      status: 'CLOSED',
      closedAt: new Date('2020-01-01'),
      retentionUntil: new Date('2024-01-01'), // before `now`
      ...overrides,
    });

    it('returnerar projekt vars retentionUntil har passerat', () => {
      const projects = [makeProject({})];
      expect(findProjectsReadyForDeletion(projects, now)).toHaveLength(1);
    });

    it('exkluderar ACTIVE projekt', () => {
      const projects = [makeProject({ status: 'ACTIVE' })];
      expect(findProjectsReadyForDeletion(projects, now)).toHaveLength(0);
    });

    it('exkluderar projekt utan retentionUntil', () => {
      const projects = [makeProject({ retentionUntil: null })];
      expect(findProjectsReadyForDeletion(projects, now)).toHaveLength(0);
    });

    it('exkluderar projekt vars retentionUntil är i framtiden', () => {
      const projects = [makeProject({ retentionUntil: new Date('2026-01-01') })];
      expect(findProjectsReadyForDeletion(projects, now)).toHaveLength(0);
    });

    it('inkluderar projekt på exakt retentionstidpunkten', () => {
      const exactNow = new Date('2025-01-01T00:00:00Z');
      const projects = [makeProject({ retentionUntil: exactNow })];
      expect(findProjectsReadyForDeletion(projects, exactNow)).toHaveLength(1);
    });

    it('hanterar blandad lista korrekt', () => {
      const projects = [
        makeProject({ id: 'p1', status: 'CLOSED', retentionUntil: new Date('2024-01-01') }), // redo
        makeProject({ id: 'p2', status: 'ACTIVE', retentionUntil: new Date('2024-01-01') }), // active → skip
        makeProject({ id: 'p3', status: 'ARCHIVED', retentionUntil: new Date('2026-01-01') }), // future → skip
        makeProject({ id: 'p4', status: 'ARCHIVED', retentionUntil: new Date('2023-06-01') }), // redo
        makeProject({ id: 'p5', status: 'CLOSED', retentionUntil: null }), // no date → skip
      ];

      const result = findProjectsReadyForDeletion(projects, now);
      expect(result.map((p) => p.id)).toEqual(['p1', 'p4']);
    });

    it('returnerar tom array när inga projekt är redo', () => {
      expect(findProjectsReadyForDeletion([], now)).toEqual([]);
    });

    it('använder nuvarande tid som standard när now inte anges', () => {
      const oldProject = makeProject({
        retentionUntil: new Date('2000-01-01'), // already expired
      });
      // Should not throw
      expect(() => findProjectsReadyForDeletion([oldProject])).not.toThrow();
    });
  });
});
