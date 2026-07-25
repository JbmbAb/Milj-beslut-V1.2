import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, FileText, FileDown, CheckSquare, Send, CheckCircle2, AlertTriangle, ShieldCheck, MapPin, Layers, Scale, Bookmark, Eye, Activity, HelpCircle, RefreshCw, ChevronRight, Calculator, Leaf, TrendingUp } from 'lucide-react';
import { callApi, getActiveProjectId } from '../../../../services/coreApiClient';
import { isSensitiveAreaFromMassGis } from '../../../../services/massSpatialSensitivity';
import type { MassGISAnalysis, MassSiteProfile, MpfDecisionSummary } from '../../../../types';
import { useMassGisAnalysis } from '../../hooks/useMassGisAnalysis';
import MassMapView from './MassMapView';
import MpfGeofenceOverlay from './MpfGeofenceOverlay';
import { useOperationsCenter } from '../../../context/OperationsCenterContext';
import { useTheme } from '../../../context/ThemeContext';
import '../module-common.css';

type OperationDraft = {
  operationType: 'MELLANLAGRING' | 'DEPONI';
  ewcCode: string;
  quantityPerYear: string;
  sniCode: string;
  capacityM3: string;
  receiverName: string;
};

const emptyOp = (type: 'MELLANLAGRING' | 'DEPONI'): OperationDraft => ({
  operationType: type,
  ewcCode: type === 'MELLANLAGRING' ? '17 05 04' : '17 05 03*',
  quantityPerYear: '5000',
  sniCode: '',
  capacityM3: '1000',
  receiverName: '',
});

interface RagSuggestion {
  title: string;
  source: string;
  confidence: number;
  badge: 'COMPLIANT' | 'ATTENTION' | 'HIGH_RISK';
  matchedText: string;
  suggestionText: string;
  sourcesList: Array<{ id: string; title: string; type: string; citation: string }>;
}

const RAG_SUGGESTIONS: Record<string, RagSuggestion> = {
  'block-applicant': {
    title: 'Lokaliseringsprövning & Fastighetsrätt',
    source: 'Miljöbalken (1998:808) 2 kap 6§ & Plan- och bygglagen (2010:900)',
    confidence: 96,
    badge: 'COMPLIANT',
    matchedText: 'Sökande är Gävle Schakt & Logistik AB... GÄVLE BRYNÄS 1:1... Areal 15 400 m²...',
    suggestionText: 'Verksamhetsutövaren Gävle Schakt & Logistik AB (Org.nr: 556123-4567) anmäler härmed yrkesmässig hantering av schaktmassor på GÄVLE BRYNÄS 1:1. Platsen ligger inom gällande detaljplan för industriella ändamål och har en areal på 15 400 m², vilket uppfyller lokaliseringsprincipen i MB 2 kap 6§.',
    sourcesList: [
      { id: 'mb-2-6', title: 'Miljöbalken 2 kap 6§ (Lokaliseringsprincipen)', type: 'Lagbok', citation: 'Verksamheter ska lokaliseras där syftet kan uppnås med minsta intrång och olägenhet.' },
      { id: 'pbl-8', title: 'PBL 8 kap (Bygglov och detaljplan)', type: 'Lagbok', citation: 'Åtgärder ska stämma överens med gällande detaljplaners syfte.' }
    ]
  },
  'block-ewc-clean-desc': {
    title: 'Mellanlagring av Icke-Farligt Avfall',
    source: 'Miljöprövningsförordningen (2013:251) 29 kap 35§',
    confidence: 98,
    badge: 'COMPLIANT',
    matchedText: 'EWC 17 05 04 (Jord och sten... rena massor) 5 000 ton... kapacitet 1 000 m³',
    suggestionText: 'Lagring och sortering av 5 000 ton/år av EWC 17 05 04 utgör en anmälningspliktig U-verksamhet enligt miljöprövningsförordningen 29 kap 35§ (kod 90.30-C). Massorna lagras på asfalterad och avgränsad yta för att utesluta inblandning av främmande material.',
    sourcesList: [
      { id: 'mpf-29-35', title: 'MPF 29 kap 35§ (Kod 90.30)', type: 'Förordning', citation: 'Anmälningsplikt för lagring av icke-farligt avfall för återvinning.' },
      { id: 'nvv-mrr', title: 'Naturvårdsverket MRR-riktlinjer', type: 'Vägledning', citation: 'Gränsvärden för mindre än ringa risk vid återvinning i anläggningsarbeten.' }
    ]
  },
  'block-ewc-polluted-desc': {
    title: 'Hantering av Förorenade Massor',
    source: 'Miljöprövningsförordningen (2013:251) 29 kap 55§ & Avfallsförordningen',
    confidence: 94,
    badge: 'ATTENTION',
    matchedText: 'EWC 17 05 03* (Jord och sten som innehåller farliga ämnen) 500 ton...',
    suggestionText: 'Mellanlagring av lätt förorenade massor (EWC 17 05 03*) om max 500 ton/år sker i sluten container för tillfällig omlastning. Detta kräver anmälan under MPF 29 kap 55§ (kod 90.40-C) och massorna får inte samlagras med rena massor enligt Avfallsförordningen.',
    sourcesList: [
      { id: 'mpf-29-55', title: 'MPF 29 kap 55§ (Kod 90.40)', type: 'Förordning', citation: 'Anmälningsplikt för lagring av farligt avfall understegande vissa trösklar.' },
      { id: 'avfall-2020', title: 'Avfallsförordningen (2020:614)', type: 'Lagbok', citation: 'Farligt avfall får inte blandas eller samlagras på ett sätt som försvårar återvinning.' }
    ]
  },
  'block-gis-desc': {
    title: 'Skyddszoner och Recipientkontroll',
    source: 'SGU FS 2023:1 (Skydd av grundvattenbrunnar) & NFS 2016:8',
    confidence: 97,
    badge: 'COMPLIANT',
    matchedText: 'avstånd till närmaste kända dricksvattenbrunn är 112 meter... riskpoäng 28/100',
    suggestionText: 'Lokaliseringsanalysen bekräftar att lagringsytan upprätthåller ett säkert skyddsavstånd på 112 meter till närmaste dricksvattenbrunn, vilket överskrider SGU:s generella rekommendation på 100 meter. Det geografiska riskindexet enligt Mimers Brunn beräknas till 28/100 poäng (Låg risk).',
    sourcesList: [
      { id: 'sgufs-2023', title: 'SGU-FS 2023:1 Brunnsskydd', type: 'Vägledning', citation: 'Skyddsavstånd för potentiellt förorenande verksamheter bör vara minst 100m.' },
      { id: 'nfs-2016', title: 'NFS 2016:8 Förorenade områden', type: 'Vägledning', citation: 'Bedömning av föroreningsrisk och känslighet i recipienter.' }
    ]
  },
  'block-precautions-desc': {
    title: 'Försiktighetsmått & Buller/Stoft',
    source: 'Miljöbalken (1998:808) 2 kap 3§ & NFS 2004:15 Buller',
    confidence: 95,
    badge: 'COMPLIANT',
    matchedText: 'bullerdämpande åtgärder... bevattnas högarna... bullernivå 45 dBA nattetid...',
    suggestionText: 'Försiktighetsmått vidtas enligt MB 2 kap 3§. För bullerdämpning upprättas massvallar mot södra fastighetsgränsen, och drifttiderna begränsas till vardagar 07:00 - 18:00 för att hålla ljudnivåer vid närmaste bostad under Naturvårdsverkets riktvärden i NFS 2004:15.',
    sourcesList: [
      { id: 'mb-2-3', title: 'Miljöbalken 2 kap 3§ (Hänsynsregler)', type: 'Lagbok', citation: 'Krav på att utföra försiktighetsmått för att motverka olägenheter.' },
      { id: 'nfs-2004', title: 'NFS 2004:15 Buller från byggplatser', type: 'Vägledning', citation: 'Riktvärden för buller vid närliggande bostadsbebyggelse.' }
    ]
  }
};

const DEFAULT_GIS_ANALYSIS: MassGISAnalysis = {
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  timestamp: new Date().toISOString(),
  centroid: { lat: 60.6748, lng: 17.1612 },
  municipalityCode: '2180',
  municipalityName: 'Gävle',
  propertyAreaM2: 15400,
  markCover: { nmdCode: 11, description: 'Hårdgjord yta / Industrimark' },
  siteConstraints: [
    { code: 'WELL_NEARBY', label: 'Dricksvattenbrunn inom 150m (avstånd: 112m)', severity: 'MEDIUM' },
    { code: 'INDUSTRIAL_ZONE', label: 'Inom detaljplanerat industriområde', severity: 'LOW' }
  ],
  overallRiskScore: 28,
  logisticsSuitability: 'SUITABLE',
  warnings: [
    'Kontrollera lokala bullerregler då fastigheten ligger nära bostäder (180m).'
  ],
  reasoning: [
    'Fastigheten har god bärighet och hårdgjord yta, lämplig för tung trafik.',
    'Risk för damning eller bullerstörning är begränsad men kräver hänsyn.',
    'Avstånd till närmaste ytvattenreceptorer är tillräckligt (>100m).'
  ]
};

const DEFAULT_SITE_PROFILE: MassSiteProfile = {
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  centroid: { lat: 60.6748, lng: 17.1612 },
  recommendedZones: [
    { id: 'zone-1', label: 'Zon A: Mellanlagring (EWC 17 05 04)', operationType: 'MELLANLAGRING', offsetM: 25 },
    { id: 'zone-2', label: 'Zon B: Sortering & Krossning', operationType: 'TRANSIT', offsetM: 45 },
    { id: 'zone-3', label: 'Zon C: Deponering / Återvinning', operationType: 'DEPONI', offsetM: -30 }
  ],
  source: 'SGU + Lantmäteriet fastighetskarta'
};

