import type { ContentReference, HashDescriptor, SchemaReference } from "./types";
import {
  ReferenceMismatchViolation,
  IntegrityViolation,
} from "./errors";

/**
 * Convert artifact → ContentReference
 */
export function toContentReference(artifact: {
  artifact_id: string;
  content_hash: HashDescriptor;
  schema_ref?: SchemaReference;
}): ContentReference {
  return {
    id: artifact.artifact_id,
    content_hash: artifact.content_hash,
    schema_ref: artifact.schema_ref,
  };
}

/**
 * Strict reference consistency check
 */
export function assertContentReferenceMatches(
  actual: ContentReference,
  expected: ContentReference,
  code: string,
  message: string,
  ViolationClass: new (
    code: string,
    message: string,
    artifact_ref?: ContentReference
  ) => IntegrityViolation = ReferenceMismatchViolation
): void {
  const schemaMismatch =
    expected.schema_ref !== undefined &&
    (
      actual.schema_ref === undefined ||
      actual.schema_ref.schema_id !== expected.schema_ref.schema_id ||
      actual.schema_ref.schema_version !== expected.schema_ref.schema_version
    );

  if (
    actual.id !== expected.id ||
    actual.content_hash.algorithm !== expected.content_hash.algorithm ||
    actual.content_hash.digest !== expected.content_hash.digest ||
    schemaMismatch
  ) {
    throw new ViolationClass(code, message, expected);
  }
}
