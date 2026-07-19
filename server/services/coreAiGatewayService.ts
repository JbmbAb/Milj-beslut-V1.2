/**
 * coreAiGatewayService.ts
 *
 *
 * AI-gateway för Core-flödet. Allt körs via Vertex AI (Google Cloud).
 * Tidigare direktanrop till Gemini API och OpenAI är avvecklade i spår 10b.
 */

import type { RequirementItem } from '../schemas/coreSchemas';
import { generateJsonWithVertex } from './vertexAiService';

type PermitDraftSuggestion = {
  document_type: string;
  draft_text: string;
};

type VerificationSecondOpinion = {
  status: 'VERIFIED' | 'UNVERIFIED';
  missing_citations: string[];
};

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = process.env.NODE_ENV === 'test' ? 0 : 3,
  delay = process.env.NODE_ENV === 'test' ? 0 : 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseRequirementsPayload(payload: unknown): RequirementItem[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const requirementsValue = (payload as Record<string, unknown>).requirements;
  if (!Array.isArray(requirementsValue)) return null;

  const requirements = requirementsValue.flatMap<RequirementItem>((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const obj = entry as Record<string, unknown>;
    const rule = normalizeText(obj.rule);
    const law = normalizeText(obj.law);
    const citation = normalizeText(obj.citation);
    if (!rule || !law || !citation) return [];
    return [{ rule, law, citation }];
  });

  return requirements.length ? requirements : null;
}

function parsePermitDraftPayload(payload: unknown): PermitDraftSuggestion | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const documentType = normalizeText(obj.document_type);
  const draftText = normalizeText(obj.draft_text);
  if (!documentType || !draftText) return null;
  return {
    document_type: documentType,
    draft_text: draftText,
  };
}

function parseVerificationPayload(payload: unknown): VerificationSecondOpinion | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const status = normalizeText(obj.status).toUpperCase();
  const missing = Array.isArray(obj.missing_citations)
    ? obj.missing_citations.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  if (status !== 'VERIFIED' && status !== 'UNVERIFIED') return null;
  return {
    status: status as 'VERIFIED' | 'UNVERIFIED',
    missing_citations: missing,
  };
}

/**
 * Tydliga Vertex-nycklar i `.env` (P1), med stöd för äldre Core_GEMINI_* / MVP_* under övergång.
 */
function vertexModelOrDefault(envKeys: string[], fallback: string): string {
  for (const k of envKeys) {
    const v = normalizeText(process.env[k]);
    if (v) return v;
  }
  return fallback;
}

export async function suggestRequirementsFromGemini(input: {
  activityCode: string;
  ewcCode: string;
}): Promise<RequirementItem[] | null> {
  const model = vertexModelOrDefault(
    ['VERTEX_CORE_REQUIREMENTS_MODEL', 'Core_GEMINI_REQUIREMENTS_MODEL', 'MVP_GEMINI_REQUIREMENTS_MODEL'],
    'gemini-1.5-flash',
  );
  const prompt = `Du är juridisk assistent för svensk miljöanmälan.
Returnera ENDAST JSON enligt schema:
{
  "requirements": [
    { "rule": "string", "law": "string", "citation": "string" }
  ]
}
Krav:
- Max 8 rader
- Endast relevanta krav för activity_code och ewc_code
- citation ska innehålla laghänsvisning, exempel "26 kap. paragraf 19"

Input:
activity_code=${input.activityCode}
ewc_code=${input.ewcCode}`;

  return withRetry(() =>
    generateJsonWithVertex<RequirementItem[]>(prompt, {
      model,
      profile: 'fast',
      parse: parseRequirementsPayload,
    }),
  ).catch((error) => {
    console.error(`Vertex (coreAi requirements) fel:`, error instanceof Error ? error.message : error);
    return null;
  });
}

export async function generatePermitDraftFromGemini(input: {
  projectData: Record<string, unknown>;
  requirements: RequirementItem[];
  riskFlags: string[];
  defaultDocumentType: string;
}): Promise<PermitDraftSuggestion | null> {
  const model = vertexModelOrDefault(
    ['VERTEX_CORE_PERMIT_MODEL', 'Core_GEMINI_PERMIT_MODEL', 'MVP_GEMINI_PERMIT_MODEL'],
    'gemini-1.5-pro',
  );
  const prompt = `Du skriver utkast för svensk miljöansökan.
Returnera ENDAST JSON enligt schema:
{
  "document_type": "string",
  "draft_text": "string"
}
Regler:
- Bevara juridisk ton
- Skriv på svenska
- Inkludera tydlig sektion med "Juridiska krav"
- Avsluta med "Human-in-the-loop: juridisk slutgranskning krävs"

Input JSON:
${JSON.stringify(
  {
    project_data: input.projectData,
    requirements: input.requirements,
    risk_flags: input.riskFlags,
    default_document_type: input.defaultDocumentType,
  },
  null,
  2,
)}`;

  return withRetry(() =>
    generateJsonWithVertex<PermitDraftSuggestion>(prompt, {
      model,
      profile: 'text',
      parse: parsePermitDraftPayload,
    }),
  ).catch((error) => {
    console.error(`Vertex (coreAi permit draft) fel:`, error instanceof Error ? error.message : error);
    return null;
  });
}

/**
 * Verifieringssecond-opinion. Funktionsnamnet behålls för bakåtkompatibilitet
 * med testsuiter och routes, men körs nu via Vertex AI (inte OpenAI).
 */
export async function getVerificationSecondOpinionFromOpenAi(input: {
  analysis: string;
}): Promise<VerificationSecondOpinion | null> {
  const model = vertexModelOrDefault(
    ['VERTEX_CORE_VERIFICATION_MODEL', 'Core_VERIFICATION_MODEL', 'MVP_OPENAI_VERIFICATION_MODEL'],
    'gemini-1.5-pro',
  );
  const schemaHint = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['VERIFIED', 'UNVERIFIED'] },
      missing_citations: { type: 'array', items: { type: 'string' } },
    },
    required: ['status', 'missing_citations'],
  };

  const prompt = `Du verifierar juridiska citat i svensk miljötext. Markera UNVERIFIED om tydlig lag/paragrafhänsvisning saknas.
Analys att verifiera:
${input.analysis}`;

  return withRetry(() =>
    generateJsonWithVertex<VerificationSecondOpinion>(prompt, {
      model,
      profile: 'json',
      schemaHint,
      parse: parseVerificationPayload,
    }),
  ).catch((error) => {
    console.error(`Vertex (coreAi verification) fel:`, error instanceof Error ? error.message : error);
    return null;
  });
}