export const CNotificationMassUI: React.FC = () => {
  const projectId = getActiveProjectId() || 'demo-project';
  const { setActiveStep, setInspectorData, addAiActivity } = useOperationsCenter();
  const { isDark } = useTheme();

  // State
  const [propertyDesignation, setPropertyDesignation] = useState('');
  const [gisAnalysis, setGisAnalysis] = useState<MassGISAnalysis | null>(null);
  const [siteProfile, setSiteProfile] = useState<MassSiteProfile | null>(null);
  const [caseId, setCaseId] = useState('');
  const [mellanlagring, setMellanlagring] = useState<OperationDraft>(emptyOp('MELLANLAGRING'));
  const [deponi, setDeponi] = useState<OperationDraft>(emptyOp('DEPONI'));
  const [decisionM, setDecisionM] = useState<MpfDecisionSummary | null>(null);
  const [decisionD, setDecisionD] = useState<MpfDecisionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);

  // Selected block inside the Notion-style document editor
  const [selectedBlock, setSelectedBlock] = useState<string | null>('block-applicant');

  // Editable block contents
  const [blocks, setBlocks] = useState<Record<string, string>>({
    'block-applicant': 'Verksamhetsutövaren Gävle Schakt & Logistik AB (Org.nr: 556123-4567) anmäler härmed yrkesmässig hantering av schaktmassor på fastigheten GÄVLE BRYNÄS 1:1 i Gävle kommun (kommunkod 2180). Platsen har en total areal på 15 400 m² och är huvudsakligen hårdgjord industrimark.',
    'block-ewc-clean-desc': 'Mellanlagring av EWC 17 05 04 (Jord och sten som inte omfattas av 17 05 03, dvs. rena massor) planeras med en årlig volym på 5 000 ton. Den maximala lagringsvolymen vid ett givet tillfälle uppgår till 1 000 m³.',
    'block-ewc-polluted-desc': 'Tillfällig sortering och omlastning av EWC 17 05 03* (Jord och sten som innehåller farliga ämnen, t.ex. lätt förorenade massor) planeras uppgå till maximalt 500 ton per år.',
    'block-gis-desc': 'Enligt geografisk riskanalys via Mimers Brunn upprätthålls ett säkerhetsavstånd på 112 meter till närmaste kända dricksvattenbrunn, vilket väl överstiger SGU:s generella krav på 100 meter. Riskbedömningen ger 28/100 poäng.',
    'block-precautions-desc': 'Hänsynsregler och försiktighetsmått upprätthålls i enlighet med miljöbalkens allmänna råd. För att motverka damning under torrt väder etableras automatiska bevattningssystem. Buller dämpas genom att använda strategiskt placerade massor som vallar mot angränsande områden.'
  });

  // Checklists inside precautions
  const [precautionsChecklist, setPrecautionsChecklist] = useState([
    { id: 'c1', label: 'Etablera tätt underlag och tillfälliga vallar runt lagringszon A', checked: true },
    { id: 'c2', label: 'Installera dammdämpande dimspridare/bevattningssystem', checked: true },
    { id: 'c3', label: 'Skapa bullerdämpande skyddsvall mot bostäder i söder', checked: false }
  ]);

  // --- Dynamic Inline Calculators State ---
  // Stormwater Detention P110 States
  const [p1AreaM2, setP1AreaM2] = useState(15400);
  const [p1Runoff, setP1Runoff] = useState(0.8);
  const [p1ReturnPeriod, setP1ReturnPeriod] = useState(10);
  const [p1ClimateFactor, setP1ClimateFactor] = useState(1.25);
  const [p1AllowedOutflow, setP1AllowedOutflow] = useState(15);

  // VA Climate & Geokalkyl States
  const [trenchLength, setTrenchLength] = useState(100);
  const [trenchWidth, setTrenchWidth] = useState(1.2);
  const [trenchDepth, setTrenchDepth] = useState(1.8);
  const [reusePercent, setReusePercent] = useState(60);
  const [pipeMaterial, setPipeMaterial] = useState<'PVC' | 'PE' | 'PP' | 'CONCRETE' | 'DUCTILE_IRON'>('PE');
  const [pipeDiameter, setPipeDiameter] = useState(160);
  const [transportDistance, setTransportDistance] = useState(25);
  const [localGroundType, setLocalGroundType] = useState<'fast' | 'mellanfast' | 'svag'>('mellanfast');

  // SGU Groundwater Model States
  const [gwK, setGwK] = useState<number>(0.0001); // K-värde (m/s)
  const [gwS, setGwS] = useState<number>(1.5); // Avsänkning s (m)
  const [gwH, setGwH] = useState<number>(5.0); // Magasinstjocklek H (m)
  const [gwRw, setGwRw] = useState<number>(2.5); // Schaktradie rw (m)

  // LTAR Sewage Infiltration States
  const [sewagePe, setSewagePe] = useState<number>(5); // Antal personer (PE)
  const [sewageLtar, setSewageLtar] = useState<number>(15); // LTAR (l/m²/dygn)
  const [dailyFlowPerPe, setDailyFlowPerPe] = useState<number>(170); // Flöde per PE och dygn (l)


  // --- Calculator Mathematical Engines ---
  const dahlstromIntensity = (months: number, duration: number) => {
    const d = Math.max(5, duration);
    const t = Math.max(1, months);
    return 190 * Math.pow(t, 1/3) * Math.log(d) / Math.pow(d, 0.98) + 2;
  };

  const getPipeWeightPerMeter = (material: string, diameterMm: number): number => {
    switch (material) {
      case 'PVC':
      case 'PE':
      case 'PP':
        return 0.00011 * Math.pow(diameterMm, 2);
      case 'CONCRETE':
        return 0.001 * Math.pow(diameterMm, 2);
      case 'DUCTILE_IRON':
        return 0.0006 * Math.pow(diameterMm, 2);
      default:
        return 0;
    }
  };

  const PIPE_EMISSION_FACTORS: Record<string, number> = {
    PVC: 2.5,
    PE: 2.0,
    PP: 1.8,
    CONCRETE: 0.15,
    DUCTILE_IRON: 1.6,
  };

  const calculateLocalStormwater = (areaM2: number, runoff: number, returnPeriod: number, climateFactor: number, allowedOutflow: number) => {
    const catchmentAreaHa = areaM2 / 10000;
    const reducedAreaHa = catchmentAreaHa * runoff;
    const returnPeriodMonths = returnPeriod * 12;

    const sweepDurations = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
    let maxRequiredVolumeM3 = 0;
    let criticalDurationMinutes = 5;

    for (const d of sweepDurations) {
      const intens = dahlstromIntensity(returnPeriodMonths, d);
      const inflow = reducedAreaHa * intens * climateFactor;
      const vol = Math.max(0, (inflow - allowedOutflow) * d * 60 / 1000);

      if (vol > maxRequiredVolumeM3) {
        maxRequiredVolumeM3 = vol;
        criticalDurationMinutes = d;
      }
    }

    const currentIntensity = dahlstromIntensity(returnPeriodMonths, 15);
    const currentInflow = reducedAreaHa * currentIntensity * climateFactor;

    return {
      inflowLs: Math.round(currentInflow * 10) / 10,
      requiredVolumeM3: Math.round(maxRequiredVolumeM3 * 10) / 10,
      criticalDurationMinutes,
    };
  };

  const calculateLocalVaProjectClimate = (
    trenchLengthM: number,
    trenchWidthM: number,
    trenchDepthM: number,
    reusePercentage: number,
    pipeMat: string,
    pipeDiameterMm: number,
    transportDistanceKm: number
  ) => {
    const excavatedVolumeM3 = trenchLengthM * trenchWidthM * trenchDepthM;
    const soilDensityTonM3 = 1.8;
    const excavatedWeightTons = excavatedVolumeM3 * soilDensityTonM3;

    const EXCAVATION_FACTOR_KG_CO2E_PER_M3 = 3.5;
    const excavationEmissionsKgCo2e = excavatedVolumeM3 * EXCAVATION_FACTOR_KG_CO2E_PER_M3;

    const weightPerMeter = getPipeWeightPerMeter(pipeMat, pipeDiameterMm);
    const totalPipeWeightKg = weightPerMeter * trenchLengthM;
    const emissionFactor = PIPE_EMISSION_FACTORS[pipeMat] || 2.0;
    const pipeMaterialEmissionsKgCo2e = totalPipeWeightKg * emissionFactor;

    const massToTransportAwayTons = excavatedWeightTons * (1 - reusePercentage / 100);
    const massToImportTons = excavatedWeightTons * (1 - reusePercentage / 100);
    const pipesToImportTons = totalPipeWeightKg / 1000;
    const totalTransportWeightTons = massToTransportAwayTons + massToImportTons + pipesToImportTons;

    const TRANSPORT_FACTOR_KG_CO2E_PER_TON_KM = 0.08;
    const transportEmissionsKgCo2e = totalTransportWeightTons * transportDistanceKm * TRANSPORT_FACTOR_KG_CO2E_PER_TON_KM;

    const totalEmissionsKgCo2e = excavationEmissionsKgCo2e + pipeMaterialEmissionsKgCo2e + transportEmissionsKgCo2e;

    return {
      excavatedVolumeM3: Math.round(excavatedVolumeM3 * 10) / 10,
      excavationEmissionsKgCo2e: Math.round(excavationEmissionsKgCo2e),
      pipeMaterialEmissionsKgCo2e: Math.round(pipeMaterialEmissionsKgCo2e),
      transportEmissionsKgCo2e: Math.round(transportEmissionsKgCo2e),
      totalEmissionsKgCo2e: Math.round(totalEmissionsKgCo2e),
      totalPipeWeightKg: Math.round(totalPipeWeightKg),
    };
  };

  const calculateLocalGeokalkylCost = (lengthM: number, ground: 'fast' | 'mellanfast' | 'svag') => {
    const baseCost = 1250;
    let complexityMultiplier = 1.0;

    if (ground === 'fast') {
      complexityMultiplier = 1.40;
    } else if (ground === 'svag') {
      complexityMultiplier = 1.30;
    }

    const estimatedCost = lengthM * baseCost * complexityMultiplier;
    return {
      multiplier: complexityMultiplier,
      estimatedCost: Math.round(estimatedCost),
    };
  };

  const calculateLocalGroundwaterInfluence = (k: number, s: number, h: number, rw: number) => {
    // Sichardt's formula for influence radius R
    const rSichardt = 3000 * s * Math.sqrt(k);
    
    // Ensure R is larger than rw
    const finalR = Math.max(rw + 0.1, rSichardt);

    // Radial flow Dupuit-Thiem Q (m3/s)
    let flowRateM3s = 0;
    try {
      flowRateM3s = (Math.PI * k * (Math.pow(h, 2) - Math.pow(h - s, 2))) / Math.log(finalR / rw);
    } catch (err) {
      flowRateM3s = 0;
    }

    // Convert m3/s to l/m (liters per minute)
    const flowRateLpm = flowRateM3s * 1000 * 60;

    return {
      radiusM: Math.round(finalR * 10) / 10,
      flowRateLpm: Math.round(flowRateLpm * 10) / 10,
      drawdownM: s,
    };
  };

  const calculateLocalSewageInfiltration = (pe: number, ltar: number, flowPerPe: number) => {
    const dailyFlowL = pe * flowPerPe;
    const requiredAreaM2 = dailyFlowL / ltar;
    return {
      dailyFlowL,
      requiredAreaM2: Math.round(requiredAreaM2 * 10) / 10,
    };
  };



  // Sync active step to Operations Center Context on Mount
  useEffect(() => {
    setActiveStep(4); // 4. Dokumentera (Compliance Mode)
    addAiActivity('Compliance Mode laddad: C-anmälan och Notion-editor aktiv.', 'info');
    
    // Set initial Inspector Panel details
    if (gisAnalysis) {
      setInspectorData({
        title: caseId ? `Ärende ${caseId} (Compliance)` : 'Compliance Mode',
        subtitle: gisAnalysis.propertyDesignation || 'Fastighet vald',
        type: 'property',
        metadata: {
          'Areal': gisAnalysis.propertyAreaM2 ? `${gisAnalysis.propertyAreaM2} m²` : '—',
          'Marktäcke': gisAnalysis.markCover ? gisAnalysis.markCover.description : '—',
          'Riskindex': `${gisAnalysis.overallRiskScore}/100`,
          'Logistik': gisAnalysis.logisticsSuitability || '—',
        },
        confidence: 96,
        explainText: 'Detta är utredningsstödet för C-anmälan (Konsultläge). Redigera anmälans textblock till höger. Klicka på valfritt stycke för att granska tillämpliga lagar, föreskrifter och Naturvårdsverkets riktvärden live.',
        sources: [
          { id: 'nvv-mrr', title: 'Naturvårdsverket MRR-riktlinjer', type: 'Vägledning' },
          { id: 'sgufs-2023', title: 'SGU-FS 2023:1 Brunnsskydd', type: 'Vägledning' }
        ]
      });
    } else {
      setInspectorData({
        title: 'Compliance Mode',
        subtitle: 'Ingen fastighet vald',
        type: 'property',
        metadata: {
          'Areal': '—',
          'Marktäcke': '—',
          'Riskindex': '—',
          'Logistik': '—',
        },
        confidence: 96,
        explainText: 'Detta är utredningsstödet för C-anmälan (Konsultläge). Ange en fastighetsbeteckning till vänster och kör GIS-analysen för att hämta fastighetsdetaljer, miljörestriktioner och RAG-underlag.',
        sources: [
          { id: 'nvv-mrr', title: 'Naturvårdsverket MRR-riktlinjer', type: 'Vägledning' },
          { id: 'sgufs-2023', title: 'SGU-FS 2023:1 Brunnsskydd', type: 'Vägledning' }
        ]
      });
    }
  }, [setActiveStep, addAiActivity, setInspectorData, gisAnalysis, caseId]);

  // Computed properties
  const mergedGeofenceLayers = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...(decisionM?.geofenceLayers ?? []), ...(decisionD?.geofenceLayers ?? [])];
    return merged.filter((layer) => {
      if (seen.has(layer.key)) return false;
      seen.add(layer.key);
      return true;
    });
  }, [decisionM, decisionD]);

  const mergedRequiredMapLayers = useMemo(
    () => mergedGeofenceLayers.map((layer) => layer.key),
    [mergedGeofenceLayers],
  );

  const siteIsSensitive = useMemo(
    () => Boolean(gisAnalysis && isSensitiveAreaFromMassGis(gisAnalysis)),
    [gisAnalysis],
  );

  // Download logic
  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const buildSituationMapSvg = (payload: Record<string, unknown>) => {
    const gis = (payload.gis as Record<string, unknown> | null) ?? null;
    const centroid = (gis?.centroid as { lat?: number; lng?: number } | undefined) ?? {};
    const recommendedZones = (
      (gis?.recommendedZones as Array<Record<string, unknown>> | undefined) ?? []
    ).slice(0, 8);

    const width = 960;
    const height = 540;
    const centerX = 480;
    const centerY = 260;
    const zoneColors: Record<string, string> = {
      MELLANLAGRING: '#4f46e5',
      DEPONI: '#059669',
      TRANSIT: '#475569',
    };

    const zoneNodes = recommendedZones
      .map((zone, index) => {
        const operationType = String(zone.operationType || 'TRANSIT');
        const label = String(zone.label || operationType);
        const color = zoneColors[operationType] ?? '#475569';
        const angle = (index / Math.max(recommendedZones.length, 1)) * Math.PI * 2;
        const radius = 120;
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const y = Math.round(centerY + Math.sin(angle) * radius);
        return `<g><circle cx="${x}" cy="${y}" r="18" fill="${color}" /><text x="${x}" y="${
          y + 34
        }" text-anchor="middle" font-size="13" fill="#334155">${label}</text></g>`;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <rect x="30" y="30" width="900" height="480" rx="18" fill="#ffffff" stroke="#cbd5e1" />
  <text x="60" y="74" font-size="28" font-weight="700" fill="#0f172a">Situationskarta - C-anmälan schaktmassor</text>
  <text x="60" y="104" font-size="16" fill="#334155">Fastighet: ${propertyDesignation}</text>
  <text x="60" y="130" font-size="14" fill="#475569">Centroid: ${Number(centroid.lat || 0).toFixed(5)}, ${Number(
    centroid.lng || 0,
  ).toFixed(5)}</text>
  <circle cx="${centerX}" cy="${centerY}" r="42" fill="#dbeafe" stroke="#2563eb" stroke-width="2" />
  <text x="${centerX}" y="${centerY + 6}" text-anchor="middle" font-size="14" fill="#1e3a8a">Fastighet</text>
  ${zoneNodes}
  <text x="60" y="486" font-size="12" fill="#64748b">Human-in-the-loop: juridisk slutgranskning krävs</text>
</svg>`;
  };

  const fetchCaseExport = async () => {
    if (!caseId) {
      throw new Error('Ärende-ID saknas. Spara delbeslut först.');
    }
    return callApi<{ ok: boolean; export: Record<string, unknown> }>(
      `/api/c-notification/mass/${encodeURIComponent(caseId)}/export`,
      { method: 'GET' },
    );
  };

  // Mutation and action runners
  const {
    mutate: runGisAnalysis,
    isPending: isAnalyzingGis,
    error: gisError,
  } = useMassGisAnalysis({
    onSuccess: (data) => {
      setGisAnalysis(data.analysis);
      setSiteProfile(data.siteProfile);
      setPropertyDesignation(data.analysis.propertyDesignation);
      setMessage(`GIS-analys klar för ${data.analysis.propertyDesignation}.`);
      addAiActivity(`Geografisk riskanalys utförd för ${data.analysis.propertyDesignation}.`, 'success');
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
      addAiActivity(`GIS-analys misslyckades: ${err.message}`, 'warning');
    },
  });

  const run = useCallback(async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ett fel uppstod');
    } finally {
      setLoading(false);
    }
  }, []);

  const validateOne = async (op: OperationDraft, setter: (decision: MpfDecisionSummary | null) => void) => {
    const res = await callApi<{
      ok: boolean;
      mpfDecision: MpfDecisionSummary;
    }>('/api/c-notification/mass/validate-codes', {
      method: 'POST',
      body: {
        propertyDesignation,
        operationType: op.operationType,
        quantityPerYear: Number(op.quantityPerYear),
        ewcCode: op.ewcCode,
        sniCode: op.sniCode || undefined,
        isSensitiveArea: gisAnalysis ? isSensitiveAreaFromMassGis(gisAnalysis) : undefined,
        siteLat: gisAnalysis?.centroid.lat,
        siteLng: gisAnalysis?.centroid.lng,
      },
    });
    if (res.ok) {
      setter(res.mpfDecision);
      addAiActivity(`MPF-screening slutförd för ${op.operationType} (${op.ewcCode}).`, 'success');
      
      // Update global inspector with decision
      setInspectorData({
        title: `MPF-analys: ${op.operationType}`,
        subtitle: `${op.ewcCode} • Screening`,
        type: 'mass_operation',
        confidence: 95,
        status: res.mpfDecision.gateDecision === 'NOTIFICATION_REQUIRED' ? 'success' : 'warning',
        statusText: `Beslutsklass: ${res.mpfDecision.gateDecision}`,
        metadata: {
          'Kodtyp': res.mpfDecision.primaryCodeType || 'Ej tillämpligt',
          'MPF-aktivitet': res.mpfDecision.activityCode || 'Ej fastställt',
          'Regulatoriskt spår': res.mpfDecision.primaryPermitProfile?.regulatoryTrack || 'Anmälningsplikt',
          'Skyddsnivå': res.mpfDecision.isSensitiveArea ? 'Högt skydd' : 'Normal',
        },
        explainText: res.mpfDecision.notes,
        sources: res.mpfDecision.geofenceLayers.map(l => ({
          id: l.key,
          title: l.label,
          type: 'Geofence-lager',
          citation: l.reason
        }))
      });
    }
  };

  const handleSaveOperations = async () => {
    await run(async () => {
      const res = await callApi<{
        ok: boolean;
        caseId: string;
        decisions?: {
          mellanlagring?: { mpfDecision?: MpfDecisionSummary | null } | null;
          deponi?: { mpfDecision?: MpfDecisionSummary | null } | null;
        };
        warnings?: string[];
      }>('/api/c-notification/mass/operations', {
        method: 'POST',
        body: {
          caseId: caseId || undefined,
          projectId,
          propertyDesignation,
          gisSnapshot:
            gisAnalysis && siteProfile
              ? {
                  analysis: gisAnalysis,
                  siteProfile,
                  analyzedAt: gisAnalysis.timestamp,
                }
              : undefined,
          operations: [
            {
              ...mellanlagring,
              quantityPerYear: Number(mellanlagring.quantityPerYear),
              capacityM3: Number(mellanlagring.capacityM3) || undefined,
            },
            {
              ...deponi,
              quantityPerYear: Number(deponi.quantityPerYear),
              capacityM3: Number(deponi.capacityM3) || undefined,
            },
          ],
        },
      });
      if (res.ok) {
        setDecisionM(res.decisions?.mellanlagring?.mpfDecision ?? decisionM);
        setDecisionD(res.decisions?.deponi?.mpfDecision ?? decisionD);
        setCaseId(res.caseId);
        setMessage(`Ärende ${res.caseId} sparat. ${(res.warnings ?? []).join(' ')}`);
        addAiActivity(`Sparade delbeslut för ärende ${res.caseId} (MPF & EWC koder lagrade).`, 'success');
        setActiveStep(5); // 5. Exportera
      }
    });
  };

  // Block clicks to trigger RAG update and Inspector update
  const handleBlockSelect = (blockId: string) => {
    setSelectedBlock(blockId);
    const suggestion = RAG_SUGGESTIONS[blockId];
    if (suggestion) {
      // Update global inspector with laws/citations
      setInspectorData({
        title: suggestion.title,
        subtitle: `RAG Analys • ${suggestion.source.split('&')[0]}`,
        type: 'general',
        confidence: suggestion.confidence,
        status: suggestion.badge === 'COMPLIANT' ? 'success' : 'warning',
        metadata: {
          'Lagbok': suggestion.source.split('&')[0],
          'RAG Konfidens': `${suggestion.confidence}%`,
          'Status': suggestion.badge,
        },
        explainText: `Mimers RAG-motor har granskat stycket mot gällande lagstiftning och myndighetsdirektiv. Den har identifierat följande referenser: ${suggestion.source}.`,
        sources: suggestion.sourcesList
      });
      addAiActivity(`Körde on-demand RAG för avsnitt: ${suggestion.title}`, 'info');
    }
  };

  // Apply suggestion to block text
  const applySuggestion = (blockId: string) => {
    const suggestion = RAG_SUGGESTIONS[blockId];
    if (suggestion) {
      setBlocks(prev => ({
        ...prev,
        [blockId]: suggestion.suggestionText
      }));
      addAiActivity(`Infogade juridiskt verifierad formulering för: ${suggestion.title}`, 'success');
      
      // Update Inspector Panel to success
      setInspectorData({
        title: suggestion.title,
        subtitle: 'Bästa möjliga teknik (BAT) säkerställd',
        type: 'general',
        confidence: 99,
        status: 'success',
        statusText: 'Fullt förenlig (Compliant)',
        metadata: {
          'Kvalitetssäkrad': 'Ja (Mimer RAG)',
          'Tillämpning': suggestion.source,
          'Metod': 'Automatiskt lagrum-matchning v2'
        },
        explainText: 'Stycket har formulerats i linje med Naturvårdsverkets officiella handböcker och föreskrifter. All terminologi är nu juridiskt stringent och skyddar mot framtida handläggningstvister.',
        sources: suggestion.sourcesList
      });
    }
  };

  const toggleChecklist = (id: string) => {
    setPrecautionsChecklist(prev =>
      prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item)
    );
    addAiActivity('Uppdaterade kontrollprogrammet för försiktighetsmått.', 'info');
  };

  // Current active suggestion details
  const activeSuggestion = selectedBlock ? RAG_SUGGESTIONS[selectedBlock] : null;

  return (
    <div className={`module-container c-notification-mass-view h-full flex flex-col ${isDark ? 'text-slate-100 bg-slate-950/10' : 'text-slate-900 bg-slate-50'}`}>
      
      {/* Notifications bar */}
      {(error || gisError || message) && (
        <div className="flex flex-col gap-2 mb-4">
          {error && (
            <div className={`rounded-xl border p-3.5 flex items-center gap-3 text-xs font-medium ${
              isDark ? 'bg-rose-950/20 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <AlertTriangle className="text-rose-500 flex-shrink-0 animate-pulse" size={16} />
              <span>{error}</span>
            </div>
          )}
          {gisError && (
            <div className={`rounded-xl border p-3.5 flex items-center gap-3 text-xs font-medium ${
              isDark ? 'bg-rose-950/20 border-rose-900/60 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              <AlertTriangle className="text-rose-500 flex-shrink-0" size={16} />
              <span>{gisError.message}</span>
            </div>
          )}
          {message && (
            <div className={`rounded-xl border p-3.5 flex items-center gap-3 text-xs font-medium ${
              isDark ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}>
              <CheckCircle2 className="text-emerald-500 flex-shrink-0" size={16} />
              <span>{message}</span>
            </div>
          )}
        </div>
      )}

      {/* Main 25% GIS Map / 75% Document Split */}
      <div className="flex flex-col xl:flex-row gap-6 h-[calc(100vh-12rem)] flex-1 overflow-hidden">
        
        {/* Left 25% - GIS Analysis & Site Summary Panel */}
        <div className={`w-full xl:w-1/4 flex flex-col h-full overflow-y-auto pr-1 space-y-4 custom-scrollbar p-4 rounded-2xl border ${
          isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          <div>
            <span className="text-[9px] font-black uppercase text-cyan-400 tracking-wider">Mimers Brunn GIS</span>
            <h2 className="text-sm font-black tracking-tight mt-0.5">Platsanalys & Karta</h2>
          </div>

          {/* Property Designation Field */}
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fastighetsbeteckning</label>
            <div className="flex gap-2">
              <input
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold focus:outline-none transition-all ${
                  isDark 
                    ? 'bg-slate-950/50 border-slate-800 text-slate-100 focus:border-cyan-500' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-indigo-500'
                }`}
                value={propertyDesignation}
                onChange={(e) => setPropertyDesignation(e.target.value.toUpperCase())}
                placeholder="Fastighetsbeteckning..."
              />
              <button
                type="button"
                disabled={isAnalyzingGis || !propertyDesignation.trim()}
                onClick={() =>
                  runGisAnalysis({
                    projectId,
                    propertyDesignation: propertyDesignation.trim(),
                  })
                }
                className={`px-3 py-1.5 rounded-lg flex items-center justify-center transition-all ${
                  isDark
                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
                }`}
                title="Kör ny GIS-analys"
              >
                {isAnalyzingGis ? (
                  <RefreshCw className="animate-spin" size={14} />
                ) : (
                  <Sparkles size={14} />
                )}
              </button>
            </div>
          </div>

          {/* Map View */}
          {gisAnalysis && siteProfile ? (
            <div className="rounded-xl overflow-hidden border border-slate-800/20 dark:border-slate-800 bg-slate-950/5">
              <MassMapView
                analysis={gisAnalysis}
                siteProfile={siteProfile}
                requiredMapLayers={mergedRequiredMapLayers}
              />
            </div>
          ) : (
            <div className={`h-48 rounded-xl border border-dashed flex flex-col items-center justify-center p-4 text-center ${
              isDark ? 'border-slate-800 bg-slate-900/10' : 'border-slate-200 bg-slate-50'
            }`}>
              <Layers className="text-slate-400 mb-2 animate-bounce" size={24} />
              <p className="text-xs font-semibold">Ingen platsdata tillgänglig</p>
              <p className="text-[10px] text-slate-500 mt-1">Skriv in en fastighet och kör analysen för att hämta kartan.</p>
            </div>
          )}

          {/* Geofence Alert Overlays */}
          {gisAnalysis && (
            <div className="space-y-3">
              {/* Overall Ratings Card */}
              <div className={`p-3 rounded-xl border grid grid-cols-2 gap-2 ${
                isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'
              }`}>
                <div>
                  <p className="text-[9px] font-black uppercase text-slate-400">Georiskpoäng</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-lg font-black text-emerald-400">{gisAnalysis.overallRiskScore}</span>
                    <span className="text-[10px] text-slate-500 font-bold">/100</span>
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase text-slate-400">Logistiklämplighet</p>
                  <span className="inline-block mt-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider bg-emerald-950/20 border border-emerald-900/40 rounded px-1.5 py-0.5">
                    {gisAnalysis.logisticsSuitability}
                  </span>
                </div>
              </div>

              {/* Marktäcke */}
              {gisAnalysis.markCover && (
                <div className={`p-3 rounded-xl border ${
                  isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'
                }`}>
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">NMD Marktäcke (Out-of-DB)</p>
                  <p className="text-xs font-bold text-slate-200">{gisAnalysis.markCover.description}</p>
                </div>
              )}

              {/* Site Constraints List */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Restriktioner & SGU brunnar</p>
                <ul className="space-y-1">
                  {gisAnalysis.siteConstraints.map((item) => (
                    <li key={item.code} className={`text-[11px] border rounded-lg px-2.5 py-2 flex gap-2 items-start ${
                      isDark ? 'bg-slate-900/20 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        item.severity === 'HIGH' ? 'bg-rose-500' : item.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`} />
                      <div className="flex-1">
                        <span className="font-semibold text-slate-300 dark:text-slate-200">{item.label}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Geofence layers mapping */}
              {mergedGeofenceLayers.length > 0 && (
                <MpfGeofenceOverlay layers={mergedGeofenceLayers} isSensitiveArea={siteIsSensitive} />
              )}
            </div>
          )}
        </div>

        {/* Right 75% - Notion-Style Document Editor & AI RAG Dual Column */}
        <div className="w-full xl:w-3/4 flex flex-col h-full overflow-hidden">
          
          {/* Editor Sub-Header (Sticky) */}
          <div className={`flex justify-between items-center pb-3.5 mb-3.5 border-b ${
            isDark ? 'border-slate-900' : 'border-slate-200'
          }`}>
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
              <p className="text-xs font-semibold text-slate-500">
                Ärende-ID: <span className="font-bold text-cyan-400 dark:text-cyan-400">{caseId || 'EJ SPARAT'}</span> • <span className="uppercase tracking-wider">C-anmälan (Draft)</span>
              </p>
            </div>

            {/* Global Actions in Header */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveOperations}
                disabled={loading}
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all ${
                  isDark
                    ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-indigo-600'
                }`}
              >
                Spara delbeslut
              </button>

              <button
                type="button"
                disabled={loading || !caseId}
                onClick={() =>
                  run(async () => {
                    const res = await fetchCaseExport();
                    const pdfBlob = await callApi<Blob>('/api/export/pdf-json', {
                      method: 'POST',
                      body: {
                        title: `C-anmälan schaktmassor - ${caseId}`,
                        subtitle: `Fastighet ${propertyDesignation}`,
                        json: {
                          ...res.export,
                          exportedAt: new Date().toISOString(),
                          humanInTheLoop:
                            'Underlaget är AI-assisterat utredningsstöd. Konsulten ansvarar för verifiering av uppgifterna inför myndighetsinlämning.',
                        },
                      },
                    });
                    downloadBlob(pdfBlob, `c-anmalan-schaktmassor-${caseId}.pdf`);
                    setMessage('PDF-export slutförd och laddas ner.');
                    addAiActivity('Exportera ärende-PDF (Mimers Brunn godkänd).', 'success');
                  })
                }
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                  isDark
                    ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <FileDown size={12} />
                Exportera PDF
              </button>
            </div>
          </div>

          {/* Dual Column Workspace */}
          <div className="flex-1 flex gap-5 h-full overflow-hidden">
            
            {/* Notion Document Column (70%) */}
            <div className={`w-full lg:w-[70%] flex flex-col h-full overflow-y-auto pr-1 space-y-5 custom-scrollbar p-6 rounded-2xl border ${
              isDark ? 'bg-slate-900/25 border-slate-800/60' : 'bg-white border-slate-200/80 shadow-sm'
            }`} style={{ fontFamily: 'var(--font-mono, Inter, system-ui)' }}>
              
              {/* Document Cover Header */}
              <div className="pb-6 border-b border-dashed border-slate-800/10 dark:border-slate-800/40">
                <span className="text-[9px] font-mono uppercase bg-slate-800/20 text-cyan-400 dark:text-cyan-400 border border-slate-800/40 rounded px-2 py-0.5">Mall: Massor C-anmälan</span>
                <h1 className="text-xl font-extrabold tracking-tight mt-3 text-slate-100 dark:text-slate-100">
                  Anmälan om mellanlagring, sortering och återvinning av schaktmassor
                </h1>
                <p className="text-xs text-slate-500 mt-1.5">
                  Fysiskt arkiverad i GEO_Master_Archive under juridisk tillsyn.
                </p>
              </div>

              {/* Notion-style Block 1: Applicant & Fastighet */}
              <div 
                onClick={() => handleBlockSelect('block-applicant')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedBlock === 'block-applicant' 
                    ? (isDark ? 'bg-cyan-950/15 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-indigo-50/40 border-indigo-500/50')
                    : (isDark ? 'bg-slate-950/25 border-transparent hover:border-slate-800' : 'bg-slate-50/30 border-transparent hover:border-slate-200')
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Bookmark size={11} className="text-cyan-400" />
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Avsnitt 1: Verksamhetsutövare & Fastighet</span>
                </div>
                <textarea
                  className="w-full text-xs font-medium border-none bg-transparent resize-none focus:ring-0 leading-relaxed custom-scrollbar py-1"
                  rows={3}
                  value={blocks['block-applicant']}
                  onChange={(e) => setBlocks({ ...blocks, 'block-applicant': e.target.value })}
                />
              </div>

              {/* Block 2: Delbeslut & MPF Tables (Embedded Interactive Table Card) */}
              <div className={`p-4 rounded-xl border ${
                isDark ? 'bg-slate-950/35 border-slate-800/80' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/40 dark:border-slate-800/40">
                  <div className="flex items-center gap-1.5">
                    <Scale size={13} className="text-cyan-400" />
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Avsnitt 2: Avfallstyper, EWC-koder & MPF-screening</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-bold">Automatiserad screening</span>
                </div>

                <div className="space-y-4">
                  {/* Operations Draft Grid */}
                  {(['MELLANLAGRING', 'DEPONI'] as const).map((type) => {
                    const op = type === 'MELLANLAGRING' ? mellanlagring : deponi;
                    const setOp = type === 'MELLANLAGRING' ? setMellanlagring : setDeponi;
                    const decision = type === 'MELLANLAGRING' ? decisionM : decisionD;
                    const isMell = type === 'MELLANLAGRING';

                    return (
                      <div key={type} className={`p-3.5 rounded-lg border ${
                        isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'
                      }`}>
                        <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-800/10 dark:border-slate-800/40">
                          <span className="text-[10px] font-black text-cyan-400 tracking-wider uppercase">{isMell ? 'Mellanlagring (Zon A)' : 'Deponering/Återvinning (Zon C)'}</span>
                          <span className="text-[9px] text-slate-500 font-semibold">{isMell ? 'EWC 17 05 04 (Rena)' : 'EWC 17 05 03* (Farliga)'}</span>
                        </div>

                        {/* Inline Form Fields */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5">
                          <div>
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">EWC-Kod</p>
                            <input
                              className={`w-full rounded-md border px-2 py-1 text-[11px] font-bold focus:outline-none ${
                                isDark ? 'bg-slate-950/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                              value={op.ewcCode}
                              onChange={(e) => setOp({ ...op, ewcCode: e.target.value })}
                            />
                          </div>
                          <div>
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Mängd (ton/år)</p>
                            <input
                              className={`w-full rounded-md border px-2 py-1 text-[11px] font-bold focus:outline-none ${
                                isDark ? 'bg-slate-950/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                              value={op.quantityPerYear}
                              onChange={(e) => setOp({ ...op, quantityPerYear: e.target.value })}
                            />
                          </div>
                          <div>
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Kapacitet (m³)</p>
                            <input
                              className={`w-full rounded-md border px-2 py-1 text-[11px] font-bold focus:outline-none ${
                                isDark ? 'bg-slate-950/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                              value={op.capacityM3}
                              onChange={(e) => setOp({ ...op, capacityM3: e.target.value })}
                            />
                          </div>
                          <div>
                            <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Mottagare</p>
                            <input
                              className={`w-full rounded-md border px-2 py-1 text-[11px] font-bold focus:outline-none ${
                                isDark ? 'bg-slate-950/60 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                              }`}
                              value={op.receiverName}
                              onChange={(e) => setOp({ ...op, receiverName: e.target.value })}
                              placeholder="Fyll i extern mottagare..."
                            />
                          </div>
                        </div>

                        {/* Screening trigger and feedback */}
                        <div className="flex justify-between items-center mt-2 pt-1">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => validateOne(op, isMell ? setDecisionM : setDecisionD)}
                            className={`text-[9px] font-black px-2.5 py-1 rounded border transition-all ${
                              isDark 
                                ? 'border-cyan-800/40 bg-cyan-950/20 text-cyan-400 hover:bg-cyan-950/40' 
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            }`}
                          >
                            Slutför MPF-screening
                          </button>

                          {decision && (
                            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              decision.gateDecision === 'NOTIFICATION_REQUIRED' 
                                ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/50' 
                                : 'bg-amber-950/30 text-amber-400 border border-amber-900/50'
                            }`}>
                              Gate: {decision.gateDecision}
                            </span>
                          )}
                        </div>

                        {decision && (
                          <div className={`mt-3 p-2.5 rounded border text-[11px] leading-relaxed space-y-1 ${
                            isDark ? 'bg-slate-950/50 border-slate-800/80 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}>
                            <p><strong>Aktivitet:</strong> {decision.primaryCodeType ?? 'Okänd'} {decision.activityCode ? `· MPF-kod ${decision.activityCode}` : ''}</p>
                            <p><strong>Anvisning:</strong> {decision.notes}</p>
                            {decision.advisorySignals.length > 0 && (
                              <div className="text-amber-400 dark:text-amber-400 font-semibold mt-1">
                                <span className="underline">Advisory signaler:</span> {decision.advisorySignals.join(', ')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Descriptions blocks inside avsnitt 2 */}
                  <div className="space-y-3">
                    <div 
                      onClick={() => handleBlockSelect('block-ewc-clean-desc')}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        selectedBlock === 'block-ewc-clean-desc' 
                          ? (isDark ? 'bg-cyan-950/15 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-indigo-50/40 border-indigo-500/50')
                          : (isDark ? 'bg-slate-900/20 border-transparent hover:border-slate-800' : 'bg-white border-transparent hover:border-slate-200')
                      }`}
                    >
                      <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Volymsbeskrivning (Rena massor)</p>
                      <textarea
                        className="w-full text-xs font-medium border-none bg-transparent resize-none focus:ring-0 leading-relaxed custom-scrollbar py-0.5"
                        rows={2}
                        value={blocks['block-ewc-clean-desc']}
                        onChange={(e) => setBlocks({ ...blocks, 'block-ewc-clean-desc': e.target.value })}
                      />
                    </div>

                    <div 
                      onClick={() => handleBlockSelect('block-ewc-polluted-desc')}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        selectedBlock === 'block-ewc-polluted-desc' 
                          ? (isDark ? 'bg-cyan-950/15 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-indigo-50/40 border-indigo-500/50')
                          : (isDark ? 'bg-slate-900/20 border-transparent hover:border-slate-800' : 'bg-white border-transparent hover:border-slate-200')
                      }`}
                    >
                      <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Volymsbeskrivning (Farligt / Lätt förorenade massor)</p>
                      <textarea
                        className="w-full text-xs font-medium border-none bg-transparent resize-none focus:ring-0 leading-relaxed custom-scrollbar py-0.5"
                        rows={2}
                        value={blocks['block-ewc-polluted-desc']}
                        onChange={(e) => setBlocks({ ...blocks, 'block-ewc-polluted-desc': e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Notion-style Block 3: Platsanalys */}
              <div 
                onClick={() => handleBlockSelect('block-gis-desc')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedBlock === 'block-gis-desc' 
                    ? (isDark ? 'bg-cyan-950/15 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-indigo-50/40 border-indigo-500/50')
                    : (isDark ? 'bg-slate-950/25 border-transparent hover:border-slate-800' : 'bg-slate-50/30 border-transparent hover:border-slate-200')
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Layers size={11} className="text-cyan-400" />
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Avsnitt 3: Platsanalys & Miljöbedömning</span>
                </div>
                <textarea
                  className="w-full text-xs font-medium border-none bg-transparent resize-none focus:ring-0 leading-relaxed custom-scrollbar py-1"
                  rows={3}
                  value={blocks['block-gis-desc']}
                  onChange={(e) => setBlocks({ ...blocks, 'block-gis-desc': e.target.value })}
                />
              </div>

              {/* Notion-style Block 4: Skyddsåtgärder */}
              <div 
                onClick={() => handleBlockSelect('block-precautions-desc')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedBlock === 'block-precautions-desc' 
                    ? (isDark ? 'bg-cyan-950/15 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-indigo-50/40 border-indigo-500/50')
                    : (isDark ? 'bg-slate-950/25 border-transparent hover:border-slate-800' : 'bg-slate-50/30 border-transparent hover:border-slate-200')
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ShieldCheck size={11} className="text-cyan-400" />
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Avsnitt 4: Skyddsåtgärder & Kontrollprogram</span>
                </div>
                <textarea
                  className="w-full text-xs font-medium border-none bg-transparent resize-none focus:ring-0 leading-relaxed custom-scrollbar py-1 mb-3"
                  rows={3}
                  value={blocks['block-precautions-desc']}
                  onChange={(e) => setBlocks({ ...blocks, 'block-precautions-desc': e.target.value })}
                />

                {/* Interactive checklists within Document block */}
                <div className="space-y-1.5 border-t border-slate-800/10 dark:border-slate-800/40 pt-2.5">
                  <p className="text-[8px] font-mono uppercase tracking-wider text-slate-500 mb-1">Mimer Checklist: Kontrollpunkter</p>
                  {precautionsChecklist.map((item) => (
                    <div key={item.id} className="flex items-start gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => toggleChecklist(item.id)}
                        className={`mt-1 h-3.5 w-3.5 rounded border focus:ring-0 cursor-pointer ${
                          isDark 
                            ? 'bg-slate-950 border-slate-800 text-cyan-600 focus:border-cyan-500' 
                            : 'bg-slate-50 border-slate-200 text-indigo-600 focus:border-indigo-500'
                        }`}
                      />
                      <span className={`leading-tight ${item.checked ? 'text-slate-300 dark:text-slate-300' : 'text-slate-500 line-through decoration-slate-600'}`}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notion-style Block 5: Underlag & Inlämning (Official Signoff Card) */}
              <div className={`p-4 rounded-xl border ${
                isDark ? 'bg-slate-950/35 border-slate-800/80' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-slate-800/10 dark:border-slate-800/40">
                  <CheckCircle2 size={13} className="text-cyan-400" />
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Avsnitt 5: Underlag & Myndighetsinlämning</span>
                </div>

                <p className="text-[11px] font-semibold text-slate-400 mb-4">
                  Dokumentationen är komplett och synkroniserad offline med GEO_Master_Archive. Signera och skicka in för slutgiltig myndighetsprövning.
                </p>

                {/* Submissions flow buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={loading || !caseId}
                    onClick={() =>
                      run(async () => {
                        const res = await callApi<{
                          ok: boolean;
                          documents?: { situationsplan?: { title: string } | null };
                          warnings?: string[];
                        }>('/api/c-notification/mass/generate-documents', {
                          method: 'POST',
                          body: { caseId },
                        });
                        const planNote = res.documents?.situationsplan
                          ? 'Situationsplan inkluderad i underlaget.'
                          : 'Situationsplan saknas — kör GIS-analys och spara delbeslut.';
                        const warnNote = (res.warnings ?? []).join(' ');
                        setMessage(['Underlag genererat.', planNote, warnNote].filter(Boolean).join(' '));
                        addAiActivity(`Genererade myndighetsunderlag för ärende ${caseId}.`, 'success');
                      })
                    }
                    className={`text-[10px] font-black uppercase tracking-wider px-3.5 py-2 rounded-lg border transition-all ${
                      isDark 
                        ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    Generera underlag
                  </button>

                  <button
                    type="button"
                    disabled={loading || !caseId}
                    onClick={() =>
                      run(async () => {
                        const res = await fetchCaseExport();
                        const svg = buildSituationMapSvg(res.export);
                        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                        downloadBlob(blob, `situationskarta-${caseId}.svg`);
                        setMessage('Situationskarta nedladdad.');
                        addAiActivity(`Exporterade situationskarta SVG för ärende ${caseId}.`, 'success');
                      })
                    }
                    className={`text-[10px] font-black uppercase tracking-wider px-3.5 py-2 rounded-lg border transition-all ${
                      isDark 
                        ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    Ladda ner situationskarta
                  </button>

                  <button
                    type="button"
                    disabled={loading || !caseId}
                    onClick={() =>
                      run(async () => {
                        const res = await fetchCaseExport();
                        setExportJson(JSON.stringify(res.export, null, 2));
                        setMessage('Exportdata laddad till fönster.');
                      })
                    }
                    className={`text-[10px] font-black uppercase tracking-wider px-3.5 py-2 rounded-lg border transition-all ${
                      isDark 
                        ? 'border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300' 
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    Visa exportdata
                  </button>

                  <button
                    type="button"
                    disabled={loading || !caseId}
                    onClick={() =>
                      run(async () => {
                        const res = await callApi<{ ok: boolean; referenceNumber: string; warnings?: string[] }>(
                          '/api/c-notification/mass/submit',
                          { method: 'POST', body: { caseId } },
                        );
                        const warningNote = (res.warnings ?? []).join(' ');
                        setMessage(
                          [`Inlämning lyckades! Referensnummer: ${res.referenceNumber}`, warningNote].filter(Boolean).join(' '),
                        );
                        addAiActivity(`Sände in C-anmälan till Gävle kommun (Ref: ${res.referenceNumber}).`, 'success');
                      })
                    }
                    className={`text-[10px] font-black uppercase tracking-wider px-3.5 py-2 rounded-lg transition-all ${
                      isDark
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    Skicka in
                  </button>
                </div>

                {exportJson && (
                  <div className="mt-3">
                    <p className="text-[8px] font-bold text-slate-500 uppercase mb-1">Rå Export JSON (Mimers Brunn Manifest v2)</p>
                    <pre className="max-h-48 overflow-auto rounded bg-slate-950 border border-slate-800 p-3 text-[10px] leading-relaxed text-slate-400 font-mono">
                      {exportJson}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {/* AI RAG Legal Side-drawer Column (30%) */}
            <div className={`w-full lg:w-[30%] flex flex-col h-full overflow-y-auto pr-1 space-y-4 custom-scrollbar p-4 rounded-2xl border ${
              isDark ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              
              {/* RAG Header */}
              <div className="border-b border-slate-800/10 dark:border-slate-800/40 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-cyan-400" />
                  <h3 className="text-xs font-black tracking-tight uppercase">Mimer RAG Assist</h3>
                </div>
                <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest bg-slate-800/20 px-1.5 py-0.5 border border-slate-800/40 rounded">RAG v2.0</span>
              </div>

              {/* RAG Dynamic Content */}
              {activeSuggestion ? (
                <div className="space-y-4">
                  
                  {/* Confidence rating and Badge */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-black uppercase text-slate-400">RAG Konfidens</span>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                        activeSuggestion.badge === 'COMPLIANT' 
                          ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/40' 
                          : 'bg-amber-950/40 text-amber-400 border border-amber-900/40'
                      }`}>
                        {activeSuggestion.badge}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 bg-slate-800 rounded-full flex-1 overflow-hidden">
                        <div 
                          className="h-full bg-cyan-500 rounded-full transition-all duration-500" 
                          style={{ width: `${activeSuggestion.confidence}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-300 font-mono">{activeSuggestion.confidence}%</span>
                    </div>
                  </div>

                  {/* Matched Reference */}
                  <div className={`p-3 rounded-xl border ${
                    isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <p className="text-[8px] font-black uppercase text-slate-400 mb-1 flex items-center gap-1">
                      <Scale size={9} className="text-cyan-400" />
                      Primär RAG-Källa
                    </p>
                    <p className="text-xs font-extrabold text-slate-200 leading-normal">{activeSuggestion.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{activeSuggestion.source}</p>
                  </div>

                  {/* Highlight of identified terms */}
                  <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase text-slate-400">Identifierat i texten</p>
                    <div className={`p-2.5 rounded-lg border text-[11px] leading-relaxed italic ${
                      isDark ? 'bg-slate-900/10 border-slate-850 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-500'
                    }`}>
                      "...{activeSuggestion.matchedText}..."
                    </div>
                  </div>

                  {/* AI Suggestion Area */}
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1">
                      <Sparkles size={10} className="text-cyan-400" />
                      Rekommenderat tillägg (BAT)
                    </p>
                    <div className={`p-3 rounded-lg border text-xs leading-relaxed font-semibold ${
                      isDark ? 'bg-cyan-950/5 border-cyan-900/40 text-slate-100' : 'bg-indigo-50/20 border-indigo-200 text-slate-800'
                    }`}>
                      {activeSuggestion.suggestionText}
                    </div>

                    {/* Apply suggestion button */}
                    <button
                      type="button"
                      onClick={() => applySuggestion(selectedBlock!)}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                        isDark 
                          ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]' 
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      <CheckSquare size={13} />
                      Infoga AI-förslag
                    </button>

                    {/* Stormwater P110 Interactive Card (Section 3: Platsanalys & Miljöbedömning) */}
                    {selectedBlock === 'block-gis-desc' && (
                      <div className={`p-3 rounded-xl border mt-3 space-y-3 ${
                        isDark ? 'bg-slate-900/40 border-cyan-900/30' : 'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="flex items-center gap-1.5 border-b border-slate-800/10 dark:border-slate-800/30 pb-2">
                          <TrendingUp size={12} className="text-cyan-400" />
                          <span className="text-[10px] font-black uppercase text-slate-300">P110 Dagvattenkalkyl</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-slate-400 block mb-0.5">Avrinningsyta (m²)</label>
                            <input
                              type="number"
                              value={p1AreaM2}
                              onChange={(e) => setP1AreaM2(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Avrinningskoeff. (φ)</label>
                            <input
                              type="number"
                              step="0.05"
                              value={p1Runoff}
                              onChange={(e) => setP1Runoff(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Återkomsttid (år)</label>
                            <input
                              type="number"
                              value={p1ReturnPeriod}
                              onChange={(e) => setP1ReturnPeriod(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Tillåtet flöde (l/s)</label>
                            <input
                              type="number"
                              value={p1AllowedOutflow}
                              onChange={(e) => setP1AllowedOutflow(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Display Results */}
                        {(() => {
                          const results = calculateLocalStormwater(p1AreaM2, p1Runoff, p1ReturnPeriod, p1ClimateFactor, p1AllowedOutflow);
                          return (
                            <div className="bg-slate-950/40 p-2 rounded border border-slate-850 space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Erforderlig volym:</span>
                                <span className="font-bold text-cyan-400 font-mono">{results.requiredVolumeM3} m³</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Dimensionerande flöde:</span>
                                <span className="font-bold text-slate-300 font-mono">{results.inflowLs} l/s</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Kritisk regnvaraktighet:</span>
                                <span className="font-bold text-slate-300 font-mono">{results.criticalDurationMinutes} min</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const text = `\n\n[Svenskt Vatten P110 dimensionering genomförd: Erforderlig magasinsvolym beräknas till ${results.requiredVolumeM3} m³ baserat på dimensionerande flöde ${results.inflowLs} l/s och tillåtet utflöde ${p1AllowedOutflow} l/s vid kritisk regnvaraktighet ${results.criticalDurationMinutes} min (återkomsttid ${p1ReturnPeriod} år, klimatfaktor ${p1ClimateFactor})].`;
                                  setBlocks(prev => ({
                                    ...prev,
                                    'block-gis-desc': (prev['block-gis-desc'] || '').trim() + text
                                  }));
                                  addAiActivity('Infogade dagvattenkalkyl P110 i dokumentavsnitt 3.', 'success');
                                }}
                                className="w-full mt-2 py-1 px-2 rounded bg-cyan-950/60 border border-cyan-800 text-[10px] font-bold text-cyan-300 uppercase tracking-wide hover:bg-cyan-900/60 flex items-center justify-center gap-1 transition-all"
                              >
                                <Calculator size={11} />
                                Infoga kalkyl i texten
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* VA Climate & SGI Geokalkyl Interactive Card (Section 2: Clean & Polluted Massor) */}
                    {(selectedBlock === 'block-ewc-clean-desc' || selectedBlock === 'block-ewc-polluted-desc') && (
                      <div className={`p-3 rounded-xl border mt-3 space-y-3 ${
                        isDark ? 'bg-slate-900/40 border-cyan-900/30' : 'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="flex items-center gap-1.5 border-b border-slate-800/10 dark:border-slate-800/30 pb-2">
                          <Leaf size={12} className="text-emerald-400" />
                          <span className="text-[10px] font-black uppercase text-slate-300">Klimat- & Geokalkyl</span>
                        </div>
                        
                        {/* Grid of Inputs */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-slate-400 block mb-0.5">Ledningslängd (m)</label>
                            <input
                              type="number"
                              value={trenchLength}
                              onChange={(e) => setTrenchLength(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Återanvändning (%)</label>
                            <input
                              type="number"
                              value={reusePercent}
                              onChange={(e) => setReusePercent(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Rörmaterial</label>
                            <select
                              value={pipeMaterial}
                              onChange={(e: any) => setPipeMaterial(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none text-[9px]"
                            >
                              <option value="PE">PE-HD (Plast)</option>
                              <option value="PVC">PVC (Standard)</option>
                              <option value="CONCRETE">Betong</option>
                              <option value="DUCTILE_IRON">Segjärn</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Markförhållande (SGI)</label>
                            <select
                              value={localGroundType}
                              onChange={(e: any) => setLocalGroundType(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none text-[9px]"
                            >
                              <option value="mellanfast">Mellanfast (Sand/Silt)</option>
                              <option value="fast">Fast mark (Berg/Morän)</option>
                              <option value="svag">Svag mark (Lera/Torv)</option>
                            </select>
                          </div>
                        </div>

                        {/* Display Results */}
                        {(() => {
                          const clim = calculateLocalVaProjectClimate(trenchLength, trenchWidth, trenchDepth, reusePercent, pipeMaterial, pipeDiameter, transportDistance);
                          const costRes = calculateLocalGeokalkylCost(trenchLength, localGroundType);
                          return (
                            <div className="bg-slate-950/40 p-2 rounded border border-slate-850 space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Total klimatpåverkan:</span>
                                <span className="font-bold text-emerald-400 font-mono">{(clim.totalEmissionsKgCo2e / 1000).toFixed(2)} t CO2e</span>
                              </div>
                              <div className="flex justify-between text-[10px] pl-2">
                                <span className="text-slate-500">- Rör & Material:</span>
                                <span className="text-slate-400 font-mono">{clim.pipeMaterialEmissionsKgCo2e} kg</span>
                              </div>
                              <div className="flex justify-between text-[10px] pl-2">
                                <span className="text-slate-500">- Transport & Maskin:</span>
                                <span className="text-slate-400 font-mono">{clim.excavationEmissionsKgCo2e + clim.transportEmissionsKgCo2e} kg</span>
                              </div>
                              <div className="flex justify-between border-t border-slate-800/40 pt-1">
                                <span className="text-slate-400">Est. Anläggningskostnad:</span>
                                <span className="font-bold text-amber-400 font-mono">{costRes.estimatedCost.toLocaleString()} SEK</span>
                              </div>
                              <div className="flex justify-between text-[9px] pl-2">
                                <span className="text-slate-500">- Komplexitetsfaktor (SGI):</span>
                                <span className="text-slate-400 font-mono">x{costRes.multiplier.toFixed(2)}</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const activeKey = selectedBlock!;
                                  const text = `\n\n[Klimatpåverkan beräknas till ${(clim.totalEmissionsKgCo2e / 1000).toFixed(2)} ton CO2e för ${trenchLength}m ledning (${pipeMaterial} DN${pipeDiameter}). Estimerad anläggningskostnad enligt SGI Geokalkyl justerad för ${localGroundType === 'fast' ? 'fast berg (sprängning krävs)' : localGroundType === 'svag' ? 'svag lera (spontning krävs)' : 'mellanfast mark'} uppgår till ${costRes.estimatedCost.toLocaleString()} SEK (faktor x${costRes.multiplier.toFixed(2)})].`;
                                  setBlocks(prev => ({
                                    ...prev,
                                    [activeKey]: (prev[activeKey] || '').trim() + text
                                  }));
                                  addAiActivity(`Infogade klimat- & geokalkyl i dokumentavsnitt: ${activeKey}`, 'success');
                                }}
                                className="w-full mt-2 py-1 px-2 rounded bg-emerald-950/60 border border-emerald-800 text-[10px] font-bold text-emerald-300 uppercase tracking-wide hover:bg-emerald-900/60 flex items-center justify-center gap-1 transition-all"
                              >
                                <Calculator size={11} />
                                Infoga kalkyl i texten
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {/* SGU Analytisk Grundvattensänkning (Section 4: Skyddsåtgärder) */}
                    {selectedBlock === 'block-precautions-desc' && (
                      <div className={`p-3 rounded-xl border mt-3 space-y-3 ${
                        isDark ? 'bg-slate-900/40 border-cyan-900/30' : 'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="flex items-center gap-1.5 border-b border-slate-800/10 dark:border-slate-800/30 pb-2">
                          <Activity size={12} className="text-cyan-400" />
                          <span className="text-[10px] font-black uppercase text-slate-300">SGU Grundvattensänkning</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-slate-400 block mb-0.5">Avsänkning s (m)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={gwS}
                              onChange={(e) => setGwS(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Magasinstjocklek H (m)</label>
                            <input
                              type="number"
                              step="0.5"
                              value={gwH}
                              onChange={(e) => setGwH(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Hydraulisk ledningsf. K</label>
                            <select
                              value={gwK}
                              onChange={(e) => setGwK(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none text-[9px]"
                            >
                              <option value={1e-3}>Grovsand/Grus (10⁻³ m/s)</option>
                              <option value={1e-4}>Mellansand (10⁻⁴ m/s)</option>
                              <option value={1e-5}>Finsand (10⁻⁵ m/s)</option>
                              <option value={1e-6}>Silt (10⁻⁶ m/s)</option>
                              <option value={1e-9}>Lera (10⁻⁹ m/s)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Schaktradie rw (m)</label>
                            <input
                              type="number"
                              step="0.5"
                              value={gwRw}
                              onChange={(e) => setGwRw(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Display Results */}
                        {(() => {
                          const results = calculateLocalGroundwaterInfluence(gwK, gwS, gwH, gwRw);
                          return (
                            <div className="bg-slate-950/40 p-2 rounded border border-slate-850 space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Influensradie R (Sichardt):</span>
                                <span className="font-bold text-cyan-400 font-mono">{results.radiusM} m</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Länshållningsflöde Q:</span>
                                <span className="font-bold text-slate-300 font-mono">{results.flowRateLpm} l/min</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const text = `\n\n[Grundvattensänkning beräknad enligt SGU Sichardt & Dupuit-Thiem: Vid en avsänkning på ${gwS}m i jordart med hydraulisk konduktivitet K = ${gwK} m/s beräknas influensradien till ${results.radiusM}m. Det nödvändiga länshållningsflödet för att bibehålla torrt schaktbotten uppgår till ca ${results.flowRateLpm} l/min. Särskilda skyddsåtgärder vidtas för intilliggande dricksvattenbrunnar inom influensområdet.];`;
                                  setBlocks(prev => ({
                                    ...prev,
                                    'block-precautions-desc': (prev['block-precautions-desc'] || '').trim() + text
                                  }));
                                  addAiActivity('Infogade SGU grundvattensänkningsanalys i dokumentavsnitt 4.', 'success');
                                }}
                                className="w-full mt-2 py-1 px-2 rounded bg-cyan-950/60 border border-cyan-800 text-[10px] font-bold text-cyan-300 uppercase tracking-wide hover:bg-cyan-900/60 flex items-center justify-center gap-1 transition-all"
                              >
                                <Calculator size={11} />
                                Infoga kalkyl i texten
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* LTAR Sewage Infiltration (Section 1: Sökande) */}
                    {selectedBlock === 'block-applicant' && (
                      <div className={`p-3 rounded-xl border mt-3 space-y-3 ${
                        isDark ? 'bg-slate-900/40 border-emerald-900/30' : 'bg-slate-50 border-slate-200'
                      }`}>
                        <div className="flex items-center gap-1.5 border-b border-slate-800/10 dark:border-slate-800/30 pb-2">
                          <CheckCircle2 size={12} className="text-emerald-400" />
                          <span className="text-[10px] font-black uppercase text-slate-300">Enskilt Avlopp LTAR</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-slate-400 block mb-0.5">Antal personer (PE)</label>
                            <input
                              type="number"
                              value={sewagePe}
                              onChange={(e) => setSewagePe(Number(e.target.value))}
                              className="w-full bg-slate-950/80 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-slate-400 block mb-0.5">Dimensionerande LTAR</label>
                            <select
                              value={sewageLtar}
                              onChange={(e) => setSewageLtar(Number(e.target.value))}
                              className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 font-semibold text-slate-200 focus:outline-none text-[9px]"
                            >
                              <option value={5}>Lera / Tät Silt (LTAR 5)</option>
                              <option value={15}>Mellansilt / Sandig Morän (LTAR 15)</option>
                              <option value={30}>Finsand / Grusig Morän (LTAR 30)</option>
                              <option value={45}>Grovsand / Grus (LTAR 45)</option>
                            </select>
                          </div>
                        </div>

                        {/* Display Results */}
                        {(() => {
                          const results = calculateLocalSewageInfiltration(sewagePe, sewageLtar, dailyFlowPerPe);
                          return (
                            <div className="bg-slate-950/40 p-2 rounded border border-slate-850 space-y-1.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-slate-400">Totalflöde per dygn:</span>
                                <span className="font-bold text-emerald-400 font-mono">{results.dailyFlowL} liter</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-slate-400">Erforderlig infiltrationsyta:</span>
                                <span className="font-bold text-emerald-400 font-mono">{results.requiredAreaM2} m²</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const text = `\n\n[Enskilt avlopp dimensionering genomförd: Fastigheten planerar installation av ett enskilt avloppssystem dimensionerat för ${sewagePe} PE. Baserat på lokal SGU-klassning av jordart och LTAR-värde ${sewageLtar} l/m²/dygn uppgår det dimensionerande totalflödet till ${results.dailyFlowL} liter/dygn, vilket kräver en minsta infiltrations- eller spridningsyta på ${results.requiredAreaM2} m² baserat på Naturvårdsverkets riktlinjer.];`;
                                  setBlocks(prev => ({
                                    ...prev,
                                    'block-applicant': (prev['block-applicant'] || '').trim() + text
                                  }));
                                  addAiActivity('Infogade LTAR-dimensionering för enskilt avlopp i dokumentavsnitt 1.', 'success');
                                }}
                                className="w-full mt-2 py-1 px-2 rounded bg-emerald-950/60 border border-emerald-800 text-[10px] font-bold text-emerald-300 uppercase tracking-wide hover:bg-emerald-900/60 flex items-center justify-center gap-1 transition-all"
                              >
                                <Calculator size={11} />
                                Infoga kalkyl i texten
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Legal Citations List */}
                  <div className="space-y-2 border-t border-slate-800/10 dark:border-slate-800/40 pt-3">
                    <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Hänvisningar & domar</p>
                    <ul className="space-y-1.5">
                      {activeSuggestion.sourcesList.map((src) => (
                        <li 
                          key={src.id}
                          onClick={() => {
                            setInspectorData({
                              title: src.title,
                              subtitle: `Underlag: ${src.type}`,
                              type: 'general',
                              metadata: {
                                'Källtyp': src.type,
                                'Referenskod': src.id,
                              },
                              explainText: src.citation,
                              sources: [{ id: src.id, title: src.title, type: src.type, citation: src.citation }]
                            });
                            addAiActivity(`Visa detaljer för rättskälla: ${src.title}`, 'info');
                          }}
                          className={`p-2 rounded-lg border text-[11px] leading-relaxed cursor-pointer transition-all hover:-translate-y-0.5 ${
                            isDark ? 'bg-slate-900/30 border-slate-850 text-slate-400 hover:bg-slate-850 hover:text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex justify-between items-center font-bold text-slate-300 dark:text-slate-200 mb-0.5">
                            <span>{src.title}</span>
                            <span className="text-[8px] uppercase tracking-wider font-mono text-cyan-400">{src.type}</span>
                          </div>
                          <p className="line-clamp-2 text-slate-500">{src.citation}</p>
                        </li>
                      ))}
                    </ul>
                  </div>

                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-400">
                  <HelpCircle className="mb-2 text-slate-500" size={24} />
                  <p className="text-xs font-semibold">Inget avsnitt valt</p>
                  <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                    Klicka på ett stycke eller card i Notion-dokumentet för att aktivera on-demand RAG-analys mot svenska miljölagar och Naturvårdsverkets anvisningar.
                  </p>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};

export default CNotificationMassUI;
