/**
 * PRODUCT-UI-LEGACY-ISOLATION-01.
 *
 * Server-side authorization must never be decided by client/UI configuration --
 * `uiConfig.enableLegacyUi` (Vite build config) controls what the browser renders, not what
 * the server accepts. A route family that is only reachable through hidden legacy UI is still
 * fully callable by anyone holding a valid bearer token, regardless of which UI they were
 * issued it from. This is the server's own, independent policy: default false, false in RC1,
 * and only ever true via an explicit opt-in a developer sets deliberately for local work on
 * these out-of-scope modules.
 */
export function isLegacyRoutesEnabled(): boolean {
  return String(process.env.LEGACY_ROUTES_ENABLED || '').trim().toLowerCase() === 'true';
}
