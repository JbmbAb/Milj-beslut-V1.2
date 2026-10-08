/**
 * The production entrypoint set of u51-generation-derivation-1 is DERIVED from the release composition
 * (the distinct command/CMD entrypoints of the files bound by the composition manifest hash of
 * product-release-v3; contract 5.3). It is never hand-picked and never substituted by a subset.
 *
 * The legacy marker check below only reports whether older composition markers exist. The authoritative
 * derivation path is deriveEntrypointSet(): it reads deploy/onprem/entrypoints.json from the exact subject tree
 * and reuses D's fail-closed composition checker. When that file is absent or inconsistent the proof is
 * NOT_EXECUTED; observed launch surfaces remain context only and are never substituted for the derived set.
 */
import {
  ENTRYPOINTS_FILE_PATH,
  checkEntrypointComposition,
  memoryTreeReader,
} from '../../mps-release-entrypoints/src/index';
import type { StaticCensusDetail, TreeEntry } from './staticCensus.js';

export type EntrypointDerivability =
  | {
      readonly status: 'NOT_DERIVABLE';
      readonly blocker: 'RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE';
      readonly detail: string;
    }
  | {
      readonly status: 'NOT_DERIVABLE';
      readonly blocker: 'COMPOSITION_DERIVATION_NOT_IMPLEMENTED';
      readonly detail: string;
      readonly composition_marker_paths: readonly string[];
    };

export function assessEntrypointDerivability(detail: StaticCensusDetail): EntrypointDerivability {
  if (detail.composition_marker_paths.length === 0) {
    return {
      status: 'NOT_DERIVABLE',
      blocker: 'RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE',
      detail:
        'no non-test, non-documentation file of the subject tree carries a composition manifest; the set of production entrypoints cannot be derived and must not be curated by hand',
    };
  }
  return {
    status: 'NOT_DERIVABLE',
    blocker: 'COMPOSITION_DERIVATION_NOT_IMPLEMENTED',
    detail:
      'the subject tree carries composition-manifest content, but deriving the entrypoint set from it is not implemented or verified in this unit',
    composition_marker_paths: detail.composition_marker_paths,
  };
}

export type DerivedEntrypointSet =
  | {
      readonly status: 'DERIVED';
      readonly derived_sha256: string;
      readonly file_jcs_sha256: string;
      readonly file_bytes_sha256: string;
      readonly entrypoints: readonly {
        readonly id: string;
        readonly role: 'web' | 'worker';
        readonly argv: readonly string[];
        readonly entry_file: string;
      }[];
    }
  | {
      readonly status: 'NOT_DERIVABLE';
      readonly blocker: 'RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE' | 'COMPOSITION_INCONSISTENT';
      readonly detail: string;
      readonly problems?: readonly { readonly rule: string; readonly message: string }[];
    };

/**
 * Derive the production entrypoint set from the exact subject tree's composition-bound
 * deploy/onprem/entrypoints.json and cross-check it with the same fail-closed rules used by D.
 * This never accepts a hand-picked subset.
 */
export function deriveEntrypointSet(entries: readonly TreeEntry[]): DerivedEntrypointSet {
  const files: Record<string, string> = {};
  for (const entry of entries) files[entry.path] = Buffer.from(entry.bytes).toString('utf8');

  if (!Object.prototype.hasOwnProperty.call(files, ENTRYPOINTS_FILE_PATH)) {
    return {
      status: 'NOT_DERIVABLE',
      blocker: 'RELEASE_COMPOSITION_ABSENT_FROM_SUBJECT_TREE',
      detail: `${ENTRYPOINTS_FILE_PATH} is absent from the subject tree; the production entrypoint set cannot be derived`,
    };
  }

  const checked = checkEntrypointComposition(memoryTreeReader(files));
  if (checked.outcome !== 'consistent') {
    return {
      status: 'NOT_DERIVABLE',
      blocker: 'COMPOSITION_INCONSISTENT',
      detail: 'the subject carries entrypoints.json, but its bound release composition does not satisfy the D consistency rules',
      problems: checked.problems,
    };
  }

  return {
    status: 'DERIVED',
    derived_sha256: checked.derived_sha256,
    file_jcs_sha256: checked.file_jcs_sha256,
    file_bytes_sha256: checked.file_bytes_sha256,
    entrypoints: checked.file.entries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      argv: [...entry.argv],
      entry_file: entry.entry_file,
    })),
  };
}

/** Context only. NOT a derivation of the entrypoint set. */
export interface ObservedLaunchSurfaces {
  readonly authoritative: false;
  readonly dockerfile_stages: readonly string[];
  readonly dockerfile_cmds: readonly string[];
  readonly package_scripts: Readonly<Record<string, string>>;
}

export class LaunchSurfaceObserver {
  private stages: string[] = [];
  private cmds: string[] = [];
  private scripts: Record<string, string> = {};

  add(entry: TreeEntry): void {
    if (entry.path === 'Dockerfile') {
      for (const line of Buffer.from(entry.bytes).toString('utf8').split(/\r?\n/)) {
        const stage = /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
        if (stage) this.stages.push(stage[1]!);
        if (/^CMD\s/.test(line)) this.cmds.push(line.trim());
      }
    } else if (entry.path === 'package.json') {
      const parsed = JSON.parse(Buffer.from(entry.bytes).toString('utf8')) as { scripts?: Record<string, string> };
      for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
        if (name === 'start' || name.startsWith('worker:')) this.scripts[name] = command;
      }
    }
  }

  result(): ObservedLaunchSurfaces {
    return {
      authoritative: false,
      dockerfile_stages: this.stages,
      dockerfile_cmds: this.cmds,
      package_scripts: this.scripts,
    };
  }
}
