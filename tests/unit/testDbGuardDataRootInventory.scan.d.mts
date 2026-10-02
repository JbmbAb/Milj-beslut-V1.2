// TDG-4: types of the data-root inventory scanner (testDbGuardDataRootInventory.scan.mjs).
export type DataRootEnvRead = {
  readonly file: string;
  readonly line: number;
  readonly how: string;
  readonly fallback: string | null;
  readonly fallbackKind: 'none' | 'caller' | 'location';
};
export type DataRootInventory = {
  readonly how: 'git' | 'walk';
  readonly fileCount: number;
  readonly envKeys: Readonly<
    Record<string, { readonly reads: readonly DataRootEnvRead[]; readonly fallsBackToLocation: boolean }>
  >;
  readonly relativeRoots: Readonly<
    Record<
      string,
      readonly { readonly file: string; readonly line: number; readonly path: string; readonly how: string }[]
    >
  >;
  readonly absoluteDefaults: Readonly<
    Record<string, readonly { readonly file: string; readonly line: number; readonly key: string }[]>
  >;
};
export declare const DATA_ROOT_SCAN_SCOPE: readonly string[];
export declare const DATA_ROOT_NAME_TOKENS: readonly string[];
export declare function isDataRootShapedEnvKey(key: string): boolean;
export declare function isDataRootScanFile(relPath: string): boolean;
export declare function listDataRootScanFiles(
  root: string,
  how?: 'auto' | 'git' | 'walk',
): { readonly how: 'git' | 'walk'; readonly files: string[] };
export declare function stripComments(text: string): string;
export declare function classifyFallback(expr: string | null): 'none' | 'caller' | 'location';
export declare function topRelativeRoot(p: string): string;
export declare function scanDataRoots(
  root: string,
  options?: { readonly how?: 'auto' | 'git' | 'walk' },
): DataRootInventory;
