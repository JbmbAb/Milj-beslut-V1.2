/**
 * feature-flags.ts
 *
 * Avancerad, miljö- och användarspecifik Feature Flags-tjänst för kontrollerad utrullning.
 * Stöder:
 *   - Miljöspecifika begränsningar (dev/staging/prod)
 *   - Användarspecifik utrullning (tillåtna användar-IDn)
 *   - Deterministisk procentuell utrullning per användare (dark launches)
 */

export interface FeatureFlagConfig {
  enabled: boolean;
  environments?: string[];       // t.ex. ['dev', 'staging']
  allowedUserIds?: string[];     // Användar-IDn som alltid har tillgång
  rolloutPercentage?: number;    // Procentuell utrullning (0-100) för allmänna användare
}

export interface FeatureFlagContext {
  userId?: string;
  environment?: string;          // Om ej angiven, läses process.env.NODE_ENV
}

// Standardkonfigurationer för plattformens nya funktioner under migrering
const DEFAULT_FLAGS: Record<string, FeatureFlagConfig> = {
  'mvp-sewage-assessment': {
    enabled: true,
    environments: ['development', 'test', 'staging'],
    rolloutPercentage: 100,
  },
  'mvp-c-anmalan': {
    enabled: true,
    environments: ['development', 'test', 'staging', 'production'],
    allowedUserIds: ['beta-tester-1', 'admin-user'],
    rolloutPercentage: 10, // Dark launch: 10 % av vanliga användare i produktion
  },
  'mvp-localization-report': {
    enabled: true,
    environments: ['development', 'test'],
    rolloutPercentage: 100,
  },
  'new-ai-orchestration': {
    enabled: false, // Helt avstängd i produktion, aktiv i dev/test
    environments: ['development', 'test'],
  },
  'show-logistics-workspace': {
    enabled: false,
    environments: ['development', 'test'],
    rolloutPercentage: 100,
  },
  'show-project-manager': {
    enabled: false,
    environments: ['development', 'test'],
    rolloutPercentage: 100,
  },
  'show-compliance-audit': {
    enabled: false,
    environments: ['development', 'test'],
    rolloutPercentage: 100,
  },
  'show-admin-console': {
    enabled: false,
    environments: ['development', 'test'],
    rolloutPercentage: 100,
  },
};

export class FeatureFlagService {
  private flags = new Map<string, FeatureFlagConfig>();

  constructor() {
    // Ladda standardflaggor
    for (const [key, config] of Object.entries(DEFAULT_FLAGS)) {
      this.flags.set(key, config);
    }
    // Möjliggör override via miljövariabler, t.ex. FEATURE_FLAG_MVP_SEWAGE=true
    this.loadFromEnv();
  }

  private loadFromEnv(): void {
    if (typeof process === 'undefined' || !process.env) return;

    for (const [envKey, val] of Object.entries(process.env)) {
      if (envKey.startsWith('FEATURE_FLAG_')) {
        const flagKey = envKey
          .slice('FEATURE_FLAG_'.length)
          .toLowerCase()
          .replace(/_/g, '-');
        
        const enabled = val?.trim().toLowerCase() === 'true';
        const existing = this.flags.get(flagKey);

        if (existing) {
          existing.enabled = enabled;
        } else {
          this.flags.set(flagKey, { enabled });
        }
      }
    }
  }

  /**
   * Beräknar en stabil, deterministisk procentsats (0-99) för en användare och flagga.
   * Garanterar att samma användare alltid får samma utfall för en specifik flagga.
   */
  private getUserHashPercentage(userId: string, flagName: string): number {
    const key = `${userId}:${flagName}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash |= 0; // Gör det till ett 32-bitars heltal
    }
    return Math.abs(hash) % 100;
  }

  /**
   * Kontrollerar om en feature flag är aktiv för givet sammanhang.
   */
  isEnabled(flagName: string, context?: FeatureFlagContext): boolean {
    const config = this.flags.get(flagName);
    if (!config) {
      return false;
    }

    // 1. Grundläggande huvudströmbrytare
    if (!config.enabled) {
      return false;
    }

    // Hämta och normalisera miljö
    const currentEnv =
      context?.environment || process.env.NODE_ENV || 'development';

    // 2. Kontrollera miljöbegränsning
    if (config.environments && config.environments.length > 0) {
      if (!config.environments.includes(currentEnv)) {
        return false;
      }
    }

    // 3. Kontrollera om användaren är explicit tillåten (vitlistad)
    if (context?.userId && config.allowedUserIds) {
      if (config.allowedUserIds.includes(context.userId)) {
        return true;
      }
    }

    // 4. Kontrollera procentuell utrullning
    if (config.rolloutPercentage !== undefined) {
      if (config.rolloutPercentage >= 100) {
        return true;
      }
      if (config.rolloutPercentage <= 0) {
        return false;
      }
      if (!context?.userId) {
        // Om användar-ID saknas vid procentuell utrullning, faller vi tillbaka till false
        return false;
      }
      const userPercent = this.getUserHashPercentage(context.userId, flagName);
      return userPercent < config.rolloutPercentage;
    }

    return true;
  }

  /**
   * Manuellt sätta eller ändra en flaggkonfiguration (användbart för dynamisk administration eller tester).
   */
  setFlag(flagName: string, config: FeatureFlagConfig): void {
    this.flags.set(flagName, config);
  }

  /**
   * Återställer flaggkonfigurationen till standard (främst för enhetstester).
   */
  resetToDefaults(): void {
    this.flags.clear();
    for (const [key, config] of Object.entries(DEFAULT_FLAGS)) {
      this.flags.set(key, { ...config });
    }
    this.loadFromEnv();
  }
}

export const featureFlags = new FeatureFlagService();
