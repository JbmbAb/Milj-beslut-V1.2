/**
 * W-CATCH2 (D) -- the REVIEWED list of catches in the read-fault inventory's scope that neither use the
 * shared classification, nor propagate their failure, nor carry a `CATCH-REVIEWED:` marker in the code.
 * They live in files this unit was not allowed to change (another lane owns them, or they are verified
 * and frozen), so they are reviewed here, by file and BODY FINGERPRINT (readFaultCatchInventory.scan.mjs
 * `fingerprint`: sha256 of the whitespace-collapsed handler body, first 16 hex). A change to such a
 * handler changes its fingerprint and fails the inventory until someone reviews it again -- that is the
 * point. A NEW catch must never be added here to silence the test: classify it (readFaultClassification.ts),
 * propagate the failure, or mark it in the code with a reason.
 *
 * OPEN_NOT_FIXED entries are real findings of this inventory in files W-CATCH2 must not change; the note
 * names the class and the owning lane. They are listed so they stay visible, not because they are right.
 */

export type ReadFaultCatchKind =
  | 'ABSENCE_ONLY'
  | 'NOT_A_READ'
  | 'CLEANUP'
  | 'BEST_EFFORT_LOGGED'
  | 'DEFERRED_RETHROW'
  | 'RACE_REREAD'
  | 'FAIL_CLOSED_EXIT'
  | 'SANITIZED_500'
  | 'OWN_CLASSIFICATION'
  | 'OPEN_NOT_FIXED';

export const READ_FAULT_CATCH_KINDS: Readonly<Record<ReadFaultCatchKind, string>> = {
  ABSENCE_ONLY: 'The handler answers only the repository\'s proven "never stored" for the exact id; everything else is rethrown or typed.',
  NOT_A_READ: 'Nothing in the try reads CAS, an index or a database: it validates, hashes or parses content that was already read (or a constant), and the handler fails closed (tampered / invalid / unparsable), never "missing".',
  CLEANUP: 'Releasing a resource (closing a runtime) after the answer is decided; a failure to clean up decides nothing.',
  BEST_EFFORT_LOGGED: 'A side effect whose failure is logged and does not decide any truth (no "missing", no "current", no mint).',
  DEFERRED_RETHROW: 'The failure is kept and thrown after the remaining candidates were examined (fail closed, order-independent).',
  RACE_REREAD: 'A unique-key race on an insert: the winner is re-read; when there is none, a refusal is thrown (fail closed). A read error of the re-read propagates.',
  FAIL_CLOSED_EXIT: 'A command-line verifier: the failure is printed and the process exits non-zero (the caller treats that as failed verification).',
  SANITIZED_500: 'The route answers a sanitized 500 (toSafeErrorResponse: no raw text) -- a technical failure, never "missing" and never another record.',
  OWN_CLASSIFICATION: 'A verified lane\'s own value-based classification that already separates proven absence, lasting storage faults and read errors (M1a-F1 verdicts, U20D/U20CDF2/W-APR mappings).',
  OPEN_NOT_FIXED: 'A real finding in a file W-CATCH2 must not change: the note names the class and the owning lane.',
};

export interface ReviewedCatch {
  readonly file: string;
  readonly fingerprint: string;
  /** How many handlers in the file have exactly this body. */
  readonly count: number;
  readonly kind: ReadFaultCatchKind;
  readonly note: string;
}

