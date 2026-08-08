import { describe, it, expect } from 'vitest';
import { SnapshotReplayEngine } from '../src/SnapshotReplayEngine';
import { RuntimeSnapshot } from '../src/RuntimeSnapshot';
import { ReplayEvent } from '../src/SnapshotTypes';

describe('Commit G: Runtime Snapshot Boundary', () => {

    describe('SNAP-I01: Replay, not Authority', () => {
        it('Snapshot ReplayEngine får inte skapa DecisionArtifact (SNAPSHOT_AUTHORITY_VIOLATION)', () => {
            const engine = new SnapshotReplayEngine();
            expect(() => {
                engine.createDecisionArtifact();
            }).toThrowError('SNAPSHOT_AUTHORITY_VIOLATION');
        });
    });

    describe('SNAP-I02: Snapshot Truth Separation', () => {
        it('Snapshot får inte bära DecisionFacts eller raw_documents (Payload isolation)', () => {
            const maliciousPayload = {
                release_hash: 'r1',
                event_position: 100,
                runtime_state_hash: 'state1',
                schema_version: '1.0',
                decision_facts: { allowed: true } // Förbjuden!
            };

            expect(() => {
                RuntimeSnapshot.validateIsolation(maliciousPayload);
            }).toThrowError('SNAPSHOT_AUTHORITY_VIOLATION');
        });
    });

    describe('SNAP-I03: Replay Determinism', () => {
        it('SNAPSHOT + EVENTS = IDENTICAL REPLAY STATE', () => {
            const engine = new SnapshotReplayEngine();
            
            const snapshot = new RuntimeSnapshot({
                release_hash: 'rel_a',
                event_position: 100,
                runtime_state_hash: 'base_state_hash',
                schema_version: '1.0'
            });

            const events: ReplayEvent[] = [
                { id: 'e1', sequence: 101, payload_hash: 'p1' },
                { id: 'e2', sequence: 102, payload_hash: 'p2' }
            ];

            // Kör 1
            const stateA = engine.replay(snapshot, events);

            // Kör 2 - med samma ingångsvärden men oordnad händelsearray
            const eventsShuffled: ReplayEvent[] = [
                { id: 'e2', sequence: 102, payload_hash: 'p2' },
                { id: 'e1', sequence: 101, payload_hash: 'p1' }
            ];
            const stateB = engine.replay(snapshot, eventsShuffled);

            expect(stateA).toEqual(stateB);
        });
    });

});
