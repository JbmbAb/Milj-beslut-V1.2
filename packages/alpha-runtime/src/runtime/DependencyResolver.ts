import { ExecutionPlanArtifact, ExecutionDependency } from "../execution/ExecutionPlanArtifact";
import { HashDescriptor } from "../types";
import { Sha256HashEngine } from "./engines/Sha256HashEngine";
import { JsonCanonicalizer } from "./engines/SimpleCanonicalizer";

export interface DependencyResolution {
  plan_id: string;
  graph_hash: HashDescriptor;
  order: string[];
  dependencies: ExecutionDependency[];
}

export class DependencyResolver {
  private hasher = new Sha256HashEngine();
  private canonicalizer = new JsonCanonicalizer();

  async resolve(plan: ExecutionPlanArtifact): Promise<DependencyResolution> {
    const graph: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();

    // Initialize
    for (const step of plan.steps) {
      graph.set(step.step_id, []);
      inDegree.set(step.step_id, 0);
    }

    // Build graph
    for (const dep of plan.dependencies) {
      if (!graph.has(dep.from) || !graph.has(dep.to)) {
        throw new Error("missing_dependency_target");
      }
      if (dep.type === "data" || dep.type === "control" || dep.type === "policy") {
        graph.get(dep.from)!.push(dep.to);
        inDegree.set(dep.to, inDegree.get(dep.to)! + 1);
      }
    }

    // Topological sort (Kahn's algorithm)
    const queue: string[] = [];
    // To ensure determinism, sort the queue alphabetically
    const initialNodes = Array.from(inDegree.entries())
      .filter(([_, count]) => count === 0)
      .map(([id]) => id)
      .sort();
      
    queue.push(...initialNodes);

    const order: string[] = [];

    while (queue.length > 0) {
      // Deterministically pick the first element (queue is always sorted)
      queue.sort();
      const node = queue.shift()!;
      order.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        const count = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, count);
        if (count === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (order.length !== plan.steps.length) {
      throw new Error("cyclic_dependency");
    }

    const graphBytes = this.canonicalizer.serialize(order);
    const graph_hash = await this.hasher.hash(graphBytes, "sha256-v1");

    return {
      plan_id: plan.plan_id,
      graph_hash,
      order,
      dependencies: plan.dependencies
    };
  }
}
