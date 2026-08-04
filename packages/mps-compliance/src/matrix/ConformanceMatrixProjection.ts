export interface ConformanceMatrixProjection {
  readonly version: string;

  readonly entries: readonly {
    readonly adr_id: string;
    readonly profile_id: string;
    readonly profile_version: string;
    readonly rule_ids: readonly string[];
  }[];
}
