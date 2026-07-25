# poc_end_to_end.py
# Körbar end-to-end POC med Evolver: Plugin scan -> Planner -> Constraint Solver -> Simulator -> Fitness -> Tracker -> Evolution
# Se README för instruktioner.

import os, json, glob, yaml, hashlib, time, random
from dataclasses import dataclass, asdict, field
from typing import Dict, Any, List
import networkx as nx
import numpy as np
import scipy.stats as st
from pathlib import Path

# -------------------------
# Datamodeller (immutabla)
# -------------------------
@dataclass(frozen=True)
class PipelineNode:
    node_id: str
    capability: str
    service: str
    implementation_id: str
    execution_engine: str
    deployment: str
    runtime_profile: str
    resources: Dict[str, Any] = field(default_factory=dict)
    config_version: str = ""

@dataclass
class QualityVector:
    faithfulness: float
    faithfulness_std: float
    citation_recall: float
    citation_recall_std: float
    correctness: float
    correctness_std: float

@dataclass
class ExperimentResult:
    pipeline_hash: str
    pipeline_graph: Dict[str, Any]
    evaluation: Dict[str, Any]
    telemetry_samples: List[Dict[str,Any]]
    mutation: str
    parent_hashes: List[str]
    generation: int
    population_index: int
    timestamp: str

# -------------------------
# Plugin loader & registry
# -------------------------
class PluginRegistry:
    def __init__(self, plugin_dir="plugins"):
        self.plugin_dir = Path(plugin_dir)
        self.plugins = {}
        self.scan_plugins()

    def scan_plugins(self):
        self.plugins = {}
        for p in self.plugin_dir.glob("*/plugin.yaml"):
            data = yaml.safe_load(p.read_text())
            pid = data.get("plugin_id")
            self.plugins[pid] = data

    def get_candidates_for_capability(self, capability):
        return [v for v in self.plugins.values() if v.get("provides",{}).get("capability")==capability]

    def simulate(self, implementation_id, runtime, workload, concurrency, n=1):
        plugin = self.plugins.get(implementation_id)
        if not plugin:
            return {"latency_samples": list(np.random.lognormal(mean=3.5, sigma=0.4, size=n)),
                    "cost_samples": list(np.random.gamma(shape=2.0, scale=0.02, size=n)),
                    "memory_samples": [1 for _ in range(n)]}
        meta = plugin.get("metadata",{})
        est_lat = meta.get("estimated_latency_ms",50)
        mu = np.log(max(est_lat,1))
        sigma = meta.get("latency_sigma",0.35)
        lat = list(np.random.lognormal(mean=mu, sigma=sigma, size=n))
        cost = list(np.random.gamma(shape=2.0, scale=meta.get("estimated_cost_per_query",0.01), size=n))
        mem = [meta.get("resources",{}).get("ram_gb",4) for _ in range(n)]
        return {"latency_samples": lat, "cost_samples": cost, "memory_samples": mem}

# -------------------------
# PipelineGraph (immutable nodes)
# -------------------------
class PipelineGraph:
    def __init__(self):
        self.g = nx.DiGraph()

    def add_node(self, node: PipelineNode):
        self.g.add_node(node.node_id, node=node)

    def add_edge(self, src, dst):
        self.g.add_edge(src, dst)

    def to_dict(self):
        nodes = []
        for n,d in self.g.nodes(data=True):
            nodes.append({"node_id": n, **asdict(d["node"])})
        edges = [{"src":u,"dst":v} for u,v in self.g.edges()]
        return {"nodes": nodes, "edges": edges}

    def hash(self, registry_versions, dataset_version, prompt_version, policy_version, model_versions):
        payload = {
            "pipeline": self.to_dict(),
            "registry_versions": registry_versions,
            "dataset_version": dataset_version,
            "prompt_version": prompt_version,
            "policy_version": policy_version,
            "model_versions": model_versions
        }
        s = json.dumps(payload, sort_keys=True, separators=(',',':'))
        return hashlib.sha256(s.encode('utf-8')).hexdigest()

    def sample_path_for_query(self, query):
        return [self.g.nodes[n]["node"] for n in nx.topological_sort(self.g)]

