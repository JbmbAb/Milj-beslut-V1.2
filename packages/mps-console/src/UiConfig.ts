export interface UiConfig {
  /** When true, AppShell shows TechnicalDashboardHub + mode cards. Default false. */
  readonly enableLegacyUi: boolean;
}

function readLegacyFlag(): boolean {
  try {
    const vite = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_ENABLE_LEGACY_UI;
    if (vite === '1' || vite === 'true') return true;
  } catch {
    /* ignore */
  }
  if (typeof process !== 'undefined') {
    const v = process.env?.VITE_ENABLE_LEGACY_UI ?? process.env?.ENABLE_LEGACY_UI;
    if (v === '1' || v === 'true') return true;
  }
  return false;
}

export const uiConfig: UiConfig = {
  enableLegacyUi: readLegacyFlag(),
};
