import { spawnSync } from 'node:child_process';

import { registerLiveDatabaseEndpoints, TEST_DB_GUARD_LABEL } from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-2 finding 4: a running staging database
 * (`miljobeslut-lu-proof-db`, 127.0.0.1:55432, `miljobeslut_staging`) was in neither the static
 * denylist nor the inventory. The static list now names it, and on top of that the guard asks
 * Docker, best effort, which host ports the running containers publish -- `docker ps --format`
 * with names, ports and images ONLY (never env, never inspect, never a password) -- and refuses
 * every port published by a container that is not a disposable test container, and its name as a
 * host. So an unknown new container is refused as well, and an opt-in can never reach a port of a
 * known live/staging/proof container. Without Docker (or with a stopped daemon) the static list
 * applies, and one stderr line says so.
 *
 * Runs once per process, when the guard is installed (installTestDatabaseConnectionGuard), and
 * before a local E2E run (playwright.config.ts) or a destructive GIS admission is decided.
 * A container started later in the same process is not seen; pg connections to it still need the
 * opt-in, and its name is not a known host.
 */

export type DockerContainerPorts = {
  readonly name: string;
  readonly image: string;
  /** Host ports the container publishes (any bind address). */
  readonly hostPorts: readonly number[];
};

export type DockerDatabaseEndpointDiscovery = {
  readonly status: 'not-run' | 'ok' | 'unavailable';
  readonly detail: string;
  /** Published host ports of every container that is not a disposable test container. */
  readonly deniedPorts: readonly number[];
  /** Names of those containers (refused as hosts on any port). */
  readonly deniedNames: readonly string[];
  readonly containers: readonly DockerContainerPorts[];
};

export type DockerPsResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: { readonly code?: string; readonly message?: string } | null;
};

const DOCKER_PS_ARGS = ['ps', '--format', '{{.Names}}\t{{.Ports}}\t{{.Image}}'];
const DOCKER_TIMEOUT_MS = 4000;
const MAX_RANGE = 1024;

/** `0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 127.0.0.1:8000-8002->80-82/tcp` -> host ports. */
export function parsePublishedHostPorts(ports: string): number[] {
  const out = new Set<number>();
  for (const part of String(ports ?? '').split(',')) {
    const match = /:(\d+)(?:-(\d+))?->/.exec(part.trim());
    if (!match) continue; // `5432/tcp`: exposed on the Docker network only, not on this host
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    for (let port = start; port <= end && port - start < MAX_RANGE; port += 1) out.add(port);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseDockerPsOutput(stdout: string): DockerContainerPorts[] {
  const containers: DockerContainerPorts[] = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name = '', ports = '', image = ''] = line.split('\t');
    if (!name.trim()) continue;
    containers.push({ name: name.trim(), image: image.trim(), hostPorts: parsePublishedHostPorts(ports) });
  }
  return containers;
}

/**
 * The only containers whose ports an opt-in may reach: the NAME says disposable test database
 * (`test`/`tests` as a whole word) and nothing in it says live, staging, proof, demo, recovery,
 * platform or production. The image is deliberately ignored: the staging proof database runs the
 * `milj-beslut-postgres-test` image.
 */
export function isDisposableTestContainerName(name: string): boolean {
  const lower = String(name ?? '').toLowerCase();
  if (/(prod|staging|stage|proof|live|demo|recovery|platform)/.test(lower)) return false;
  return /(^|[-_.])tests?([-_.]|$)/.test(lower);
}

function denied(containers: readonly DockerContainerPorts[]): { ports: number[]; names: string[] } {
  const ports = new Set<number>();
  const names = new Set<string>();
  for (const container of containers) {
    if (isDisposableTestContainerName(container.name)) continue;
    names.add(container.name.toLowerCase());
    for (const port of container.hostPorts) ports.add(port);
  }
  return { ports: [...ports].sort((a, b) => a - b), names: [...names].sort() };
}

function runDockerPs(): DockerPsResult {
  const result = spawnSync('docker', DOCKER_PS_ARGS, {
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error as { code?: string; message?: string } | undefined,
  };
}

function unavailable(detail: string): DockerDatabaseEndpointDiscovery {
  return { status: 'unavailable', detail, deniedPorts: [], deniedNames: [], containers: [] };
}

/** One discovery, without registering anything (pure apart from running `docker ps`). */
export function discoverDockerDatabaseEndpoints(
  run: () => DockerPsResult = runDockerPs,
): DockerDatabaseEndpointDiscovery {
  let result: DockerPsResult;
  try {
    result = run();
  } catch (error) {
    return unavailable(
      `docker could not be run (${String((error as Error)?.message ?? error).slice(0, 120)})`,
    );
  }
  if (result.error) {
    return unavailable(`docker could not be run (${result.error.code ?? result.error.message ?? 'error'})`);
  }
  if (result.status !== 0) {
    const firstLine = result.stderr.split(/\r?\n/).find((line) => line.trim()) ?? '';
    return unavailable(`docker ps exited ${String(result.status)}: ${firstLine.trim().slice(0, 160)}`);
  }
  const containers = parseDockerPsOutput(result.stdout);
  const { ports, names } = denied(containers);
  return {
    status: 'ok',
    detail: `${containers.length} running container(s), ${ports.length} denied host port(s)`,
    deniedPorts: ports,
    deniedNames: names,
    containers,
  };
}

const STATE = Symbol.for('mimer.testDbGuard.dockerDiscovery');
type GlobalWithDiscovery = { [STATE]?: DockerDatabaseEndpointDiscovery };

/**
 * Discovers once per process and registers the result with the policy (additive: nothing a
 * discovery found can be un-denied). Returns the discovery; later calls return the same one.
 */
export function ensureDockerDatabaseEndpointDiscovery(
  run: () => DockerPsResult = runDockerPs,
): DockerDatabaseEndpointDiscovery {
  const g = globalThis as GlobalWithDiscovery;
  const existing = g[STATE];
  if (existing) return existing;
  const discovery = discoverDockerDatabaseEndpoints(run);
  g[STATE] = discovery;
  if (discovery.status === 'ok') {
    registerLiveDatabaseEndpoints({ ports: discovery.deniedPorts, hosts: discovery.deniedNames });
  } else {
    process.stderr.write(
      `[${TEST_DB_GUARD_LABEL}] Docker port discovery unavailable (${discovery.detail}); ` +
        `the static denylist applies.\n`,
    );
  }
  return discovery;
}

/** For the proof tests: the discovery this process ran, or status `not-run`. */
export function dockerDatabaseEndpointDiscoveryState(): DockerDatabaseEndpointDiscovery {
  return (
    (globalThis as GlobalWithDiscovery)[STATE] ?? {
      status: 'not-run',
      detail: 'no discovery in this process',
      deniedPorts: [],
      deniedNames: [],
      containers: [],
    }
  );
}
