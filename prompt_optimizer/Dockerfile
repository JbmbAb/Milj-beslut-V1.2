# prompt_optimizer/Dockerfile
# Multi-stage/lightweight build for the custom Vertex AI prompt optimizer container.

FROM python:3.10-slim

WORKDIR /app

# Install standard cloud storage and scientific dependencies
RUN pip install --no-cache-dir \
    google-cloud-storage>=2.0.0 \
    numpy>=1.20.0

# Copy application files
COPY main.py .

# Entrypoint config
ENTRYPOINT ["python", "main.py"]
