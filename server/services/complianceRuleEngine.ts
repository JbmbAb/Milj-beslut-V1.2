import type { GeologicalData } from "./sguService";
import type { ProtectedArea } from "./nvrService";
import type { Monument } from "./raaService";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCK";

export interface ComplianceRuleResult {
  ruleId: string;
  chapter: string;
  title: string;
  risk: RiskLevel;
  description: string;
  recommendation: string;
}

export interface SiteAnalysis {
  overallRisk: RiskLevel;
  permitProbability: number;
  restrictions: string[];
  rules: ComplianceRuleResult[];
  summary: string;
}

/**
 * Environmental Code rule engine.
 * Converts spatial indicators into advisory compliance signals.
 * Outputs are screening only and do not replace legal or technical review.
 */
export function evaluateComplianceRules(
  observations: Array<{ name?: string; status?: string }>,
  protectedAreas: ProtectedArea[],
  geological: GeologicalData,
  monuments: Monument[],
  distanceToWater: number = 200,
): SiteAnalysis {
  const rules: ComplianceRuleResult[] = [];
  const restrictions: string[] = [];

  const reserves = protectedAreas.filter((area) => area.type.toLowerCase().includes("reservat"));
  if (reserves.length > 0) {
    restrictions.push("Naturreservat");
    rules.push({
      ruleId: "MB_7_KAP_RESERVAT",
      chapter: "7 kap MB",
      title: "Skyddade omraden (naturreservat)",
      risk: "BLOCK",
      description: `Projektet overlappar eller gransar till ${reserves[0].name}.`,
      recommendation: "Mycket lag tillstandschans. Juridisk dispensprovning kravs innan fortsatt projektering.",
    });
  }

  const natura2000 = protectedAreas.filter((area) => area.type.toLowerCase().includes("natura"));
  if (natura2000.length > 0) {
    restrictions.push("Natura 2000");
    rules.push({
      ruleId: "MB_7_KAP_N2K",
      chapter: "7 kap MB",
      title: "Natura 2000",
      risk: "HIGH",
      description: `Projektet beror Natura 2000-omrade ${natura2000[0].name}.`,
      recommendation: "Sarskild Natura 2000-provning och manuell juridisk kontroll kravs.",
    });
  }

  if (distanceToWater < 100) {
    restrictions.push("Strandskydd");
    rules.push({
      ruleId: "MB_7_KAP_STRAND",
      chapter: "7 kap MB",
      title: "Strandskydd",
      risk: "HIGH",
      description: `Avstand till vatten ar ${distanceToWater} m och ligger inom normal strandskyddszon.`,
      recommendation: "Dispensprovning kravs. Verifiera avstand och tillampning manuellt.",
    });
  }

  if (String(geological.groundwaterVulnerability || "").toLowerCase().includes("hog")) {
    restrictions.push("Kansligt grundvatten");
    rules.push({
      ruleId: "MB_9_KAP_GRUNDVATTEN",
      chapter: "9 kap MB",
      title: "Grundvatten och fororeningsrisk",
      risk: "MEDIUM",
      description: "Omradet har hog grundvattensarbarhet enligt tillgangligt underlag.",
      recommendation: "Hydrogeologisk utredning och manuell kontroll av skyddsatgarder bor goras innan beslut.",
    });
  }

  if ((geological.landslideFeatureHits?.length || 0) > 0) {
    const nearest = geological.landslideFeatureHits![0];
    const risk: RiskLevel = geological.landslideRiskLevel === "HIGH" ? "HIGH" : "MEDIUM";
    restrictions.push("SGU skred/ravinindikator");
    rules.push({
      ruleId: "SGU_SKRED_RAVIN_ADVISORY",
      chapter: "2 kap MB",
      title: "Geoteknisk forsiktighetsindikator (SGU)",
      risk,
      description: `${nearest.featureLabel} identifierad inom ${Math.round(nearest.distanceMeters)} m. ${
        geological.coverageMode === "sample"
          ? "Lokal SGU-databas ar i stickprovslage och far inte tolkas som komplett negativt bevis."
          : "Traffen ar radgivande och kravs manuell verifiering."
      }`,
      recommendation:
        "Human in the loop: lat ansvarig handlaggare och vid behov geoteknisk expert verifiera traffen innan slutsats eller villkor satts.",
    });
  }

  const redListed = observations.filter((observation) =>
    String(observation.status || "").includes("Rod") || String(observation.status || "").includes("Frid"),
  );
  if (redListed.length > 0) {
    restrictions.push("Artskydd");
    rules.push({
      ruleId: "ARTSKYDD_REG",
      chapter: "2 kap 6 § MB",
      title: "Artskydd",
      risk: "MEDIUM",
      description: `Skyddsvard art (${redListed[0].name || "okand art"}) finns i underlaget.`,
      recommendation: "Komplettera med manuell art- och habitatbedomning innan fortsatt beslut.",
    });
  }

  if (monuments.length > 0) {
    restrictions.push("Kulturmiljo");
    rules.push({
      ruleId: "KULTUR_RAA",
      chapter: "2 kap 6 § MB / KML",
      title: "Kulturmiljo och fornlämningar",
      risk: "HIGH",
      description: `Fornlamning (${monuments[0].name}) ar identifierad pa eller vid platsen.`,
      recommendation: "Markingrepp far inte ske utan manuell kontroll och kontakt med Lansstyrelsen.",
    });
  }

  let permitProbability = 0.95;
  if (restrictions.includes("Naturreservat")) permitProbability = Math.min(permitProbability, 0.05);
  else if (restrictions.includes("Kulturmiljo")) permitProbability = Math.min(permitProbability, 0.2);
  else if (restrictions.includes("Natura 2000")) permitProbability = Math.min(permitProbability, 0.25);
  else if (restrictions.includes("Strandskydd")) permitProbability = Math.min(permitProbability, 0.45);
  else if (restrictions.includes("SGU skred/ravinindikator")) permitProbability = Math.min(permitProbability, 0.6);
  else if (restrictions.includes("Kansligt grundvatten")) permitProbability = Math.min(permitProbability, 0.7);

  let overallRisk: RiskLevel = "LOW";
  if (rules.some((rule) => rule.risk === "BLOCK")) overallRisk = "BLOCK";
  else if (rules.some((rule) => rule.risk === "HIGH")) overallRisk = "HIGH";
  else if (rules.some((rule) => rule.risk === "MEDIUM")) overallRisk = "MEDIUM";

  return {
    overallRisk,
    permitProbability,
    restrictions,
    rules,
    summary: `Analysen identifierade ${restrictions.length} restriktioner eller varningssignaler. Samlad riskklassning: ${overallRisk}.`,
  };
}
