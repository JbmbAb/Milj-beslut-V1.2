import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RequirementItem } from '../schemas/mvpSchemas';

type PermitDraftSuggestion = {
  document_type: string;
  draft_text: string;
};

type VerificationSecondOpinion = {
  status: 'VERIFIED' | 'UNVERIFIED';
  missing_citations: string[];
};

type OpenAiChatMessage = {
  role: 'system' | 'user';
  content: string;
};

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = process.env.NODE_ENV === 'test' ? 0 : 3,
  delay = process.env.NODE_ENV === 'test' ? 0 : 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

let cachedGeminiClient: GoogleGenerativeAI | null | undefined;

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function getGeminiClient(): GoogleGenerativeAI | null {
  if (cachedGeminiClient !== undefined) return cachedGeminiClient;
  const apiKey = normalizeText(process.env.GEMINI_API_KEY);
  cachedGeminiClient = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  return cachedGeminiClient;
}

function getOpenAiApiKey(): string {
  return normalizeText(process.env.OPENAI_API_KEY);
}

function parseJsonObject(raw: string): unknown | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
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
    status,
    missing_citations: missing,
  };
}

async function generateGeminiJson(prompt: string, modelName: string): Promise<unknown | null> {
  const client = getGeminiClient();
  if (!client) {
    console.error('Gemini client not initialized: Missing API key');
    return null;
  }

  return withRetry(async () => {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });
      const text = normalizeText(result.response.text());
      return parseJsonObject(text);
    } catch (error) {
      console.error(`Gemini Error (${modelName}):`, error instanceof Error ? error.message : error);
      throw error; // Rethrow for withRetry
    }
  }).catch(() => null);
}

async function generateOpenAiChatJson(
  messages: OpenAiChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
  modelName: string
): Promise<unknown | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    console.error('OpenAI Error: Missing API key');
    return null;
  }

  return withRetry(async () => {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          temperature: 0,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
        }),
      });

      if (!response.ok) {
        const status = typeof (response as any).status === 'number' ? (response as any).status : 0;
        const errorText = typeof (response as any).text === 'function' ? await (response as any).text() : '';
        const err = new Error(`OpenAI HTTP ${status}: ${errorText}`);

        // Retry only on rate limiting or server errors.
        if (status === 429 || status >= 500) {
          throw err;
        }

        console.error(`OpenAI Error (${modelName}):`, err.message);
        return null;
      }
      
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = normalizeText(json.choices?.[0]?.message?.content || '');
      if (!content) return null;
      return parseJsonObject(content);
    } catch (error) {
      console.error(`OpenAI Error (${modelName}):`, error instanceof Error ? error.message : error);
      throw error;
    }
  }).catch(() => null);
}

export async function suggestRequirementsFromGemini(input: {
  activityCode: string;
  ewcCode: string;
}): Promise<RequirementItem[] | null> {
  const modelName = normalizeText(process.env.MVP_GEMINI_REQUIREMENTS_MODEL) || 'gemini-1.5-flash';
  const prompt = `Du ar juridisk assistent for svensk miljoanmalan.
Returnera ENDAST JSON enligt schema:
{
  "requirements": [
    { "rule": "string", "law": "string", "citation": "string" }
  ]
}
Krav:
- Max 8 rader
- Endast relevanta krav for activity_code och ewc_code
- citation ska innehalla laghansvisning, exempel "26 kap. paragraf 19"

Input:
activity_code=${input.activityCode}
ewc_code=${input.ewcCode}`;

  const payload = await generateGeminiJson(prompt, modelName);
  return parseRequirementsPayload(payload);
}

export async function generatePermitDraftFromGemini(input: {
  projectData: Record<string, unknown>;
  requirements: RequirementItem[];
  riskFlags: string[];
  defaultDocumentType: string;
}): Promise<PermitDraftSuggestion | null> {
  const modelName = normalizeText(process.env.MVP_GEMINI_PERMIT_MODEL) || 'gemini-1.5-pro';
  const prompt = `Du skriver utkast for svensk miljoansokan.
Returnera ENDAST JSON enligt schema:
{
  "document_type": "string",
  "draft_text": "string"
}
Regler:
- Bevara juridisk ton
- Skriv pa svenska
- Inkludera tydlig sektion med "Juridiska krav"
- Avsluta med "Human-in-the-loop: juridisk slutgranskning kravs"

Input JSON:
${JSON.stringify(
  {
    project_data: input.projectData,
    requirements: input.requirements,
    risk_flags: input.riskFlags,
    default_document_type: input.defaultDocumentType,
  },
  null,
  2
)}`;

  const payload = await generateGeminiJson(prompt, modelName);
  return parsePermitDraftPayload(payload);
}

export async function getVerificationSecondOpinionFromOpenAi(input: {
  analysis: string;
}): Promise<VerificationSecondOpinion | null> {
  const modelName = normalizeText(process.env.MVP_OPENAI_VERIFICATION_MODEL) || 'gpt-4o-mini';
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: ['VERIFIED', 'UNVERIFIED'],
      },
      missing_citations: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['status', 'missing_citations'],
  };

  const messages: OpenAiChatMessage[] = [
    {
      role: 'system',
      content:
        'Du verifierar juridiska citat i svensk miljotext. Markera UNVERIFIED om tydlig lag/paragrafhansvisning saknas.',
    },
    {
      role: 'user',
      content: `Verifiera denna analys:\n${input.analysis}`,
    },
  ];

  const payload = await generateOpenAiChatJson(messages, 'verification_second_opinion', schema, modelName);
  return parseVerificationPayload(payload);
}

