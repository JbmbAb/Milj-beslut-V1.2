/**
 * Sewage Regulations Service
 * Implements Swedish environmental laws and regulations for private sewage systems
 *
 * References:
 * - Miljöbalken (1998:808)
 * - Förordningen (1998:899) om miljöfarlig verksamhet och hälsoskydd
 * - Havs- och vattenmyndighetens allmänna råd om små avloppsanordningar (HVMFS 2016:17)
 * - Vattendirektivet (2000/60/EG)
 * - Bassängdirektivet (91/271/EEG)
 * - Länsstyrelsens regionala vägledning
 * - Domstolsverket / MÖD praxis
 * - Dataportalens platsbundna underlag
 */

import type {
  SewageApplication,
  SewageProtectionProfile,
  SewageSystemTypeId,
  SewageRequirement,
  SewageSourceTracing,
} from '../../types';
import { listSewageEvidenceSources } from '../modules/legal/catalogs/sewageEvidenceSources';

export { listSewageEvidenceSources } from '../modules/legal/catalogs/sewageEvidenceSources';

// ============================================================================
// SWEDISH REGULATORY FRAMEWORK
// ============================================================================

export interface RegulatoryReference {
  law: string; // e.g., "Miljöbalken 32 kap"
  paragraph?: string; // e.g., "4 §"
  description: string;
  url?: string;
  sourceTracing: SewageSourceTracing;
}

export interface SewageRegulation {
  id: string;
  requirement: string;
  applicableTo: SewageSystemTypeId[];
  protectionLevel: 'NORMAL' | 'HIGH' | 'BOTH';
  distance?: {
    type: 'toWell' | 'toWaterCourse' | 'toPropertyLine' | 'toNeighborWell';
    minMeters: number;
    reason: string;
  };
  references: RegulatoryReference[];
  municipality?: string; // If local override
  deadline?: string; // If time-limited
}

/**
 * Comprehensive Swedish sewage regulations
 * Source: HVMFS 2016:17, Miljöbalken, FMH, regional vägledning och praxisnära underlag
 */
