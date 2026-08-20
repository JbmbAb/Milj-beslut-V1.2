/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01.
 *
 * Real, Gemini API-key-backed answer model provider -- same call mechanism as
 * GeminiEmbeddingProvider.ts (GEMINI_API_KEY / `@google/genai`, NOT Vertex ADC, which was proven
 * broken in this environment during LEGAL-RETRIEVAL-BOUNDED-PILOT-01).
 *
 * The model is asked for STRUCTURED JSON (responseSchema, not free text parsed by regex) so that
 * every claim's citations are explicit, machine-checkable data -- `cited_fragments` -- rather than
 * something inferred from prose. This provider itself does no validation of whether a claimed
 * citation is real; that is deliberately NOT its job. It only proposes claims and their claimed
 * citations. LegalAnswerComposition.ts is the only place a claimed citation is checked against the
 * governed retrieval set (via buildCitation) and admitted or dropped -- fail-closed enforcement
 * lives in the contract layer, never in the model call itself.
 */

import { GoogleGenAI, Type } from "@google/genai";

export const ANSWER_MODEL_ID = "gemini-2.5-flash" as const;
export const ANSWER_MODEL_VERSION = "2.5" as const;
export const ANSWER_PIPELINE_VERSION = "answer-pipeline-gemini-v1" as const;
/** Bumped whenever buildPrompt()'s wording changes -- LEGAL-RETRIEVAL-ANSWER-QUALITY-BASELINE-01
 *  freezes this alongside the other answer-configuration versions before its run.
 *  v2 (LEGAL-ANSWER-PROMPT-CALIBRATION-01): calibrates the ANSWER vs INSUFFICIENT_EVIDENCE
 *  decision -- explicitly permits bounded, scoped synthesis across multiple cited passages
 *  (targeting the baseline's two FALSE_REFUSAL cases), while explicitly forbidding an
 *  "always answer if any evidence exists" rule, which would only trade false refusals for
 *  overclaims. Retrieval, context assembly, and the citation contract are untouched. */
export const ANSWER_PROMPT_VERSION = "answer-prompt-v2" as const;
/** Bumped whenever RESPONSE_SCHEMA's shape changes. */
export const ANSWER_RESPONSE_SCHEMA_VERSION = "answer-response-schema-v1" as const;

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
  type: Type.OBJECT,
  properties: {
    insufficient_evidence: { type: Type.BOOLEAN },
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          cited_fragments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fragment_id: { type: Type.STRING },
                materialization_id: { type: Type.STRING },
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
};

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

/** Real provider. Fails closed: a malformed/unparseable model response throws rather than being
 *  silently treated as an empty or fabricated answer. */
export function createGeminiAnswerModelProvider(modelId: string = ANSWER_MODEL_ID): AnswerModelProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AnswerModelError(
      "ANSWER_MODEL_NOT_CONFIGURED",
      "GEMINI_API_KEY is not set -- refusing to fabricate an answer",
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  return {
    model_id: modelId,
    model_version: ANSWER_MODEL_VERSION,
    pipeline_version: ANSWER_PIPELINE_VERSION,
    async generateAnswer(query, context): Promise<AnswerGeneration> {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: buildPrompt(query, context) }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      });

      const text = response.text;
      if (!text) {
        throw new AnswerModelError("ANSWER_MODEL_EMPTY_RESPONSE", "model returned no text -- failing closed");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AnswerModelError(
          "ANSWER_MODEL_INVALID_JSON",
          "model response was not valid JSON despite a structured response schema -- failing closed",
        );
      }

      const obj = parsed as Partial<AnswerGeneration>;
      if (typeof obj.insufficient_evidence !== "boolean" || !Array.isArray(obj.claims)) {
        throw new AnswerModelError(
          "ANSWER_MODEL_SCHEMA_MISMATCH",
          "model response did not match the required {insufficient_evidence, claims} shape -- failing closed",
        );
      }

      return { insufficient_evidence: obj.insufficient_evidence, claims: obj.claims as ProposedClaim[] };
    },
  };
}
