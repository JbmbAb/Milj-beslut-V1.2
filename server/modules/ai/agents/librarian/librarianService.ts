import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateJsonWithVertex, generateTextWithVertex } from '../../../../services/vertexAiService';

const PROMPT_FILE = 'librarian_prompt.md';
const promptDir = dirname(fileURLToPath(import.meta.url));

let cachedSystemPrompt: string | null = null;

export type LibrarianTaskKind =
  | 'archive_readiness'
  | 'postgis_optimization'
  | 'rag_availability'
  | 'dataset_review'
  | 'general';

export interface LibrarianRequest {
  task: string;
  kind?: LibrarianTaskKind;
  datasetName?: string;
  provider?: string;
  sourcePath?: string;
  targetSchema?: string;
  targetTable?: string;
  rowEstimate?: number;
  geometryType?: string;
  srid?: number;
  notes?: string;
}

export interface LibrarianActionPlan {
  summary: string;
  approved_to_run: string[];
  requires_human_approval: string[];
  blocked_questions: string[];
  postgis_recommendations: string[];
  archive_requirements: string[];
  legal_traceability_notes: string[];
  risk_level: 'low' | 'medium' | 'high';
}

async function loadLibrarianPrompt(): Promise<string> {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt;
  }

  cachedSystemPrompt = await readFile(join(promptDir, PROMPT_FILE), 'utf8');
  return cachedSystemPrompt;
}

function buildTaskPrompt(request: LibrarianRequest): string {
  return [
    'Granska foljande Mimer Bibliotekarie-uppgift och returnera en saker handlingsplan.',
    '',
    JSON.stringify(request, null, 2),
    '',
    'Svara som strikt JSON med falt:',
    [
      'summary',
      'approved_to_run',
      'requires_human_approval',
      'blocked_questions',
      'postgis_recommendations',
      'archive_requirements',
      'legal_traceability_notes',
      'risk_level',
    ].join(', '),
  ].join('\n');
}

function parseActionPlan(payload: unknown): LibrarianActionPlan | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = payload as Partial<LibrarianActionPlan>;
  if (typeof value.summary !== 'string') {
    return null;
  }

  return {
    summary: value.summary,
    approved_to_run: Array.isArray(value.approved_to_run) ? value.approved_to_run.map(String) : [],
    requires_human_approval: Array.isArray(value.requires_human_approval)
      ? value.requires_human_approval.map(String)
      : [],
    blocked_questions: Array.isArray(value.blocked_questions) ? value.blocked_questions.map(String) : [],
    postgis_recommendations: Array.isArray(value.postgis_recommendations)
      ? value.postgis_recommendations.map(String)
      : [],
    archive_requirements: Array.isArray(value.archive_requirements) ? value.archive_requirements.map(String) : [],
    legal_traceability_notes: Array.isArray(value.legal_traceability_notes)
      ? value.legal_traceability_notes.map(String)
      : [],
    risk_level: value.risk_level === 'low' || value.risk_level === 'medium' ? value.risk_level : 'high',
  };
}

export class MimerLibrarianService {
  async createActionPlan(request: LibrarianRequest): Promise<LibrarianActionPlan> {
    const systemInstruction = await loadLibrarianPrompt();
    const plan = await generateJsonWithVertex<LibrarianActionPlan>(buildTaskPrompt(request), {
      profile: 'json',
      temperature: 0.1,
      maxOutputTokens: 4096,
      systemInstruction,
      parse: parseActionPlan,
    });

    if (!plan) {
      throw new Error('Mimer Bibliotekarie kunde inte skapa en giltig JSON-handlingsplan');
    }

    return plan;
  }

  async ask(question: string): Promise<string> {
    const systemInstruction = await loadLibrarianPrompt();
    return generateTextWithVertex(question, {
      profile: 'text',
      temperature: 0.1,
      maxOutputTokens: 2048,
      systemInstruction,
    });
  }
}

export const mimerLibrarianService = new MimerLibrarianService();

