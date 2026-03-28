import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/publicUiService', () => ({
  parseBbox: vi.fn(),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({}));

import {
  allowedStageGateTypes,
  asBboxTuple,
  asOptionalProjectPlan,
  firstValue,
  parseBooleanFlag,
  parseMapLayerList,
  parseOptionalDriverJournalStatus,
  parseOptionalLimsSource,
  parseOptionalRequirementCaseReviewStatus,
  parseOptionalRequirementStatus,
  parseOptionalText,
  parsePositiveInt,
  requirementCaseReviewStatuses,
  requirementStatuses,
  routeParam,
} from '../../server/utils/routeUtils';

describe('routeUtils', () => {
  it('exposes supported status constants and gate types', () => {
    expect(allowedStageGateTypes).toEqual([
      'PERMIT_REQUIRED',
      'RISK_REVIEW',
      'DOCUMENT_CONTROL',
      'CARBON_CHECK',
    ]);
    expect(requirementStatuses).toEqual(['AUTO', 'REVIEWED', 'VERIFIED', 'REJECTED']);
    expect(requirementCaseReviewStatuses).toEqual(['AUTO', 'NEEDS_REVIEW', 'VERIFIED', 'LOCKED']);
  });

  it('extracts first values and trims route params', () => {
    expect(firstValue(['first', 'second'])).toBe('first');
    expect(firstValue('value')).toBe('value');
    expect(routeParam(['  project-1  '])).toBe('project-1');
    expect(routeParam(undefined)).toBe('');
  });

  it('normalizes optional enums and clamped integers', () => {
    expect(parseOptionalRequirementStatus('VERIFIED')).toBe('VERIFIED');
    expect(parseOptionalRequirementStatus('bad')).toBeUndefined();
    expect(parseOptionalRequirementCaseReviewStatus('LOCKED')).toBe('LOCKED');
    expect(parseOptionalRequirementCaseReviewStatus(5)).toBeUndefined();
    expect(parsePositiveInt('12.7', 5, 1, 10)).toBe(10);
    expect(parsePositiveInt('bad', 5, 1, 10)).toBe(5);
  });

  it('parses booleans and optional text', () => {
    expect(parseBooleanFlag('ja')).toBe(true);
    expect(parseBooleanFlag('No')).toBe(false);
    expect(parseBooleanFlag('unknown', true)).toBe(true);
    expect(parseOptionalText('  hello  ')).toBe('hello');
    expect(parseOptionalText('   ')).toBeUndefined();
  });

  it('accepts project plan objects and filters map layers', () => {
    expect(asOptionalProjectPlan({ name: 'Plan A' })).toEqual({ name: 'Plan A' });
    expect(asOptionalProjectPlan(null)).toBeUndefined();
    expect(parseMapLayerList(['CADASTRE', 'BAD', 'GROUNDWATER'])).toEqual(['CADASTRE', 'GROUNDWATER']);
    expect(parseMapLayerList('CADASTRE')).toBeUndefined();
  });

  it('parses logistics-specific enums and bbox tuples', () => {
    expect(parseOptionalDriverJournalStatus('SUBMITTED')).toBe('SUBMITTED');
    expect(parseOptionalDriverJournalStatus('DONE')).toBeUndefined();
    expect(parseOptionalLimsSource('API')).toBe('API');
    expect(parseOptionalLimsSource('SOAP')).toBeUndefined();
    expect(
      asBboxTuple({
        minLng: 1,
        minLat: 2,
        maxLng: 3,
        maxLat: 4,
      }),
    ).toEqual({
      minLng: 1,
      minLat: 2,
      maxLng: 3,
      maxLat: 4,
    });
  });
});
