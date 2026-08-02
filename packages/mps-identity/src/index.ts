// 📦 Paket 16 – Mimer Sovereign Identity (kodspec)

// ---------- Brand Layer ----------

export interface BrandPrinciples {
  readonly outerCircleMeaning: string;   // "system integrity"
  readonly innerRingMeaning: string;     // "traceability and continuity"
  readonly centerMeaning: string;        // "knowledge core / Mimer's well"
  readonly compassMeaning: string;       // "direction through verifiable governance"
  readonly palette: ColorSystem;
}

export interface ColorToken {
  readonly name: string;
  readonly hex: string;
  readonly role: string;
}

export interface ColorSystem {
  readonly coreTurquoise: ColorToken;
  readonly coreCyan: ColorToken;
  readonly coreGraphite: ColorToken;
  readonly flowLightCyan: ColorToken;
  readonly surfaceDarkStone: ColorToken;
  readonly statusOk: ColorToken;
  readonly statusWarn: ColorToken;
  readonly statusError: ColorToken;
  readonly statusAudit: ColorToken;
  readonly statusReplay: ColorToken;
  readonly statusRuntime: ColorToken;
}

// ---------- Architecture Layer ----------

export interface SemanticMappingEntry {
  readonly symbol: string;
  readonly mpsPrinciple: string;
}

export interface SemanticMapping {
  readonly entries: readonly SemanticMappingEntry[];
}

// ---------- Non-Goals ----------

export interface NonGoals {
  readonly shallNotEncodeSoftwareVersions: boolean;
  readonly shallNotEncodePackageNumbers: boolean;
  readonly shallNotEncodeDeploymentTopology: boolean;
  readonly shallNotEncodeImplementationDetails: boolean;
  readonly shallNotChangeMeaningBetweenReleases: boolean;
}

// ---------- Identity Evolution Contract ----------

export interface IdentityEvolutionContract {
  readonly mayEvolveCraftsmanship: boolean;
  readonly mayEvolveClarity: boolean;
  readonly mayEvolveAccessibility: boolean;
  readonly shallKeepSemanticMeaningStable: boolean;
}

// ---------- Typography ----------

export interface TypographyTokens {
  readonly headingFontFamily: string;
  readonly bodyFontFamily: string;
  readonly monoFontFamily: string;
  readonly weightBold: number;
  readonly weightRegular: number;
}

// ---------- Iconography ----------

export interface IconToken {
  readonly name: string;
  readonly description: string;
}

export interface IconographyTokens {
  readonly registry: IconToken;
  readonly runtime: IconToken;
  readonly replay: IconToken;
  readonly audit: IconToken;
  readonly policy: IconToken;
  readonly telemetry: IconToken;
  readonly evolution: IconToken;
  readonly scheduler: IconToken;
}

// ---------- Motion Language ----------

export interface MotionTokens {
  readonly compassPulseDurationMs: number;
  readonly ringRotationDurationMs: number;
  readonly maxAmplitudePx: number;
  readonly prefersReducedMotionRespect: boolean;
}

// ---------- Spatial Grid ----------

export interface SpatialGridTokens {
  readonly baseUnitPx: number;
  readonly radiusOuter: number;
  readonly radiusInner: number;
  readonly radiusCenter: number;
}

// ---------- Accessibility ----------

export interface AccessibilityTokens {
  readonly minContrastRatio: number;
  readonly supportsReducedMotion: boolean;
  readonly iconIndependentOfColor: boolean;
}

// ---------- Design Tokens Root ----------

export interface DesignTokens {
  readonly colors: ColorSystem;
  readonly typography: TypographyTokens;
  readonly iconography: IconographyTokens;
  readonly motion: MotionTokens;
  readonly grid: SpatialGridTokens;
  readonly accessibility: AccessibilityTokens;
}

// ---------- Console Theme ----------

export interface ConsoleTheme {
  readonly tokens: DesignTokens;
  readonly backgroundColor: string;
  readonly surfaceColor: string;
  readonly textColor: string;
  readonly accentColor: string;
}

// ---------- Identity Spec Root ----------

export interface MimerIdentitySpec {
  readonly brandPrinciples: BrandPrinciples;
  readonly semanticMapping: SemanticMapping;
  readonly nonGoals: NonGoals;
  readonly evolutionContract: IdentityEvolutionContract;
  readonly designTokens: DesignTokens;
  readonly consoleTheme: ConsoleTheme;
}

export const designTokens = {
  colors: {
    surfaceDarkStone: { hex: '#1C1C1E' },
    coreTurquoise: { hex: '#40E0D0' },
    flowLightCyan: { hex: '#E0FFFF' },
    coreGraphite: { hex: '#2C2C2E' },
    statusAudit: { hex: '#F0E68C' }
  }
} as any;
