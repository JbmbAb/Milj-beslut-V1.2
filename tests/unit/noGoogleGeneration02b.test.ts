/**
 * W-NO-GOOGLE-02B. Boundary tests for the Google-free LOCAL generation replacement (B1-B12).
 * Source-level assertions are deliberately plain string/regex checks over tracked files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Every production file that sits on the 02B generation path. */
const GENERATION_PATH_FILES = [
  'server/modules/ai/generation/LocalGenerationPort.ts',
  'server/modules/legal/answer/AnswerModelProvider.ts',
  'server/modules/legal/answer/LegalAnswerComposition.ts',
  'server/services/aiProviderImplementation.ts',
  'server/services/coreAiGatewayService.ts',
  'server/services/coreContractService.ts',
  'server/services/librarianService.ts',
  'server/modules/ai/agents/librarian/librarianService.ts',
  'server/services/legalRerankService.ts',
  'server/services/projectPlanGeneratorService.ts',
  'server/services/logisticsGeneratorService.ts',
  'server/services/localBiodiversityService.ts',
  'server/services/localDirigent.ts',
  'server/services/readinessService.ts',
  'server/services/appHealthService.ts',
  'server/services/operationalCoverageService.ts',
  'server/services/fullStatusService.ts',
  'services/aiAssistantService.ts',
  'src/infrastructure/ai/llm-provider.ts',
];

const BLOCKER = 'BLOCKED_BY_LOCAL_GENERATION_RUNTIME';
const PORT = '../../server/modules/ai/generation/LocalGenerationPort';
const ANSWER = '../../server/modules/legal/answer/AnswerModelProvider';

describe('B1 legal answer composition is Google-free', () => {
  it('does not import any Gemini provider and the Gemini provider file is gone', () => {
    expect(read('server/modules/legal/answer/LegalAnswerComposition.ts')).not.toMatch(
      /GeminiAnswerModelProvider|createGemini/,
    );
    expect(exists('server/modules/legal/answer/GeminiAnswerModelProvider.ts')).toBe(false);
  });
});

describe('B2/B3/B4 active generation path has no Google SDK, key or credential dependency', () => {
  for (const rel of GENERATION_PATH_FILES) {
    it(rel, () => {
      const text = read(rel);
      expect(text).not.toMatch(
        /@google\/genai|@google\/generative-ai|@google-cloud\/|google-auth-library|googleapis\.com/,
      );
      expect(text).not.toMatch(
        /process\.env\.(GEMINI_API_KEY|GOOGLE_APPLICATION_CREDENTIALS(_JSON)?|VERTEX_[A-Z_]+)/,
      );
    });
  }
});

describe('B8 retired Vertex entry points are gone', () => {
  it('vertexAiService, its browser stub and the vertex config script do not exist', () => {
    expect(exists('server/services/vertexAiService.ts')).toBe(false);
    expect(exists('stubs/browser/vertexAiService.ts')).toBe(false);
    expect(exists('scripts/ops/db-checks/check_vertex_config.ts')).toBe(false);
  });
});

