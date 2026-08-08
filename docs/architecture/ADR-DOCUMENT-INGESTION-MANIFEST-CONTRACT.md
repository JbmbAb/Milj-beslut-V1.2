# ADR — Document Ingestion, Classification & Manifest Contract (Knowledge Pipeline)

## Status

**ACCEPTED / SEQUENCE FROZEN**

## Context & Motivation

Having identified a massive 50.7 GB corpus of 40,606 raw PDF documents within the `GEO_Master_Archive/Documents/` folder, the temptation is to immediately write an automated bulk RAG/chunking pipeline to load them into pgvector. This would be a major architectural failure. Attempting to chunk and index unstructured PDFs at this volume without a strict metadata catalog, classifications, or pre-processing audits results in noise, broken context boundaries, high embedding costs, and useless retrieval.

Furthermore, we must strictly isolate the different geodata tiers to ensure high performance and maintainable pipelines. Heavy spatial datasets (1.27 TB of raster, 185 GB of PostGIS GPKGs, and 256 GB of source ZIPs) must never be channled through the document ingestion pipeline. Only the frysta 50.7 GB of PDFs are eligible for the RAG/knowledge pipeline.

## Architectural Decision

We formalize the **Unified Knowledge & Document Ingestion Architecture**, dividing the pipeline into distinct, auditable phases, beginning with a strict **DocumentInventoryManifest** gate.

### 1. Unified Knowledge Pipeline Architecture

```text
GEO_Master_Archive (1.98 TB Corpus)
        ├── GIS ──────────────→ PostGIS (185 GB Vector) / Tile Pipeline (1.27 TB Raster)
        │
        └── Documents (50.7 GB PDF)
               ↓
        Document Inventory Manifest (Metadata Catalog Gate)
               ↓
        Classification (Legal, Environmental, Technical)
               ↓
        Canonical Document Structure
               ↓
        Text extraction / OCR Audit
               ↓
        Layout-aware chunking (Semantic boundaries)
               ↓
        Metadata + legal references
               ↓
        BM25 + pgvector (Hybrid Search)
               ↓
        DocumentEvidenceArtifact (Cryptographic proof)
               ↓
        LU / RAG / Report
```

### 2. Document Inventory Manifest Schema

Before any document is processed for text extraction or chunking, it MUST be registered in the `DocumentInventoryManifest`. For every PDF, the manifest must record:

#### Core System Properties:
*   `document_id`: Stable UUIDv7 or content-hash-based ID.
*   `source_path`: Original path inside `GEO_Master_Archive/Documents/Sources/`.
*   `content_hash`: SHA-256 cryptographic checksum of the raw PDF.
*   `file_size`: Size in bytes.
*   `modified_at`: File system last modification timestamp.
*   `page_count`: Number of pages.
*   `text_extractable`: Boolean (indicates if PDF has native font maps).
*   `ocr_required`: Boolean (indicates if OCR must be run, e.g. scanned images).

#### Inferred Business Metadata (Classification):
*   `document_type`: Core classification (one of: `legal_document`, `court_decision`, `environmental_decision`, `technical_report`, `MKB`, `consultant_report`, `map`, `administrative_document`, `unknown`).
*   `authority`: Issuing body (e.g. `Boverket`, `Nacka Mark- och miljödomstol`, `Länsstyrelsen Västmanland`).
*   `document_date`: Date of issue.
*   `case_number`: Diarienummer / Case ID.
*   `title`: Document title or subject.
*   `language`: Primary language (default: `sv`).

### 3. Isolated Knowledge Domains

To enable targeted, highly performant semantic retrieval, documents in the manifest must be segmented into distinct, queryable knowledge domains (verticals):

#### `LEGAL` (The Legislative Corpus):
*   *Miljöbalken (MB)*, related Swedish ordinances (förordningar), agency regulations (föreskrifter), and fryst court precedents (rättspraxis).
*   **Purpose:** Hard environmental law validation.

#### `ENVIRONMENTAL_DECISIONS` (The Administrative Corpus):
*   Municipal permits and decisions (Kommun), regional administrative rulings (Länsstyrelse), and national agency declarations.
*   **Purpose:** Locality reference and evidence-gathering.

#### `TECHNICAL` (The Engineering Corpus):
*   Environmental Impact Assessments (MKB), geotechnical reports (geoteknik), hydrogeological analyses (hydrogeologi), and chemical pollution assessments (miljöteknik).
*   **Purpose:** Physical characteristics validation and soil/groundwater characteristics.

---

## Implications & Next Steps

1.  **DocumentInventoryManifest:** The next concrete deliverable is to implement the offline scanning engine that generates the manifest catalog without installing any external heavy dependencies.
2.  **DocumentIngestionPipeline v1:** Once the manifest is completed, audited, and verified (providing complete stats, e.g. extractable vs OCR-required count), we proceed with compiling `DocumentIngestionPipeline` (Step 4: *Canonical Document Structure*).
3.  **LayoutAwareChunker v1:** Next, we develop the parser that divides the text based on physical headers and paragraphs (Step 5: *Evidence Chunks*).