# -------------------------
# Planner (generates many candidates)
# -------------------------
class Planner:
    def __init__(self, registry: PluginRegistry):
        self.registry = registry
        self.prompt_version = "opt-prompt-d900aa00"

    def generate_candidates(self, intent, n_candidates=50):
        if intent=="spatial_reasoning":
            capability = "geospatial_retrieval"
        else:
            capability = "semantic_retrieval"
        candidates = []
        impls = self.registry.get_candidates_for_capability(capability)
        if not impls:
            impls = [{"plugin_id":"pgvector","metadata":{"estimated_latency_ms":35,"estimated_cost_per_query":0.01}}]
        for i in range(n_candidates):
            g = PipelineGraph()
            impl = random.choice(impls)
            node1 = PipelineNode(node_id=f"n1_{i}", capability=capability, service=impl.get("provides",{}).get("service","vector_service"),
                                 implementation_id=impl["plugin_id"], execution_engine=impl.get("provides",{}).get("execution_engine","sql_executor_v1"),
                                 deployment="docker", runtime_profile="cpu_small", resources={"ram_gb":8}, config_version="v1")
            reranker_id = "cross-enc-small" if random.random()<0.3 else "none"
            node2 = PipelineNode(node_id=f"n2_{i}", capability="reranker", service="rerank_service",
                                 implementation_id=reranker_id, execution_engine="model_executor", deployment="docker",
                                 runtime_profile="cpu_small", resources={"ram_gb":4}, config_version=self.prompt_version)
            g.add_node(node1); g.add_node(node2); g.add_edge(node1.node_id, node2.node_id)
            candidates.append(g)
        return candidates

# -------------------------
# Constraint Solver
# -------------------------
class ConstraintSolver:
    def __init__(self, registry, policy):
        self.registry = registry
        self.policy = policy

    def filter_hard(self, candidates, context):
        out = []
        for c in candidates:
            ok = True
            for n,d in c.g.nodes(data=True):
                node = d["node"]
                if node.implementation_id=="none" and self.policy.get("require_reranker",False):
                    ok=False
            if ok:
                out.append(c)
        return out

    def soft_penalty(self, pipeline):
        penalty = 0.0
        for n,d in pipeline.g.nodes(data=True):
            node = d["node"]
            if node.resources.get("ram_gb",0) > 64:
                penalty += 0.1
        return penalty

# -------------------------
# Evolver (mutation + recombination)
# -------------------------
class Evolver:
    """Hanterar mutationer och rekombination av pipelines."""
    def __init__(self, registry):
        self.registry = registry

    def mutate(self, parent: PipelineGraph) -> PipelineGraph:
        """Skapar en ny variant av en existerande pipeline."""
        child = PipelineGraph()
        # Kopiera noder och kanter (förenklad kopiering)
        nodes = parent.sample_path_for_query("")
        for node in nodes:
            # Chans för mutation av implementation
            if random.random() < 0.3:
                capability = node.capability
                candidates = self.registry.get_candidates_for_capability(capability)
                if candidates:
                    new_impl = random.choice(candidates)
                    new_node = PipelineNode(
                        node_id=node.node_id,
                        capability=capability,
                        service=new_impl.get("provides", {}).get("service", "vector_service"),
                        implementation_id=new_impl["plugin_id"],
                        execution_engine=new_impl.get("provides", {}).get("execution_engine", "sql_executor_v1"),
                        deployment=node.deployment,
                        runtime_profile=node.runtime_profile,
                        resources=new_impl.get("metadata", {}).get("resources", {"ram_gb": 8}),
                        config_version=new_impl.get("version","v1")
                    )
                    child.add_node(new_node)
                else:
                    child.add_node(node)
            else:
                child.add_node(node)
        # Återskapa kanter (förenklat)
        node_ids = [n.node_id for n in nodes]
        for i in range(len(node_ids)-1):
            child.add_edge(node_ids[i], node_ids[i+1])
        return child

# -------------------------
# Simulator (hierarchical Monte Carlo)
# -------------------------
class HierarchicalSimulator:
    def __init__(self, registry):
        self.registry = registry

    def simulate_pipeline(self, pipeline: PipelineGraph, queries: List[str], mc_samples=100, concurrency=1):
        results = []
        for s in range(mc_samples):
            q = random.choice(queries)
            path = pipeline.sample_path_for_query(q)
            total_latency = 0.0
            total_cost = 0.0
            per_node = []
            for node in path:
                sim = self.registry.simulate(node.implementation_id, node.runtime_profile, workload=len(queries), concurrency=concurrency, n=1)
                lat = sim["latency_samples"][0]
                cost = sim["cost_samples"][0]
                contention = np.random.gamma(shape=1.2, scale=2.0)
                lat += contention
                total_latency += lat
                total_cost += cost
                per_node.append({"node":node.node_id,"latency":lat,"cost":cost,"impl":node.implementation_id})
            has_rerank = any(n.implementation_id.startswith("cross-enc") for n in path)
            qv = {
                "faithfulness": max(0.0, min(1.0, 0.8 + (0.05 if has_rerank else 0.0) + np.random.normal(0,0.02))),
                "citation_recall": max(0.0, min(1.0, 0.7 + (0.03 if has_rerank else 0.0) + np.random.normal(0,0.02))),
                "correctness": max(0.0, min(1.0, 0.75 + np.random.normal(0,0.02)))
            }
            results.append({"latency_ms": total_latency, "cost": total_cost, "per_node": per_node, "quality": qv})
        return results

