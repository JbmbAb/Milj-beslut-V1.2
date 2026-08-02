import { CanonicalArtifact, ContentReference } from "../core/types.js";

// Minimal stub for ContentAddressedArtifactStore expected by CasArtifactRepository
export interface ContentAddressedArtifactStore {
    get<T extends CanonicalArtifact>(ref: ContentReference): Promise<T>;
    put<T extends CanonicalArtifact>(artifact: T): Promise<ContentReference>;
}

export interface ArtifactRepository {
    get<T extends CanonicalArtifact>(ref: ContentReference): Promise<T>;
    put<T extends CanonicalArtifact>(artifact: T): Promise<ContentReference>;
}

export class CasArtifactRepository implements ArtifactRepository {
    constructor(
        private cas: ContentAddressedArtifactStore
    ) {}

    async get<T extends CanonicalArtifact>(ref: ContentReference): Promise<T> {
        return this.cas.get<T>(ref);
    }

    async put<T extends CanonicalArtifact>(artifact: T): Promise<ContentReference> {
        return this.cas.put(artifact);
    }
}
