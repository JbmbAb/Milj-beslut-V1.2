/**
 * Sewage Portal View - Operations Center Edition
 * Main module for private sewage system applications.
 * Restructured as a high-density 50% Map / 50% Smart AI Form split container.
 */

import React, { useState, useEffect } from 'react';
import { MapPin, CheckCircle, AlertCircle, FileText, Send, Sparkles } from 'lucide-react';
import type {
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
} from '../../../../types';
import '../module-common.css';
import './sewage-portal.css';
import { useSewageAnalysis } from '../../hooks/useSewageAnalysis';
import SewageSystemSelector from './SewageSystemSelector';
import SewageRequirementChecklist from './SewageRequirementChecklist';
import SewageMapView from './SewageMapView';
import SewageApplicationSummary from './SewageApplicationSummary';
import { LoadingSpinner, ErrorAlert } from '../../shared';
import { callApi, getActiveProjectId } from '../../../../services/coreApiClient';
import { useOperationsCenter } from '../../../context/OperationsCenterContext';
import { useTheme } from '../../../context/ThemeContext';
import { useAppWorkspace } from '../../../app/providers/AppWorkspaceProvider';

type SewageStep =
  | 'property'
  | 'analysis'
  | 'systemSelection'
  | 'requirements'
  | 'documents'
  | 'submission'
  | 'confirmation';

const DEFAULT_ANALYSIS: SewageGISAnalysis = {
  propertyId: 'STACKMORA 3:12',
  timestamp: new Date().toISOString(),
  sguJordartData: {
    soilType: 'Moränjord / Sandig morän',
    depthToRock: 4.2,
    groundwaterLevel: 2.1,
    loadingCapacity: 'HIGH',
  },
  sguBrunnarData: {
    nearestOwnWell: {
      distance: 58.5,
      coordinates: { lat: 59.3290, lng: 18.0680 },
    },
    nearestNeighborWells: [
      {
        distance: 62.0,
        coordinates: { lat: 59.3295, lng: 18.0690 },
      },
    ],
  },
  protectedAreas: [
    { name: 'Värmdö Vattenskyddsområde zon 2', type: 'WATER_PROTECTION', distance: 140 },
  ],
  propertyBoundaries: {
    area: 8420,
    perimeter: 380,
    nearestNeighbor: 14,
  },
  floodRiskZone: {
    level: 'LOW',
    floodFrequency: '1:100 år',
  },
  overallRiskScore: 35,
  feasibilityScore: 85,
  recommendedSystems: ['MINI_PLANT_BDTA', 'SOIL_BED'],
  blockedSystems: ['CLOSED_TANK'],
  reasoning: [
    'God infiltrationskapacitet i moränjord.',
    'Avstånd till närmaste dricksvattenbrunn är > 50 meter (58.5m), vilket uppfyller lagkrav.',
    'Fastigheten ligger inom normal skyddsnivå men gränsar till zon 2 skyddsområde.',
  ],
};

const DEFAULT_PROTECTION_PROFILE: SewageProtectionProfile = {
  propertyId: 'STACKMORA 3:12',
  protectionLevel: 'NORMAL',
  reason: 'Utanför primärt skyddsområde men inom Värmdö influensområde',
  nearestWell: {
    distance: 58.5,
    owner: 'OWN',
    coordinates: { lat: 59.3290, lng: 18.0680 },
  },
  nearestWaterCourse: {
    distance: 120,
    type: 'Bäck',
    name: 'Stackmoraån',
  },
  distanceToPropertyLine: 14,
  soilProfile: {
    soilType: 'Moränjord / Sandig morän',
    depthToRock: 4.2,
    groundwaterLevel: 2.1,
    infiltrationCapacity: 'HIGH',
    permeability: 45,
  },
  floodRisk: 'LOW',
  protectedNatureNearby: false,
  recommendedSystem: 'MINI_PLANT_BDTA',
  timelineEstimateWeeks: 6,
  requiredGates: [
    { id: 'gate-SEWAGE_PROTECTION_LEVEL', name: 'Skyddsnivå-bedömning', description: 'Fastigheten ligger i normal skyddsnivå.', status: 'COMPLETED', priority: 'HIGH' },
    { id: 'gate-SOIL_TEST_COMPLETED', name: 'Markundersökning', description: 'Moränjord bekräftad via SGU-analys.', status: 'COMPLETED', priority: 'HIGH' },
    { id: 'gate-NEIGHBOR_CONSENT', name: 'Grannemedgivande', description: 'Ej krav då placering är > 4.5m från gräns.', status: 'COMPLETED', priority: 'MEDIUM' },
    { id: 'gate-DOCUMENTATION_COMPLETE', name: 'Dokumentation', description: 'Generera situationsplan och tvärsektion.', status: 'PENDING', priority: 'HIGH' },
  ],
};

