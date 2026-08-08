/**
 * Dataset family — Mimers Brunn naming vs product identity.
 * Families group related products; they must NOT be auto-merged.
 */
export type DatasetFamilyMemberRole =
  | 'canonical'
  | 'alias'
  | 'scale_variant'
  | 'generation_variant'
  | 'sidecar_extract'
  | 'legacy_path'
  | 'windows_duplicate'
  | 'empty_stub';

export type DatasetFamilyMember = {
  readonly folder: string;
  readonly role: DatasetFamilyMemberRole;
  readonly registry_key?: string;
  readonly note?: string;
};

export type DatasetFamily = {
  readonly family_id: string;
  readonly provider: string;
  readonly label: string;
  readonly members: readonly DatasetFamilyMember[];
  readonly do_not_merge: true;
};

export function buildDatasetFamily(input: {
  family_id: string;
  provider: string;
  label: string;
  members: readonly DatasetFamilyMember[];
}): DatasetFamily {
  return {
    family_id: input.family_id,
    provider: input.provider,
    label: input.label,
    members: input.members,
    do_not_merge: true,
  };
}
