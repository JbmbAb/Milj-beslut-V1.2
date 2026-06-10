import path from 'path';

/**
 * Mimers Brunn Policy Constants
 * 
 * Centralizing paths to ensure all scripts follow the Master Archive structure.
 */

// Root for the Master Archive on the H: drive
export const MASTER_ARCHIVE_ROOT = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';

// Subdirectories according to policy
export const PATHS = {
  DATA: path.join(MASTER_ARCHIVE_ROOT, 'Data'),
  VECTORS: path.join(MASTER_ARCHIVE_ROOT, 'Vectors'),
  RASTERS: path.join(MASTER_ARCHIVE_ROOT, 'Rasters'),
  DOCUMENTS: path.join(MASTER_ARCHIVE_ROOT, 'Documents', 'Sources'),
};

/**
 * Helper to generate a timestamped folder path according to policy:
 * <Root>\<Provider>\<Dataset>\<YYYY-MM-DD_HHmm>\
 */
export function getHarvestPath(provider: string, dataset: string, category: keyof typeof PATHS = 'DATA'): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
  return path.join(PATHS[category], provider, dataset, timestamp);
}

/**
 * Helper to get the legacy adoption path
 */
export function getLegacyAdoptionPath(provider: string, dataset: string, category: keyof typeof PATHS = 'DATA'): string {
  const now = new Date().toISOString().split('T')[0];
  return path.join(PATHS[category], provider, dataset, `legacy-adopted-${now}`);
}
