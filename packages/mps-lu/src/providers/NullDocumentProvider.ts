import type { DocumentProviderContract } from "./DocumentProviderContract.js";
import type { DocumentDescriptor } from "../domain/DocumentDescriptor.js";
import type { CanonicalGeometry } from "../domain/CanonicalGeometry.js";

/**
 * Production-oriented provider: returns empty set when no upstream configured.
 * Prefer injecting a real VISS/LM adapter via LUBackendOrchestrator constructor.
 * The default selection (LU_DOC_PROVIDER unset) -- see resolveDocumentProviderFromEnv below.
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
 * Explicit test mode: NODE_ENV=test and APP_ENV is not a staging/production deployment.
 * Nothing else (no flag, no default) counts as test mode.
 */
function isExplicitTestMode(env: NodeJS.ProcessEnv): boolean {
  const appEnv = String(env.APP_ENV ?? "").trim().toLowerCase();
  return env.NODE_ENV === "test" && appEnv !== "staging" && appEnv !== "production";
}

/**
 * Selects the document provider for LUBackendOrchestrator.generateDocumentEvidence from env,
 * without importing Mock by default.
 *
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02):
 *  - unset / "" / "null" -> "null" (the default). The default used to be "postgis", which swept
 *    every DocumentRecord of the resolved municipality; the LU product path no longer calls this
 *    orchestrator at all (governed DocumentEvidence comes only from explicit refs).
 *  - "postgis" -> explicit opt-in only.
 *  - "mock" -> ONLY in explicit test mode; in any other mode it fails closed
 *    (LU_DOC_PROVIDER_MOCK_FORBIDDEN) and never silently becomes a provider.
 *  - anything else -> fails closed (LU_DOC_PROVIDER_UNRECOGNIZED); it used to fall through to
 *    "postgis".
 */
export function resolveDocumentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "null" | "mock" | "postgis" {
  const v = String(env.LU_DOC_PROVIDER ?? "").trim().toLowerCase();
  if (v === "" || v === "null") return "null";
  if (v === "postgis") return "postgis";
  if (v === "mock") {
    if (!isExplicitTestMode(env)) {
      throw new Error(
        "LU_DOC_PROVIDER_MOCK_FORBIDDEN: LU_DOC_PROVIDER=mock is only allowed in explicit test mode " +
          "(NODE_ENV=test, APP_ENV not staging/production). A mock document provider must never be " +
          "selectable outside tests.",
      );
    }
    return "mock";
  }
  throw new Error(
    `LU_DOC_PROVIDER_UNRECOGNIZED: '${v}' is not a document provider (expected null, postgis or mock).`,
  );
}
