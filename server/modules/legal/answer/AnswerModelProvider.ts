/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01 / W-NO-GOOGLE-02B.
 *
 * The AnswerModelProvider DOMAIN SEAM plus the local, provider-neutral implementation. Google is
 * retired: the former Gemini implementation was removed; generation now goes through the local
 * generation port (server/modules/ai/generation/LocalGenerationPort.ts) and fails closed when no
 * governed local runtime is registered.
 *
 * The model is asked for STRUCTURED JSON so that every claim's citations are explicit,
 * machine-checkable data -- `cited_fragments` -- rather than something inferred from prose. This
 * provider itself does no validation of whether a claimed citation is real; that is deliberately
 * NOT its job. It only proposes claims and their claimed citations. LegalAnswerComposition.ts is
 * the only place a claimed citation is checked against the governed retrieval set (via
 * buildCitation) and admitted or dropped.
 */

import {
  getLocalGenerationPort,
  isLocalGenerationAvailable,
  LocalGenerationUnavailableError,
  type LocalGenerationPort,
} from "../../ai/generation/LocalGenerationPort";

export const ANSWER_PIPELINE_VERSION = "answer-pipeline-local-v1" as const;
/** Bumped whenever buildPrompt()'s wording changes -- LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01
 *  freezes this alongside the other answer-configuration versions before its run.
 *  v2 (LEGAL-ANSWER-PROMPT-CALIBRATION-01): calibrates the ANSWER vs INSUFFICIENT_EVIDENCE
 *  decision -- explicitly permits bounded, scoped synthesis across multiple cited passages
 *  (targeting the baseline's two FALSE_REFUSAL cases), while explicitly forbidding an
 *  "always answer if any evidence exists" rule, which would only trade false refusals for
 *  overclaims. Retrieval, context assembly, and the citation contract are untouched. */
export const ANSWER_PROMPT_VERSION = "answer-prompt-v2" as const;
/** Bumped whenever RESPONSE_SCHEMA's shape changes. */
export const ANSWER_RESPONSE_SCHEMA_VERSION = "answer-response-schema-v2" as const;

export class AnswerModelError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AnswerModelError";
  }
}

export interface AnswerContextEntryForModel {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly content: string;
}

/** What the model is allowed to propose -- validated against the governed retrieval set entirely
 *  OUTSIDE this provider, by LegalAnswerComposition.ts + buildCitation. */
export interface ProposedClaim {
  readonly text: string;
  readonly cited_fragments: readonly { fragment_id: string; materialization_id: string }[];
}

export interface AnswerGeneration {
  readonly insufficient_evidence: boolean;
  readonly claims: readonly ProposedClaim[];
}

export interface AnswerModelProvider {
  readonly model_id: string;
  readonly model_version: string;
  readonly pipeline_version: string;
  generateAnswer(query: string, context: readonly AnswerContextEntryForModel[]): Promise<AnswerGeneration>;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    insufficient_evidence: { type: "boolean" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          cited_fragments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fragment_id: { type: "string" },
                materialization_id: { type: "string" },
              },
              required: ["fragment_id", "materialization_id"],
            },
          },
        },
        required: ["text", "cited_fragments"],
      },
    },
  },
  required: ["insufficient_evidence", "claims"],
} as const;

