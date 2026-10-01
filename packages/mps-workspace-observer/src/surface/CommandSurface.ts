/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the frozen command surface, as data.
 *
 * The Observer is DRIVEN BY the frozen surface file rather than by a copy of it embedded in this
 * package. That is deliberate. A hard-coded argv list in the implementer's own source is exactly
 * the substitution path the authority model exists to close: the candidate would then control both
 * the request and the assertion that the request was permitted. Here the bytes come from outside,
 * the constructor refuses to build unless they hash to the digest the caller was given, and the
 * argv the Observer spawns is assembled from those bytes.
 *
 * What this module does NOT do is interpret the surface's prose. Instantiation predicates, the
 * candidate expansion and the order of execution are stated as normative algorithms in the surface
 * and are implemented in code by the Observer; this module supplies the templates, the fixed key
 * lists, the containers, the timeouts and the assertions.
 *
 * A request the surface does not permit must stop the Observer OUT OF BAND, before it is issued.
 * Silent fallback is forbidden in all three test layers (extensionPolicy).
 */
import { readFileSync } from 'node:fs';

import { sha256Hex } from '../digest/CanonicalDigest.js';

export type RequestScope = 'REPOSITORY_GLOBAL' | 'WORKSPACE_LOCAL';

export type RequestKind =
  | 'PROCESS'
  | 'FS_LSTAT'
  | 'FS_READDIR'
  | 'FS_READ_FILE'
  | 'FS_COMPOSITE';

export type FilesystemOperation =
  | 'LSTAT'
  | 'READDIR'
  | 'READDIR_COUNT'
  | 'READ_FILE'
  | 'REALPATH_NATIVE';

/**
 * coverageReasonCodes. Capture-time vocabulary, kept deliberately distinct from the Observer's
 * observation-state vocabulary: a capture-time non-attempt is not the Observer's NOT_ATTEMPTED,
 * and confusing the two is how a data-starved Observer comes to look correctly fail-closed.
 */
export type CoverageReasonCode =
  | 'CANONICAL_SHA_UNAVAILABLE'
  | 'PREREQUISITE_FAILED'
  | 'EXPANSION_EMPTY';

export interface CompositeOperation {
  readonly op: FilesystemOperation;
  readonly path: string;
  readonly key: string;
  readonly maxBytes?: number;
  readonly filesOnly?: boolean;
  readonly note?: string;
}

export interface FixedContainer {
  readonly key: string;
  readonly path: string;
  readonly nameFilter: string | null;
  readonly nameFilterFlags?: string;
  readonly onlyDirectories?: boolean;
}

export interface RequestFamily {
  readonly id: string;
  readonly name: string;
  readonly kind: RequestKind;
  readonly scope: RequestScope;
  readonly argvTemplate?: readonly string[];
  readonly pathTemplate?: string;
  readonly operations?: readonly CompositeOperation[];
  readonly instances: {
    readonly rule: string;
    readonly keys?: readonly string[];
    readonly keyFormat: string;
    readonly source?: string;
    readonly containers?: readonly FixedContainer[];
    readonly fixedFiles?: readonly string[];
  };
  readonly instantiationPredicate?: string;
  readonly timeoutMs: number;
  readonly maxBytes?: number;
  readonly withSize?: boolean;
  readonly exitCodeInterpretation?: Readonly<Record<string, string>>;
  readonly resultInterpretation?: string;
  readonly materialFacts?: readonly string[];
  readonly allowlist?: readonly string[];
}

interface SurfaceDocument {
  readonly schemaId: string;
  readonly version: string;
  readonly status: string;
  readonly repository: {
    readonly canonicalRefLocal: string;
    readonly canonicalRefRemote: string;
    readonly expectedCanonicalBaseSha: string;
  };
  readonly processPolicy: {
    readonly executable: string;
    readonly mandatoryArgvPrefix: readonly string[];
    readonly mandatoryEnvironment: Readonly<Record<string, string>>;
    readonly capturePolicy: { readonly outputLimit: string };
  };
  readonly filesystemPolicy: {
    readonly operations: readonly FilesystemOperation[];
    readonly timeoutMs: number;
    readonly errorCodeInterpretation: Readonly<Record<string, string>>;
  };
  readonly placeholders: Readonly<Record<string, string>>;
  readonly requestFamilies: readonly RequestFamily[];
  readonly coverageReasonCodes: Readonly<Record<CoverageReasonCode, string>>;
}

