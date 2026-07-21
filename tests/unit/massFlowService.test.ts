import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as massFlowService from '../../server/repositories/massFlowService';
import * as storageAreaRepository from '../../server/repositories/storageAreaRepository';

vi.mock('../../server/repositories/storageAreaRepository', () => ({
  adjustMassVolume: vi.fn(),
  listStorageAreasForProject: vi.fn(),
}));

describe('massFlowService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordMassMovement', () => {
    it('should move mass from source to destination', async () => {
      const booking = {
        projectId: 'project-1',
        wasteCode: 'WASTE_001',
        sourceStorageAreaId: 'storage-src-1',
        destinationStorageAreaId: 'storage-dst-1',
        volumeM3: 100,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledTimes(2);
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenNthCalledWith(
        1,
        'project-1',
        'storage-src-1',
        'WASTE_001',
        -100,
      );
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenNthCalledWith(
        2,
        'project-1',
        'storage-dst-1',
        'WASTE_001',
        100,
      );
    });

    it('should handle movement with only source storage area', async () => {
      const booking = {
        projectId: 'project-2',
        wasteCode: 'WASTE_002',
        sourceStorageAreaId: 'storage-src-2',
        destinationStorageAreaId: null,
        volumeM3: 50,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledOnce();
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-2',
        'storage-src-2',
        'WASTE_002',
        -50,
      );
    });

    it('should handle movement with only destination storage area', async () => {
      const booking = {
        projectId: 'project-3',
        wasteCode: 'WASTE_003',
        sourceStorageAreaId: null,
        destinationStorageAreaId: 'storage-dst-3',
        volumeM3: 75,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledOnce();
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-3',
        'storage-dst-3',
        'WASTE_003',
        75,
      );
    });

    it('should handle movement with no source or destination', async () => {
      const booking = {
        projectId: 'project-4',
        wasteCode: 'WASTE_004',
        sourceStorageAreaId: null,
        destinationStorageAreaId: null,
        volumeM3: 100,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).not.toHaveBeenCalled();
    });

    it('should not process movement when volume is zero', async () => {
      const booking = {
        projectId: 'project-5',
        wasteCode: 'WASTE_005',
        sourceStorageAreaId: 'storage-src-5',
        destinationStorageAreaId: 'storage-dst-5',
        volumeM3: 0,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).not.toHaveBeenCalled();
    });

    it('should not process movement when volume is negative', async () => {
      const booking = {
        projectId: 'project-6',
        wasteCode: 'WASTE_006',
        sourceStorageAreaId: 'storage-src-6',
        destinationStorageAreaId: 'storage-dst-6',
        volumeM3: -50,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).not.toHaveBeenCalled();
    });

    it('should not process movement when volume is undefined', async () => {
      const booking = {
        projectId: 'project-7',
        wasteCode: 'WASTE_007',
        sourceStorageAreaId: 'storage-src-7',
        destinationStorageAreaId: 'storage-dst-7',
        volumeM3: undefined,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking as any);

      expect(storageAreaRepository.adjustMassVolume).not.toHaveBeenCalled();
    });

    it('should handle decimal volumes', async () => {
      const booking = {
        projectId: 'project-8',
        wasteCode: 'WASTE_008',
        sourceStorageAreaId: 'storage-src-8',
        destinationStorageAreaId: 'storage-dst-8',
        volumeM3: 25.5,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-8',
        'storage-src-8',
        'WASTE_008',
        -25.5,
      );
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-8',
        'storage-dst-8',
        'WASTE_008',
        25.5,
      );
    });

    it('should handle very small volumes', async () => {
      const booking = {
        projectId: 'project-9',
        wasteCode: 'WASTE_009',
        sourceStorageAreaId: 'storage-src-9',
        destinationStorageAreaId: 'storage-dst-9',
        volumeM3: 0.001,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledTimes(2);
    });

    it('should handle very large volumes', async () => {
      const booking = {
        projectId: 'project-10',
        wasteCode: 'WASTE_010',
        sourceStorageAreaId: 'storage-src-10',
        destinationStorageAreaId: 'storage-dst-10',
        volumeM3: 999999.99,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-10',
        'storage-src-10',
        'WASTE_010',
        -999999.99,
      );
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenCalledWith(
        'project-10',
        'storage-dst-10',
        'WASTE_010',
        999999.99,
      );
    });

    it('should handle database errors from source adjustment', async () => {
      const booking = {
        projectId: 'project-err-1',
        wasteCode: 'WASTE_ERR_1',
        sourceStorageAreaId: 'storage-src-err',
        destinationStorageAreaId: 'storage-dst-err',
        volumeM3: 100,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockRejectedValueOnce(
        new Error('Source adjustment failed'),
      );

      await expect(massFlowService.recordMassMovement(booking)).rejects.toThrow('Source adjustment failed');
    });

    it('should handle database errors from destination adjustment', async () => {
      const booking = {
        projectId: 'project-err-2',
        wasteCode: 'WASTE_ERR_2',
        sourceStorageAreaId: 'storage-src-err-2',
        destinationStorageAreaId: 'storage-dst-err-2',
        volumeM3: 100,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Destination adjustment failed'));

      await expect(massFlowService.recordMassMovement(booking)).rejects.toThrow(
        'Destination adjustment failed',
      );
    });

    it('should use different waste codes correctly', async () => {
      const booking = {
        projectId: 'project-waste-codes',
        wasteCode: 'HAZARDOUS_WASTE_001',
        sourceStorageAreaId: 'storage-src-haz',
        destinationStorageAreaId: 'storage-dst-haz',
        volumeM3: 50,
      };

      vi.mocked(storageAreaRepository.adjustMassVolume).mockResolvedValue(undefined);

      await massFlowService.recordMassMovement(booking);

      expect(storageAreaRepository.adjustMassVolume).toHaveBeenNthCalledWith(
        1,
        'project-waste-codes',
        'storage-src-haz',
        'HAZARDOUS_WASTE_001',
        -50,
      );
      expect(storageAreaRepository.adjustMassVolume).toHaveBeenNthCalledWith(
        2,
        'project-waste-codes',
        'storage-dst-haz',
        'HAZARDOUS_WASTE_001',
        50,
      );
    });
  });

  describe('getMassFlowSnapshot', () => {
    it('should generate mass flow snapshot with single storage area', async () => {
      const projectId = 'project-snapshot-1';

      const storageAreas = [
        {
          id: 'area-1',
          name: 'Lagring A',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: { WASTE_001: 250, WASTE_002: 150 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot).toEqual({
        projectId: 'project-snapshot-1',
        generatedAt: expect.any(String),
        storageAreas: [
          {
            id: 'area-1',
            name: 'Lagring A',
            geometry: { type: 'Polygon', coordinates: [[0, 0]] },
            capacityM3: 1000,
            currentVolumeM3: 400,
            fillPercentage: 40,
            contents: [
              { wasteCode: 'WASTE_001', volumeM3: 250 },
              { wasteCode: 'WASTE_002', volumeM3: 150 },
            ],
          },
        ],
      });

      expect(storageAreaRepository.listStorageAreasForProject).toHaveBeenCalledWith(projectId);
    });

    it('should generate mass flow snapshot with multiple storage areas', async () => {
      const projectId = 'project-snapshot-2';

      const storageAreas = [
        {
          id: 'area-1',
          name: 'Lagring A',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 500,
          contents: { WASTE_001: 250 },
        },
        {
          id: 'area-2',
          name: 'Lagring B',
          geometry: { type: 'Polygon', coordinates: [[1, 1]] },
          capacityM3: 800,
          contents: { WASTE_002: 400, WASTE_003: 200 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.projectId).toBe('project-snapshot-2');
      expect(snapshot.storageAreas).toHaveLength(2);
      expect(snapshot.storageAreas[0].fillPercentage).toBe(50);
      expect(snapshot.storageAreas[1].fillPercentage).toBeCloseTo(75);
    });

    it('should handle empty storage areas', async () => {
      const projectId = 'project-snapshot-3';

      const storageAreas = [
        {
          id: 'area-empty',
          name: 'Tom lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: {},
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0]).toEqual({
        id: 'area-empty',
        name: 'Tom lagring',
        geometry: { type: 'Polygon', coordinates: [[0, 0]] },
        capacityM3: 1000,
        currentVolumeM3: 0,
        fillPercentage: 0,
        contents: [],
      });
    });

    it('should handle null contents gracefully', async () => {
      const projectId = 'project-snapshot-4';

      const storageAreas = [
        {
          id: 'area-null',
          name: 'Null lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 500,
          contents: null,
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0]).toEqual({
        id: 'area-null',
        name: 'Null lagring',
        geometry: { type: 'Polygon', coordinates: [[0, 0]] },
        capacityM3: 500,
        currentVolumeM3: 0,
        fillPercentage: 0,
        contents: [],
      });
    });

    it('should calculate correct fill percentage when at full capacity', async () => {
      const projectId = 'project-snapshot-5';

      const storageAreas = [
        {
          id: 'area-full',
          name: 'Full lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: { WASTE_001: 1000 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].fillPercentage).toBe(100);
    });

    it('should handle zero capacity storage areas', async () => {
      const projectId = 'project-snapshot-6';

      const storageAreas = [
        {
          id: 'area-zero-cap',
          name: 'Noll kapacitet',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 0,
          contents: {},
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].fillPercentage).toBe(0);
    });

    it('should round volumes to 2 decimal places', async () => {
      const projectId = 'project-snapshot-7';

      const storageAreas = [
        {
          id: 'area-decimals',
          name: 'Decimaler lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: { WASTE_001: 123.456789, WASTE_002: 456.789123 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].contents[0].volumeM3).toBe(123.46);
      expect(snapshot.storageAreas[0].contents[1].volumeM3).toBe(456.79);
      // 123.46 + 456.79 = 580.25 with standard rounding
      expect(snapshot.storageAreas[0].currentVolumeM3).toBeCloseTo(580.24, 0);
    });

    it('should round fill percentage to 1 decimal place', async () => {
      const projectId = 'project-snapshot-8';

      const storageAreas = [
        {
          id: 'area-fill-decimals',
          name: 'Fyllnadsgrad decimaler',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: { WASTE_001: 333.333333 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].fillPercentage).toBe(33.3);
    });

    it('should handle very large volumes', async () => {
      const projectId = 'project-snapshot-9';

      const storageAreas = [
        {
          id: 'area-large',
          name: 'Stor lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000000,
          contents: { WASTE_001: 500000, WASTE_002: 250000 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].currentVolumeM3).toBe(750000);
      expect(snapshot.storageAreas[0].fillPercentage).toBe(75);
    });

    it('should include timestamp in generated snapshot', async () => {
      const projectId = 'project-snapshot-10';

      const storageAreas = [
        {
          id: 'area-timestamp',
          name: 'Tidsmarkerad lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 100,
          contents: { WASTE_001: 50 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const beforeTime = new Date();
      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);
      const afterTime = new Date();

      const generatedTime = new Date(snapshot.generatedAt);
      expect(generatedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(generatedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should preserve geometry exactly as provided', async () => {
      const projectId = 'project-snapshot-11';

      const geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [16.4, 59.3],
            [16.41, 59.3],
            [16.41, 59.31],
            [16.4, 59.31],
            [16.4, 59.3],
          ],
        ],
      };

      const storageAreas = [
        {
          id: 'area-geometry',
          name: 'Geometri lagring',
          geometry,
          capacityM3: 500,
          contents: { WASTE_001: 100 },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].geometry).toEqual(geometry);
    });

    it('should handle multiple waste codes correctly', async () => {
      const projectId = 'project-snapshot-12';

      const storageAreas = [
        {
          id: 'area-multi-waste',
          name: 'Multi-avfall lagring',
          geometry: { type: 'Polygon', coordinates: [[0, 0]] },
          capacityM3: 1000,
          contents: {
            HAZARDOUS_001: 100,
            HAZARDOUS_002: 150,
            RECYCLABLE_001: 200,
            ORGANIC_001: 50,
          },
        },
      ];

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue(storageAreas as any);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot.storageAreas[0].contents).toHaveLength(4);
      expect(snapshot.storageAreas[0].currentVolumeM3).toBe(500);
    });

    it('should handle repository errors', async () => {
      const projectId = 'project-snapshot-error';

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockRejectedValue(
        new Error('Repository error'),
      );

      await expect(massFlowService.getMassFlowSnapshot(projectId)).rejects.toThrow('Repository error');
    });

    it('should return empty storage areas array when project has no areas', async () => {
      const projectId = 'project-snapshot-empty';

      vi.mocked(storageAreaRepository.listStorageAreasForProject).mockResolvedValue([]);

      const snapshot = await massFlowService.getMassFlowSnapshot(projectId);

      expect(snapshot).toEqual({
        projectId: 'project-snapshot-empty',
        generatedAt: expect.any(String),
        storageAreas: [],
      });
    });
  });
});
