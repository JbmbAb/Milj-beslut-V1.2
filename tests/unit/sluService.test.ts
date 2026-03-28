import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED med KORREKTA relativa sökvägar från TESTFILEN
const auditMock = vi.hoisted(() => ({
    appendAuditTrailRow: vi.fn(),
}));
const authRepoMock = vi.hoisted(() => ({
    assertProjectMembership: vi.fn(),
}));
const securityMock = vi.hoisted(() => ({
    assertPermission: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
    getEnv: vi.fn().mockReturnValue('https://api.slu.se'),
}));

// Nu pekar vi rätt från tests/unit/sluService.test.ts -> server/...
vi.mock('../../server/repositories/auditRepository', () => auditMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);

// Sätt miljövariabler innan import
vi.hoisted(() => {
    process.env.SLU_SPECIES_OBS_API_KEY = 'test-key';
    process.env.SLU_SPECIES_OBS_BASE_PATH = '/obs';
});

// Mocka fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { searchSluByCoordinates } from '../../server/services/sluService';

describe('sluService unit tests', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockUser: any = { id: 'u1', organisationId: 'o1', role: 'USER' };

    it('should call SLU API with a valid polygon for coordinate search', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ totalCount: 5, observations: [] }))
        });

        const result = await searchSluByCoordinates({
            lat: 59.3,
            lng: 18.0,
            purpose: 'Environmental impact study',
            user: mockUser,
            projectId: 'p1'
        });

        expect(fetchMock).toHaveBeenCalled();
        expect(auditMock.appendAuditTrailRow).toHaveBeenCalled();
        expect((result as any).totalCount).toBe(5);
    });

    it('should throw error if project membership check fails', async () => {
        authRepoMock.assertProjectMembership.mockRejectedValue(new Error('Access denied'));

        await expect(searchSluByCoordinates({
            lat: 59.3,
            lng: 18.0,
            purpose: 'Test',
            user: mockUser,
            projectId: 'p_private'
        })).rejects.toThrow('Access denied');
    });

});
