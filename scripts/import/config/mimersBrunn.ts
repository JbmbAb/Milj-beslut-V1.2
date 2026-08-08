import 'dotenv/config';
import path from 'path';

/**
 * Mimers Brunn Policy Constants
 * 
 * Centralizing paths to ensure all scripts follow the Master Archive structure.
 */

// Root for the Master Archive — reads from .env first, falls back to canonical H:-drive path.
// Set MASTER_ARCHIVE_ROOT in your .env to override (e.g. for CI or alternative mounts).
//
// This is the only place the archive root may be resolved. GEO_MASTER_ARCHIVE is
// accepted as an alias because the ops/sanitation scripts were written against
// that name; both must resolve to one root, or consumers silently diverge.
export const MASTER_ARCHIVE_ROOT =
  process.env.MASTER_ARCHIVE_ROOT ??
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';

// Subdirectories according to legacy policy
export const PATHS = {
  DATA: path.join(MASTER_ARCHIVE_ROOT, 'Data'),
  VECTORS: path.join(MASTER_ARCHIVE_ROOT, 'Vectors'),
  RASTERS: path.join(MASTER_ARCHIVE_ROOT, 'Rasters'),
  DOCUMENTS: path.join(MASTER_ARCHIVE_ROOT, 'Documents', 'Sources'),
};

export type ArchiveLayer = 'original' | 'extracted' | 'hashes' | 'manifest';

/**
 * National Environmental Archive (Mimers Brunn v9)
 * 
 * Enforces the strict immutable directory structure:
 * <MasterArchive>/<Authority>/<Year>/<Municipality>/<CaseId>/[Layer]
 * 
 * Layers:
 *  - original: Raw PDF/Doc files
 *  - extracted: Converted text files
 *  - hashes: Cryptographic checksums
 */
export function getNationalArchiveCasePath(
  authority: string,
  year: string | number,
  municipality: string,
  caseId: string,
  layer?: ArchiveLayer
): string {
  // Sanitize inputs to prevent path traversal or bad characters
  const safeAuthority = authority.replace(/[^a-z0-9_ÅÄÖåäö-]/gi, '_');
  const safeYear = String(year);
  const safeMunicipality = municipality.replace(/[^a-z0-9_ÅÄÖåäö-]/gi, '_');
  const safeCaseId = caseId.replace(/[^a-z0-9_ÅÄÖåäö-]/gi, '_');

  const basePath = path.join(
    MASTER_ARCHIVE_ROOT,
    'National_Archive',
    safeAuthority,
    safeYear,
    safeMunicipality,
    safeCaseId
  );

  if (layer && layer !== 'manifest') {
    return path.join(basePath, layer);
  }

  return basePath; // Return base dir if layer is omitted or is 'manifest'
}

/**
 * Helper to generate a timestamped folder path according to legacy policy:
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

/**
 * Checks if the free space on C: and the target drive is sufficient.
 * Default limits: 5 GB for C: and 10 GB for the target drive.
 * Throws a fatal error and exits the process if limits are violated.
 */
export function checkDiskSpaceSafety(minFreeC_Gb: number = 5, minFreeTargetGb: number = 10): void {
  if (process.env.SKIP_DISK_CHECK === 'true') {
    return;
  }

  const checkDrive = (drive: string): number => {
    try {
      const cleanDrive = drive.replace(/[^A-Za-z]/g, '');
      if (!cleanDrive) return 999;
      const cmd = `powershell.exe -NoProfile -Command "(Get-PSDrive ${cleanDrive}).Free"`;
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const bytes = parseInt(out, 10);
      if (isNaN(bytes) || bytes <= 0) return 999; // Assume safe if query fails
      return bytes / (1024 * 1024 * 1024);
    } catch {
      return 999;
    }
  };

  // Check C:
  const cFree = checkDrive('C');
  if (cFree < minFreeC_Gb) {
    console.error(`\n❌ [Mimers Brunn] FATAL DISK SPACE ERROR: C: has only ${cFree.toFixed(2)} GB free (required: ${minFreeC_Gb} GB).`);
    console.error(`Execution aborted to prevent C: drive from filling up.\n`);
    process.exit(101);
  }

  // Check Target
  const root = path.parse(MASTER_ARCHIVE_ROOT).root;
  if (root && root.includes(':')) {
    const targetDriveLetter = root.split(':')[0]!;
    if (targetDriveLetter.toUpperCase() !== 'C') {
      const targetFree = checkDrive(targetDriveLetter);
      if (targetFree < minFreeTargetGb) {
        console.error(`\n❌ [Mimers Brunn] FATAL DISK SPACE ERROR: Target drive ${targetDriveLetter}: has only ${targetFree.toFixed(2)} GB free (required: ${minFreeTargetGb} GB).`);
        console.error(`Execution aborted to prevent target disk exhaustion.\n`);
        process.exit(102);
      }
    }
  }
}

import { execSync } from 'child_process';

// Run disk space check automatically on import unless test environment or skipped
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test' && process.env.SKIP_DISK_CHECK !== 'true') {
  try {
    checkDiskSpaceSafety();
  } catch (err) {
    // Ignore non-fatal execution errors
  }
}

