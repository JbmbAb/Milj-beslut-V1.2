/**
 * The verifier's identity (contract 7.3): `{ verifier_version, implementation_tree_sha1 }` where the tree sha1 is the
 * git TREE of the controller checkout, so any change to the verifier, its adapters or its lockfile changes it.
 *
 * It is only meaningful when the checkout really IS that tree: a dirty or untracked-file-bearing controller is
 * refused (AdapterUnavailable), because then the tree sha1 would describe bytes that are not running.
 * The identity is audit-grade until the freeze gate's independent reproduction makes it authority (OD-14).
 */
import { spawnSync } from 'node:child_process';
import { AdapterUnavailable, type ControllerIdentity } from '../runner/prover';
import { U51_VERIFIER_VERSION } from '../vocabulary';

function git(root: string, args: readonly string[]): string {
  const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error !== undefined || run.status !== 0) {
    throw new AdapterUnavailable(`the controller checkout could not be inspected (git ${args.join(' ')}): ${run.error?.message ?? run.stderr?.trim()}`);
  }
  return run.stdout.trim();
}

export function controllerIdentity(controllerRoot: string): ControllerIdentity {
  const dirty = git(controllerRoot, ['status', '--porcelain', '--untracked-files=all']);
  if (dirty.length > 0) {
    throw new AdapterUnavailable('the controller checkout is not clean: its tree sha1 would not describe the code that runs');
  }
  return {
    verifier_version: U51_VERIFIER_VERSION,
    implementation_tree_sha1: git(controllerRoot, ['rev-parse', 'HEAD^{tree}']),
    controller_commit_sha: git(controllerRoot, ['rev-parse', 'HEAD']),
  };
}