# -------------------------
# Fitness Engine
# -------------------------
class FitnessEngine:
    def __init__(self, objectives):
        self.objectives = objectives

    def aggregate(self, sim_results):
        latencies = [r["latency_ms"] for r in sim_results]
        costs = [r["cost"] for r in sim_results]
        faiths = [r["quality"]["faithfulness"] for r in sim_results]
        p95 = np.percentile(latencies,95)
        mean_lat = float(np.mean(latencies))
        mean_cost = float(np.mean(costs))
        mean_faith = float(np.mean(faiths))
        std_faith = float(np.std(faiths))
        evalr = {
            "quality": {"faithfulness": mean_faith, "faithfulness_std": std_faith},
            "latency": {"p95_ms": float(p95), "mean_ms": mean_lat},
            "cost": {"estimated": mean_cost},
            "confidence": 0.9
        }
        return evalr

# -------------------------
# Experiment Tracker (file-based)
# -------------------------
class ExperimentTracker:
    def __init__(self, outdir="experiments"):
        self.outdir = Path(outdir)
        self.outdir.mkdir(exist_ok=True)

    def record(self, exp: ExperimentResult):
        fname = self.outdir / f"experiment_{exp.pipeline_hash}.json"
        with open(fname, "w", encoding="utf-8") as f:
            json.dump(asdict(exp), f, indent=2, default=str)
        print("Saved experiment:", fname)

