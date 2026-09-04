import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyExecutionRoot } from '../devgov/verify-execution-root.mjs';

const roots: string[] = [];

function makeWorkspace(): { execution: string; workspace: string } {
  const workspace = mkdtempSync(join(tmpdir(), 'devgov-execution-root-'));
  const execution = join(workspace, 'execution');
  roots.push(workspace);
  mkdirSync(execution);
  writeFileSync(join(execution, 'package.json'), '{}\n');
  writeFileSync(join(execution, 'package-lock.json'), '{}\n');
  return { execution, workspace };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { force: true, recursive: true });
  }
});

describe('trusted controller execution-root identity', () => {
  it('accepts only the exact regular npm inputs in the canonical execution checkout', () => {
    const { execution, workspace } = makeWorkspace();

    expect(verifyExecutionRoot({ execution, workspace })).toEqual({
      executionRoot: execution,
      packageJson: join(execution, 'package.json'),
      packageLock: join(execution, 'package-lock.json'),
    });
  });

  it('denies a symlinked execution root', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'devgov-execution-link-'));
    const target = mkdtempSync(join(tmpdir(), 'devgov-execution-target-'));
    roots.push(workspace, target);
    writeFileSync(join(target, 'package.json'), '{}\n');
    writeFileSync(join(target, 'package-lock.json'), '{}\n');
    symlinkSync(target, join(workspace, 'execution'), 'junction');

    expect(() => verifyExecutionRoot({ execution: join(workspace, 'execution'), workspace })).toThrow(
      /execution root must not be a symbolic link/i,
    );
  });

  it.each(['package.json', 'package-lock.json'])('denies a symlinked %s', (name) => {
    const { execution, workspace } = makeWorkspace();
    const target = join(workspace, `${name}.external`);
    if (process.platform === 'win32') {
      mkdirSync(target);
    } else {
      writeFileSync(target, '{}\n');
    }
    rmSync(join(execution, name));
    symlinkSync(target, join(execution, name), process.platform === 'win32' ? 'junction' : 'file');

    expect(() => verifyExecutionRoot({ execution, workspace })).toThrow(
      new RegExp(`${name.replace('.', '\\.')} must not be a symbolic link`, 'i'),
    );
  });

  it('does not derive execution identity from the current working directory', () => {
    const { execution, workspace } = makeWorkspace();
    const originalCwd = process.cwd();
    const unrelated = mkdtempSync(join(tmpdir(), 'devgov-cwd-'));
    roots.push(unrelated);

    try {
      process.chdir(unrelated);
      expect(verifyExecutionRoot({ execution, workspace }).executionRoot).toBe(execution);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('denies substitution with another directory under the workspace', () => {
    const { workspace } = makeWorkspace();
    const substituted = join(workspace, 'candidate');
    mkdirSync(substituted);
    writeFileSync(join(substituted, 'package.json'), '{}\n');
    writeFileSync(join(substituted, 'package-lock.json'), '{}\n');

    expect(() => verifyExecutionRoot({ execution: substituted, workspace })).toThrow(
      /execution root is not the canonical workspace execution checkout/i,
    );
  });
});
