import { splitWithBoundary } from "./splitWithBoundary.js";

export interface ExtractedChunk {
  section: string;
  content: string;
  relations: Array<{ type: string; target: string }>;
}

const EVIDENCE_MAX = 1000;
const EVIDENCE_OVERLAP = 150;

/**
 * Section detection for environmental permit evidence documents.
 */
export function detectSections(
  text: string,
  docType: string,
): Record<string, string> {
  const sections: Record<string, string> = {};

  if (docType === "decision") {
    const markers = [
      {
        name: "DOMSLUT_BESLUT",
        regex: /^(?:1\.\s+BESLUTETS\s+INNEB.RD|DOMSLUT|BESLUT)/i,
      },
      {
        name: "VILLKOR",
        regex: /^(?:2\.\s+VILLKOR|VILLKOR\s+OCH\s+F.RSIKTIGHETSM[ÅA]TT)/i,
      },
      {
        name: "UPPLYSNINGAR_ÖVERKLAGANDE",
        regex: /^(?:3\.\s+UPPLYSNINGAR|.VERKLAGANDE)/i,
      },
    ];
    partitionByMarkers(text, markers, "BAKGRUND", sections);
  } else if (docType === "mkb") {
    const markers = [
      {
        name: "LOKALISERINGSUTREDNING",
        regex: /^(?:1\.\s+L.KALISERINGSUTREDNING|PLATSVAL\s*$)/i,
      },
      {
        name: "BULLER_VIBRATIONER",
        regex: /^(?:2\.\s+N.RBOENDE|BULLER\s*$)/i,
      },
      {
        name: "VATTENMILJÖ_UTSLÄPP",
        regex: /^(?:3\.\s+VATTEN|RECEPIENT\s*$|VATTEN\s*$)/i,
      },
    ];
    partitionByMarkers(text, markers, "SAMMANFATTNING", sections);
  } else if (docType === "technical_description") {
    const markers = [
      {
        name: "PROCESSBESKRIVNING",
        regex: /^(?:1\.\s+PROCESSBESKRIVNING|DRIFT)/i,
      },
      {
        name: "RENINGSTEKNIK_FILTER",
        regex: /^(?:2\.\s+RENINGSTEKNIK|FILTER)/i,
      },
    ];
    partitionByMarkers(text, markers, "TEKNISK_ÖVERSIKT", sections);
  } else if (docType === "control_program") {
    const markers = [
      {
        name: "BULLERMÄTNING",
        regex: /^(?:1\.\s+BULLERM.TNING|AKUSTISK)/i,
      },
      {
        name: "VATTENKONTROLL",
        regex: /^(?:2\.\s+VATTENKONTROLL|GRUNDVATTEN|GW)/i,
      },
      {
        name: "ÅRSRAPPORTERING",
        regex: /^(?:3\.\s+.RSRAPPORTERING|RAPPORTERING)/i,
      },
    ];
    partitionByMarkers(text, markers, "EGENKONTROLL_INTRO", sections);
  } else {
    sections["GENERAL"] = text.trim();
  }

  return sections;
}

function partitionByMarkers(
  text: string,
  markers: readonly { name: string; regex: RegExp }[],
  initialSection: string,
  sections: Record<string, string>,
): void {
  let currentSection = initialSection;
  let currentContent: string[] = [];

  for (const line of text.split("\n")) {
    let foundMarker = false;
    for (const m of markers) {
      if (m.regex.test(line.trim())) {
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join("\n").trim();
        }
        currentSection = m.name;
        currentContent = [];
        foundMarker = true;
        break;
      }
    }
    if (!foundMarker) {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join("\n").trim();
  }
}

export function determineRelations(
  content: string,
  docType: string,
  section: string,
): Array<{ type: string; target: string }> {
  const relations: Array<{ type: string; target: string }> = [];

  if (docType === "decision" && section.includes("VILLKOR")) {
    if (/kontrollprogram/i.test(content) || /egenkontroll/i.test(content)) {
      relations.push({ type: "controlled_by", target: "control_program" });
    }
    if (/buller/i.test(content) || /dBA/i.test(content)) {
      relations.push({ type: "evaluated_in", target: "mkb_buller" });
    }
    if (/vatten|grundvatten/i.test(content)) {
      relations.push({ type: "evaluated_in", target: "mkb_water" });
    }
  }

  if (docType === "control_program") {
    if (/buller/i.test(content)) {
      relations.push({
        type: "monitors_condition",
        target: "decision_villkor_buller",
      });
    }
    if (/vatten|grundvatten|GW/i.test(content)) {
      relations.push({
        type: "monitors_condition",
        target: "decision_villkor_water",
      });
    }
  }

  if (docType === "mkb") {
    relations.push({ type: "supports_permit", target: "decision" });
  }

  if (docType === "technical_description") {
    relations.push({ type: "describes_facility_for", target: "decision" });
  }

  return relations;
}

/**
 * Evidence chunk generator with section metadata and relations (v2.3 boundary split).
 */
export function generateEvidenceChunks(
  text: string,
  docType: string,
): ExtractedChunk[] {
  const sectionsMap = detectSections(text, docType);
  const chunks: ExtractedChunk[] = [];

  for (const [section, content] of Object.entries(sectionsMap)) {
    if (content.length <= EVIDENCE_MAX) {
      chunks.push({
        section,
        content,
        relations: determineRelations(content, docType, section),
      });
    } else {
      const parts = splitWithBoundary(content, EVIDENCE_MAX, EVIDENCE_OVERLAP);
      parts.forEach((chunkText, i) => {
        chunks.push({
          section: `${section}_DEL_${i + 1}`,
          content: chunkText,
          relations: determineRelations(chunkText, docType, section),
        });
      });
    }
  }

  return chunks;
}
