import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertProjectedCharsWithinBudget,
  assertQuarantineId,
  assertRawBytesWithinBudget,
  ContentBudgetError,
  PathEscapeError,
  resolveWithinRoot,
} from '../src';

describe('K2.2 data safety — paths and budgets', () => {
  const root = path.resolve('/tmp/k22-quarantine-root');

  it('resolves a plain relative name inside the root', () => {
    expect(resolveWithinRoot(root, 'abc.bin')).toBe(path.join(root, 'abc.bin'));
    expect(resolveWithinRoot(root, 'download-manifests/x.json')).toBe(
      path.join(root, 'download-manifests', 'x.json'),
    );
  });

  it('refuses every escape shape: traversal, absolute, drive-qualified, UNC, NUL, empty, root itself', () => {
    for (const bad of [
      '../etc/passwd',
      'a/../../b',
      '/etc/passwd',
      'C:\\Windows\\system32',
      'C:/x',
      '\\\\server\\share',
      'a\0b',
      '',
      '.',
    ]) {
      expect(() => resolveWithinRoot(root, bad), bad).toThrow(PathEscapeError);
    }
  });

  it('accepts only quarantine uuids as object ids', () => {
    expect(assertQuarantineId('00019927-5933-499c-9be1-98991ad31f2f')).toBe(
      '00019927-5933-499c-9be1-98991ad31f2f',
    );
    for (const bad of ['../x', '00019927', 'DROP TABLE', '00019927-5933-499c-9be1-98991ad31f2f.bin']) {
      expect(() => assertQuarantineId(bad), bad).toThrow(PathEscapeError);
    }
  });

  it('enforces explicit content budgets', () => {
    expect(() =>
      assertRawBytesWithinBudget(10, { max_html_bytes: 1048576, max_raw_bytes: 5, max_projected_chars: 5 }),
    ).toThrow(ContentBudgetError);
    expect(() =>
      assertProjectedCharsWithinBudget(10, {
        max_html_bytes: 1048576,
        max_raw_bytes: 50,
        max_projected_chars: 5,
      }),
    ).toThrow(ContentBudgetError);
    expect(() => assertRawBytesWithinBudget(-1)).toThrow(ContentBudgetError);
    expect(() =>
      assertRawBytesWithinBudget(5, { max_html_bytes: 1048576, max_raw_bytes: 5, max_projected_chars: 5 }),
    ).not.toThrow();
  });
});
