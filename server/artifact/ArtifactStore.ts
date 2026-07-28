export interface ArtifactStore {
  put<T>(key: string, value: T): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  list(prefix: string): Promise<readonly string[]>;
}
