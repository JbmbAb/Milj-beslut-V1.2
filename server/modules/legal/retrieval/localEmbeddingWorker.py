# -*- coding: utf-8 -*-
"""Local embedding worker for the legal retrieval path (W-NO-GOOGLE-02A).

Protocol: line-delimited JSON, one request per line on stdin, one reply per line on stdout.
stdout carries ONLY protocol lines; everything a library prints is routed to stderr.

  ready  -> {"type": "ready", "runtime": {...}}                       (once, after the model is loaded)
  embed  <- {"id": n, "op": "embed", "role": "query"|"passage", "texts": [...], "max_seq_length": int|null}
         -> {"id": n, "type": "result", "runtime": {...}, "vectors": [[...], ...]}
         -> {"id": n, "type": "error", "message": "..."}

The worker is a dumb encoder. Input prefixes (e.g. "query: ") are added by the caller, which owns the
pipeline definition; this process adds nothing and rewrites nothing.

Containment (fail closed, no fallback):
- offline only: HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE are forced, the model is loaded from a local
  snapshot directory named by its exact commit, never resolved from a name, branch or tag;
- a missing snapshot, a missing GPU when cuda is required, or a dimension that differs from the
  declared one stops the process before it announces itself ready -- there is no CPU fallback and no
  other model;
- vectors are returned exactly as the pinned model produces them (L2-normalised by the library):
  no padding, no truncation, no re-scaling.

Same load and encode path as the frozen A7 evaluation harness: SentenceTransformer(snapshot,
device=..., model_kwargs={dtype: float16}, local_files_only=True) and encode(normalize_embeddings=True).
"""
import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hf-home", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--pipeline", required=True)
    parser.add_argument("--dimension", type=int, required=True)
    parser.add_argument("--device", choices=["cuda", "cpu"], required=True)
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()

    # Protocol channel: keep the real stdout for protocol lines, send all library output to stderr.
    protocol = sys.stdout
    sys.stdout = sys.stderr
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    protocol.reconfigure(encoding="utf-8", newline="\n") if hasattr(protocol, "reconfigure") else None

    os.environ["HF_HOME"] = args.hf_home
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    def send(obj: dict) -> None:
        protocol.write(json.dumps(obj, ensure_ascii=False) + "\n")
        protocol.flush()

    snapshot = Path(args.hf_home) / "hub" / ("models--" + args.repo.replace("/", "--")) / "snapshots" / args.revision
    if not snapshot.is_dir():
        print("pinned snapshot not found: " + str(snapshot), file=sys.stderr)
        return 2

    import numpy as np  # noqa: F401  (imported so a missing runtime fails before ready)
    import sentence_transformers
    import torch
    import transformers
    from sentence_transformers import SentenceTransformer

    if args.device == "cuda" and not torch.cuda.is_available():
        print("cuda is required but not available -- refusing to fall back to cpu", file=sys.stderr)
        return 3

    model_kwargs = {"dtype": torch.float16} if args.device == "cuda" else {}
    model = SentenceTransformer(str(snapshot), device=args.device, model_kwargs=model_kwargs, local_files_only=True)

    dimension = model.get_sentence_embedding_dimension()
    if dimension != args.dimension:
        print("model dimension %s != declared %s" % (dimension, args.dimension), file=sys.stderr)
        return 4

    first_param = next(model.parameters())
    base_runtime = {
        "hf_repo": args.repo,
        "hf_revision": args.revision,
        "pipeline_version": args.pipeline,
        "dimension": int(dimension),
        "normalization": "l2",
        "device": str(first_param.device),
        "dtype": str(first_param.dtype).replace("torch.", ""),
        "library_versions": {
            "torch": str(torch.__version__),
            "sentence_transformers": str(sentence_transformers.__version__),
            "transformers": str(transformers.__version__),
            "numpy": str(np.__version__),
            "python": sys.version.split()[0],
        },
    }
    send({"type": "ready", "runtime": {**base_runtime, "max_seq_length": int(model.max_seq_length), "truncated_count": 0}})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            if request.get("op") != "embed":
                raise ValueError("unknown op")
            texts = request["texts"]
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be a list of strings")
            max_seq = request.get("max_seq_length")
            if max_seq is not None:
                model.max_seq_length = int(max_seq)
            limit = int(model.max_seq_length)
            tokenizer = model.tokenizer
            truncated = sum(1 for t in texts if len(tokenizer(t, add_special_tokens=True)["input_ids"]) > limit)
            vectors = model.encode(
                texts,
                batch_size=args.batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            send(
                {
                    "id": request_id,
                    "type": "result",
                    "runtime": {**base_runtime, "max_seq_length": limit, "truncated_count": int(truncated)},
                    "vectors": [[float(x) for x in row] for row in vectors],
                }
            )
        except Exception as error:  # noqa: BLE001 -- every failure is reported, never swallowed
            send({"id": request_id, "type": "error", "message": "%s: %s" % (type(error).__name__, error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
