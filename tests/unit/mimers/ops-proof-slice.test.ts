import { describe, expect, it } from 'vitest';
import { proveOpsReplay } from '../../../scripts/mimers/prove-ops-replay';

describe('Sovereign DoD ops proof slice', () => {
  it('multi-segment load + checkpoint recovery + fault injection', async () => {
    const report = await proveOpsReplay({
      eventCount: 26,
      maxEventsPerSegment: 3,
    });

    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);

    expect(report.multiSegment.ok).toBe(true);
    expect(report.multiSegment.eventCount).toBe(26);
    expect(report.multiSegment.closedSegments).toBeGreaterThanOrEqual(2);
    expect(report.multiSegment.checkpointCount).toBeGreaterThanOrEqual(2);
    expect(report.multiSegment.hashesMatch).toBe(true);
    expect(report.multiSegment.chainIntact).toBe(true);
    expect(report.multiSegment.coldMerkleRoot).toBe(report.multiSegment.seedMerkleRoot);
    expect(report.multiSegment.recoverStatus).toBe('CLEAN');
    expect(report.multiSegment.externalVerifyOk).toBe(true);
    expect(report.multiSegment.coldStartMs).toBeGreaterThan(0);
    expect(report.multiSegment.eventsPerSec).toBeGreaterThan(0);

    expect(report.checkpointRecovery.ok).toBe(true);
    expect(report.checkpointRecovery.identicalToFullReplay).toBe(true);
    expect(report.checkpointRecovery.coveredThroughSequence).toBeGreaterThan(0);
    expect(report.checkpointRecovery.tailEventCount).toBeGreaterThan(0);
    expect(report.checkpointRecovery.fullRoot).toBe(report.multiSegment.coldMerkleRoot);

    expect(report.faultInjection.ok).toBe(true);
    expect(report.faultInjection.corruptSegmentDetected).toBe(true);
    expect(report.faultInjection.truncatedWriteDetected).toBe(true);
    expect(report.faultInjection.missingCheckpointFailClosed).toBe(true);
    expect(report.faultInjection.missingCheckpointBackfillRepair).toBe(true);
  }, 120_000);
});
