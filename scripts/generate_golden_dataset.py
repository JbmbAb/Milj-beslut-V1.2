# scripts/generate_golden_dataset.py
"""
Generates 2,000 realistic synthetic geospatial and semantic Swedish queries 
as a high-fidelity Golden Dataset for prompt optimization.
"""

import os
import json
import argparse
import random
from pathlib import Path

# Swedish environmental and geodata templates to synthesize high-quality records
SWEDISH_MUNICIPALITIES = [
    "Västerås", "Enköping", "Sala", "Uppsala", "Örebro", "Norrköping", 
    "Sigtuna", "Norrtälje", "Gävle", "Nyköping", "Linköping", "Karlstad"
]

ENVIRONMENTAL_FEATURES = [
    {"term": "skyddade områden", "type": "spatial", "cap": "geospatial_retrieval"},
    {"term": "naturreservat", "type": "spatial", "cap": "geospatial_retrieval"},
    {"term": "riksintresse för friluftsliv", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "strandskyddsbestämmelser", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "grundvattenmagasin", "type": "spatial", "cap": "geospatial_retrieval"},
    {"term": "vattenprovtagning", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "vindkraftsetablering", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "miljökonsekvensbeskrivning", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "jordartsanalys", "type": "spatial", "cap": "geospatial_retrieval"},
    {"term": "skogsbruksplan", "type": "semantic", "cap": "semantic_retrieval"},
    {"term": "kulturmiljövård", "type": "spatial", "cap": "geospatial_retrieval"}
]

CONTEXT_SNIPPETS = [
    "Naturvårdsverkets register över skyddade områden med särskilda föreskrifter.",
    "Länsstyrelsens rapport rörande strandskydd och dispenser för fastighetsbildning.",
    "SGU rapport om brunnar, uttagsmängder samt kemisk analys av grundvatten.",
    "Miljödomstolens dom angående tillstånd till vindkraftspark och bullernivåer.",
    "Kommunkarta över detaljplanelagda riksintressen samt fornlämningar.",
    "Rapport om biologisk mångfald och förekomst av fridlysta arter i våtmarker."
]

def generate_synthetic_record(idx):
    muni = random.choice(SWEDISH_MUNICIPALITIES)
    feature = random.choice(ENVIRONMENTAL_FEATURES)
    
    query = f"Visa {feature['term']} nära {muni}" if feature["type"] == "spatial" else f"Utredning gällande {feature['term']} i {muni} kommun"
    
    # Generate 2 distinct context documents
    doc1_id = f"doc_{idx}_1"
    doc2_id = f"doc_{idx}_2"
    
    # Document 1: Highly relevant to the feature
    doc1_text = f"Detta dokument beskriver {feature['term']} i detalj. {random.choice(CONTEXT_SNIPPETS)}"
    doc1_lat = round(59.0 + random.uniform(-1.0, 1.0), 4)
    doc1_lon = round(16.0 + random.uniform(-1.0, 1.0), 4)
    
    # Document 2: Less relevant to the feature
    another_feat = random.choice([f for f in ENVIRONMENTAL_FEATURES if f["term"] != feature["term"]])
    doc2_text = f"Allmän översiktsplan för samhällsbyggnad rörande {another_feat['term']}."
    doc2_lat = round(59.0 + random.uniform(-2.0, 2.0), 4)
    doc2_lon = round(16.0 + random.uniform(-2.0, 2.0), 4)
    
    context_docs = [
        {"doc_id": doc1_id, "text": doc1_text, "lat": doc1_lat, "lon": doc1_lon},
        {"doc_id": doc2_id, "text": doc2_text, "lat": doc2_lat, "lon": doc2_lon}
    ]
    
    # Gold ranking places doc1 first because it directly covers the requested feature
    gold_ranking = [doc1_id, doc2_id]
    
    return {
        "id": f"uuid-{idx:04d}",
        "query": query,
        "query_type": feature["type"],
        "context_documents": context_docs,
        "gold_ranking": gold_ranking,
        "metadata": {
            "capability": feature["cap"],
            "difficulty": random.choice(["easy", "medium", "hard"]),
            "source": "synthetic_from_capability_graph_v1",
            "sensitivity": "low" # Standard compliance labelling
        }
    }

def main():
    parser = argparse.ArgumentParser(description="Generate 2,000 synthetic golden records")
    parser.add_argument("--outdir", default="benchmarks", help="Output directory path")
    parser.add_argument("--n", type=int, default=2000, help="Number of records to generate")
    args = parser.parse_args()

    out_path = Path(args.outdir)
    out_path.mkdir(exist_ok=True)
    
    filename = out_path / f"golden_v1_{args.n}_records.jsonl"
    
    with open(filename, "w", encoding="utf-8") as f:
        for i in range(1, args.n + 1):
            record = generate_synthetic_record(i)
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            
    print(f"Successfully generated {args.n} golden records inside: {filename}")

if __name__ == "__main__":
    main()
