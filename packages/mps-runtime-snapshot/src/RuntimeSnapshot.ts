import { SnapshotMetadata } from './SnapshotTypes';

/**
 * SNAP-I01 & SNAP-I02: RuntimeSnapshot
 * This class exclusively holds replay pointers and metadata.
 * It strictly forbids any domain/decision payloads.
 */
export class RuntimeSnapshot {
    public readonly release_hash: string;
    public readonly event_position: number;
    public readonly runtime_state_hash: string;
    public readonly schema_version: string;

    // Notice: There is no 'decision_facts' or 'raw_documents' here.

    constructor(metadata: SnapshotMetadata) {
        this.release_hash = metadata.release_hash;
        this.event_position = metadata.event_position;
        this.runtime_state_hash = metadata.runtime_state_hash;
        this.schema_version = metadata.schema_version;
    }

    /**
     * Helper to verify this snapshot doesn't secretly hold unauthorized keys
     * @param payload the raw payload it was instantiated from
     */
    static validateIsolation(payload: any): void {
        const forbiddenKeys = ['decision_facts', 'evidence_refs', 'raw_documents', 'materialized_payloads'];
        for (const key of forbiddenKeys) {
            if (key in payload) {
                throw new Error(`SNAPSHOT_AUTHORITY_VIOLATION: Snapshot payload contains forbidden key '${key}'`);
            }
        }
    }
}