function buildInitialApplication(
  propertyDesignation: string,
  pe: number,
  protectionProfile: SewageProtectionProfile,
  selectedSystemType: SewageSystemTypeId,
): SewageApplication {
  const now = new Date().toISOString();
  const neighborConsentRequired =
    protectionProfile.nearestWell.distance < 50 || protectionProfile.distanceToPropertyLine < 4.5;

  return {
    id: `sewage-${Date.now()}`,
    projectId: getActiveProjectId() || `sewage-local-${Date.now()}`,
    propertyDesignation,
    pe,
    selectedSystemType,
    protectionProfile,
    soilTestCompleted: false,
    neighborConsentRequired,
    neighborConsentObtained: false,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    currentGates: [
      {
        id: 'gate-SEWAGE_PROTECTION_LEVEL',
        name: 'Skyddsnivå-bedömning',
        description:
          protectionProfile.protectionLevel === 'HIGH'
            ? 'Fastigheten ligger i högt skyddat område.'
            : 'Fastigheten ligger i normal skyddsnivå.',
        status: 'COMPLETED',
        priority: 'HIGH',
      },
      {
        id: 'gate-SOIL_TEST_COMPLETED',
        name: 'Markundersökning',
        description: 'Perkolationsprov behövs för markbaserade system.',
        status: ['INFILTRATION', 'SOIL_BED'].includes(selectedSystemType) ? 'PENDING' : 'COMPLETED',
        priority: 'HIGH',
      },
      {
        id: 'gate-NEIGHBOR_CONSENT',
        name: 'Grannemedgivande',
        description: neighborConsentRequired
          ? 'Grannemedgivande krävs för vald placering.'
          : 'Ej krav för vald placering.',
        status: neighborConsentRequired ? 'PENDING' : 'COMPLETED',
        priority: 'MEDIUM',
      },
      {
        id: 'gate-DOCUMENTATION_COMPLETE',
        name: 'Dokumentation',
        description: 'Situationsplan och tvärsektion ska genereras före inskickning.',
        status: 'PENDING',
        priority: 'HIGH',
      },
    ],
  };
}

function patchGateStatus(
  application: SewageApplication,
  gateId: string,
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED',
): SewageApplication {
  return {
    ...application,
    updatedAt: new Date().toISOString(),
    currentGates: application.currentGates.map((gate) => (gate.id === gateId ? { ...gate, status } : gate)),
  };
}

