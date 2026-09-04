#!/usr/bin/env node

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function canonicalPath(path) {
  const canonical = realpathSync.native(path);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function requireRegularFile(path, label) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) {
    throw new Error(`${label} does not exist`);
  }
  if (entry.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  if (!entry.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

export function verifyExecutionRoot({ execution, workspace }) {
  if (!isAbsolute(workspace) || !isAbsolute(execution)) {
    throw new Error('workspace and execution paths must be absolute');
  }

  const executionEntry = lstatSync(execution, { throwIfNoEntry: false });
  if (!executionEntry) {
    throw new Error('execution root does not exist');
  }
  if (executionEntry.isSymbolicLink()) {
    throw new Error('execution root must not be a symbolic link');
  }
  if (!executionEntry.isDirectory()) {
    throw new Error('execution root must be a directory');
  }

  const workspaceRoot = realpathSync.native(workspace);
  const executionRoot = realpathSync.native(execution);
  const expectedExecutionRoot = realpathSync.native(join(workspaceRoot, 'execution'));
  const executionRelativeToWorkspace = relative(workspaceRoot, executionRoot);

  if (
    executionRelativeToWorkspace === '' ||
    executionRelativeToWorkspace.startsWith('..') ||
    isAbsolute(executionRelativeToWorkspace)
  ) {
    throw new Error('execution root must be contained by the canonical workspace');
  }
  if (canonicalPath(executionRoot) !== canonicalPath(expectedExecutionRoot)) {
    throw new Error('execution root is not the canonical workspace execution checkout');
  }

  const packageJson = join(executionRoot, 'package.json');
  const packageLock = join(executionRoot, 'package-lock.json');
  requireRegularFile(packageJson, 'package.json');
  requireRegularFile(packageLock, 'package-lock.json');

  if (canonicalPath(packageJson) !== canonicalPath(join(executionRoot, 'package.json'))) {
    throw new Error('package.json does not resolve to the verified execution root');
  }
  if (canonicalPath(packageLock) !== canonicalPath(join(executionRoot, 'package-lock.json'))) {
    throw new Error('package-lock.json does not resolve to the verified execution root');
  }

  return { executionRoot, packageJson, packageLock };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('expected --workspace and --execution arguments');
    }
    values[name.slice(2)] = resolve(value);
  }
  if (!values.workspace || !values.execution) {
    throw new Error('expected --workspace and --execution arguments');
  }
  return values;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const identity = verifyExecutionRoot(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${identity.executionRoot}\n`);
  } catch (error) {
    process.stderr.write(`execution identity denied: ${error.message}\n`);
    process.exitCode = 4;
  }
}
