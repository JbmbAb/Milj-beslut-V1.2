import { ReplayVerifier } from "./ReplayVerifier";
import { ExecutionIdentityInvariant } from "./invariants/ExecutionIdentityInvariant";
import { ExecutionPlanInvariant } from "./invariants/ExecutionPlanInvariant";
import { DependencyGraphInvariant } from "./invariants/DependencyGraphInvariant";
import { SeedInvariant } from "./invariants/SeedInvariant";
import { ExecutionOrderInvariant } from "./invariants/ExecutionOrderInvariant";
import { OutputInvariant } from "./invariants/OutputInvariant";

export class ReplayVerifierProfiles {
  static strict(): ReplayVerifier {
    return new ReplayVerifier([
      ExecutionIdentityInvariant,
      ExecutionPlanInvariant,
      DependencyGraphInvariant,
      SeedInvariant,
      ExecutionOrderInvariant,
      OutputInvariant,
    ]);
  }

  static audit(): ReplayVerifier {
    return new ReplayVerifier([
      ExecutionIdentityInvariant,
      ExecutionPlanInvariant,
      DependencyGraphInvariant,
      SeedInvariant,
      OutputInvariant,
    ]);
  }

  static debug(): ReplayVerifier {
    return new ReplayVerifier([
      ExecutionIdentityInvariant,
      ExecutionPlanInvariant,
      DependencyGraphInvariant,
      SeedInvariant,
      ExecutionOrderInvariant,
      OutputInvariant,
    ]);
  }
}
