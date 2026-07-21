# Manifest schema v2 — ArchiveManifestV2

Status: **implementerat** (2026-06-23). Batch A `--execute` skriver v2 direkt till Drive.

## Kontrakt

TypeScript: `scripts/import/types/manifestSchema.ts`  
JSON Schema: `scripts/import/schemas/manifest-v2.schema.json`  
JS helper (audit/rclone): `scripts/import/types/manifestSchema.mjs`

```typescript
type QAStatus = 'pending' | 'staging_ok' | 'passed' | 'failed';

interface ArchiveManifestV2 {
  schema_version: '2.0';
  provider: string;
  dataset: string;
  version: string;
  total_bytes: number;
  files: string[];
  content_bundle_sha256: string;
  provenance: string;
  source_url?: string;
  provider_version?: string;
  license?: string;
  qa_status: QAStatus;
  qa_at?: string;
  qa_error?: string;
  expected_columns?: string[];
  supersedes?: string;
  invalidated_by?: string;
  files_detail?: Array<{ name: string; sha256: string; size_bytes: number; rel_path?: string }>;
}
```

## qa_status

| Värde | Betydelse |
|-------|-----------|
| `pending` | Manifest skapat; Librarian har inte kört QA/import |
| `staging_ok` | ogr2ogr + staging QA OK; väntar promote |
| `passed` | Promote klar — canonical i PostGIS |
| `failed` | Schema/geometri/import fail — blockera `--auto-pick` |

Livscykel: `supersedes` pekar bakåt (version-sträng), `invalidated_by` pekar framåt när ny version ersätter denna.

## Batch A-flöde

1. `--propose` → lokala JSON med `schema_version: "2.0"`, `qa_status: "pending"`
2. CSV-granskning → `approved=true`
3. `--execute` → `ensureArchiveManifestV2()` (uppgraderar ev. tidiga v1-förslag) → rclone upload

Ingen separat v1→v2-migration behövs för de 794 mapparna.

## Librarian

- `validateArchiveManifestStructure()` accepterar v1 (uppgraderas) och v2
- `isImportEligible()` tillåter endast `pending` och `staging_ok`
- Write-back av `qa_status` / `qa_at` / `qa_error` till Drive: `--write-back-manifest` (köas asynkront, `flush` före exit; kastar inte vid Drive-fel)

## provenance vs source_url

- `provenance` — leveranstyp: `harvested`, `archive_manifest_audit_proposal`, `legacy_adopted`
- `source_url` — faktisk URL/API-endpoint (valfritt)