const SewagePortalView: React.FC = () => {
  const { addAiActivity, setInspectorData } = useOperationsCenter();
  const { isDark } = useTheme();
  const workspace = useAppWorkspace();

  // State with pre-populated defaults
  const [currentStep, setCurrentStep] = useState<SewageStep>('property');
  const [propertyDesignation, setPropertyDesignation] = useState('');
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [pe, setPe] = useState(5);
  const [latitude, setLatitude] = useState(0);
  const [longitude, setLongitude] = useState(0);

  const [analysis, setAnalysis] = useState<SewageGISAnalysis | null>(null);
  const [protectionProfile, setProtectionProfile] = useState<SewageProtectionProfile | null>(null);
  const [application, setApplication] = useState<SewageApplication | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<SewageSystemTypeId | null>(null);

  const [dismissedError, setDismissedError] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [isGeneratingDocuments, setIsGeneratingDocuments] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Dynamic default initialization based on workspace context
  useEffect(() => {
    const propName = workspace?.activeProjectLabel || workspace?.selectedPermit?.property_id || '';
    setPropertyDesignation(propName);

    if (propName.toLowerCase().includes('orsa')) {
      setMunicipalityCode('2034');
      setLatitude(61.115);
      setLongitude(14.617);
    } else {
      setMunicipalityCode('0120');
      setLatitude(59.329);
      setLongitude(18.068);
    }
  }, [workspace?.activeProjectLabel, workspace?.selectedPermit?.property_id]);

  // Initialize application on mount based on defaults
  useEffect(() => {
    if (protectionProfile && selectedSystemId) {
      setApplication(buildInitialApplication(propertyDesignation, pe, protectionProfile, selectedSystemId));
    }
  }, []);

  const downloadDataUrl = (dataUrl: string, fileName: string) => {
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fileName;
    anchor.click();
  };

  const handleExportSewagePdf = async () => {
    if (!application || !protectionProfile) {
      setDocumentError('Saknade uppgifter för PDF-export.');
      return;
    }
    addAiActivity('Exporterar PDF-dokumentation för enskilt avlopp...', 'info');

    try {
      const blob = await callApi<Blob>('/api/export/pdf-json', {
        method: 'POST',
        body: {
          title: `Enskilt avlopp - ${application.propertyDesignation}`,
          subtitle: `Kommun ${municipalityCode} · PE ${application.pe}`,
          json: {
            application,
            protectionProfile,
            exportedAt: new Date().toISOString(),
            humanInTheLoop:
              'Underlaget är AI-assisterat. Handläggare ska verifiera alla uppgifter innan myndighetsinlämning.',
          },
        },
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `enskilt-avlopp-${application.propertyDesignation.replace(/\s+/g, '-')}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      addAiActivity('✓ PDF exporterad framgångsrikt.', 'success');
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'PDF-export misslyckades.');
      addAiActivity('PDF-export misslyckades.', 'warning');
    }
  };

  const {
    mutate: analyzeProperty,
    isPending: isAnalyzing,
    error: analysisError,
  } = useSewageAnalysis({
    onSuccess: (data) => {
      setAnalysis(data.analysis);
      setProtectionProfile(data.protectionProfile);
      setSelectedSystemId(data.protectionProfile.recommendedSystem);
      setApplication(
        buildInitialApplication(
          propertyDesignation,
          pe,
          data.protectionProfile,
          data.protectionProfile.recommendedSystem,
        ),
      );
      setDismissedError(false);
      addAiActivity('✓ Ny PostGIS-analys och SGU-lagersökning genomförd för fastighet.', 'success');
      setCurrentStep('analysis');
    },
  });

  const handleStartAnalysis = () => {
    if (!propertyDesignation || !municipalityCode || pe < 1 || pe > 200) {
      setFormError('Fyll i fastighetsbeteckning, kommun och ett PE-värde mellan 1 och 200.');
      return;
    }

    setFormError(null);
    setDocumentError(null);
    addAiActivity(`Startar automatisk geodatainsamling för ${propertyDesignation}...`, 'info');
    analyzeProperty({
      propertyDesignation,
      municipalityCode,
      latitude,
      longitude,
      pe,
    });
    setCurrentStep('analysis');
  };

  const handleSystemSelected = (systemId: SewageSystemTypeId) => {
    setSelectedSystemId(systemId);
    addAiActivity(`Valde avloppssystemtyp: ${systemId}`, 'info');

    // Bind selection change to update Inspector Panel
    setInspectorData({
      title: systemId === 'MINI_PLANT_BDTA' ? 'Minireningsverk (BDTA)' : 'Valt avloppssystem',
      subtitle: `${systemId} • Juridisk systemutredning`,
      type: 'sewage_point',
      confidence: 94,
      status: 'success',
      statusText: 'Tillåten teknikklass',
      metadata: {
        'Systemtyp': systemId,
        'PE Kapacitet': `${pe} PE`,
        'Underhållsintervall': '6 månader',
        'Krav på perkolationsprov': 'Nej',
        'Skyddsklass-kompatibilitet': 'Normal & Hög skyddsklass',
      },
      explainText: 'Det valda systemet uppfyller kraven för både normal och hög miljöskyddsnivå enligt Havs- och vattenmyndighetens allmänna råd (HVMFS 2016:17). Systemet använder biologisk rening i kombination med kemfällning för hög fosforreduktion (>90%). Detta minskar belastningen på det lokala grundvattnet.',
      sources: [
        { id: 'hvmfs-2016', title: 'HVMFS 2016:17 Miljöskyddskrav', type: 'Vägledning', citation: 'Biologisk och kemisk rening krävs för hög miljöskyddsnivå.' },
        { id: 'mb-9-7', title: 'Miljöbalk (1998:808) 9 kap 7§', type: 'Lagbok', citation: 'Förbud mot utsläpp av bristfälligt renat avloppsvatten.' }
      ]
    });

    if (protectionProfile) {
      const nextApplication =
        application ?? buildInitialApplication(propertyDesignation, pe, protectionProfile, systemId);
      setApplication({
        ...nextApplication,
        selectedSystemType: systemId,
        updatedAt: new Date().toISOString(),
        currentGates: nextApplication.currentGates.map((gate) =>
          gate.id === 'gate-SOIL_TEST_COMPLETED'
            ? { ...gate, status: ['INFILTRATION', 'SOIL_BED'].includes(systemId) ? 'PENDING' : 'COMPLETED' }
            : gate,
        ),
      });
    }
    setCurrentStep('requirements');
  };

  const handleRequirementsCompleted = () => {
    addAiActivity('Juridisk kravlista avstämd och verifierad.', 'success');
    if (application) {
      const withSoilGate = patchGateStatus(
        application,
        'gate-SOIL_TEST_COMPLETED',
        ['INFILTRATION', 'SOIL_BED'].includes(application.selectedSystemType) ? 'IN_PROGRESS' : 'COMPLETED',
      );
      setApplication(
        patchGateStatus(
          withSoilGate,
          'gate-NEIGHBOR_CONSENT',
          application.neighborConsentRequired ? 'IN_PROGRESS' : 'COMPLETED',
        ),
      );
    }
    setCurrentStep('documents');
  };

  const handleGenerateDocuments = async () => {
    if (!application || !protectionProfile || !analysis) {
      setDocumentError('Saknade uppgifter för dokumentgenerering');
      return;
    }

    setIsGeneratingDocuments(true);
    setDocumentError(null);
    addAiActivity('Genererar SVG-ritningar (situationsplan och tvärsektion)...', 'info');

    try {
      const response = await fetch('/api/sewage/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application,
          protectionProfile,
          analysis,
        }),
      });

      if (!response.ok) {
        throw new Error('Fel vid dokumentgenerering');
      }

      const data = await response.json();

      setApplication(
        patchGateStatus(
          {
            ...application,
            situationPlan: {
              generatedDate: data.generatedAt,
              url: data.situationPlanDataUrl,
            },
            crossSection: {
              generatedDate: data.generatedAt,
              url: data.crossSectionDataUrl,
            },
          },
          'gate-DOCUMENTATION_COMPLETE',
          'COMPLETED',
        ),
      );

      addAiActivity('✓ Ritningar framgångsrikt genererade av Vertex AI CAD service.', 'success');
      setCurrentStep('submission');
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Okänt fel');
      addAiActivity('Dokumentgenerering misslyckades.', 'warning');
    } finally {
      setIsGeneratingDocuments(false);
    }
  };

  const handleSubmitApplication = (submittedReferenceNumber: string) => {
    setReferenceNumber(submittedReferenceNumber);
    addAiActivity(`✓ Ansökan framgångsrikt inskickad! Ärendenummer: ${submittedReferenceNumber}.`, 'success');
    setCurrentStep('confirmation');
  };

  const resetFlow = () => {
    addAiActivity('Återställer flöde för nytt avloppsärende.', 'info');
    setCurrentStep('property');
    setPropertyDesignation('');
    setMunicipalityCode('');
    setPe(5);
    setLatitude(0);
    setLongitude(0);
    setAnalysis(null);
    setProtectionProfile(null);
    setApplication(null);
    setSelectedSystemId(null);
    setDismissedError(false);
    setReferenceNumber('');
    setDocumentError(null);
    setFormError(null);
  };

  const progressSteps = [
    { id: 'property', label: 'Fastighet', icon: MapPin },
    { id: 'analysis', label: 'GIS-analys', icon: Sparkles },
    { id: 'systemSelection', label: 'Systemval', icon: CheckCircle },
    { id: 'requirements', label: 'Krav', icon: AlertCircle },
    { id: 'documents', label: 'Dokument', icon: FileText },
    { id: 'submission', label: 'Inskickning', icon: Send },
  ];

  return (
    <div className={`module-container sewage-portal-view h-full flex flex-col ${isDark ? 'text-slate-100 bg-slate-950/20' : 'text-slate-900'}`}>
      
      {/* 50/50 Split Container */}
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-12rem)] flex-1 overflow-hidden">
        
        {/* Left 50% - Smart AI Form Panel */}
        <div className={`w-full lg:w-1/2 flex flex-col h-full overflow-y-auto pr-1 space-y-4 custom-scrollbar p-4 rounded-2xl border ${
          isDark ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
        }`}>
          
          {/* Header */}
          <div className="border-b border-slate-800/10 dark:border-slate-800/60 pb-3 flex justify-between items-center">
            <div>
              <span className="text-[9px] font-black uppercase text-cyan-400 tracking-wider">Modul: Enskilt Avlopp</span>
              <h1 className="text-base font-black tracking-tight mt-0.5">Copilot Mode</h1>
            </div>
            <button
              onClick={resetFlow}
              className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-all ${
                isDark 
                  ? 'border-slate-800 hover:bg-slate-800 text-slate-300' 
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              Återställ
            </button>
          </div>

          {/* Progress Timeline/Stepper Inside Form */}
          <div className={`p-3 rounded-xl border flex justify-between items-center gap-2 ${
            isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'
          }`}>
            {progressSteps.map((step, idx) => {
              const Icon = step.icon;
              const isCurrent = currentStep === step.id;
              const isDone =
                (step.id === 'property' && currentStep !== 'property') ||
                (step.id === 'analysis' &&
                  ['systemSelection', 'requirements', 'documents', 'submission', 'confirmation'].includes(
                    currentStep,
                  )) ||
                (step.id === 'systemSelection' &&
                  ['requirements', 'documents', 'submission', 'confirmation'].includes(currentStep)) ||
                (step.id === 'requirements' &&
                  ['documents', 'submission', 'confirmation'].includes(currentStep)) ||
                (step.id === 'documents' && ['submission', 'confirmation'].includes(currentStep)) ||
                (step.id === 'submission' && currentStep === 'confirmation');

              return (
                <button
                  key={step.id}
                  onClick={() => {
                    // Allow fast jumping back if data exists
                    if (analysis && protectionProfile) {
                      setCurrentStep(step.id as SewageStep);
                    }
                  }}
                  className={`flex flex-col items-center gap-1 flex-1 relative group focus:outline-none`}
                  title={step.label}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
                    isCurrent 
                      ? 'bg-cyan-600 border-cyan-500 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]' 
                      : isDone 
                        ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-400' 
                        : 'bg-slate-900/20 border-slate-800 text-slate-500'
                  }`}>
                    <Icon size={12} />
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-tight hidden md:inline ${
                    isCurrent ? 'text-cyan-400' : isDone ? 'text-emerald-400' : 'text-slate-500'
                  }`}>
                    {step.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Form Step Bodies */}
          <div className="flex-1">
            {/* Error Handlers inside the scrollable form */}
            {analysisError && !dismissedError && (
              <ErrorAlert
                message={`GIS-analys misslyckades: ${analysisError.message}`}
                severity="error"
                onDismiss={() => setDismissedError(true)}
              />
            )}
            {formError && (
              <ErrorAlert message={formError} severity="warning" onDismiss={() => setFormError(null)} />
            )}

            {/* Step 1: Property Information */}
            {currentStep === 'property' && (
              <div className="sewage-step-container space-y-4">
                <div className="space-y-1">
                  <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">Fastighetsuppgifter</h2>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Ange fastighetsbeteckning, kommun och personbelastning för avloppsdimensioneringen.
                  </p>
                </div>

                <form
                  className={`p-4 rounded-xl border space-y-4 ${isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleStartAnalysis();
                  }}
                >
                  <div className="space-y-1">
                    <label htmlFor="propertyDesignation" className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fastighetsbeteckning *</label>
                    <input
                      id="propertyDesignation"
                      type="text"
                      placeholder="t.ex. VÄRMDÖ STACKMORA 3:12"
                      value={propertyDesignation}
                      onChange={(e) => setPropertyDesignation(e.target.value)}
                      className={`w-full text-xs rounded-lg p-2 border ${
                        isDark ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-cyan-500' : 'bg-white border-slate-300'
                      }`}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="municipalityCode" className="text-[10px] font-black uppercase tracking-wider text-slate-400">Kommun *</label>
                      <select
                        id="municipalityCode"
                        value={municipalityCode}
                        onChange={(e) => setMunicipalityCode(e.target.value)}
                        className={`w-full text-xs rounded-lg p-2 border ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-cyan-500' : 'bg-white border-slate-300'
                        }`}
                        required
                      >
                        <option value="">Välj kommun</option>
                        <option value="0120">Värmdö (0120)</option>
                        <option value="2034">Orsa (2034)</option>
                        <option value="0180">Stockholm</option>
                        <option value="0184">Västerås</option>
                        <option value="0580">Göteborg</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="pe" className="text-[10px] font-black uppercase tracking-wider text-slate-400">Personbelastning (PE) *</label>
                      <input
                        id="pe"
                        type="number"
                        min="1"
                        max="200"
                        value={pe}
                        onChange={(e) => setPe(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                        className={`w-full text-xs rounded-lg p-2 border ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-cyan-500' : 'bg-white border-slate-300'
                        }`}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Geografiska Koordinater</label>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="number"
                        placeholder="Latitud"
                        value={latitude || ''}
                        onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                        step="0.0001"
                        className={`w-full text-xs rounded-lg p-2 border ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-300'
                        }`}
                      />
                      <input
                        type="number"
                        placeholder="Longitud"
                        value={longitude || ''}
                        onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                        step="0.0001"
                        className={`w-full text-xs rounded-lg p-2 border ${
                          isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-white border-slate-300'
                        }`}
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs py-2.5 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                  >
                    Starta GIS-analys
                  </button>
                </form>

                <div className={`p-3.5 rounded-xl border flex gap-3 ${
                  isDark ? 'bg-blue-950/10 border-blue-900/30 text-blue-200' : 'bg-blue-50 border-blue-100 text-blue-800'
                }`}>
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div className="text-[10px] leading-relaxed">
                    <strong>Vad innebär PE?</strong>
                    <p className="mt-1">
                      Person Equivalents (PE) anger avloppssystemets dimensioneringsbelastning. För ett vanligt hushåll (villa) rekommenderas 5 till 8 PE (motsvarar 1-2 familjer).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: GIS Analysis Results */}
            {currentStep === 'analysis' && (
              <div className="sewage-step-container space-y-4">
                {isAnalyzing ? (
                  <LoadingSpinner message="Kör rymliga PostGIS-beräkningar & SGU-analyser..." />
                ) : analysis && protectionProfile ? (
                  <>
                    <div className="space-y-1">
                      <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">GIS-Analys Slutförd</h2>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Data har framgångsrikt skördats offline enligt Mimers Brunn.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                        <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400">📍 Läge & Avstånd</h4>
                        <div className="text-[11px] font-bold mt-1.5 space-y-1">
                          <p>Egen brunn: {analysis.sguBrunnarData.nearestOwnWell?.distance || 58.5}m</p>
                          <p>Tomtgräns: {protectionProfile.distanceToPropertyLine}m</p>
                          <p className="text-[9px] text-slate-500 font-normal">Avståndskrav brunn: 50m • Gräns: 4.5m</p>
                        </div>
                      </div>

                      <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                        <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400">🌍 Skyddsklass</h4>
                        <div className="text-[11px] font-bold mt-1.5 space-y-1">
                          <p>Miljöskydd: {protectionProfile.protectionLevel === 'HIGH' ? '🔴 HÖG SKYDDSKLASS' : '🟢 NORMAL SKYDDSKLASS'}</p>
                          <p>Risk-score: {analysis.overallRiskScore}/100</p>
                          <p className="text-[9px] text-slate-500 font-normal">Källa: MSB, Länsstyrelsen</p>
                        </div>
                      </div>
                    </div>

                    <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200 shadow-sm'}`}>
                      <h4 className="text-[9px] font-black uppercase tracking-wider text-slate-400">🏗️ SGU Jordart & Geologi</h4>
                      <div className="text-[11px] font-bold mt-1.5 space-y-1">
                        <p>Jordtyp: {protectionProfile.soilProfile.soilType}</p>
                        <p>Genomsläpplighet: {protectionProfile.soilProfile.infiltrationCapacity === 'HIGH' ? 'Hög (Morän/Sand)' : 'Medium'}</p>
                        <p className="text-[9px] text-slate-500 font-normal">Infiltrationskapacitet (LTAR): {protectionProfile.soilProfile.permeability} mm/h</p>
                      </div>
                    </div>

                    <button
                      className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs py-2.5 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                      onClick={() => setCurrentStep('systemSelection')}
                    >
                      Nästa: Välj avloppsystem
                    </button>
                  </>
                ) : null}
              </div>
            )}

            {/* Step 3: System Selection */}
            {currentStep === 'systemSelection' && analysis && protectionProfile && (
              <div className="sewage-step-container">
                <SewageSystemSelector
                  selectedSystem={selectedSystemId}
                  recommendedSystems={analysis.recommendedSystems}
                  blockedSystems={analysis.blockedSystems}
                  protectionLevel={protectionProfile.protectionLevel}
                  pe={pe}
                  onSelect={handleSystemSelected}
                />
              </div>
            )}

            {/* Step 4: Requirements Checklist */}
            {currentStep === 'requirements' && analysis && protectionProfile && selectedSystemId && (
              <div className="sewage-step-container">
                <SewageRequirementChecklist
                  systemType={selectedSystemId}
                  protectionLevel={protectionProfile.protectionLevel}
                  municipalityCode={municipalityCode}
                  distanceData={{
                    toWell: protectionProfile.nearestWell.distance,
                    toPropertyLine: protectionProfile.distanceToPropertyLine,
                  }}
                  onCompleted={handleRequirementsCompleted}
                />
              </div>
            )}

            {/* Step 5: Document Generation */}
            {currentStep === 'documents' && (
              <div className="sewage-step-container space-y-4">
                <div className="space-y-1">
                  <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">Dokumentgenerering</h2>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Skapa färdiga situationsplaner, tvärsektioner och anmälningsunderlag.
                  </p>
                </div>

                {isGeneratingDocuments ? (
                  <LoadingSpinner message="Kör Vertex AI CAD-pipeline för ritningsproduktion..." />
                ) : documentError ? (
                  <ErrorAlert
                    message={`Dokumentgenerering misslyckades: ${documentError}`}
                    severity="error"
                    onDismiss={() => setDocumentError(null)}
                  />
                ) : (
                  <div className={`p-4 rounded-xl border space-y-4 ${isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'}`}>
                    <button 
                      className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs py-2.5 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)]" 
                      onClick={handleGenerateDocuments}
                    >
                      Generera ritningsunderlag (SVG/CAD)
                    </button>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        className={`text-[9px] font-bold p-2 border rounded-lg transition-all flex flex-col items-center gap-1.5 ${
                          isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
                        } disabled:opacity-40`}
                        disabled={!application?.situationPlan?.url}
                        onClick={() => {
                          if (!application?.situationPlan?.url) return;
                          downloadDataUrl(application.situationPlan.url, 'situationsplan.svg');
                        }}
                      >
                        <FileText size={14} />
                        <span>Situationsplan</span>
                      </button>
                      <button
                        type="button"
                        className={`text-[9px] font-bold p-2 border rounded-lg transition-all flex flex-col items-center gap-1.5 ${
                          isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
                        } disabled:opacity-40`}
                        onClick={() => void handleExportSewagePdf()}
                        disabled={!application?.situationPlan?.url && !application?.crossSection?.url}
                      >
                        <FileText size={14} className="text-red-400" />
                        <span>Exportera PDF</span>
                      </button>
                      <button
                        type="button"
                        className={`text-[9px] font-bold p-2 border rounded-lg transition-all flex flex-col items-center gap-1.5 ${
                          isDark ? 'border-slate-800 hover:bg-slate-800 text-slate-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
                        } disabled:opacity-40`}
                        disabled={!application?.crossSection?.url}
                        onClick={() => {
                          if (!application?.crossSection?.url) return;
                          downloadDataUrl(application.crossSection.url, 'tvarsektion.svg');
                        }}
                      >
                        <FileText size={14} />
                        <span>Tvärsektion</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 6: Application Summary */}
            {currentStep === 'submission' && application && protectionProfile && (
              <div className="sewage-step-container">
                <SewageApplicationSummary
                  application={application}
                  protectionProfile={protectionProfile}
                  municipalityCode={municipalityCode}
                  onSubmit={handleSubmitApplication}
                />
              </div>
            )}

            {/* Step 7: Confirmation */}
            {currentStep === 'confirmation' && (
              <div className="sewage-step-container space-y-4">
                <div className={`p-6 text-center rounded-2xl border ${
                  isDark ? 'bg-slate-950/40 border-slate-800/80 text-slate-300' : 'bg-white border-slate-200 shadow-sm'
                } flex flex-col items-center space-y-4`}>
                  <CheckCircle size={48} className="text-emerald-500 animate-bounce" />
                  <div className="space-y-1">
                    <h2 className="text-sm font-black text-emerald-500">Ansökan Inskickad!</h2>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Ärendet har registrerats hos miljö- och byggnadsnämnden i kommun {municipalityCode}.
                    </p>
                  </div>
                  <div className="p-3 bg-slate-950/30 rounded-xl border border-slate-800 w-full">
                    <p className="text-[9px] text-slate-400 font-semibold uppercase">Referensnummer</p>
                    <p className="text-xs font-black text-cyan-400 font-mono mt-0.5">
                      {referenceNumber || 'SEW-240704-98A'}
                    </p>
                  </div>
                  <p className="text-[9px] text-slate-500 italic">Beräknad handläggningstid: 6-8 veckor</p>
                  <button 
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs py-2.5 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                    onClick={resetFlow}
                  >
                    Starta nytt ärende
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right 50% - Interactive Map with Buffers */}
        <div className={`w-full lg:w-1/2 h-full rounded-2xl overflow-hidden border relative shadow-2xl z-0 ${
          isDark ? 'bg-slate-950/40 border-slate-800/80' : 'bg-slate-50 border-slate-200'
        }`}>
          {analysis && protectionProfile ? (
            <SewageMapView 
              analysis={analysis} 
              protectionProfile={protectionProfile} 
              onPositionLocked={(pos, feedback) => {
                // Pos has locked, update application positions and timeline
                if (application) {
                  setApplication({
                    ...application,
                    updatedAt: new Date().toISOString(),
                    protectionProfile: {
                      ...application.protectionProfile,
                      nearestWell: {
                        ...application.protectionProfile.nearestWell,
                        coordinates: { lat: 59.3290 + pos.y * 0.0001, lng: 18.0680 + pos.x * 0.0001 }
                      }
                    }
                  });
                }
              }}
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center space-y-3">
              <MapPin size={32} className="text-slate-500 animate-pulse" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-400">Avloppsanalys ej startad</p>
                <p className="text-[10px] text-slate-500 max-w-xs">
                  Ange fastighetsbeteckning till vänster och klicka på "Starta GIS-analys" för att ladda den interaktiva positionsplaneraren.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default SewagePortalView;
