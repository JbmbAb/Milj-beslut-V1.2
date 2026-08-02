import { CanonicalArtifact } from "../domain/types.js";

export class ArchiveEngine {
  archive<T extends CanonicalArtifact>(
    artifact: T
  ): void {
    // OK
    // Detta förhindrar compile-time att RuntimeResult skickas in här
  }
}
