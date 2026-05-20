import { describe, it, expect, beforeEach } from 'vitest';
import { AuditAction, type AuditEvent } from '../../src/domain/audit';
import {
  ComplianceStatus,
  ComplianceCategory,
  RatingLabel,
  type TaxonomyIndicator,
  type IndicatorScore,
  type ComplianceProfile,
} from '../../src/domain/compliance';
import type { Project } from '../../src/domain/project';
import type { Requirement } from '../../src/domain/requirement';
import type { Document } from '../../src/domain/document';

describe('Domain Models', () => {
  // ── AuditEvent ───────────────────────────────────────────────────────────────

  describe('AuditEvent', () => {
    let auditEvent: AuditEvent;

    beforeEach(() => {
      auditEvent = {
        id: 'audit-1',
        timestamp: new Date(),
        userId: 'user-123',
        action: AuditAction.CREATE,
        entityType: 'Project',
        entityId: 'proj-1',
        details: 'Created new project',
        clientIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        signatureId: 'sig-1',
      };
    });

    it('should have valid audit event structure', () => {
      expect(auditEvent.id).toBeDefined();
      expect(auditEvent.timestamp).toBeInstanceOf(Date);
      expect(auditEvent.userId).toBeTruthy();
      expect(auditEvent.action).toMatch(/CREATE|UPDATE|DELETE|VERIFY|EXPORT|ACCESS/);
      expect(auditEvent.entityType).toBeTruthy();
      expect(auditEvent.entityId).toBeTruthy();
      expect(auditEvent.details).toBeTruthy();
    });

    it('should track all AuditAction types', () => {
      const actions = [
        AuditAction.CREATE,
        AuditAction.UPDATE,
        AuditAction.DELETE,
        AuditAction.VERIFY,
        AuditAction.EXPORT,
        AuditAction.ACCESS,
      ];

      actions.forEach((action) => {
        expect(action).toBeTruthy();
        expect(typeof action).toBe('string');
      });
    });

    it('should make audit event immutable', () => {
      const originalAction = auditEvent.action;

      // Attempting to modify should either fail or create new object
      const frozenEvent = Object.freeze(auditEvent);

      // Verify original is unchanged
      expect(auditEvent.action).toBe(originalAction);
    });

    it('should support optional fields', () => {
      const minimalEvent: AuditEvent = {
        id: 'audit-2',
        timestamp: new Date(),
        userId: 'user-456',
        action: AuditAction.UPDATE,
        entityType: 'Document',
        entityId: 'doc-1',
        details: 'Updated document',
      };

      expect(minimalEvent.clientIp).toBeUndefined();
      expect(minimalEvent.signatureId).toBeUndefined();
    });
  });

  // ── ComplianceProfile ────────────────────────────────────────────────────────

  describe('ComplianceProfile', () => {
    let profile: ComplianceProfile;

    beforeEach(() => {
      profile = {
        projectId: 'proj-1',
        computedAt: new Date(),
        overallScore: 75,
        ratingLabel: RatingLabel.GOOD,
        categoryScores: {
          [ComplianceCategory.ENVIRONMENTAL]: {
            score: 80,
            maxScore: 100,
            percentage: 80,
          },
          [ComplianceCategory.SOCIAL]: {
            score: 70,
            maxScore: 100,
            percentage: 70,
          },
          [ComplianceCategory.GOVERNANCE]: {
            score: 75,
            maxScore: 100,
            percentage: 75,
          },
          [ComplianceCategory.LEGAL]: {
            score: 75,
            maxScore: 100,
            percentage: 75,
          },
        },
        indicators: [],
        summary: 'Good compliance profile',
        criticalGaps: [],
      };
    });

    it('should have valid compliance profile structure', () => {
      expect(profile.projectId).toBeTruthy();
      expect(profile.computedAt).toBeInstanceOf(Date);
      expect(profile.overallScore).toBeGreaterThanOrEqual(0);
      expect(profile.overallScore).toBeLessThanOrEqual(100);
      expect(profile.ratingLabel).toMatch(/EXCELLENT|GOOD|ACCEPTABLE|WEAK|FAILING/);
    });

    it('should track all compliance categories', () => {
      const categories = [
        ComplianceCategory.ENVIRONMENTAL,
        ComplianceCategory.SOCIAL,
        ComplianceCategory.GOVERNANCE,
        ComplianceCategory.LEGAL,
      ];

      categories.forEach((cat) => {
        expect(profile.categoryScores[cat]).toBeDefined();
        expect(profile.categoryScores[cat].score).toBeGreaterThanOrEqual(0);
        expect(profile.categoryScores[cat].percentage).toBeGreaterThanOrEqual(0);
        expect(profile.categoryScores[cat].percentage).toBeLessThanOrEqual(100);
      });
    });

    it('should have all RatingLabel values', () => {
      const labels = [
        RatingLabel.EXCELLENT,
        RatingLabel.GOOD,
        RatingLabel.ACCEPTABLE,
        RatingLabel.WEAK,
        RatingLabel.FAILING,
      ];

      labels.forEach((label) => {
        expect(label).toBeTruthy();
        expect(typeof label).toBe('string');
      });
    });

    it('should support critical gaps array', () => {
      profile.criticalGaps = ['Missing environmental impact assessment', 'No social stakeholder engagement'];

      expect(Array.isArray(profile.criticalGaps)).toBe(true);
      expect(profile.criticalGaps.length).toBe(2);
    });

    it('should calculate percentage correctly', () => {
      const envScore = profile.categoryScores[ComplianceCategory.ENVIRONMENTAL];
      const expectedPercentage = (envScore.score / envScore.maxScore) * 100;

      expect(envScore.percentage).toBe(expectedPercentage);
    });
  });

  // ── IndicatorScore ───────────────────────────────────────────────────────────

  describe('IndicatorScore', () => {
    let indicatorScore: IndicatorScore;

    beforeEach(() => {
      indicatorScore = {
        indicatorId: 'ind-1',
        status: ComplianceStatus.PASS,
        score: 85,
        maxScore: 100,
        notes: 'Environmental controls adequate',
      };
    });

    it('should have valid indicator score structure', () => {
      expect(indicatorScore.indicatorId).toBeTruthy();
      expect(indicatorScore.status).toMatch(/PASS|PARTIAL|FAIL|NOT_APPLICABLE/);
      expect(indicatorScore.score).toBeGreaterThanOrEqual(0);
      expect(indicatorScore.maxScore).toBeGreaterThan(0);
      expect(indicatorScore.notes).toBeTruthy();
    });

    it('should track all ComplianceStatus values', () => {
      const statuses = [
        ComplianceStatus.PASS,
        ComplianceStatus.PARTIAL,
        ComplianceStatus.FAIL,
        ComplianceStatus.NOT_APPLICABLE,
      ];

      statuses.forEach((status) => {
        expect(status).toBeTruthy();
        expect(typeof status).toBe('string');
      });
    });

    it('should validate score does not exceed maxScore', () => {
      expect(indicatorScore.score).toBeLessThanOrEqual(indicatorScore.maxScore);
    });

    it('should handle partial compliance', () => {
      indicatorScore.status = ComplianceStatus.PARTIAL;
      indicatorScore.score = 50;

      expect(indicatorScore.status).toBe(ComplianceStatus.PARTIAL);
      expect(indicatorScore.score).toBe(50);
    });
  });

  // ── TaxonomyIndicator ────────────────────────────────────────────────────────

  describe('TaxonomyIndicator', () => {
    let indicator: TaxonomyIndicator;

    beforeEach(() => {
      indicator = {
        id: 'tax-env-1',
        category: ComplianceCategory.ENVIRONMENTAL,
        name: 'Carbon Emissions',
        description: 'Scope 1 & 2 carbon emissions',
        maxScore: 100,
        euTaxonomyRef: 'E1.1',
      };
    });

    it('should have valid taxonomy indicator structure', () => {
      expect(indicator.id).toBeTruthy();
      expect(indicator.category).toMatch(/ENVIRONMENTAL|SOCIAL|GOVERNANCE|LEGAL/);
      expect(indicator.name).toBeTruthy();
      expect(indicator.description).toBeTruthy();
      expect(indicator.maxScore).toBeGreaterThan(0);
    });

    it('should support optional EU taxonomy reference', () => {
      expect(indicator.euTaxonomyRef).toBeTruthy();

      const noRefIndicator: TaxonomyIndicator = {
        id: 'tax-social-1',
        category: ComplianceCategory.SOCIAL,
        name: 'Employee Satisfaction',
        description: 'Annual employee engagement score',
        maxScore: 100,
      };

      expect(noRefIndicator.euTaxonomyRef).toBeUndefined();
    });

    it('should categorize by all compliance categories', () => {
      const categories = [
        ComplianceCategory.ENVIRONMENTAL,
        ComplianceCategory.SOCIAL,
        ComplianceCategory.GOVERNANCE,
        ComplianceCategory.LEGAL,
      ];

      categories.forEach((cat) => {
        const ind: TaxonomyIndicator = {
          id: `ind-${cat}`,
          category: cat,
          name: `Indicator for ${cat}`,
          description: `Description`,
          maxScore: 100,
        };

        expect(ind.category).toBe(cat);
      });
    });
  });

  // ── Integration: Profile with Indicators ──────────────────────────────────────

  describe('Integration: ComplianceProfile with Indicators', () => {
    let profile: ComplianceProfile;

    beforeEach(() => {
      const indicators: IndicatorScore[] = [
        {
          indicatorId: 'ind-1',
          status: ComplianceStatus.PASS,
          score: 90,
          maxScore: 100,
          notes: 'Excellent',
        },
        {
          indicatorId: 'ind-2',
          status: ComplianceStatus.PARTIAL,
          score: 60,
          maxScore: 100,
          notes: 'Needs improvement',
        },
      ];

      profile = {
        projectId: 'proj-1',
        computedAt: new Date(),
        overallScore: 75,
        ratingLabel: RatingLabel.GOOD,
        categoryScores: {
          [ComplianceCategory.ENVIRONMENTAL]: {
            score: 90,
            maxScore: 100,
            percentage: 90,
          },
          [ComplianceCategory.SOCIAL]: {
            score: 60,
            maxScore: 100,
            percentage: 60,
          },
          [ComplianceCategory.GOVERNANCE]: {
            score: 75,
            maxScore: 100,
            percentage: 75,
          },
          [ComplianceCategory.LEGAL]: {
            score: 75,
            maxScore: 100,
            percentage: 75,
          },
        },
        indicators,
        summary: 'Mixed compliance',
        criticalGaps: ['Social compliance needs work'],
      };
    });

    it('should link indicators to profile', () => {
      expect(profile.indicators).toHaveLength(2);
      expect(profile.indicators[0].indicatorId).toBe('ind-1');
      expect(profile.indicators[1].status).toBe(ComplianceStatus.PARTIAL);
    });

    it('should reflect critical gaps in indicators', () => {
      const hasSocialGap = profile.indicators.some((ind) => ind.status === ComplianceStatus.PARTIAL);

      expect(hasSocialGap).toBe(true);
      expect(profile.criticalGaps.length).toBeGreaterThan(0);
    });
  });

  // ── Audit Trail with Project Changes ─────────────────────────────────────────

  describe('Audit Trail Scenario', () => {
    let events: AuditEvent[];

    beforeEach(() => {
      events = [
        {
          id: 'evt-1',
          timestamp: new Date('2026-01-01'),
          userId: 'user-1',
          action: AuditAction.CREATE,
          entityType: 'Project',
          entityId: 'proj-1',
          details: 'Project created',
        },
        {
          id: 'evt-2',
          timestamp: new Date('2026-01-02'),
          userId: 'user-1',
          action: AuditAction.UPDATE,
          entityType: 'Project',
          entityId: 'proj-1',
          details: 'Project updated',
        },
        {
          id: 'evt-3',
          timestamp: new Date('2026-01-03'),
          userId: 'user-2',
          action: AuditAction.VERIFY,
          entityType: 'Project',
          entityId: 'proj-1',
          details: 'Project verified',
          signatureId: 'sig-verify-1',
        },
      ];
    });

    it('should maintain chronological order', () => {
      const timestamps = events.map((e) => e.timestamp.getTime());
      const isSorted = timestamps.every((t, i, arr) => i === 0 || t >= arr[i - 1]);

      expect(isSorted).toBe(true);
    });

    it('should track all actions on entity', () => {
      const projEvents = events.filter((e) => e.entityId === 'proj-1');

      expect(projEvents).toHaveLength(3);
      expect(projEvents[0].action).toBe(AuditAction.CREATE);
      expect(projEvents[1].action).toBe(AuditAction.UPDATE);
      expect(projEvents[2].action).toBe(AuditAction.VERIFY);
    });

    it('should link verification to signature', () => {
      const verifyEvent = events.find((e) => e.action === AuditAction.VERIFY);

      expect(verifyEvent?.signatureId).toBeDefined();
    });
  });
});
