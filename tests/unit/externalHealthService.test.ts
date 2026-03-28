import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const lantmaterietMock = vi.hoisted(() => ({
    getLantmaterietOpenMapStatus: vi.fn(),
}));
const sluMock = vi.hoisted(() => ({
    getSluProductStatus: vi.fn().mockReturnValue([]),
    pingSluProduct: vi.fn(),
}));
const openDataMock = vi.hoisted(() => ({
    fetchImmediateOpenSources: vi.fn().mockResolvedValue([]),
}));
const transportMock = vi.hoisted(() => ({
    getDispatchProviderRuntimeStatus: vi.fn().mockReturnValue({
        activeProvider: 'NONE',
        credentials: { timocomConfigured: false, transEuConfigured: false }
    }),
}));

vi.mock('./lantmaterietService', () => lantmaterietMock);
vi.mock('./sluService', () => sluMock);
vi.mock('./openDataSourceService', () => openDataMock);
vi.mock('./transportDispatchService', () => transportMock);

// Mocka env (isLantmaterietOpenMode)
vi.mock('../security/env', () => ({
    isLantmaterietOpenMode: vi.fn().mockReturnValue(false),
}));

// Mocka fetch globalt
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { 
    summarizeExternalHealthReport, 
    getExternalHealthReport 
} from '../../server/services/externalHealthService';

describe('externalHealthService unit tests', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('summarizeExternalHealthReport', () => {
        it('should mark overall status as error if any check has error', () => {
            const checks: any[] = [
                { key: 'a', status: 'healthy', category: 'C1', label: 'A', configured: true },
                { key: 'b', status: 'error', category: 'C1', label: 'B', configured: true }
            ];
            const report = summarizeExternalHealthReport(checks);
            expect(report.overall).toBe('error');
            expect(report.totals.error).toBe(1);
        });

        it('should mark overall status as degraded if no error but not_configured exists', () => {
            const checks: any[] = [
                { key: 'a', status: 'healthy', category: 'C1', label: 'A', configured: true },
                { key: 'b', status: 'not_configured', category: 'C1', label: 'B', configured: false }
            ];
            const report = summarizeExternalHealthReport(checks);
            expect(report.overall).toBe('degraded');
        });
    });

    describe('getExternalHealthReport (Integration Logic)', () => {
        it('should probe AI services like OpenAI and Gemini', async () => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.GEMINI_API_KEY = 'test-key';

            // OpenAI Success
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] })
            });
            // Gemini Success
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ models: [{ name: 'gemini-1.5-pro' }] })
            });
            // VISS Failure (401)
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: () => Promise.resolve('No Key')
            });

            lantmaterietMock.getLantmaterietOpenMapStatus.mockResolvedValue({ ok: true, endpoint: 'url' });

            const report = await getExternalHealthReport();

            const openai = report.checks.find(c => c.key === 'openai');
            const gemini = report.checks.find(c => c.key === 'gemini');
            
            expect(openai?.status).toBe('healthy');
            expect(gemini?.status).toBe('healthy');
        });
    });

});
