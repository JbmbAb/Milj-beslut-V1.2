# prompt_optimizer/Dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cache.py checkpoint.py rate_limiter.py metadata.py metrics.py rerank_client.py eval.py main.py ./

ENV RERANK_CACHE_PATH=/tmp/rerank_eval_cache.sqlite
ENV CACHE_DIR=/tmp

ENTRYPOINT ["python", "main.py"]