export const SEWAGE_REGULATIONS: SewageRegulation[] = [
  // ========== MILJÖBALKEN 32 KAP (Environmental Code Chapter 32) ==========
  {
    id: 'MB-32-4-well-distance',
    requirement: 'Avloppsanordning måste ligga minst 50 meter från egen brunn eller vattentäkt',
    applicableTo: ['INFILTRATION', 'SOIL_BED'],
    protectionLevel: 'NORMAL',
    distance: {
      type: 'toWell',
      minMeters: 50,
      reason: 'Skydda dricksvattnets kvalitet (Miljöbalken 32:4)',
    },
    references: [
      {
        law: 'Miljöbalken (1998:808)',
        paragraph: '32:4',
        description: 'Privatbrunnar och toaletter – avloppsanordning minst 50 m från brunn',
        url: 'https://www.riksdagen.se/sv/dokument-lagar/dokument/svensk-forfattningssamling/miljobalk-1998808_sfs-1998-808',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '1998:808',
        },
      },
    ],
  },

  {
    id: 'MB-32-4-property-line-distance',
    requirement: 'Avloppsanordning måste ligga minst 4,5 meter från tomtgräns',
    applicableTo: [
      'CLOSED_TANK',
      'INFILTRATION',
      'SOIL_BED',
      'MINI_PLANT_BDTA',
      'MINI_PLANT_BDT',
      'PHOSPHORUS_TRAP',
    ],
    protectionLevel: 'NORMAL',
    distance: {
      type: 'toPropertyLine',
      minMeters: 4.5,
      reason: 'Grannes rätt till lugn och ro, möjlighet för framtida utbyggnad (Miljöbalken 32:4)',
    },
    references: [
      {
        law: 'Miljöbalken (1998:808)',
        paragraph: '32:4',
        description: 'Minimalt avstånd till tomtgräns för grannskaps skull',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '1998:808',
        },
      },
    ],
  },

  {
    id: 'MB-32-water-course-distance',
    requirement:
      'Minst 10 meter från vattendrag för infiltration, minst 50 meter för recipientkänsliga områden',
    applicableTo: ['INFILTRATION', 'SOIL_BED'],
    protectionLevel: 'NORMAL',
    distance: {
      type: 'toWaterCourse',
      minMeters: 10,
      reason: 'Skydda vattendragets ekologiska status (Vattendirektivet 2000/60/EG)',
    },
    references: [
      {
        law: 'Vattendirektivet (2000/60/EG)',
        description: 'Goda ekologiska och kemiska statusar för vattendrag',
        url: 'https://eur-lex.europa.eu/legal-content/SV/TXT/?uri=CELEX:32000L0060',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '2000',
        },
      },
    ],
  },

  // ========== HAVS- OCH VATTENMYNDIGHETENS ALLMÄNNA RÅD (HVMFS 2016:17) ==========
  {
    id: 'NFS-2016-soil-test',
    requirement:
      'Perkolationsprov (TB145) krävs för infiltrations- och markbäddssystem för att fastställa LTAR (Loading Rate)',
    applicableTo: ['INFILTRATION', 'SOIL_BED'],
    protectionLevel: 'BOTH',
    references: [
      {
        law: 'Havs- och vattenmyndighetens allmänna råd',
        paragraph: 'HVMFS 2016:17',
        description: 'Små avloppsanordningar kräver platsbedömning med markundersökning och perkolationsprov.',
        url: 'https://www.havochvatten.se/vagledning-foreskrifter-och-lagar/foreskrifter/register-avlopp/sma-avloppsanordningar-for-hushallsspillvatten-hvmfs-201617.html',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: 'HVMFS 2016:17',
        },
      },
    ],
  },

  {
    id: 'NFS-2016-high-protection-area',
    requirement:
      'I högt skyddade områden (vattenskyddsområde, Natura 2000) krävs minireningsverk med kemfällning (BDTA) eller bättre',
    applicableTo: ['MINI_PLANT_BDTA', 'PHOSPHORUS_TRAP'],
    protectionLevel: 'HIGH',
    references: [
      {
        law: 'Havs- och vattenmyndighetens allmänna råd',
        paragraph: 'HVMFS 2016:17',
        description: 'Hög skyddsnivå kräver skärpt plats- och teknikbedömning i känsliga områden.',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: 'HVMFS 2016:17',
        },
      },
    ],
  },

  // ========== BASSINBADSDIREKTIVET (91/271/EEG) ==========
  {
    id: 'EU-Bathing-sensitive-area',
    requirement:
      'I känsliga områden (recipientkänsliga eller för badvattenkvalitet) krävs full behandling innan infiltration',
    applicableTo: ['MINI_PLANT_BDTA'],
    protectionLevel: 'HIGH',
    references: [
      {
        law: 'Bassinbadsdirektivet (91/271/EEG)',
        description: 'Skydd av känsliga mottagarvatten',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '1991',
        },
      },
    ],
  },

  // ========== GRANNEKONSENT (Neighbour Consent) ==========
  {
    id: 'neighbor-consent-well',
    requirement: 'Grannemedgivande krävs om avloppsanordningen ligger närmare än 50 m från grannens brunn',
    applicableTo: ['INFILTRATION', 'SOIL_BED', 'MINI_PLANT_BDT', 'MINI_PLANT_BDTA'],
    protectionLevel: 'NORMAL',
    distance: {
      type: 'toNeighborWell',
      minMeters: 50,
      reason: 'Granns rätt att förlita sig på brunnskvalitet',
    },
    references: [
      {
        law: 'Miljöbalken (1998:808)',
        paragraph: '32:7',
        description: 'Grannesamråd och medgivande för avloppsanordninga inom närhet av brunnar',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '1998',
        },
      },
    ],
  },

  {
    id: 'neighbor-consent-property-line',
    requirement:
      'Grannemedgivande kan krävas om anordningen ligger närmare än 4,5 m från tomtgräns (kommun-specifikt)',
    applicableTo: ['INFILTRATION', 'SOIL_BED'],
    protectionLevel: 'NORMAL',
    distance: {
      type: 'toPropertyLine',
      minMeters: 4.5,
      reason: 'Grannskapsrättslig praxis – risk för skador på granns fastighet',
    },
    references: [
      {
        law: 'Grannskapslagen / sedvaniära grannskapsrätter',
        description: 'Domstolspraxis för grannkonflikter kring avlopp',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: 'Sedvänja',
        },
      },
    ],
  },

  // ========== MARK- OCH MILJÖDOMSTOLSPRAXIS ==========
  {
    id: 'court-infiltration-depth',
    requirement: 'Markbädd/infiltration kräver minst 0,5 m djup till grundvatten för rening',
    applicableTo: ['INFILTRATION', 'SOIL_BED'],
    protectionLevel: 'NORMAL',
    references: [
      {
        law: 'Mark- och miljödomstolspraxis',
        description: 'Se t.ex. Dom MÖD 2018:38 om infiltrationssystems efektivitet',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '2018',
        },
      },
    ],
  },

  {
    id: 'court-tank-emptying',
    requirement: 'Sluten tank måste tömmas regelbundet – ansökan måste visa avtalad tomningsservice',
    applicableTo: ['CLOSED_TANK'],
    protectionLevel: 'BOTH',
    references: [
      {
        law: 'Praxis från bygglovsprövning',
        description: 'Kommuner kräver servicekontrakt för tankav tankar',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: 'Sedvänja',
        },
      },
    ],
  },

  // ========== ÅTGÄRDER MOT FOSFORBELASTNING ==========
  {
    id: 'phosphorus-sensitive-recipient',
    requirement:
      'Fosforfälla eller motsvarande åtgärd krävs för att reducera P-utsläpp till känsliga mottagare',
    applicableTo: ['PHOSPHORUS_TRAP'],
    protectionLevel: 'HIGH',
    references: [
      {
        law: 'Miljöbalken 32 kap',
        description: 'Ansökan måste visa åtgärder för att minimera fosforutsläpp',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '1998',
        },
      },
      {
        law: 'Naturvårdsverkets rapporter',
        description: 'Ofta rekommenderat i phosphor-känsliga sjöar och vattendrag',
        sourceTracing: {
          source: 'LOCAL_RULES',
          timestamp: new Date().toISOString(),
          version: '2020',
        },
      },
    ],
  },
];

