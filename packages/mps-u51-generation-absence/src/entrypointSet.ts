/**
 * The production entrypoint set of u51-generation-derivation-1 is DERIVED from the release composition
 * (the distinct command/CMD entrypoints of the files bound by the composition manifest hash of
 * product-release-v3; contract 5.3). It is never hand-picked and never substituted by a subset.
 *
 * This module therefore does exactly one thing: decide whether the subject tree can give that derivation.
 * It cannot derive a set, so it never returns one. When the release composition is absent the answer is
 * NOT_DERIVABLE and the proof is NOT_EXECUTED (the runner exits 2). What it observes about launch surfaces is
 * reported as context for the reader and is NOT a derivation and NOT evidence.
 */
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