/**
 * Raised when the Observer would issue a request the frozen surface does not permit.
 *
 * The replay contract owns this code, and it is raised out of band in all three test layers,
 * never returned as a value the Observer could fold into UNKNOWN.
 */
export class RequestOutsideCommandSurface extends Error {
  readonly code = 'REQUEST_OUTSIDE_COMMAND_SURFACE';
  readonly detail: string;

  constructor(detail: string) {
    super(`REQUEST_OUTSIDE_COMMAND_SURFACE: ${detail}`);
    this.name = 'RequestOutsideCommandSurface';
    this.detail = detail;
  }
}

export class CommandSurfaceDigestMismatch extends Error {
  readonly code = 'AUTHORITY_DIGEST_MISMATCH';

  constructor(expected: string, actual: string) {
    super(`AUTHORITY_DIGEST_MISMATCH: command surface expected ${expected}, got ${actual}`);
    this.name = 'CommandSurfaceDigestMismatch';
  }
}

/** A fully assembled process request, ready for the port to execute or the transport to look up. */
export interface ProcessRequest {
  readonly kind: 'PROCESS';
  readonly requestId: string;
  readonly scope: RequestScope;
  readonly instanceKey: string;
  readonly executable: 'git';
  /** Includes the mandatory prefix, exactly as it must be spawned and keyed. */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

/** A fully assembled filesystem request. `opKey` is '' for single-operation families. */
export interface FilesystemRequest {
  readonly kind: 'FS';
  readonly requestId: string;
  readonly scope: RequestScope;
  readonly instanceKey: string;
  readonly operation: FilesystemOperation;
  readonly opKey: string;
  readonly path: string;
  readonly timeoutMs: number;
  readonly maxBytes?: number;
  /**
   * The frozen listing filter, carried on the request so a LIVE port applies exactly what the
   * recorder applied.
   *
   * Without it the live layer records entry names the policy says are never recorded — RD4 keeps
   * only `totalEntryCount` and `matchedEntryCount` for names outside the drive-root filter, and
   * RD5 keeps only a count for candidate directory contents. Ignoring it does not just leak names:
   * it inflates the candidate set with unrelated drive-root files, and the live layer then answers
   * questions about `hiberfil.sys`. This is not theoretical — it is what the first live run did.
   */
  readonly listing?: {
    readonly nameFilter?: string | null;
    readonly nameFilterFlags?: string;
    readonly onlyDirectories?: boolean;
    readonly filesOnly?: boolean;
  };
}

export type SurfaceRequest = ProcessRequest | FilesystemRequest;

export class CommandSurface {
  private readonly doc: SurfaceDocument;
  private readonly byId: ReadonlyMap<string, RequestFamily>;

  readonly digest: string;

  private constructor(doc: SurfaceDocument, digest: string) {
    this.doc = doc;
    this.digest = digest;
    this.byId = new Map(doc.requestFamilies.map((f) => [f.id, f]));
  }

  /**
   * Load the surface from bytes supplied by the caller and refuse unless they hash to
   * `expectedDigest`. There is no default path and no fallback: an Observer that could fall back
   * to a bundled copy would be able to answer for a surface nobody bound.
   */
  static fromBytes(bytes: Uint8Array, expectedDigest: string): CommandSurface {
    const actual = sha256Hex(bytes);
    if (actual !== expectedDigest) throw new CommandSurfaceDigestMismatch(expectedDigest, actual);
    const doc = JSON.parse(Buffer.from(bytes).toString('utf8')) as SurfaceDocument;
    if (doc.schemaId !== 'WORKSPACE_OBSERVER_COMMAND_SURFACE_V1') {
      throw new CommandSurfaceDigestMismatch(expectedDigest, `schemaId ${doc.schemaId}`);
    }
    if (doc.status !== 'FROZEN') {
      throw new CommandSurfaceDigestMismatch(expectedDigest, `status ${doc.status}`);
    }
    return new CommandSurface(doc, actual);
  }

  static fromFile(path: string, expectedDigest: string): CommandSurface {
    return CommandSurface.fromBytes(readFileSync(path), expectedDigest);
  }

  get version(): string {
    return this.doc.version;
  }

  get expectedCanonicalBaseSha(): string {
    return this.doc.repository.expectedCanonicalBaseSha;
  }

  get mandatoryArgvPrefix(): readonly string[] {
    return this.doc.processPolicy.mandatoryArgvPrefix;
  }

  get mandatoryEnvironment(): Readonly<Record<string, string>> {
    return this.doc.processPolicy.mandatoryEnvironment;
  }

