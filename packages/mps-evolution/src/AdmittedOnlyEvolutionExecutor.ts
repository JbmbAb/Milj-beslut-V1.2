import type {
  MutatedCodeArtifact,
  EvaluationDatasetArtifact,
} from "./EvolutionTypes";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";
import type { EvolutionExecutor } from "./EvolutionExecutor";
import type {
  FrozenAdmissionResult,
  FrozenExecutionManifestIdentity,
} from "../../mps-runtime/src/contracts/freeze/FrozenIdentities";
import type { ExecutionKernel } from "../../mps-runtime/src/kernel/ExecutionKernel";

/**
 * Evolution SHALL execute admitted manifests only.
 * Manifest → Admission → Evolution (never Pipeline → Evolution without admit).
 */
export class AdmittedOnlyEvolutionExecutor implements EvolutionExecutor {
  constructor(
    private readonly kernel: ExecutionKernel,
    private readonly buildManifest: (
      candidate: MutatedCodeArtifact,
      dataset: EvaluationDatasetArtifact,
    ) => FrozenExecutionManifestIdentity,
    private readonly toExecutionReport: (
      admission: FrozenAdmissionResult,
    ) => ExecutionReport,
  ) {}

  async executeCandidate(
    candidate: MutatedCodeArtifact,
    dataset: EvaluationDatasetArtifact,
  ): Promise<ExecutionReport> {
    const manifest = this.buildManifest(candidate, dataset);
    const result = await this.kernel.execute(manifest);
    if (result.admission.decision !== "admitted") {
      throw new Error(
        `Evolution denied: manifest not admitted (${result.admission.reason_codes.join(",")})`,
      );
    }
    return this.toExecutionReport(result.admission);
  }
}
