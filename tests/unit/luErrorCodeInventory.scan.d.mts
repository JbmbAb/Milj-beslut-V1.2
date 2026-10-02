// W-M2e item 2: types of the shared inventory scanner (luErrorCodeInventory.scan.mjs).
export declare const LU_ENTRY_MODULES: readonly string[];
export declare function scanServerTokens(root: string): {
  readonly tokens: Map<string, { readonly files: Set<string>; readonly how: Set<string> }>;
  readonly files: string[];
};
export declare function luReachClosure(root: string): Set<string>;