  get filesystemOperations(): readonly FilesystemOperation[] {
    return this.doc.filesystemPolicy.operations;
  }

  get filesystemTimeoutMs(): number {
    return this.doc.filesystemPolicy.timeoutMs;
  }

  get families(): readonly RequestFamily[] {
    return this.doc.requestFamilies;
  }

  family(id: string): RequestFamily {
    const f = this.byId.get(id);
    if (f === undefined) throw new RequestOutsideCommandSurface(`no request family ${id}`);
    return f;
  }

  /** The declared placeholder names, e.g. '{candidatePath}'. Anything else in a template is literal. */
  get placeholderNames(): readonly string[] {
    return Object.keys(this.doc.placeholders);
  }

  /**
   * Substitute declared placeholders verbatim — no quoting, no normalisation — and assert the
   * result against the family's argvTemplate.
   *
   * Only names declared in `placeholders` are substituted. That distinction matters: R-G-11's
   * template token is `{sha}^{commit}`, where `{sha}` is a placeholder and `^{commit}` is literal
   * git revision syntax. A naive brace-substitution would eat the second one and produce a request
   * the surface does not describe.
   */
  assembleArgv(familyId: string, values: Readonly<Record<string, string>>): readonly string[] {
    const family = this.family(familyId);
    if (family.kind !== 'PROCESS' || family.argvTemplate === undefined) {
      throw new RequestOutsideCommandSurface(`${familyId} is not a process family`);
    }
    const names = this.placeholderNames;
    const instantiated = family.argvTemplate.map((token) => {
      let out = token;
      for (const name of names) {
        if (!out.includes(name)) continue;
        const bare = name.slice(1, -1);
        const value = values[bare];
        if (value === undefined) {
          throw new RequestOutsideCommandSurface(
            `${familyId} template token ${JSON.stringify(token)} needs placeholder ${name}`,
          );
        }
        out = out.split(name).join(value);
      }
      return out;
    });

    this.assertArgvAgainstTemplate(family, instantiated);
    return Object.freeze([...this.mandatoryArgvPrefix, ...instantiated]);
  }

  /**
   * argvPolicy: same length; every template token without a placeholder equal byte for byte; a
   * leading '-C' pair present if and only if the template has one.
   *
   * `argv` here is the instantiated template WITHOUT the mandatory prefix.
   */
  assertArgvAgainstTemplate(family: RequestFamily, argv: readonly string[]): void {
    const template = family.argvTemplate;
    if (template === undefined) {
      throw new RequestOutsideCommandSurface(`${family.id} has no argvTemplate`);
    }
    if (argv.length !== template.length) {
      throw new RequestOutsideCommandSurface(
        `${family.id} argv length ${argv.length} != template length ${template.length}`,
      );
    }
    const names = this.placeholderNames;
    for (let i = 0; i < template.length; i += 1) {
      const token = template[i];
      const hasPlaceholder = names.some((n) => token.includes(n));
      if (!hasPlaceholder && argv[i] !== token) {
        throw new RequestOutsideCommandSurface(
          `${family.id} argv[${i}] = ${JSON.stringify(argv[i])}, template requires ${JSON.stringify(token)}`,
        );
      }
    }
    const templateHasC = template[0] === '-C';
    const argvHasC = argv[0] === '-C';
    if (templateHasC !== argvHasC) {
      throw new RequestOutsideCommandSurface(
        `${family.id} '-C' prefix present in argv=${String(argvHasC)} but template=${String(templateHasC)}`,
      );
    }
  }

  /** The mandatory environment, asserted key by key. No host value is ever added. */
  assertEnvironment(env: Readonly<Record<string, string>>): void {
    const required = this.mandatoryEnvironment;
    for (const [k, v] of Object.entries(required)) {
      if (!(k in env)) throw new RequestOutsideCommandSurface(`environment is missing ${k}`);
      if (env[k] !== v) {
        throw new RequestOutsideCommandSurface(
          `environment ${k} = ${JSON.stringify(env[k])}, frozen value is ${JSON.stringify(v)}`,
        );
      }
    }
    for (const k of Object.keys(env)) {
      if (!(k in required)) {
        throw new RequestOutsideCommandSurface(`environment carries undeclared key ${k}`);
      }
    }
  }

  assertFilesystemOperation(operation: string): asserts operation is FilesystemOperation {
    if (!(this.doc.filesystemPolicy.operations as readonly string[]).includes(operation)) {
      throw new RequestOutsideCommandSurface(`filesystem operation ${operation} is not frozen`);
    }
  }
}
