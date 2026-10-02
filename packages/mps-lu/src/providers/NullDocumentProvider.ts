import type { DocumentProviderContract } from "./DocumentProviderContract.js";
import type { DocumentDescriptor } from "../domain/DocumentDescriptor.js";
import type { CanonicalGeometry } from "../domain/CanonicalGeometry.js";

/**
 * Production-oriented provider: returns empty set when no upstream configured.
 * The default selection (LU_DOC_PROVIDER unset) -- see resolveDocumentProviderFromEnv below.
 * (K0-FIX-1 b: LUBackendOrchestrator, which used to construct providers from this selection, is
 * removed; governed DocumentEvidence comes only from explicit refs resolved from CAS.)
 */
export class NullDocumentProvider implements DocumentProviderContract {
  getProviderName(): string {
    return "NullDocumentProvider";
  }

  async fetchDocumentsForGeometry(_geometry: CanonicalGeometry): Promise<DocumentDescriptor[]> {
    return [];
  }
}

/**
 * K0-FIX-1 (a): the ONLY APP_ENV values under which the mock may be selected -- an explicit
 * ALLOWLIST of test-classified environments, matched exactly (no trimming, no case folding).
 * Unset/empty APP_ENV is not a test environment, and neither is "development". demo, stage,
 * staging, preprod, prod, production, local, and every unknown, misspelt, partial, upper-case or
 * padded value are refused. The K0 version used a denylist (only "staging"/"production"), which let
 * NODE_ENV=test activate the mock in a deployment that calls itself prod, stage, demo or preprod --
 * or that sets no APP_ENV at all.
 */
const MOCK_ALLOWED_APP_ENVS: ReadonlySet<string> = new Set(["test", "ci"]);

/**
 * Explicit test mode: NODE_ENV exactly "test" AND APP_ENV explicitly set to a value on the allowlist
 * above. Nothing else (no flag, no default, no fallback) counts as test mode. A test that needs the
 * mock sets APP_ENV itself. Returns why the mock is refused, or null when it is allowed.
 */
function mockRefusalReason(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV !== "test") return "NODE_ENV is not exactly 'test'";
  const appEnv = env.APP_ENV;
  if (typeof appEnv !== "string" || appEnv === "") {
    return "APP_ENV is not set; the mock requires APP_ENV explicitly set to 'test' or 'ci'";
  }
  if (!MOCK_ALLOWED_APP_ENVS.has(appEnv)) {
    return "APP_ENV is not a test-classified environment (allowlist, exact match: 'test', 'ci')";
  }
  return null;
}

/**
 * The single reading of LU_DOC_PROVIDER: which document provider env asks for. It constructs
 * nothing and imports no provider; no product path selects a provider from env any more (K0-FIX-1 b
 * removed LUBackendOrchestrator.generateDocumentEvidence, its only consumer).
 *
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02) + K0-FIX-1:
 *  - unset / "" / "null" -> "null" (the default). The default used to be "postgis", which swept
 *    every DocumentRecord of the resolved municipality; governed DocumentEvidence comes only from
 *    explicit refs.
 *  - "postgis" -> no longer a provider (K0-FIX-1 b): the opt-in to the municipality sweep is
 *    removed and fails closed like any unrecognised value.
 *  - "mock" -> ONLY in explicit test mode (NODE_ENV exactly "test" AND APP_ENV exactly "test" or
 *    "ci", see MOCK_ALLOWED_APP_ENVS); in any other mode it fails closed
 *    (LU_DOC_PROVIDER_MOCK_FORBIDDEN) and never silently becomes a provider.
 *  - anything else -> fails closed (LU_DOC_PROVIDER_UNRECOGNIZED); it used to fall through to
 *    "postgis".
 */
export function resolveDocumentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "null" | "mock" {
  const v = String(env.LU_DOC_PROVIDER ?? "").trim().toLowerCase();
  if (v === "" || v === "null") return "null";
  if (v === "mock") {
    const refusal = mockRefusalReason(env);
    if (refusal !== null) {
      throw new Error(
        "LU_DOC_PROVIDER_MOCK_FORBIDDEN: LU_DOC_PROVIDER=mock is only allowed in explicit test mode " +
          "(NODE_ENV exactly 'test' AND APP_ENV explicitly set to a test-classified environment: exactly " +
          "'test' or 'ci'). " +
          `Refused: ${refusal}. A mock document provider must never be selectable outside tests.`,
      );
    }
    return "mock";
  }
  throw new Error(
    `LU_DOC_PROVIDER_UNRECOGNIZED: '${v}' is not a document provider (expected null or mock).`,
  );
}
