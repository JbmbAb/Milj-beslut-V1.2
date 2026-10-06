# -*- coding: utf-8 -*-
"""Offline local embedding worker for W-NO-GOOGLE-02A.

The caller supplies only a closed model key. This worker owns the immutable key -> model/revision/
pipeline mapping and verifies the runtime-essential snapshot files before SentenceTransformer loads
anything. No repository/revision/pipeline value is accepted from the caller.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

_FROZEN_REGISTRY_JSON = r"""{
  "schema": "mimer-local-embedding-registry-1",
  "pipelines": {
    "bge-m3": {
      "hf_repo": "BAAI/bge-m3",
      "hf_revision": "5617a9f61b028005a4858fdac845db406aefb181",
      "pipeline_version": "local-st-bge-m3-dense-v1",
      "dimension": 1024,
      "normalization": "l2",
      "max_seq_length": null,
      "snapshot_manifest_sha256": "ad53098aac8c75a64934f63661527777481de725b45c8daa0d2bd44468372a66",
      "files": [
        {"path":"1_Pooling/config.json","algo":"git-blob-sha1","digest":"9bd85925f325e25246d94c4918dc02ab98f2a1b7","size":191},
        {"path":"config.json","algo":"git-blob-sha1","digest":"e6eda1c72da8f9dc30fdd9b69c73d35af3b7a7ad","size":687},
        {"path":"config_sentence_transformers.json","algo":"git-blob-sha1","digest":"1fba91c78a6c8e17227058ab6d4d3acb5d8630a9","size":123},
        {"path":"modules.json","algo":"git-blob-sha1","digest":"952a9b81c0bfd99800fabf352f69c7ccd46c5e43","size":349},
        {"path":"pytorch_model.bin","algo":"sha256","digest":"b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38","size":2271145830},
        {"path":"sentence_bert_config.json","algo":"git-blob-sha1","digest":"0140ba1eac83a3c9b857d64baba91969d988624b","size":54},
        {"path":"sentencepiece.bpe.model","algo":"sha256","digest":"cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865","size":5069051},
        {"path":"special_tokens_map.json","algo":"git-blob-sha1","digest":"b1879d702821e753ffe4245048eee415d54a9385","size":964},
        {"path":"tokenizer.json","algo":"sha256","digest":"21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08","size":17098108},
        {"path":"tokenizer_config.json","algo":"git-blob-sha1","digest":"dc69ac559dcba2694012009aaa108c614541789a","size":444}
      ]
    },
    "multilingual-e5-large": {
      "hf_repo": "intfloat/multilingual-e5-large",
      "hf_revision": "3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
      "pipeline_version": "local-st-multilingual-e5-large-v1",
      "dimension": 1024,
      "normalization": "l2",
      "max_seq_length": 512,
      "snapshot_manifest_sha256": "184a4cbfce0022ad5454ef20a4f484b5811f6d85bc1010a1bde6136fcc8e3c19",
      "files": [
        {"path":"1_Pooling/config.json","algo":"git-blob-sha1","digest":"63d473457c905564c8f818cff50a22e144b45f7b","size":201},
        {"path":"config.json","algo":"git-blob-sha1","digest":"fc68c8c9ccbe4af4c95b6c9f8d4a3b8d6c790768","size":690},
        {"path":"model.safetensors","algo":"sha256","digest":"020afdebf2762b29fcaf286629a96c3b3b65af241f6a08226b1cfee60a21def6","size":2239611368},
        {"path":"modules.json","algo":"git-blob-sha1","digest":"ac2039abdf6ff023b27c919bb9675cfe378cb10f","size":387},
        {"path":"sentence_bert_config.json","algo":"git-blob-sha1","digest":"4eca68d85ecd3034cf4174d8a4033a75344ea62d","size":57},
        {"path":"sentencepiece.bpe.model","algo":"sha256","digest":"cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865","size":5069051},
        {"path":"special_tokens_map.json","algo":"git-blob-sha1","digest":"d5698132694f4f1bcff08fa7d937b1701812598e","size":280},
        {"path":"tokenizer.json","algo":"sha256","digest":"62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626","size":17082660},
        {"path":"tokenizer_config.json","algo":"git-blob-sha1","digest":"6de1940d16d38be9877bf7cc228c9377841b311f","size":418}
      ]
    }
  }
}"""
_REGISTRY = json.loads(_FROZEN_REGISTRY_JSON)["pipelines"]


def setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print("missing required setting " + name, file=sys.stderr)
        raise RuntimeError("missing required setting " + name)
    return value


def _file_digest(path: Path, algo: str, size: int) -> str:
    if algo == "sha256":
        h = hashlib.sha256()
    elif algo == "git-blob-sha1":
        h = hashlib.sha1()
        h.update(("blob %d\0" % size).encode("ascii"))
    else:
        raise RuntimeError("unsupported manifest hash algorithm: " + algo)
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _manifest_digest(files: list[dict]) -> str:
    h = hashlib.sha256()
    for entry in sorted(files, key=lambda x: x["path"]):
        line = "%s\0%s\0%s\0%s\n" % (
            entry["path"], entry["algo"], entry["digest"], entry["size"]
        )
        h.update(line.encode("utf-8"))
    return h.hexdigest()


def verify_snapshot(snapshot: Path, spec: dict) -> str:
    files = spec["files"]
    manifest = _manifest_digest(files)
    if manifest != spec["snapshot_manifest_sha256"]:
        raise RuntimeError("frozen snapshot manifest definition hash mismatch")
    root = snapshot.resolve()
    for entry in files:
        rel = Path(entry["path"])
        if rel.is_absolute() or ".." in rel.parts:
            raise RuntimeError("unsafe path in frozen snapshot manifest: " + entry["path"])
        target = (snapshot / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise RuntimeError("snapshot manifest path escapes snapshot: " + entry["path"]) from exc
        if not target.is_file():
            raise RuntimeError("required snapshot file missing: " + entry["path"])
        size = target.stat().st_size
        if size != int(entry["size"]):
            raise RuntimeError("snapshot size mismatch: " + entry["path"])
        actual = _file_digest(target, entry["algo"], size)
        if actual != entry["digest"]:
            raise RuntimeError("snapshot content hash mismatch: " + entry["path"])
    return manifest


def main() -> int:
    try:
        hf_home = setting("HF_HOME")
        model_key = setting("MIMER_EMBED_MODEL_KEY")
        device = setting("MIMER_EMBED_DEVICE")
    except RuntimeError:
        return 2
    spec = _REGISTRY.get(model_key)
    if spec is None:
        print("unknown local embedding model key: " + model_key, file=sys.stderr)
        return 2
    if device not in ("cuda", "cpu"):
        print("MIMER_EMBED_DEVICE must be cuda or cpu", file=sys.stderr)
        return 2
    batch_size = int(os.environ.get("MIMER_EMBED_BATCH", "4"))

    protocol = sys.stdout
    sys.stdout = sys.stderr
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(protocol, "reconfigure"):
        protocol.reconfigure(encoding="utf-8", newline="\n")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

    def send(obj: dict) -> None:
        protocol.write(json.dumps(obj, ensure_ascii=False) + "\n")
        protocol.flush()

    repo = spec["hf_repo"]
    revision = spec["hf_revision"]
    snapshot = Path(hf_home) / "hub" / ("models--" + repo.replace("/", "--")) / "snapshots" / revision
    if not snapshot.is_dir():
        print("pinned snapshot not found: " + str(snapshot), file=sys.stderr)
        return 2

    try:
        manifest_sha = verify_snapshot(snapshot, spec)
    except Exception as exc:
        print("snapshot verification failed: %s" % exc, file=sys.stderr)
        return 2

    import numpy as np
    import sentence_transformers
    import torch
    import transformers
    from sentence_transformers import SentenceTransformer

    if device == "cuda" and not torch.cuda.is_available():
        print("cuda is required but not available -- refusing to fall back to cpu", file=sys.stderr)
        return 3

    model_kwargs = {"dtype": torch.float16} if device == "cuda" else {}
    model = SentenceTransformer(str(snapshot), device=device, model_kwargs=model_kwargs, local_files_only=True)
    if spec["max_seq_length"] is not None:
        model.max_seq_length = int(spec["max_seq_length"])

    dimension = model.get_sentence_embedding_dimension()
    if dimension != int(spec["dimension"]):
        print("model dimension %s != frozen %s" % (dimension, spec["dimension"]), file=sys.stderr)
        return 4

    first_param = next(model.parameters())
    base_runtime = {
        "model_key": model_key,
        "hf_repo": repo,
        "hf_revision": revision,
        "pipeline_version": spec["pipeline_version"],
        "dimension": int(dimension),
        "normalization": spec["normalization"],
        "device": str(first_param.device),
        "dtype": str(first_param.dtype).replace("torch.", ""),
        "snapshot_revision": revision,
        "snapshot_manifest_sha256": manifest_sha,
        "interpreter_realpath": str(Path(sys.executable).resolve()),
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
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            request_id = request["id"]
            if request.get("op") != "embed":
                raise ValueError("unknown op")
            texts = request["texts"]
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be a list of strings")
            requested_max = request.get("max_seq_length")
            frozen_max = spec["max_seq_length"]
            if frozen_max is not None and requested_max != frozen_max:
                raise ValueError("requested max_seq_length differs from frozen pipeline")
            if frozen_max is None and requested_max is not None:
                raise ValueError("caller may not override the frozen model default")
            limit = int(model.max_seq_length)
            tokenizer = model.tokenizer
            truncated = sum(1 for t in texts if len(tokenizer(t, add_special_tokens=True)["input_ids"]) > limit)
            vectors = model.encode(
                texts,
                batch_size=batch_size,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            send({
                "id": request_id,
                "type": "result",
                "runtime": {**base_runtime, "max_seq_length": limit, "truncated_count": int(truncated)},
                "vectors": [[float(x) for x in row] for row in vectors],
            })
        except Exception as error:
            send({"id": request_id, "type": "error", "message": "%s: %s" % (type(error).__name__, error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
