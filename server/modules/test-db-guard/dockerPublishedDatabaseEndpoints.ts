import { spawnSync } from 'node:child_process';

import {
  registerLiveDatabaseEndpoints,
  TEST_DB_GUARD_LABEL,
  WORKSTATION_LIVE_DATABASE_PORTS,
} from './testDatabaseTargetPolicy';

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
 *
 * TDG-3 (low findings):
 *   - the output is validated line by line (exactly the four requested fields, a container name,
 *     the published-ports grammar, an image); anything else is not trusted at all: a clear warning
 *     on stderr, and only the static denylist applies (never a silent `ok` with no ports);
 *   - a container is a disposable test database only if it was CREATED as one -- the label
 *     `mimer.test-db=disposable` -- AND its name says test and nothing live; a name alone (e.g. a
 *     live copy called `pg-test`) is never enough;
 *   - a hanging Docker costs at most 1.5 s per test process, with a warning that says so.
 */

/** The label that marks a container as a disposable test database: `--label mimer.test-db=disposable`. */
export const DISPOSABLE_TEST_DB_LABEL = 'mimer.test-db';
export const DISPOSABLE_TEST_DB_LABEL_VALUE = 'disposable';

export type DockerContainerPorts = {
  readonly name: string;
  readonly image: string;
  /** Host ports the container publishes (any bind address). */
  readonly hostPorts: readonly number[];
  /** The value of the container's `mimer.test-db` label ('' when it has none). */
  readonly testDbLabel: string;
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

const DOCKER_PS_FIELDS = 4;
const DOCKER_PS_ARGS = [
  'ps',
  '--format',
  `{{.Names}}\t{{.Ports}}\t{{.Image}}\t{{.Label "${DISPOSABLE_TEST_DB_LABEL}"}}`,
];
export const DOCKER_TIMEOUT_MS = 1500;
const MAX_RANGE = 1024;

/** `name` or `name1,name2` (docker ps lists every name of a container). */
const CONTAINER_NAMES = /^[A-Za-z0-9][A-Za-z0-9_.-]*(,[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
/** One published/exposed port: `5432/tcp`, `0.0.0.0:5432->5432/tcp`, `[::]:80-82->80-82/udp`. */
const PORT_ENTRY = /^(\S+:\d+(-\d+)?->)?\d+(-\d+)?\/(tcp|udp|sctp)$/;

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

export type DockerPsParse = {
  readonly containers: DockerContainerPorts[];
  /** Every line that is not in the requested format (empty when the whole output is trusted). */
  readonly problems: string[];
};

/** Parses AND validates `docker ps --format` output; a single unexpected line is a problem. */
export function parseDockerPsOutput(stdout: string): DockerPsParse {
  const containers: DockerContainerPorts[] = [];
  const problems: string[] = [];
  String(stdout ?? '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      const where = `line ${index + 1}`;
      const fields = line.split('\t');
      if (fields.length !== DOCKER_PS_FIELDS) {
        problems.push(`${where} has ${fields.length} field(s), expected ${DOCKER_PS_FIELDS}`);
        return;
      }
      const [name, ports, image, label] = fields.map((field) => field.trim());
      if (!CONTAINER_NAMES.test(name)) {
        problems.push(`${where}: ${JSON.stringify(name.slice(0, 60))} is not a container name`);
        return;
      }
      const entries = ports ? ports.split(',').map((part) => part.trim()) : [];
      const badPort = entries.find((entry) => !PORT_ENTRY.test(entry));
      if (badPort !== undefined) {
        problems.push(`${where}: ${JSON.stringify(badPort.slice(0, 60))} is not a published-port entry`);
        return;
      }
      if (!image) {
        problems.push(`${where}: no image`);
        return;
      }
      containers.push({ name, image, hostPorts: parsePublishedHostPorts(ports), testDbLabel: label });
    });
  return { containers, problems };
}

/**
 * The name half of the test-container rule: the NAME says disposable test database (`test`/`tests`
 * as a whole word) and nothing in it says live, staging, proof, demo, recovery, platform or
 * production. The image is deliberately ignored: the staging proof database runs the
 * `milj-beslut-postgres-test` image.
 */
export function isDisposableTestContainerName(name: string): boolean {
  const lower = String(name ?? '').toLowerCase();
  if (/(prod|staging|stage|proof|live|demo|recovery|platform)/.test(lower)) return false;
  return /(^|[-_.])tests?([-_.]|$)/.test(lower);
}

/**
 * The only containers whose ports an opt-in may reach: created with the label
 * `mimer.test-db=disposable` AND named as a test database (isDisposableTestContainerName). A
 * container cannot become a test container by being renamed.
 */
export function isDisposableTestContainer(
  container: Pick<DockerContainerPorts, 'name' | 'testDbLabel'>,
): boolean {
  return (
    String(container.testDbLabel ?? '').trim() === DISPOSABLE_TEST_DB_LABEL_VALUE &&
    isDisposableTestContainerName(container.name)
  );
}

function denied(containers: readonly DockerContainerPorts[]): { ports: number[]; names: string[] } {
  const ports = new Set<number>();
  const names = new Set<string>();
  for (const container of containers) {
    if (isDisposableTestContainer(container)) continue;
    for (const name of container.name.split(',')) names.add(name.toLowerCase());
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
    if (result.error.code === 'ETIMEDOUT') {
      return unavailable(`docker ps did not answer within ${DOCKER_TIMEOUT_MS} ms (timed out)`);
    }
    return unavailable(`docker could not be run (${result.error.code ?? result.error.message ?? 'error'})`);
  }
  if (result.status !== 0) {
    const firstLine = result.stderr.split(/\r?\n/).find((line) => line.trim()) ?? '';
    return unavailable(`docker ps exited ${String(result.status)}: ${firstLine.trim().slice(0, 160)}`);
  }
  const { containers, problems } = parseDockerPsOutput(result.stdout);
  if (problems.length > 0) {
    return unavailable(
      `unexpected docker ps output format, nothing of it is used (${problems.slice(0, 3).join('; ')}` +
        `${problems.length > 3 ? `; +${problems.length - 3} more` : ''})`,
    );
  }
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
      `[${TEST_DB_GUARD_LABEL}] WARNING: Docker port discovery unavailable (${discovery.detail}); ` +
        `only the static denylist applies (ports ${WORKSTATION_LIVE_DATABASE_PORTS.join(', ')}).\n`,
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
