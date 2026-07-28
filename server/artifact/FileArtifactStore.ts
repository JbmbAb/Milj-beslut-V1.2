import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactStore } from './ArtifactStore';

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  async put<T>(key: string, value: T): Promise<void> {
    const filePath = this.resolveKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
    await this.fsyncFile(tmpPath);
    await fs.rename(tmpPath, filePath);
    await this.fsyncDirectory(path.dirname(filePath));
  }

  async get<T>(key: string): Promise<T | undefined> {
    const filePath = this.resolveKey(key);
    try {
      const json = await fs.readFile(filePath, 'utf8');
      return JSON.parse(json) as T;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<readonly string[]> {
    const prefixPath = this.resolvePrefix(prefix);
    const entries: string[] = [];

    try {
      await this.walk(prefixPath, entries);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    return entries.sort();
  }

  private async walk(dir: string, entries: string[]): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(entryPath, entries);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const relative = path.relative(this.rootDir, entryPath).replace(/\\/g, '/');
        entries.push(relative.slice(0, -'.json'.length));
      }
    }
  }

  private resolveKey(key: string): string {
    return `${this.resolvePrefix(key)}.json`;
  }

  private resolvePrefix(prefix: string): string {
    const normalized = prefix.replace(/\\/g, '/').replace(/^\/+/, '');
    const fullPath = path.resolve(this.rootDir, normalized);
    const root = path.resolve(this.rootDir);

    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Artifact key escapes store root: ${prefix}`);
    }

    return fullPath;
  }

  private async fsyncFile(filePath: string): Promise<void> {
    const handle = await fs.open(filePath, constants.O_RDONLY);
    try {
      await handle.sync();
    } catch (error) {
      if (!isIgnorableFsyncError(error)) {
        throw error;
      }
    } finally {
      await handle.close();
    }
  }

  private async fsyncDirectory(dir: string): Promise<void> {
    try {
      const handle = await fs.open(dir, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!isIgnorableFsyncError(error)) {
        throw error;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isIgnorableFsyncError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === 'EINVAL' || error.code === 'EISDIR' || error.code === 'EPERM')
  );
}