function buildPrompt(query: string, context: readonly AnswerContextEntryForModel[]): string {
  const passages = context
    .map(
      (c, i) =>
        `[PASSAGE ${i + 1}] fragment_id=${c.fragment_id} materialization_id=${c.materialization_id}\n${c.content}`,
    )
    .join("\n\n");

  return [
    "Du är ett svenskt miljö-/planjuridiskt uppslagsverktyg. Svara ENDAST utifrån de bifogade passagerna nedan.",
    "Du får ALDRIG citera information som inte finns ordagrant i en bifogad passage, och du får ALDRIG hitta på",
    "fragment_id eller materialization_id -- använd bara de exakta värden som står ovanför varje passage.",
    "",
    "Du FÅR och BÖR göra en begränsad syntes när flera bifogade passager tillsammans -- var och en fullt",
    "korrekt citerad för sig -- ger ett meningsfullt svar på frågan, även om ingen enskild passage ensam",
    "täcker hela frågan. Ange i så fall svarets omfattning eller begränsning uttryckligen i svarstexten",
    "(t.ex. \"utifrån de bifogade bestämmelserna...\", \"såvitt framgår av det bifogade materialet...\"),",
    "snarare än att avstå enbart för att inget enskilt utdrag räcker på egen hand.",
    "",
    "Sätt insufficient_evidence=true ENDAST när passagerna genuint saknar innehåll som besvarar frågans",
    "kärna -- inte bara för att inget enskilt utdrag är en perfekt, fullständig träff. Men anta ALDRIG att",
    "\"någon relevant passage finns\" i sig räcker för att alltid producera ett svar -- en syntes som går",
    "längre än vad de citerade passagerna faktiskt säger är lika fel som en obefogad refusal. Formulera",
    "aldrig en svag träff som ett bevisat juridiskt faktum -- svarets säkerhet i tonen får aldrig överstiga",
    "vad passagerna faktiskt styrker.",
    "",
    `FRÅGA: ${query}`,
    "",
    "PASSAGER:",
    passages,
  ].join("\n");
}

/** Deterministic, fail-closed shape validation. No coercion, no best-effort repair. */
export function parseAnswerGeneration(text: string): AnswerGeneration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnswerModelError(
      "ANSWER_MODEL_INVALID_JSON",
      "model response was not valid JSON -- failing closed",
    );
  }
  const obj = parsed as Partial<AnswerGeneration> | null;
  const mismatch = () =>
    new AnswerModelError(
      "ANSWER_MODEL_SCHEMA_MISMATCH",
      "model response did not match the required {insufficient_evidence, claims} shape -- failing closed",
    );
  if (!obj || typeof obj !== "object" || typeof obj.insufficient_evidence !== "boolean" || !Array.isArray(obj.claims)) {
    throw mismatch();
  }
  for (const claim of obj.claims as unknown[]) {
    const c = claim as { text?: unknown; cited_fragments?: unknown } | null;
    if (!c || typeof c.text !== "string" || !Array.isArray(c.cited_fragments)) throw mismatch();
    for (const f of c.cited_fragments as unknown[]) {
      const r = f as { fragment_id?: unknown; materialization_id?: unknown } | null;
      if (!r || typeof r.fragment_id !== "string" || typeof r.materialization_id !== "string") throw mismatch();
    }
  }
  return { insufficient_evidence: obj.insufficient_evidence, claims: obj.claims as ProposedClaim[] };
}

/** Local provider over the generation port. Fails closed: no runtime, empty or malformed output
 *  throws rather than being treated as an empty or fabricated answer. Never falls back to a mock
 *  or to any cloud endpoint. */
export function createLocalAnswerModelProvider(port?: LocalGenerationPort): AnswerModelProvider {
  if (!port && !isLocalGenerationAvailable()) {
    throw new AnswerModelError(
      "ANSWER_MODEL_NOT_CONFIGURED",
      "BLOCKED_BY_LOCAL_GENERATION_RUNTIME: no governed local generation runtime -- refusing to fabricate an answer",
    );
  }
  const runtime = port ?? getLocalGenerationPort();

  return {
    model_id: runtime.model_id,
    model_version: runtime.model_version,
    pipeline_version: ANSWER_PIPELINE_VERSION,
    async generateAnswer(query, context): Promise<AnswerGeneration> {
      let text: string;
      try {
        text = await runtime.generateText(buildPrompt(query, context), {
          profile: "json",
          temperature: 0,
          responseSchema: RESPONSE_SCHEMA,
        });
      } catch (err) {
        if (err instanceof LocalGenerationUnavailableError) {
          throw new AnswerModelError("ANSWER_MODEL_NOT_CONFIGURED", err.message);
        }
        throw err;
      }
      if (typeof text !== "string" || !text.trim()) {
        throw new AnswerModelError("ANSWER_MODEL_EMPTY_RESPONSE", "model returned no text -- failing closed");
      }
      return parseAnswerGeneration(text);
    },
  };
}
