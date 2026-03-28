import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mocka beroenden HOISTED
const limsRepoMock = vi.hoisted(() => ({
    createLimsReport: vi.fn(),
    getLimsReport: vi.fn(),
    verifyLimsReport: vi.fn(),
}));

// VIKTIGT: Vi måste mocka det sättet tjänsten importerar det.
// Eftersom limsService.ts gör: import { isHazardousWasteCode } from "./transportDispatchService"
// måste vi se till att Vitest mappar detta rätt.
const transportMock = vi.hoisted(() => ({
    isHazardousWasteCode: vi.fn().mockImplementation((code) => code?.startsWith('H')),
}));

vi.mock('../../server/repositories/limsRepository', () => limsRepoMock);
vi.mock('../../server/services/transportDispatchService', () => transportMock);

import { 
    createLimsReport, 
    verifyLimsReport, 
    isLimsRequiredForBooking 
} from '../../server/services/limsService';

describe('limsService unit tests', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isLimsRequiredForBooking', () => {
        it('should return true for hazardous waste codes (H*)', () => {
            expect(isLimsRequiredForBooking({ wasteCode: 'H123' } as any)).toBe(true);
            expect(isLimsRequiredForBooking({ wasteCode: '170101' } as any)).toBe(false);
        });
    });

    describe('createLimsReport', () => {
        it('should correctly normalize metrics and sense exceeded values', async () => {
            limsRepoMock.createLimsReport.mockImplementation((data) => Promise.resolve({
                ...data,
                id: 'rep-1',
                createdAt: new Date(),
                verifiedAt: null
            }));

            const report = await createLimsReport({
                sampleId: 'S-1',
                labName: 'L1',
                rawReference: 'R1',
                metrics: [
                    { key: 'Pb', value: 100, unit: 'mg/kg', maxAllowed: 10 }
                ]
            });

            expect(report.metrics[0].exceeded).toBe(true);
            expect(report.passed).toBe(false);
        });
    });

    describe('verifyLimsReport', () => {
        it('should handle verification of a report', async () => {
            const mockReport = {
                id: 'r1',
                metrics: [{ key: 'X', value: 1, unit: 'mg/kg', maxAllowed: 10 }],
                analyzedAt: new Date(),
                createdAt: new Date(),
                source: 'MANUAL'
            };
            limsRepoMock.getLimsReport.mockResolvedValue(mockReport);
            limsRepoMock.verifyLimsReport.mockResolvedValue({
                ...mockReport,
                reviewer: 'Tester',
                verifiedAt: new Date()
            });

            const result = await verifyLimsReport({
                reportId: 'r1',
                reviewer: 'Tester',
                signatureId: 'SIG-1'
            });

            expect(result.reviewer).toBe('Tester');
        });
    });

});
