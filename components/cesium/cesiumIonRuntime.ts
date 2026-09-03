/**
 * CESIUM-MAP-RENDERING-RUNTIME-01.
 *
 * CesiumJS ships a bundled default Ion access token. Leaving it in place makes Viewer
 * construct World Imagery against api.cesium.com, logs "Ion is using the default access
 * token", and commonly 401s. Product token, when present, comes only from Vite runtime
 * env -- never a hardcoded personal JWT in source.
 */
export const CESIUM_ION_ACCESS_TOKEN_ENV = 'VITE_CESIUM_ION_ACCESS_TOKEN' as const;

export type CesiumIonRuntimeEnv = {
  readonly VITE_CESIUM_ION_ACCESS_TOKEN?: string;
};

export type CesiumIonRuntimeStatus = 'configured' | 'disabled';

export interface CesiumIonTokenSink {
  defaultAccessToken: string;
}

export function readCesiumIonAccessToken(env: object): string | null {
  const token = String((env as Record<string, unknown>).VITE_CESIUM_ION_ACCESS_TOKEN ?? '').trim();
  return token.length > 0 ? token : null;
}

export function applyCesiumIonRuntimeConfiguration(
  ion: CesiumIonTokenSink,
  env: object,
): CesiumIonRuntimeStatus {
  const token = readCesiumIonAccessToken(env);
  if (token) {
    ion.defaultAccessToken = token;
    return 'configured';
  }
  // Empty string disables Cesium's bundled default token and the default-token warning.
  ion.defaultAccessToken = '';
  return 'disabled';
}
