/**
 * dockerAvailable must not trust an exit status alone (DEV-GOV trusted run 36747167246): a Docker CLI
 * that exits 0 from `docker info --format` with an empty ServerVersion while the daemon is
 * unreachable is UNAVAILABLE, so `--executor auto` falls back to host-npm and an explicit docker
 * executor is refused before any build. The tests put a stub `docker` first on PATH.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dockerAvailable } from '../src/docker/executors';
import { executeRedProbe } from '../src/docker/red-probe';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let stubDir: string;
let originalPath: string | undefined;

function installDockerStub(body: string): void {
  fs.writeFileSync(path.join(stubDir, 'docker'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  process.env.PATH = `${stubDir}${path.delimiter}${originalPath ?? ''}`;
}

beforeEach(() => {
  originalPath = process.env.PATH;
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-docker-stub-'));
});

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

describe('dockerAvailable: a server version on stdout is required, not just exit status 0', () => {
  it('is available when info exits 0 and prints a server version', async () => {
    installDockerStub('echo 29.3.1');
    expect(await dockerAvailable()).toEqual({ ok: true });
  });

  it('accepts pre-release and vendor version strings', async () => {
    for (const version of ['28.0.4', '25.0.0-beta.1', '24.0.9+azure-2']) {
      installDockerStub(`echo '${version}'`);
      expect(await dockerAvailable(), version).toEqual({ ok: true });
    }
  });

  it('is UNAVAILABLE when info exits 0 with an empty ServerVersion and an error on stderr (trusted-runner shape)', async () => {
    installDockerStub(
      'echo ""; echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 0',
    );
    const result = await dockerAvailable();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('permission denied while trying to connect');
  });

  it('is UNAVAILABLE when info exits 0 and prints nothing at all', async () => {
    installDockerStub('exit 0');
    const result = await dockerAvailable();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('docker info printed no ServerVersion');
  });

  it('is UNAVAILABLE when stdout is not a version (whitespace, prose, a multi-token line)', async () => {
    for (const out of ['   ', '<no value>', 'Server Version: 29.3.1', 'error']) {
      installDockerStub(`echo '${out}'`);
      expect((await dockerAvailable()).ok, out).toBe(false);
    }
  });

  it('is UNAVAILABLE when info exits non-zero, reporting the last output line', async () => {
    installDockerStub('echo "Cannot connect to the Docker daemon" >&2; exit 1');
    expect(await dockerAvailable()).toEqual({
      ok: false,
      reason: 'Cannot connect to the Docker daemon',
    });
  });

  it('is UNAVAILABLE when docker is not installed (spawn error)', async () => {
    process.env.PATH = stubDir; // an empty directory: no docker, no anything
    const result = await dockerAvailable();
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('executeRedProbe with an explicit docker executor and a daemon-less CLI that exits 0', () => {
  it('is refused before any build: BLOCKED DOCKER_UNAVAILABLE, executorUsed none', async () => {
    installDockerStub(
      'echo ""; echo "failed to connect to the docker API at unix:///nonexistent/ppe.sock" >&2; exit 0',
    );
    const result = await executeRedProbe({
      repoRoot: REPO_ROOT,
      stageName: 'production-base',
      executor: 'docker',
      dockerHost: 'unix:///nonexistent/ppe.sock',
      timeoutMs: 60_000,
    });
    expect(result.classification).toBe('BLOCKED');
    expect(result.reasonCode).toBe('DOCKER_UNAVAILABLE');
    expect(result.executorRequested).toBe('docker');
    expect(result.executorUsed).toBe('none');
    expect(result.installStepStarted).toBe(false);
    expect(result.blockedReason).toContain('failed to connect to the docker API');
  }, 120_000);
});