# -------------------------
# Orchestrator med evolution
# -------------------------
class Orchestrator:
    def __init__(self, plugin_dir="plugins"):
        self.registry = PluginRegistry(plugin_dir)
        self.planner = Planner(self.registry)
        self.policy = {"require_reranker": False}
        self.constraint_solver = ConstraintSolver(self.registry, self.policy)
        self.simulator = HierarchicalSimulator(self.registry)
        self.fitness = FitnessEngine(objectives={"quality":0.6,"latency":0.2,"cost":0.2})
        self.tracker = ExperimentTracker()
        self.evolver = Evolver(self.registry)

    def run_experiment(self, intent="spatial_reasoning", n_candidates=100, mc_samples=200):
        print("Scanning plugins...")
        self.registry.scan_plugins()
        print("Generating candidates...")
        candidates = self.planner.generate_candidates(intent, n_candidates=n_candidates)
        print(f"Generated {len(candidates)} candidates")
        filtered = self.constraint_solver.filter_hard(candidates, context={})
        print(f"After hard constraints: {len(filtered)} candidates")
        topk = filtered[:min(40,len(filtered))]
        queries = ["geo: find polygons near X", "what is flow in river Y", "compare area Z"]
        results = []
        for idx, cand in enumerate(topk):
            sim = self.simulator.simulate_pipeline(cand, queries, mc_samples=mc_samples, concurrency=4)
            evalr = self.fitness.aggregate(sim)
            phash = cand.hash(registry_versions={"plugins":"v1"}, dataset_version="v1", prompt_version="v1", policy_version="v1", model_versions={"cross-enc":"v1"})
            exp = ExperimentResult(
                pipeline_hash=phash,
                pipeline_graph=cand.to_dict(),
                evaluation=evalr,
                telemetry_samples=sim[:10],
                mutation="initial",
                parent_hashes=[],
                generation=0,
                population_index=idx,
                timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ")
            )
            self.tracker.record(exp)
            results.append((phash, evalr))
        results_sorted = sorted(results, key=lambda x: x[1]["quality"]["faithfulness"], reverse=True)
        print("Top 5 by faithfulness:")
        for r in results_sorted[:5]:
            print(r)
        return results_sorted

    def evolve_architecture(self, generations=5, pop_size=10, mc_samples=200):
        print(f"--- Startar Evolution (Gen 0) ---")
        population = self.planner.generate_candidates("semantic_retrieval", n_candidates=pop_size)
        for gen in range(generations):
            results = []
            print(f"\nUtvärderar Generation {gen}...")
            for cand in population:
                sim = self.simulator.simulate_pipeline(cand, ["test_query"], mc_samples=mc_samples)
                evalr = self.fitness.aggregate(sim)
                results.append((cand, evalr))
            results.sort(key=lambda x: x[1]["quality"]["faithfulness"], reverse=True)
            parents = [r[0] for r in results[:max(2, pop_size // 5)]]
            print(f"Bästa faithfulness i Gen {gen}: {results[0][1]['quality']['faithfulness']:.4f}")
            next_pop = parents.copy()
            while len(next_pop) < pop_size:
                parent = random.choice(parents)
                next_pop.append(self.evolver.mutate(parent))
            population = next_pop
        # return best candidate and its evaluation
        best = results[0]
        return best

# -------------------------
# Bootstrap: create sample plugins if none exist
# -------------------------
def bootstrap_plugins():
    pdir = Path("plugins")
    pdir.mkdir(exist_ok=True)
    pg = pdir / "pgvector"
    pg.mkdir(exist_ok=True)
    plugin_yaml = {
        "plugin_id":"pgvector",
        "name":"pgvector",
        "version":"1.2.0",
        "provides":{"capability":"semantic_retrieval","service":"vector_service","execution_engine":"sql_executor_v1"},
        "metadata":{"estimated_latency_ms":35,"estimated_cost_per_query":0.01,"latency_sigma":0.35,"resources":{"ram_gb":8}},
        "adapters":[{"adapter_id":"pgvector_sql_adapter","supported_deployments":["docker","kubernetes"]}]
    }
    (pg / "plugin.yaml").write_text(yaml.safe_dump(plugin_yaml))
    fa = pdir / "faiss"
    fa.mkdir(exist_ok=True)
    plugin_yaml2 = {
        "plugin_id":"faiss",
        "name":"faiss",
        "version":"1.7",
        "provides":{"capability":"semantic_retrieval","service":"vector_service","execution_engine":"faiss_executor"},
        "metadata":{"estimated_latency_ms":12,"estimated_cost_per_query":0.005,"latency_sigma":0.25,"resources":{"ram_gb":16}},
        "adapters":[{"adapter_id":"faiss_docker_adapter","supported_deployments":["docker","kubernetes"]}]
    }
    (fa / "plugin.yaml").write_text(yaml.safe_dump(plugin_yaml2))
    neo = pdir / "postgis"
    neo.mkdir(exist_ok=True)
    plugin_yaml3 = {
        "plugin_id":"postgis",
        "name":"postgis",
        "version":"3.1",
        "provides":{"capability":"geospatial_retrieval","service":"polygon_search","execution_engine":"sql_executor_v1"},
        "metadata":{"estimated_latency_ms":40,"estimated_cost_per_query":0.003,"latency_sigma":0.4,"resources":{"ram_gb":8}},
        "adapters":[{"adapter_id":"postgis_adapter","supported_deployments":["docker","kubernetes","cloud_sql"]}]
    }
    (neo / "plugin.yaml").write_text(yaml.safe_dump(plugin_yaml3))

# -------------------------
# Run POC or Evolution
# -------------------------
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Körbar end-to-end POC för Miljöbeslut")
    parser.add_argument("--smoke", action="store_true", help="Kör i rök-test/smoke-läge med minimala samples")
    parser.add_argument("--use_prompt", default=None, help="GCS URI eller ID för optimerad prompt")
    args = parser.parse_args()

    bootstrap_plugins()
    orch = Orchestrator(plugin_dir="plugins")

    if args.use_prompt:
        # Condense prompt ID for the model config configuration
        prompt_val = args.use_prompt
        if prompt_val.startswith("gs://"):
            h = hashlib.sha256(prompt_val.encode('utf-8')).hexdigest()[:8]
            prompt_val = f"opt-prompt-{h}"
        print(f"Konfigurerar pipeline att använda optimerad prompt: {prompt_val}")
        orch.planner.prompt_version = prompt_val

    if args.smoke:
        print("--- Startar Smoke Test (Rök-test) ---")
        print(f"Kör experiment med n_candidates=1 och mc_samples=50...")
        res = orch.run_experiment(intent="spatial_reasoning", n_candidates=1, mc_samples=50)
        print("Rök-test slutfört framgångsrikt!")
    else:
        # Kör enkel experimentloop
        print("Kör standardexperiment...")
        res = orch.run_experiment(intent="spatial_reasoning", n_candidates=80, mc_samples=200)
        # Kör evolutionär optimering (POC)
        print("\nKör evolutionär optimering POC...")
        best_candidate, best_eval = orch.evolve_architecture(generations=4, pop_size=12, mc_samples=150)
        print("Evolution klar. Bästa evaluation:", best_eval)
