# prompt_optimizer/Dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cache.py checkpoint.py metadata.py metrics.py rate_limiter.py rerank_types.py \
     rerank_client.py async_rate_limiter.py async_rerank_client.py \
     eval.py eval_async.py main.py ./

ENV RERANK_CACHE_PATH=/tmp/rerank_eval_cache.sqlite
ENV CACHE_DIR=/tmp
ENV EVAL_MODE=sync

ENTRYPOINT ["python", "main.py"]