describe('B11 no cloud/inference endpoint in the port', () => {
  it('contains no URL, fetch or http client', () => {
    const text = read('server/modules/ai/generation/LocalGenerationPort.ts');
    expect(text).not.toMatch(/https?:\/\/|\bfetch\(|axios|node:https?/);
  });
});

describe('B5/B6/B7 fail-closed behaviour', () => {
  afterEach(async () => {
    const port = await import(PORT);
    port.registerLocalGenerationRuntime(null);
    vi.resetModules();
  });

  it('B5: with no runtime registered, generation fails closed with the exact blocker', async () => {
    const port = await import(PORT);
    expect(port.isLocalGenerationAvailable()).toBe(false);
    expect(port.localGenerationStatus()).toMatchObject({ available: false, blocker: BLOCKER });
    await expect(port.generateText('hej')).rejects.toMatchObject({ code: BLOCKER });
    await expect(port.generateJson('hej')).rejects.toMatchObject({ code: BLOCKER });
  });

  it('B5: the answer provider refuses to be created without a runtime (no canned answer)', async () => {
    const { createLocalAnswerModelProvider } = await import(ANSWER);
    expect(() => createLocalAnswerModelProvider()).toThrowError(new RegExp(BLOCKER));
  });

  it('B5: a runtime that becomes unavailable mid-flight still fails closed', async () => {
    const { LocalGenerationUnavailableError } = await import(PORT);
    const { createLocalAnswerModelProvider } = await import(ANSWER);
    const provider = createLocalAnswerModelProvider({
      runtime_id: 't',
      model_id: 'm',
      model_version: '1',
      generateText: async () => {
        throw new LocalGenerationUnavailableError();
      },
    });
    await expect(provider.generateAnswer('q', [])).rejects.toMatchObject({ code: 'ANSWER_MODEL_NOT_CONFIGURED' });
  });

  const malformed: Array<[string, string, string]> = [
    ['empty', '', 'ANSWER_MODEL_EMPTY_RESPONSE'],
    ['prose around json', 'Svar: {"insufficient_evidence": false, "claims": []}', 'ANSWER_MODEL_INVALID_JSON'],
    [
      'fenced json (no regex repair)',
      '```json\n{"insufficient_evidence":false,"claims":[]}\n```',
      'ANSWER_MODEL_INVALID_JSON',
    ],
    ['missing claims', '{"insufficient_evidence":false}', 'ANSWER_MODEL_SCHEMA_MISMATCH'],
    [
      'claim without citations array',
      '{"insufficient_evidence":false,"claims":[{"text":"x"}]}',
      'ANSWER_MODEL_SCHEMA_MISMATCH',
    ],
    [
      'citation with non-string id',
      '{"insufficient_evidence":false,"claims":[{"text":"x","cited_fragments":[{"fragment_id":1,"materialization_id":"m"}]}]}',
      'ANSWER_MODEL_SCHEMA_MISMATCH',
    ],
    ['null payload', 'null', 'ANSWER_MODEL_SCHEMA_MISMATCH'],
  ];
  for (const [label, text, code] of malformed) {
    it(`B6: malformed local response (${label}) fails closed`, async () => {
      const { createLocalAnswerModelProvider } = await import(ANSWER);
      const provider = createLocalAnswerModelProvider({
        runtime_id: 't',
        model_id: 'm',
        model_version: '1',
        generateText: async () => text,
      });
      await expect(provider.generateAnswer('q', [])).rejects.toMatchObject({ code });
    });
  }

  it('B7: the provider only proposes claims; citation validation stays in the composition', async () => {
    const { createLocalAnswerModelProvider } = await import(ANSWER);
    const proposed = {
      insufficient_evidence: false,
      claims: [{ text: 'x', cited_fragments: [{ fragment_id: 'invented', materialization_id: 'invented' }] }],
    };
    const provider = createLocalAnswerModelProvider({
      runtime_id: 't',
      model_id: 'm',
      model_version: '1',
      generateText: async () => JSON.stringify(proposed),
    });
    await expect(provider.generateAnswer('q', [])).resolves.toEqual(proposed);
    expect(read('server/modules/legal/answer/LegalAnswerComposition.ts')).toMatch(/buildCitation/);
  });
});

describe('B9 readiness no longer reports Google/Vertex as a prerequisite', () => {
  it('payload has no vertex key and the status sources have no Vertex check', async () => {
    vi.resetModules();
    vi.doMock('../../server/db/prisma', () => ({ prisma: { $queryRaw: vi.fn(async () => [{ one: 1 }]) } }));
    const { getReadinessPayload } = await import('../../server/services/readinessService');
    const payload = await getReadinessPayload();
    expect(Object.keys(payload)).not.toContain('vertex');
    expect(payload.ok).toBe(true);
    expect(read('server/services/appHealthService.ts')).not.toMatch(/Vertex/);
    expect(read('server/services/fullStatusService.ts')).not.toMatch(/name: 'Vertex AI'/);
    vi.doUnmock('../../server/db/prisma');
  });
});

describe('B12 no mock provider is selected by production composition', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, USE_MOCK_AI: process.env.USE_MOCK_AI };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it('USE_MOCK_AI=true outside the test runner does not yield the mock', async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.USE_MOCK_AI = 'true';
    const { getAiProvider, MockAiProvider } = await import('../../server/services/aiProviderImplementation');
    const provider = getAiProvider();
    expect(provider).not.toBeInstanceOf(MockAiProvider);
    await expect(provider.generateText('x')).rejects.toMatchObject({ code: BLOCKER });
  });
});
