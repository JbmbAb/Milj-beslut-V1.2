import { describe, expect, it } from 'vitest';
import {
  classificationRequestSchema,
  classificationResponseSchema,
  complianceRequirementsRequestSchema,
  complianceRequirementsResponseSchema,
  documentExportRequestSchema,
  labValidateRequestSchema,
  labValidateResponseSchema,
  mvpWorkflowRequestSchema,
  permitGenerateRequestSchema,
  permitGenerateResponseSchema,
  riskAnalysisRequestSchema,
  riskAnalysisResponseSchema,
  requirementItemSchema,
  traceIdSchema,
  verificationCheckRequestSchema,
  verificationCheckResponseSchema,
} from '../../server/schemas/mvpSchemas';

describe('traceIdSchema', () => {
  it('accepts a valid traceId', () => {
    expect(traceIdSchema.safeParse({ traceId: 'abc-123' }).success).toBe(true);
  });

  it('rejects an empty traceId', () => {
    expect(traceIdSchema.safeParse({ traceId: '' }).success).toBe(false);
  });
});

describe('classificationRequestSchema', () => {
  it('accepts valid classification request', () => {
    const result = classificationRequestSchema.safeParse({
      activity_code: 'SNI_12345',
      ewc_code: '17 05 03*',
      volume_tons: 100,
    });
    expect(result.success).toBe(true);
  });

  it('requires ewc_code to be non-empty when provided (default does not bypass min(1))', () => {
    // schema has min(1) before optional().default('') so '' always fails
    expect(
      classificationRequestSchema.safeParse({ activity_code: 'SNI', ewc_code: '', volume_tons: 50 }).success,
    ).toBe(false);
    expect(
      classificationRequestSchema.safeParse({ activity_code: 'SNI', ewc_code: '17 05', volume_tons: 50 })
        .success,
    ).toBe(true);
  });

  it('rejects negative volume', () => {
    expect(
      classificationRequestSchema.safeParse({
        activity_code: 'SNI',
        volume_tons: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects empty activity_code', () => {
    expect(
      classificationRequestSchema.safeParse({
        activity_code: '   ',
        volume_tons: 10,
      }).success,
    ).toBe(false);
  });

  it('coerces string volume_tons to number', () => {
    const result = classificationRequestSchema.safeParse({
      activity_code: 'SNI',
      ewc_code: '17 05',
      volume_tons: '42.5',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.volume_tons).toBe(42.5);
  });
});

describe('classificationResponseSchema', () => {
  const valid = {
    traceId: 'trace-1',
    classification: 'Farligt avfall',
    legal_basis: 'MB 9 kap',
    status: 'MATCHED',
    volume_tons: 100,
  };

  it('accepts a valid response', () => {
    expect(classificationResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(classificationResponseSchema.safeParse({ ...valid, status: 'UNKNOWN' }).success).toBe(false);
  });
});

describe('requirementItemSchema', () => {
  it('accepts valid requirement', () => {
    expect(requirementItemSchema.safeParse({ rule: 'R1', law: 'MB', citation: 'Kap 1 § 2' }).success).toBe(
      true,
    );
  });

  it('rejects empty fields', () => {
    expect(requirementItemSchema.safeParse({ rule: '', law: 'MB', citation: '§' }).success).toBe(false);
  });
});

describe('complianceRequirementsRequestSchema', () => {
  it('accepts valid input with ewc_code', () => {
    expect(
      complianceRequirementsRequestSchema.safeParse({ activity_code: 'A1', ewc_code: '17 05' }).success,
    ).toBe(true);
  });

  it('requires ewc_code to be non-empty when provided', () => {
    // same min(1) constraint - providing empty string fails
    expect(complianceRequirementsRequestSchema.safeParse({ activity_code: 'A1', ewc_code: '' }).success).toBe(
      false,
    );
    expect(
      complianceRequirementsRequestSchema.safeParse({ activity_code: 'A1', ewc_code: '17 05' }).success,
    ).toBe(true);
  });
});

describe('complianceRequirementsResponseSchema', () => {
  it('accepts a valid compliance response', () => {
    expect(
      complianceRequirementsResponseSchema.safeParse({
        traceId: 't1',
        requirements: [{ rule: 'R1', law: 'L1', citation: 'C1' }],
        source: 'INDEX',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid source', () => {
    expect(
      complianceRequirementsResponseSchema.safeParse({
        traceId: 't1',
        requirements: [],
        source: 'MANUAL',
      }).success,
    ).toBe(false);
  });
});

describe('riskAnalysisRequestSchema', () => {
  it('accepts valid risk request', () => {
    expect(riskAnalysisRequestSchema.safeParse({ ewc_code: '17 05', volume_tons: 50 }).success).toBe(true);
  });

  it('defaults location to empty string', () => {
    const result = riskAnalysisRequestSchema.safeParse({ ewc_code: '17 05', volume_tons: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.location).toBe('');
  });
});

describe('riskAnalysisResponseSchema', () => {
  it('accepts valid risk response', () => {
    expect(
      riskAnalysisResponseSchema.safeParse({
        traceId: 't1',
        risk_flags: ['ground_contamination'],
        risk_score: 'HIGH',
      }).success,
    ).toBe(true);
  });

  it('accepts response without risk_score', () => {
    expect(riskAnalysisResponseSchema.safeParse({ traceId: 't1', risk_flags: [] }).success).toBe(true);
  });
});

describe('labValidateRequestSchema', () => {
  it('accepts valid lab samples', () => {
    expect(
      labValidateRequestSchema.safeParse({
        sample_results: [{ parameter: 'Pb', value: 100, unit: 'mg/kg' }],
      }).success,
    ).toBe(true);
  });

  it('rejects empty sample array', () => {
    expect(labValidateRequestSchema.safeParse({ sample_results: [] }).success).toBe(false);
  });
});

describe('labValidateResponseSchema', () => {
  it('accepts PASS result', () => {
    expect(
      labValidateResponseSchema.safeParse({ traceId: 't1', status: 'PASS', exceedances: [] }).success,
    ).toBe(true);
  });

  it('accepts FAIL result with exceedances', () => {
    expect(
      labValidateResponseSchema.safeParse({
        traceId: 't1',
        status: 'FAIL',
        exceedances: [{ parameter: 'Pb', value: 200, limit: 100 }],
      }).success,
    ).toBe(true);
  });
});

describe('permitGenerateRequestSchema', () => {
  it('accepts valid permit generate request', () => {
    expect(
      permitGenerateRequestSchema.safeParse({
        project_data: { name: 'proj' },
        requirements: [{ rule: 'R1', law: 'L1', citation: 'C1' }],
        risk_flags: ['flag1'],
      }).success,
    ).toBe(true);
  });

  it('defaults all arrays to empty', () => {
    const result = permitGenerateRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requirements).toEqual([]);
      expect(result.data.risk_flags).toEqual([]);
    }
  });
});

describe('permitGenerateResponseSchema', () => {
  it('accepts valid permit response', () => {
    expect(
      permitGenerateResponseSchema.safeParse({
        traceId: 't1',
        document_type: 'PERMIT',
        draft_text: 'Ansökan är godkänd.',
      }).success,
    ).toBe(true);
  });

  it('rejects empty draft_text', () => {
    expect(
      permitGenerateResponseSchema.safeParse({
        traceId: 't1',
        document_type: 'PERMIT',
        draft_text: '',
      }).success,
    ).toBe(false);
  });
});

describe('verificationCheckRequestSchema', () => {
  it('accepts any analysis value', () => {
    expect(verificationCheckRequestSchema.safeParse({ analysis: { data: 'x' } }).success).toBe(true);
    expect(verificationCheckRequestSchema.safeParse({ analysis: null }).success).toBe(true);
  });
});

describe('verificationCheckResponseSchema', () => {
  it('accepts VERIFIED response', () => {
    expect(
      verificationCheckResponseSchema.safeParse({
        traceId: 't1',
        status: 'VERIFIED',
        missing_citations: [],
      }).success,
    ).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(
      verificationCheckResponseSchema.safeParse({
        traceId: 't1',
        status: 'PARTIAL',
        missing_citations: [],
      }).success,
    ).toBe(false);
  });
});

describe('documentExportRequestSchema', () => {
  it('accepts valid export request', () => {
    expect(documentExportRequestSchema.safeParse({ draft_text: 'Text', document_type: 'PDF' }).success).toBe(
      true,
    );
  });

  it('rejects blank draft_text', () => {
    expect(documentExportRequestSchema.safeParse({ draft_text: '   ', document_type: 'PDF' }).success).toBe(
      false,
    );
  });
});

describe('mvpWorkflowRequestSchema', () => {
  it('accepts a complete workflow request', () => {
    expect(
      mvpWorkflowRequestSchema.safeParse({
        activity_code: 'SNI_12345',
        ewc_code: '17 05 03*',
        volume_tons: 100,
        location: 'Stockholm',
        project_data: { name: 'MyProject' },
      }).success,
    ).toBe(true);
  });

  it('defaults location and project_data', () => {
    const result = mvpWorkflowRequestSchema.safeParse({
      activity_code: 'SNI',
      ewc_code: '17 05',
      volume_tons: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe('');
      expect(result.data.project_data).toEqual({});
    }
  });

  it('rejects missing required fields', () => {
    expect(mvpWorkflowRequestSchema.safeParse({ activity_code: 'SNI' }).success).toBe(false);
  });
});
