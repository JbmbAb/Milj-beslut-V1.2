import { describe, expect, it } from 'vitest';

import { AuditAction } from '../../src/domain/audit';
import { ComplianceCategory, ComplianceStatus, RatingLabel } from '../../src/domain/compliance';
import { DocumentCategory, DocumentStatus } from '../../src/domain/document';
import { GeoLayerType, RiskLevel } from '../../src/domain/geo';
import { TransportStatus } from '../../src/domain/logistics';
import { PriceTrend } from '../../src/domain/market-intel';
import { DecisionType } from '../../src/domain/permit';
import { ProjectStatus, ProjectType } from '../../src/domain/project';
import { RequirementLevel, RequirementStatus } from '../../src/domain/requirement';

describe('src domain models', () => {
  it('exports audit actions for legal traceability', () => {
    expect(AuditAction.CREATE).toBe('CREATE');
    expect(AuditAction.ACCESS).toBe('ACCESS');
  });

  it('exports compliance enums and profile-like structures', () => {
    const categoryScores = {
      [ComplianceCategory.ENVIRONMENTAL]: { score: 8, maxScore: 10, percentage: 80 },
      [ComplianceCategory.SOCIAL]: { score: 5, maxScore: 10, percentage: 50 },
      [ComplianceCategory.GOVERNANCE]: { score: 7, maxScore: 10, percentage: 70 },
      [ComplianceCategory.LEGAL]: { score: 9, maxScore: 10, percentage: 90 },
    };

    expect(ComplianceStatus.PARTIAL).toBe('PARTIAL');
    expect(RatingLabel.GOOD).toBe('GOOD');
    expect(categoryScores[ComplianceCategory.LEGAL].percentage).toBe(90);
  });

  it('exports document enums for ingestion state and category', () => {
    expect(DocumentStatus.RECEIVED).toBe('RECEIVED');
    expect(DocumentCategory.APPLICATION).toBe('APPLICATION');
  });

  it('exports geo enums and property-compatible shapes', () => {
    const property = {
      id: 'property-1',
      designation: 'STOCKHOLM 1:1',
      municipality: 'Stockholm',
      centroid: { lat: 59.3, lng: 18.0 },
    };

    expect(GeoLayerType.NATURA_2000).toBe('NATURA_2000');
    expect(RiskLevel.HIGH).toBe('HIGH');
    expect(property.centroid.lng).toBe(18.0);
  });

  it('exports logistics booking states and track-compatible data', () => {
    const track = {
      bookingId: 'booking-1',
      positions: [
        {
          id: 'pos-1',
          bookingId: 'booking-1',
          lat: 1,
          lng: 2,
          timestamp: new Date(),
          hash: 'h1',
          prevHash: null,
        },
      ],
    };

    expect(TransportStatus.IN_TRANSIT).toBe('IN_TRANSIT');
    expect(track.positions[0].prevHash).toBeNull();
  });

  it('exports market intelligence trend values', () => {
    expect(PriceTrend.RISING).toBe('RISING');
    expect(PriceTrend.STABLE).toBe('STABLE');
    expect(PriceTrend.FALLING).toBe('FALLING');
  });

  it('exports permit decision types', () => {
    expect(DecisionType.BIFALL).toBe('BIFALL');
    expect(DecisionType.UNKNOWN).toBe('OKÄNT');
  });

  it('exports project lifecycle and type values', () => {
    expect(ProjectStatus.DRAFT).toBe('DRAFT');
    expect(ProjectType.VA).toBe('VA');
  });

  it('exports requirement levels and statuses', () => {
    expect(RequirementLevel.MANDATORY).toBe('MANDATORY');
    expect(RequirementStatus.VERIFIED).toBe('VERIFIED');
  });
});