/**
 * Generate comprehensive requirement checklist based on system type, location, and protection level
 */
export function generateSewageRequirementChecklist(
  systemType: SewageSystemTypeId,
  protectionLevel: 'NORMAL' | 'HIGH',
  municipalityCode: string,
  distanceData?: {
    toWell?: number;
    toPropertyLine?: number;
    toWaterCourse?: number;
    toNeighborWell?: number;
  },
): SewageRequirement[] {
  const requirements: SewageRequirement[] = [];
  const now = new Date().toISOString();

  // Filter regulations applicable to this system and protection level
  const applicableRegs = SEWAGE_REGULATIONS.filter(
    (reg) =>
      reg.applicableTo.includes(systemType) &&
      (reg.protectionLevel === 'BOTH' || reg.protectionLevel === protectionLevel),
  );

  applicableRegs.forEach((reg) => {
    // Check if distance requirement is met (if applicable)
    let status: SewageRequirement['status'] = 'DRAFT';
    let blockingFactor: string | undefined;

    if (reg.distance && distanceData) {
      const actualDistance = distanceData[reg.distance.type as keyof typeof distanceData];
      if (actualDistance !== undefined && actualDistance < reg.distance.minMeters) {
        status = 'BLOCKED';
        blockingFactor = `Faktiskt avstånd: ${actualDistance}m (krav: ${reg.distance.minMeters}m)`;
      } else if (actualDistance !== undefined) {
        status = 'COMPLETED';
      }
    }

    const requirement: SewageRequirement = {
      id: reg.id,
      category:
        reg.distance?.type === 'toWell' || reg.distance?.type === 'toPropertyLine'
          ? 'DISTANCE'
          : reg.id.includes('soil') || reg.id.includes('perkolation')
            ? 'SOIL'
            : reg.id.includes('consent')
              ? 'NEIGHBOR'
              : 'DESIGN',
      requirement: reg.requirement,
      reason: reg.references[0]?.description || 'Svensk miljölagstiftning',
      status,
      priority: reg.id.includes('well') || reg.id.includes('property-line') ? 'HIGH' : 'MEDIUM',
      applicableTo: reg.applicableTo,
      relatedMunicipalCode: municipalityCode,
      sourceTracing: reg.references[0]?.sourceTracing || {
        source: 'LOCAL_RULES',
        timestamp: now,
        version: '2024',
      },
    };

    if (blockingFactor) {
      requirement.blockingFactor = blockingFactor;
    }

    requirements.push(requirement);
  });

  return requirements;
}

