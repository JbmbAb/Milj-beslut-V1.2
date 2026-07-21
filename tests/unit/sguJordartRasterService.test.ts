import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { mockSpawn, mockExistsSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  default: {
    spawn: mockSpawn,
  },
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  default: {
    existsSync: mockExistsSync,
  },
}));

import {
  querySguJordartRasterPoint,
  checkSguJordartRasterHealth,
} from '../../server/services/sguJordartRasterService';

vi.mock('../../server/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('sguJordartRasterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockGdalResponse(value: string, exitCode = 0) {
    mockSpawn.mockImplementation(() => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter();
      (child as any).stdout = stdout;
      (child as any).stderr = stderr;
      (child as any).kill = vi.fn();

      setTimeout(() => {
        stdout.emit('data', Buffer.from(value));
        child.emit('close', exitCode);
      }, 10);

      return child as any;
    });
  }

  describe('querySguJordartRasterPoint', () => {
    it('returns error for invalid coordinates', async () => {
      const result = await querySguJordartRasterPoint(100, 18.06);
      expect(result.ok).toBe(false);
      expect('error' in result ? result.error : '').toBe('Ogiltiga koordinater (WGS84 krävs)');
    });

    it('returns error if raster directory is missing', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await querySguJordartRasterPoint(59.33, 18.06);
      expect(result.ok).toBe(false);
      expect('error' in result ? result.error : '').toContain('SGU_JORDART_RASTER_DIR saknas');
    });

    it('returns parallelized results for selected layers', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGdalResponse('7.2');

      const result = await querySguJordartRasterPoint(59.33, 18.06, ['ph', 'lerhalt']);

      expect(result.ok, result.ok ? '' : (result as any).error).toBe(true);
      if (result.ok) {
        expect(result.layers).toHaveLength(2);
        expect(result.layers[0]).toMatchObject({ key: 'ph', value: 7.2 });
        expect(result.layers[1]).toMatchObject({ key: 'lerhalt', value: 7.2 });
      }
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('handles NaN or empty responses from GDAL as null', async () => {
      mockExistsSync.mockReturnValue(true);
      mockGdalResponse('NaN');

      const result = await querySguJordartRasterPoint(59.33, 18.06, ['ph']);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.layers[0].value).toBeNull();
      }
    });
  });

  describe('checkSguJordartRasterHealth', () => {
    it('returns ok: false if directory is missing', async () => {
      mockExistsSync.mockReturnValue(false);
      const health = await checkSguJordartRasterHealth();
      expect(health.ok).toBe(false);
      expect(health.error).toBe('SGU_JORDART_RASTER_DIR saknas');
    });

    it('returns ok: true if everything is fine', async () => {
      // Mock directory and at least one file existing
      mockExistsSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('3006.tif')) return true;
        if (typeof p === 'string' && p.includes('Tiff_jordartskartor')) return true;
        return false;
      });
      mockGdalResponse('1.0');

      const health = await checkSguJordartRasterHealth();
      expect(health.ok).toBe(true);
      expect(health.layerCount).toBeGreaterThan(0);
    });
  });
});
