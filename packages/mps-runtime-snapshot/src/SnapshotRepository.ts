import { RuntimeSnapshot } from './RuntimeSnapshot';

export interface SnapshotRepository {
    getLatestSnapshot(): Promise<RuntimeSnapshot | null>;
    saveSnapshot(snapshot: RuntimeSnapshot): Promise<void>;
}

export class InMemorySnapshotRepository implements SnapshotRepository {
    private latest: RuntimeSnapshot | null = null;

    async getLatestSnapshot(): Promise<RuntimeSnapshot | null> {
        return this.latest;
    }

    async saveSnapshot(snapshot: RuntimeSnapshot): Promise<void> {
        this.latest = snapshot;
    }
}
