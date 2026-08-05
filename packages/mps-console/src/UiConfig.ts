export interface UiConfig {
  readonly enableLegacyUi: boolean; // SHALL be false in production
}

export const uiConfig: UiConfig = {
  enableLegacyUi: true,
};
