import path from 'node:path';

import {
  archiveImportedSource,
  ensureImportDirectories,
  resolveImportArchiveRoot,
  type ArchiveImportMode,
} from '../server/services/importPathService';

function readFlagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

async function main() {
  const sourcePath = readFlagValue('--source');
  if (!sourcePath) {
    throw new Error('Ange --source <path> för materialet som ska arkiveras.');
  }

  const archiveSubdirectory = readFlagValue('--subdir');
  const label = readFlagValue('--label');
  const requestedMode = (readFlagValue('--mode') || 'auto') as ArchiveImportMode;

  if (!['auto', 'copy', 'move'].includes(requestedMode)) {
    throw new Error('Ogiltigt --mode. Använd auto, copy eller move.');
  }

  await ensureImportDirectories();

  const result = await archiveImportedSource({
    sourcePath: path.resolve(sourcePath),
    archiveSubdirectory,
    label,
    mode: requestedMode,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        archiveRoot: resolveImportArchiveRoot(),
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('archive-import-sources failed:', error);
  process.exitCode = 1;
});
