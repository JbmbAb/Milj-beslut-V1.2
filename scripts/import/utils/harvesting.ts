import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface HarvestManifest {
  provider: string;
  dataset: string;
  version: string;
  downloaded_at: string;
  source_url: string;
  provenance: string;
  content_bundle_sha256: string;
  files: string[];
  total_bytes: number;
}

/**
 * Calculates SHA-256 for a single file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Calculates a bundle hash for a list of files (sorted by name to ensure determinism)
 */
export async function calculateBundleHash(filePaths: string[]): Promise<string> {
  const hashes = await Promise.all(
    filePaths.sort().map(async (fp) => {
      const h = await calculateFileHash(fp);
      return `${path.basename(fp)}:${h}`;
    })
  );
  const bundleHash = crypto.createHash('sha256').update(hashes.join('|')).digest('hex');
  return bundleHash;
}

/**
 * Generates and saves a manifest.json in the target directory
 */
export async function createManifest(
  targetDir: string,
  metadata: Omit<HarvestManifest, 'content_bundle_sha256' | 'files' | 'total_bytes' | 'downloaded_at'>
): Promise<HarvestManifest> {
  const allFiles = fs.readdirSync(targetDir).filter((f) => {
    if (f === 'manifest.json' || f === 'checksums.txt') return false;
    return fs.statSync(path.join(targetDir, f)).isFile();
  });
  const fullPaths = allFiles.map(f => path.join(targetDir, f));
  
  const content_bundle_sha256 = await calculateBundleHash(fullPaths);
  const total_bytes = fullPaths.reduce((acc, fp) => acc + fs.statSync(fp).size, 0);

  const manifest: HarvestManifest = {
    ...metadata,
    downloaded_at: new Date().toISOString(),
    content_bundle_sha256,
    files: allFiles,
    total_bytes,
  };

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  // Also write a simple checksums.txt for convenience
  const checksums = await Promise.all(fullPaths.map(async fp => {
    const hash = await calculateFileHash(fp);
    return `${hash}  ${path.basename(fp)}`;
  }));
  fs.writeFileSync(path.join(targetDir, 'checksums.txt'), checksums.join('\n'));

  return manifest;
}
