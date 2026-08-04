import { describe, it, expect } from 'vitest';
import { ValidationResult } from '../src/conformance/ValidationResult';
import { ValidationContext } from '../src/conformance/ValidationContext';
import { RuleRegistrySnapshot } from '../src/conformance/RuleRegistrySnapshot';
import { ValidationRule } from '../src/conformance/ValidationRule';

describe('Phase 1 - Immutable MCS Kernel (Optimized)', () => {
  it('should compile and structure validators purely', () => {
    const mockRule: ValidationRule = {
      rule_id: 'test-rule-01',
      validate: (artifact, context) => ({
        rule_id: 'test-rule-01',
        passed: true,
        evidence: []
      })
    };

    const snapshot = new RuleRegistrySnapshot([mockRule]);
    expect(snapshot.rules.length).toBe(1);
    expect(snapshot.rules[0].rule_id).toBe('test-rule-01');
    expect(Object.isFrozen(snapshot.rules)).toBe(true);
  });
});
