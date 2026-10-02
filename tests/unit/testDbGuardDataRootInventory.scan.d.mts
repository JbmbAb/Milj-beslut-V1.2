// TDG-4: types of the data-root inventory scanner (testDbGuardDataRootInventory.scan.mjs).
export type DataRootEnvRead = {
  readonly file: string;
  readonly line: number;
  readonly how: string;
  readonly fallback: string | null;
  readonly fallbackKind: 'none' | 'caller' | 'location';
};
export type DataRootUse = { readonly file: string; readonly line: number; readonly how: string };
export type DataRootInventory = {
  readonly how: 'git' | 'walk';
  readonly fileCount: number;
  readonly envKeys: Readonly<
    Record<string, { readonly reads: readonly DataRootEnvRead[]; readonly fallsBackToLocation: boolean }>
  >;
  /** TDG-5: data-root-shaped keys built at run time (`*_STORE_ROOT`). */
  readonly dynamicEnvKeys: Readonly<Record<string, readonly DataRootUse[]>>;
  readonly relativeRoots: Readonly<
    Record<
      string,
      readonly { readonly file: string; readonly line: number; readonly path: string; readonly how: string }[]
    >
  >;
  readonly absoluteDefaults: Readonly<
    Record<string, readonly { readonly file: string; readonly line: number; readonly key: string }[]>
  >;
  /** TDG-5: every absolute path literal (not under a home directory). */
  readonly absolutePaths: Readonly<Record<string, readonly DataRootUse[]>>;
  /** TDG-5: every path under the home directory, as `~/...`. */
  readonly homePaths: Readonly<Record<string, readonly DataRootUse[]>>;
};
export declare const DATA_ROOT_SCAN_SCOPE: readonly string[];
export declare const DATA_ROOT_NAME_TOKENS: readonly string[];
export declare function isDataRootShapedEnvKey(key: string): boolean;
export declare function fallbackBuildsPath(expr: string | null): boolean;
export declare function isDataRootScanFile(relPath: string): boolean;
export declare function listDataRootScanFiles(
  root: string,
  how?: 'auto' | 'git' | 'walk',
): { readonly how: 'git' | 'walk'; readonly files: string[] };
export declare function stripComments(text: string): string;
export declare function classifyFallback(expr: string | null): 'none' | 'caller' | 'location';
export declare function topRelativeRoot(p: string): string;
export declare function homeRelative(absolute: string): string | null;
export declare function scanDataRoots(
  root: string,
  options?: { readonly how?: 'auto' | 'git' | 'walk' },
): DataRootInventory;
