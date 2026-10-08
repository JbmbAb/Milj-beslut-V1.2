/**
 * Recall of one upstream validator token for one source, locator and target.
 *
 * This is not an inventory, not a DownloadManifest, and not a content hash.
 * A target keeps at most one record. The record has no authority of its own.
 */

export type ValidatorClass = "STRONG_ETAG" | "UPSTREAM_CONTENT_DIGEST" | "IMMUTABLE_REVISION_ID";

export interface ValidatorBindingRecord {
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly registryArtifactId: string;
  readonly locatorIdentity: string;
  readonly targetIdentity: string;
  readonly fileName: string | null;
  readonly validatorClass: ValidatorClass;
  readonly validatorToken: string;
  readonly observedAt: string;
}

/** The file is present but is not one readable binding. Absence is a missing file, not this error. */
export class BindingStoreUnreadable extends Error {
  readonly reason_code = "BINDING_STORE_UNREADABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "BindingStoreUnreadable";
  }
}

export interface ValidatorBindingStore {
  resolve(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
  ): Promise<readonly ValidatorBindingRecord[]>;
  replace(record: ValidatorBindingRecord): Promise<void>;
  touchObservedAt(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
    observedAt: string,
    expectedValidatorToken?: string,
  ): Promise<boolean>;
}

export class InMemoryValidatorBindingStore implements ValidatorBindingStore {
  private readonly records = new Map<string, readonly ValidatorBindingRecord[]>();

  async resolve(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
  ): Promise<readonly ValidatorBindingRecord[]> {
    return this.records.get(keyOf(sourceId, locatorIdentity, targetIdentity)) ?? [];
  }

  async replace(record: ValidatorBindingRecord): Promise<void> {
    this.records.set(keyOf(record.sourceId, record.locatorIdentity, record.targetIdentity), [record]);
  }

  async touchObservedAt(
    sourceId: string,
    locatorIdentity: string,
    targetIdentity: string,
    observedAt: string,
    expectedValidatorToken?: string,
  ): Promise<boolean> {
    const current = await this.resolve(sourceId, locatorIdentity, targetIdentity);
    const existing = current[0];
    if (current.length !== 1 || existing === undefined) return false;
    if (expectedValidatorToken !== undefined && existing.validatorToken !== expectedValidatorToken) {
      return false;
    }
    this.records.set(keyOf(sourceId, locatorIdentity, targetIdentity), [{ ...existing, observedAt }]);
    return true;
  }
}

function keyOf(sourceId: string, locatorIdentity: string, targetIdentity: string): string {
  return JSON.stringify([sourceId, locatorIdentity, targetIdentity]);
}
