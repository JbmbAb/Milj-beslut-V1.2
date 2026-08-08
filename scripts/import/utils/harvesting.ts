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

export interface BundleManifestDocument {
  type: string;
  legal_weight: string;
  file: string;
  hash: string;
}

export interface BundleManifest {
  bundle_id: string;
  bundle_hash: string;
  source_authority: string;
  retrieved_at: string;
  documents: BundleManifestDocument[];
}

/**
 * Generates and saves a bundle_manifest.json with strict provenance and semantic roles
 */
export async function createBundleManifest(
  targetDir: string,
  bundleId: string,
  sourceAuthority: string,
  documentsInfo: Omit<BundleManifestDocument, 'hash'>[]
): Promise<BundleManifest> {
  const documents: BundleManifestDocument[] = [];
  const fullPaths: string[] = [];

  for (const doc of documentsInfo) {
    const filePath = path.join(targetDir, doc.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found for bundle manifest: ${filePath}`);
    }
    const hash = await calculateFileHash(filePath);
    documents.push({ ...doc, hash });
    fullPaths.push(filePath);
  }

  // Calculate composite bundle hash
  const bundle_hash = await calculateBundleHash(fullPaths);

  const manifest: BundleManifest = {
    bundle_id: bundleId,
    bundle_hash,
    source_authority: sourceAuthority,
    retrieved_at: new Date().toISOString(),
    documents,
  };

  fs.writeFileSync(path.join(targetDir, 'bundle_manifest.json'), JSON.stringify(manifest, null, 2));

  return manifest;
}

