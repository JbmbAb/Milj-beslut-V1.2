import { describe, expect, it } from 'vitest';
import { estimateSewageSizing } from '../../server/modules/sewage/sewageSizingService';

describe('estimateSewageSizing', () => {
  it('normalizes PE to at least 1 and computes daily flow', () => {
    const result = estimateSewageSizing(0);

    expect(result.pe).toBe(1);
    expect(result.estimatedDailyFlowLiters).toBe(150);
    expect(result.suggestedBufferVolumeLiters).toBe(300);
  });

  it('rounds fractional PE and scales buffer to two days of flow', () => {
    const result = estimateSewageSizing(4.4);

    expect(result.pe).toBe(4);
    expect(result.estimatedDailyFlowLiters).toBe(600);
    expect(result.suggestedBufferVolumeLiters).toBe(1200);
  });
});
