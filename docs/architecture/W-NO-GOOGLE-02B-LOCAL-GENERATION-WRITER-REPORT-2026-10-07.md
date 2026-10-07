# W-NO-GOOGLE-02B â€” local generation replacement writer report

Date: 2026-10-07
Branch: `rt/no-google-02b-local-generation`
Base: `621a28680c277e1e4f8a24483acf33be566e99e9`
Writer status: **WORKING / BLOCKED_BY_LOCAL_GENERATION_RUNTIME**
Independent verification: **NOT PERFORMED**

## Owner invariant

Future active generation paths are local/on-prem only. No Google, no replacement cloud provider and no mock/canned production generation is admitted. When no governed local generation runtime is registered, generation fails closed with `BLOCKED_BY_LOCAL_GENERATION_RUNTIME`.

## Reachability census and disposition

Production-reachable generation surfaces were migrated to the provider-neutral `LocalGenerationPort` or explicitly retired:

| Surface | Disposition |
| --- | --- |
| Legal answer composition | `GeminiAnswerModelProvider` removed; `AnswerModelProvider` remains the domain seam and uses the local generation port |
| `vertexAiService` | Removed; text/JSON callers migrated to the local port |
| multimodal Vertex helper | Retired; no reachable caller found and no unsafe compatibility layer added |
| AI provider implementation / core AI gateway | Migrated to local port; no cloud fallback |
| librarian services | Migrated to local port |
| project plan / logistics generation | Migrated to local port |
| legal rerank | Local generation when available; deterministic lexical fallback otherwise |
| biodiversity generation | Provider-neutral local service |
| dirigent/report generation | Provider-neutral local service |
| platform AI adapter | Replaced by `LocalAIAdapter`; strict structured parsing, no fabricated stub result |
| AI assistant service/API | Renamed provider-neutrally; active endpoint is `/api/ai-assistant` |
| health/readiness/migration scope | Google/Vertex generation is no longer a production prerequisite; local runtime availability is reported |
| production mock selection | `USE_MOCK_AI` no longer selects a production mock; test-only mock remains test-only |
| executive-summary mock path | Production placeholder/mock selection removed; missing governed context/runtime fails closed |

Current port importers include the legal answer provider, AI provider/gateway, both librarian paths, reranker, project-plan/logistics services, local biodiversity/dirigent services, assistant service, LLM provider, local platform adapter, health and migration-readiness surfaces.

## Removed 02B provider surfaces

The following files are absent:
- `server/services/vertexAiService.ts`
- `server/modules/legal/answer/GeminiAnswerModelProvider.ts`
- `stubs/browser/vertexAiService.ts`
- `scripts/ops/db-checks/check_vertex_config.ts`

The former active names `geminiService`, `geminiApi.express`, `GeminiClientExample`, `vertexDirigent`, `geminiBiodiversityService` and `geminiSystemPrompt` were removed from the active generation surface and replaced with provider-neutral names.

`geminiDbApi` remains outside this unit: it is a legacy database API name, not a generation provider or Google SDK/runtime path. Historical comments/evidence are not authority.

## Runtime blocker

No governed local generation runtime was found in the repository or machine census: no configured Ollama, llama.cpp or vLLM runtime and no admitted local model/runtime contract. Therefore this unit intentionally does **not** select a model or fake a runtime.

The `LocalGenerationPort` has no public/cloud default URL, no fetch-based cloud escape hatch and no mock default. Missing runtime is a hard fail-closed generation blocker.

## Test evidence â€” writer run, not independent verification

- `tests/unit/noGoogleGeneration02b.test.ts`: **35/35 PASS**
- repaired assistant/component/legal-rerank/search/local-adapter matrix: **86/86 PASS**
- local dirigent/biodiversity/platform composition/audit/dossier-retirement matrix: **19/19 PASS**
- targeted ESLint over the 02B core/repaired files: **PASS**
- repo-wide TypeScript check: **EXIT 2 on the pre-existing broad baseline; 0 diagnostics matched the named 02B touched/core paths in the captured output**
- `git diff --check`: **PASS**

Negative control:
- Current B1 test copied into an isolated worktree at exact base `621a2868`.
- B1 failed as expected because base `LegalAnswerComposition.ts` still imported/created the Gemini answer provider.
- This is RED evidence only, not independent verification.

## No-Google guard

The guard at `fe0e0cfc` is unchanged.

On this isolated 02B branch it now reports exactly one remaining hit:

`google-sdk-import server/modules/legal/retrieval/GeminiEmbeddingProvider.ts`

That hit belongs to parallel 02A. 02B-owned guard hits are **0**.

The guard must not be allowlisted or weakened. After 02A + 02B reconciliation the combined target is zero hits / GREEN.

## Dependency cleanup candidates

Do not remove shared dependencies in this unit. Combined 02A/02B reconciliation must decide them after all imports are gone.

Current candidates:
- `@google-cloud/vertexai` â€” no longer needed by 02B generation after removal of `vertexAiService`
- `google-auth-library` â€” no longer needed by 02B generation
- `@google/genai` â€” still required by the isolated branch's 02A-owned `GeminiEmbeddingProvider.ts`
- `@google/generative-ai` â€” verify globally before removal

## Final writer disposition

`W-NO-GOOGLE-02B-LOCAL-GENERATION-REPLACEMENT: WORKING / BLOCKED_BY_LOCAL_GENERATION_RUNTIME`

Do not call this VERIFIED, EXECUTION_VERIFIED or PROVEN.
Do not close `W-NO-GOOGLE-02-RUNTIME-CUT` or `GLOBAL ZERO GOOGLE` from this writer unit.