export const READ_FAULT_CATCH_REVIEWED: readonly ReviewedCatch[] = [
  // governedEvidenceDetails.ts (U20D / U20CDF lane; not changed by W-CATCH2)
  { file: 'server/modules/localization/governedEvidenceDetails.ts', fingerprint: 'cd784ea726513cb4', count: 1, kind: 'OWN_CLASSIFICATION', note: 'readArtifact: the exact "Artifact not found: <id>" is not_found, CASIntegrityError corrupted, anything else error (technical) -- never read as present or absent by guess' },
  { file: 'server/modules/localization/governedEvidenceDetails.ts', fingerprint: 'dabbdf16b8204c2b', count: 1, kind: 'NOT_A_READ', note: 'recomputing the spatial evidence content hash of an artifact already read; a failure means "not intact" (fail closed)' },
  { file: 'server/modules/localization/governedEvidenceDetails.ts', fingerprint: 'a21c28ae35b131a2', count: 3, kind: 'NOT_A_READ', note: 'rebuilding / validating root-provenance artifacts already read; a failure is "tampered" (fail closed)' },
  // localizationGeometryCurrentProvider.ts (M1a, VERIFIED -- logic frozen)
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '3756d762d4d9743b', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a-F1 candidate read: missing / corrupted / lasting storage fault are determined exclusions, every other failure is thrown as unresolvable' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '7d73c035f971b03f', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a: a REJECT_LOCALIZATION_GEOMETRY verdict excludes the candidate; anything else is thrown as unresolvable' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '420c89415f4fbbfa', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a-F1 edge read: missing / corrupted are determined exclusions, a lasting storage fault and anything else are thrown' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '66c673f5d69fa7d7', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a: an edge refused at validation is excluded; anything else is thrown as unresolvable' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '594d622aa360cb9b', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a-F1 issuer read: missing / corrupted excluded, a lasting storage fault and anything else thrown' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: '1dc564a33ee1743d', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a / OD-R3 issuer verification: key mismatch counted (configuration), a refusal excluded, anything else thrown' },
  { file: 'server/modules/localization/localizationGeometryCurrentProvider.ts', fingerprint: 'f23ceb279574ce3d', count: 1, kind: 'OWN_CLASSIFICATION', note: 'M1a: an edge refused at signature verification is excluded; anything else is thrown as unresolvable' },
  // provisioning queues (not changed by W-CATCH2)
  { file: 'server/modules/localization/localizationGeometrySupersessionQueue.ts', fingerprint: 'a3eab8d2372006cf', count: 1, kind: 'RACE_REREAD', note: 'enqueue lost a unique-key race: re-read the winner, else throw the refusal' },
  { file: 'server/modules/localization/localizationIdentityProvisioningQueue.ts', fingerprint: 'a3275b546fcffd42', count: 1, kind: 'RACE_REREAD', note: 'enqueue lost a unique-key race: re-read the winner, else throw the refusal' },
  { file: 'server/modules/localization/viewerCapabilityProvisioningQueue.ts', fingerprint: '7be264478ea60a92', count: 1, kind: 'RACE_REREAD', note: 'enqueue lost a unique-key race: re-read the winner, else throw the refusal' },
  // fresh verifier CLIs (not changed by W-CATCH2)
  { file: 'server/modules/localization/luExecutionIdentityV3VerifyCli.ts', fingerprint: '4fb23fe137f6fc2b', count: 1, kind: 'FAIL_CLOSED_EXIT', note: 'fresh public-key-only verification: exit code 1 is FRESH_VERIFICATION_FAILED for the worker' },
  { file: 'server/modules/localization/luProjectContextBootstrapVerifyCli.ts', fingerprint: '4fb23fe137f6fc2b', count: 1, kind: 'FAIL_CLOSED_EXIT', note: 'fresh public-key-only verification: exit code 1 is FRESH_VERIFICATION_FAILED for the worker' },
  { file: 'server/modules/localization/luViewerCapabilityVerifyCli.ts', fingerprint: '4fb23fe137f6fc2b', count: 1, kind: 'FAIL_CLOSED_EXIT', note: 'fresh public-key-only verification: exit code 1 is FRESH_VERIFICATION_FAILED for the worker' },
  // localizationOrchestrator.ts (W-U20CDF4 lane; not changed by W-CATCH2)
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: 'e86b102f06db4bc6', count: 1, kind: 'OWN_CLASSIFICATION', note: 'U20-D assessed point: exact not-found -> 424 MISSING, CASIntegrityError -> 424 TAMPERED, anything else 503 READ_ERROR (an object gone behind its index entry lands in 503 READ_ERROR, not a lasting class -- noted for the owning lane)' },
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: 'd0fe380a1f4696cf', count: 1, kind: 'NOT_A_READ', note: 'validating the assessed point already read: failure -> 424 TAMPERED (fail closed)' },
  // W-U20CDF5 (B1): the two assertProjectAccess catches (former OPEN_NOT_FIXED 0e002c221d34609a x2) now call
  // projectAccessFailure -- classified, so they are accepted by the scanner and no longer listed here.
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: 'dad2ad37bc2f8019', count: 1, kind: 'OWN_CLASSIFICATION', note: 'W-APR/U20CDF2 assessmentResolutionFailure: REJECT absence 404, typed selection faults 503/409/424' },
  // W-U20CDF5 (B2): the presentation catch (former OPEN_NOT_FIXED d7ff42e40d76b015) rethrows a typed
  // LuReadFaultError to the route and classifies everything else (projectAccessFailure / classifyReadFault ->
  // VIEWER_PRESENTATION_UNRESOLVED) -- accepted by the scanner, no longer listed here.
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: '451e8918e6743c45', count: 1, kind: 'OWN_CLASSIFICATION', note: 'U20CDF2 assessmentArtifactReadFailure: exact not-found 404, read error 503 retryable, lasting storage fault 503' },
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: '76c1f80445ebfa62', count: 1, kind: 'OWN_CLASSIFICATION', note: 'W-APR/U20CDF2 assessmentResolutionFailure (see above)' },
  { file: 'server/modules/localization/localizationOrchestrator.ts', fingerprint: 'b9fde1fe58ff150c', count: 1, kind: 'OWN_CLASSIFICATION', note: 'U20CDF2 assessmentArtifactReadFailure (see above)' },
  // W-U20CDF5 (B3): the contract-version catch (former OPEN_NOT_FIXED 4eac7eeebe7aa444) answers the selection's
  // typed ASSESSMENT_CONTRACT_REFUSED via classifyReadFault -- accepted by the scanner, no longer listed here.
  // W-U20CDF5 (B4): the authorizeAssessmentPresentation catch (former OPEN_NOT_FIXED 78beea267442af8c) now
  // classifies (projectAccessFailure for the access re-check, classifyReadFault for the binding); its inner
  // access-check catch propagates the failure -- both accepted by the scanner, no longer listed here.
  // W-U20CDF5 (B5): the two PDF context catches (former OPEN_NOT_FIXED 054922544981d0f7, 37dd1e5d75a57bb2) are one
  // readPdfContext catch that classifies (readExistingOrProvenAbsent + toReadFaultError) -- a failed read is a typed
  // fail-closed answer without a PDF, only a proven absence is printed; accepted by the scanner, not listed here.
  // No OPEN_NOT_FIXED entry remains in localizationOrchestrator.ts.
];
