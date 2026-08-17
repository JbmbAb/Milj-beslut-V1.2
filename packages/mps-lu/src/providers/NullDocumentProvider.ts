import type { DocumentProviderContract } from "./DocumentProviderContract.js";
import type { DocumentDescriptor } from "../domain/DocumentDescriptor.js";
import type { CanonicalGeometry } from "../domain/CanonicalGeometry.js";

/**
 * Production-oriented provider: returns empty set when no upstream configured.
 * Prefer injecting a real VISS/LM adapter via LUBackendOrchestrator constructor.
 * MockDocumentProvider is no longer the silent default when LU_DOC_PROVIDER=null.
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
 * Selects document provider from env without importing Mock by default.
 */
export function resolveDocumentProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "null" | "mock" | "postgis" {
  const v = (env.LU_DOC_PROVIDER ?? "postgis").toLowerCase();
  if (v === "mock") return "mock";
  if (v === "null") return "null";
  return "postgis";
}
