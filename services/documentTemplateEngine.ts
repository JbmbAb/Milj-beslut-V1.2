export type TemplateVariables = {
  projectName: string;
  municipality: string;
  wasteTypes: string[];
  totalVolumeTons: number;
  riskScore: string;
  riskFactors: string[];
  aiMitigationAdvice?: string;
};

/**
 * Dokument-autogenerering 2.0 (Template Engine)
 *
 * Istället för att låta LLM:en uppfinna eller omformulera den juridiska och
 * formatmässiga rapportstrukturen (hallucinationsrisk), så fyller vi i en
 * hårdkodad och juridiskt granskad mall. AI:n hjälper bara till att ta fram
 * själva parametrarna (rådatan) som injiceras.
 */
export const renderCompliancePlanTemplate = (vars: TemplateVariables): string => {
  const dateStr = new Date().toISOString().split('T')[0];
  const factorsStr =
    vars.riskFactors.length === 0
      ? '  - Inga förhöjda risker identifierades under regelmotorns granskning.'
      : vars.riskFactors.map((f) => `  - ${f}`).join('\n');

  return `
============================================================
           MILJÖKONTROLLPLAN & PROJEKTBESKRIVNING
============================================================

Dokument-ID:   SEC-${Date.now().toString().slice(-6)}
Genererat:     ${dateStr}
Avser projekt: ${vars.projectName}
Kommun:        ${vars.municipality}

1. BAKGRUND OCH SYFTE
------------------------------------------------------------
Detta dokument utgör den formella kontrollplanen för hantering 
och mellanlagring av avfallsmassor inom projektet "${vars.projectName}", 
beläget i ${vars.municipality}. 

Syftet är att säkerställa att arbetet bedrivs i enlighet 
med Miljöbalken (1998:808) och gällande branschpraxis (t.ex. 
Naturvårdsverkets handbok för hantering av schaktmassor).


2. OMFATTNING
------------------------------------------------------------
Verksamheten omfattar formell hantering och transport av 
totalt ca ${vars.totalVolumeTons} ton massor.
Följande avfallskoder (EWC/Avfallsförordningen) misstänks eller
har uppmätts:
  > ${vars.wasteTypes.join(', ')}


3. MILJÖRISKANALYS
------------------------------------------------------------
Efter systemets Hybrid AI- och logistikanalys bedöms projektets 
generella risk- och compliance-nivå till: [ ${vars.riskScore} ]

Identifierade faktorer och sårbarheter som måste hanteras 
inom ramen för entreprenörens egenkontroll:
${factorsStr}


4. RISKMINIMERANDE ÅTGÄRDER OCH RÅDGIVNING
------------------------------------------------------------
${vars.aiMitigationAdvice || 'Inväntar detaljerad rådgivning från AI-modulen.'}

============================================================
Detta är ett systemgenererat beslutsunderlag. Ansvarig för 
verksamheten (Verksamhetsutövaren) bär enligt 2 kap. Miljöbalken 
slutgiltigt ansvar för att åtgärderna är tillräckliga.
`;
};