/**
 * Validate sewage application against regulations
 */
export function validateSewageApplicationRegulations(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
): {
  isCompliant: boolean;
  violations: string[];
  warnings: string[];
  recommendations: string[];
} {
  const violations: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  const systemType = application.selectedSystemType;
  const protectionLevel = protectionProfile.protectionLevel;

  // Check well distance (50m minimum)
  if (['INFILTRATION', 'SOIL_BED'].includes(systemType) && protectionProfile.nearestWell.distance < 50) {
    violations.push(
      `Avlopp ligger endast ${protectionProfile.nearestWell.distance}m från brunn. Krav: minst 50m (Miljöbalken 32:4).`,
    );
  }

  // Check property line distance (4.5m minimum)
  if (protectionProfile.distanceToPropertyLine < 4.5) {
    violations.push(
      `Avlopp ligger endast ${protectionProfile.distanceToPropertyLine}m från tomtgräns. Krav: minst 4,5m (Miljöbalken 32:4).`,
    );
  }

  // Check soil test for infiltration systems
  if (['INFILTRATION', 'SOIL_BED'].includes(systemType) && !application.soilTestCompleted) {
      violations.push(
        `Infiltrations-/markbäddssystem kräver perkolationsprov (TB145) för att fastställa LTAR (HVMFS 2016:17).`,
      );
    }

  // Check protection level compatibility
  if (protectionLevel === 'HIGH' && ['INFILTRATION', 'SOIL_BED'].includes(systemType)) {
    violations.push(
      `Infiltration/markbädd är inte tillåten i högt skyddade områden. Kräver minireningsverk med kemfällning (BDTA).`,
    );
  }

  // Neighbor consent checks
  if (protectionProfile.nearestWell.owner === 'NEIGHBOR' && protectionProfile.nearestWell.distance < 50) {
    if (!application.neighborConsentObtained) {
      violations.push(
        `Grannens brunn ligger endast ${protectionProfile.nearestWell.distance}m bort. Grannemedgivande är OBLIGATORISKT.`,
      );
    }
  }

  // Warnings
  if (protectionProfile.soilProfile.infiltrationCapacity === 'LOW') {
    warnings.push(
      `Jorden har låg infiltrationskapacitet. Markbädd/infiltration är inte lämpligt – minireningsverk rekommenderas.`,
    );
  }

  if (protectionProfile.floodRisk === 'MEDIUM' || protectionProfile.floodRisk === 'HIGH') {
    warnings.push(
      `Risk för översvämning på platsen. Dimensionering måste säkra mot vattenpåslag (översvämning ${protectionProfile.floodRisk.toLowerCase()}).`,
    );
  }

  // Recommendations
  if (protectionLevel === 'HIGH') {
    recommendations.push(
      `Högt skyddad område – rekommenderas att kontakta länstyrelsen för eventuella ytterligare krav före inskickning.`,
    );
  }

  if (protectionProfile.protectedNatureNearby && ['INFILTRATION', 'SOIL_BED'].includes(systemType)) {
    recommendations.push(
      `Naturvårdsområde nära fastigheten. Fosforfälla eller motsvarande åtgärd rekommenderas för att minimera miljöpåverkan.`,
    );
  }

  return {
    isCompliant: violations.length === 0,
    violations,
    warnings,
    recommendations,
  };
}

/**
 * Get municipal-specific regulations (override national standards if more strict)
 */
export async function getMunicipalRegulations(_municipalityCode: string): Promise<SewageRegulation[]> {
  // In production: fetch from database of municipal rules
  // For now: return national standards
  return SEWAGE_REGULATIONS;
}

/**
 * Generate source tracing for all regulatory references
 */
export function generateRegulatorySourceTracing(): SewageSourceTracing[] {
  const now = new Date().toISOString();
  const versions = listSewageEvidenceSources().map((item) => item.title);
  return versions.map((version) => ({
    source: 'LOCAL_RULES',
    timestamp: now,
    version,
  }));
}
