export interface SnapshotMetadata {
    release_hash: string;
    event_position: number;
    runtime_state_hash: string;
    schema_version: string;
}

export interface ReplayEvent {
    id: string;
    sequence: number;
    payload_hash: string;
}
