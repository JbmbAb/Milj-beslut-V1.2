import { describe, expect, it } from 'vitest';
import {
  evaluateMpfCode,
  evaluateMpfOperation,
  getMpfPermitProfileDefinition,
  getMpfThreshold,
  listMpfThresholds,
  resolvePermitCodeProfile,
  mergeGateDecisions,
  toMpfDecisionSummary,
} from '../../services/mpfEngine';

describe('mpfEngine', () => {
  describe('listMpfThresholds', () => {
    it('returns configured thresholds', () => {
      expect(listMpfThresholds().length).toBeGreaterThan(0);
    });
  });

  describe('getMpfThreshold', () => {
    it('finds an exact EWC match', () => {
      const threshold = getMpfThreshold('17 05 03*', 'EWC');
      expect(threshold?.permitClass).toBe('A');
    });

    it('finds an exact SNI match', () => {
      const threshold = getMpfThreshold('38.21', 'SNI');
      expect(threshold?.permitClass).toBe('A');
    });

    it('returns null for unknown code', () => {
      expect(getMpfThreshold('00 00 00', 'EWC')).toBeNull();
    });
  });

  describe('evaluateMpfCode', () => {
    it('returns UNKNOWN_CODE for missing rule', () => {
      const result = evaluateMpfCode({ code: '00 00 00', quantity: 100, codeType: 'EWC' });
      expect(result.gateDecision).toBe('UNKNOWN_CODE');
      expect(result.notes).toContain('Manuell juridisk granskning krävs');
    });

    it('returns PERMIT_REQUIRED when threshold is exceeded', () => {
      const result = evaluateMpfCode({ code: '17 05 03*', quantity: 15, codeType: 'EWC' });
      expect(result.gateDecision).toBe('PERMIT_REQUIRED');
      expect(result.requiresEia).toBe(true);
    });
  });

  describe('mergeGateDecisions', () => {
    it('keeps strongest decision', () => {
      expect(mergeGateDecisions(['EXEMPT', 'NOTIFICATION_REQUIRED', 'PERMIT_REQUIRED'])).toBe(
        'PERMIT_REQUIRED',
      );
    });
  });

  describe('evaluateMpfOperation', () => {
    it('lets EWC drive the phase-1 gate decision when both codes exist', () => {
      const result = evaluateMpfOperation({
        ewcCode: '17 05 04',
        sniCode: '38.21',
        quantity: 100,
      });

      expect(result.gateDecision).toBe('EXEMPT');
      expect(result.primaryCodeType).toBe('EWC');
      expect(result.activityCode).toBeTruthy();
      expect(result.primaryPermitProfile?.activityCode).toBe(result.activityCode);
      expect(result.advisorySignals[0]).toContain('EWC-koden styr gate-beslutet');
    });

    it('falls back to SNI when the EWC code is unknown', () => {
      const result = evaluateMpfOperation({
        ewcCode: '00 00 00',
        sniCode: '38.21',
        quantity: 100,
      });

      expect(result.gateDecision).toBe('PERMIT_REQUIRED');
      expect(result.primaryCodeType).toBe('SNI');
      expect(result.sniPermitProfile?.activityCode).toBeTruthy();
      expect(result.notes).toContain('fallback');
    });

    it('can still evaluate strongest-wins explicitly for compatibility', () => {
      const result = evaluateMpfOperation({
        ewcCode: '17 05 04',
        sniCode: '38.21',
        quantity: 100,
        strategy: 'strongest-wins',
      });

      expect(result.gateDecision).toBe('PERMIT_REQUIRED');
      expect(result.primaryCodeType).toBe('SNI');
    });
  });

  describe('toMpfDecisionSummary', () => {
    it('includes geofence layers and registry version for known EWC code', () => {
      const evaluation = evaluateMpfOperation({
        ewcCode: '17 05 04',
        quantity: 100,
      });
      const summary = toMpfDecisionSummary(evaluation);

      expect(summary.gateDecision).toBe('EXEMPT');
      expect(summary.requiredMapLayers).toContain('CADASTRE');
      expect(summary.requiredMapLayers).toContain('SOIL');
      expect(summary.geofenceLayers.length).toBeGreaterThan(0);
      expect(summary.registryVersion).toBeTruthy();
      expect(summary.isSensitiveArea).toBe(false);
    });
  });

  describe('permit profile mapping', () => {
    it('maps a direct 90.xxx activity code to a permit profile definition', () => {
      const definition = getMpfPermitProfileDefinition({ code: '90.50', codeType: 'SNI' });

      expect(definition?.activityCode).toBe('90.50');
      expect(definition?.requiredMapLayers).toContain('NATURA2000');
      expect(definition?.timelineBufferWeeks).toBe(2);
    });

    it('maps hazardous EWC to an MPF activity profile with EWC-specific overrides', () => {
      const definition = getMpfPermitProfileDefinition({ code: '17 05 03*', codeType: 'EWC' });

      expect(definition?.activityCode).toBe('90.50');
      expect(definition?.regulatoryTrack).toBe('PERMIT');
      expect(definition?.legalReference).toContain('Avfallsförordningen');
      expect(definition?.requiredMapLayers).toContain('SOIL');
    });

    it('builds a resolved permit profile for known MPF activity code', () => {
      const profile = resolvePermitCodeProfile({ code: '90.30', codeType: 'SNI', municipality: 'Uppsala' });

      expect(profile.code).toBe('90.30');
      expect(profile.thresholdScope).toBe('AT_ONCE');
      expect(profile.municipality).toBe('Uppsala');
    });
  });
});
