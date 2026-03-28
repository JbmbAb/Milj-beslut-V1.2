import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const auditMock = vi.hoisted(() => ({
    appendPropertyAudit: vi.fn(),
}));
const auditRepoMock = vi.hoisted(() => ({
    writePropertyAccessLog: vi.fn(),
}));
const authRepoMock = vi.hoisted(() => ({
    assertProjectMembership: vi.fn(),
}));
const securityMock = vi.hoisted(() => ({
    assertPermission: vi.fn(),
    validatePropertyLookupInput: vi.fn(),
}));
const envMock = vi.hoisted(() => ({
    isLantmaterietOpenMode: vi.fn().mockReturnValue(false),
}));

// VIKTIGT: Sökvägar från tests/unit/ -> server/...
vi.mock('../../server/security/auditTrail', () => auditMock);
vi.mock('../../server/repositories/auditRepository', () => auditRepoMock);
vi.mock('../../server/repositories/projectAccessRepository', () => authRepoMock);
vi.mock('../../server/security/projectAccess', () => securityMock);
vi.mock('../../server/security/env', () => envMock);

// Sätt miljövariabler innan import
vi.hoisted(() => {
    process.env.LANTMATERIET_CONSUMER_KEY = 'test-key';
    process.env.LANTMATERIET_CONSUMER_SECRET = 'test-secret';
    process.env.LANTMATERIET_LOOKUP_MODE = 'ogc';
    process.env.LANTMATERIET_BASE_URL = 'https://api.test';
});

// Mocka fetch globalt
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { 
    lookupPropertyByDesignation, 
    parseOgcDesignation,
    mergeOgcFeatureGeometry 
} from '../../server/services/lantmaterietService';

describe('lantmaterietService unit tests', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockUser: any = { id: 'u1', organisationId: 'o1', role: 'USER' };

    describe('parseOgcDesignation', () => {
        it('should correctly parse a standard property name', () => {
            const result = parseOgcDesignation('STHLM LERA 1:1');
            expect(result.tract).toBe('LERA');
        });
    });

    describe('mergeOgcFeatureGeometry', () => {
        it('should merge multiple polygons into a MultiPolygon', () => {
            const features = [
                { geometry: { type: 'Polygon', coordinates: [[[0,0], [0,1], [1,1]]] } }
            ];
            const merged: any = mergeOgcFeatureGeometry(features as any);
            expect(merged.type).toBe('Polygon'); 
        });
    });

    describe('lookupPropertyByDesignation', () => {
        it('should complete a lookup flow: get token -> fetch items', async () => {
            // Mocka Token
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'valid-token', expires_in: 3600 })
            });

            // Mocka Items
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    features: [
                        { properties: { etikett: 'GÄVLE 1:1' }, geometry: { type: 'Point', coordinates: [17, 60] } }
                    ]
                })
            });

            const result = await lookupPropertyByDesignation({
                projectId: 'p1',
                propertyDesignation: 'GÄVLE 1:1',
                purpose: 'Inspection'
            }, mockUser);

            expect(result.designation).toBe('GÄVLE 1:1');
            expect(fetchMock).toHaveBeenCalled();
        });
    });

});
