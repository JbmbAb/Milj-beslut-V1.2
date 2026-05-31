/**
 * Sewage Portal View
 * Main module for private sewage system applications
 * Workflow: Property → GIS Analysis → System Selection → Validation → Submission
 */

import React, { useState } from 'react';
import { MapPin, CheckCircle, AlertCircle, FileText, Send } from 'lucide-react';
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

type SewageStep =
  | 'property'
  | 'analysis'
  | 'systemSelection'
  | 'requirements'
  | 'documents'
  | 'submission'
  | 'confirmation';

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
  const [currentStep, setCurrentStep] = useState<SewageStep>('property');
  const [propertyDesignation, setPropertyDesignation] = useState('');
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [pe, setPe] = useState(8);
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
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'PDF-export misslyckades.');
    }
  };

  // Mutation for GIS analysis
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

      // Update application with generated documents
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

      setCurrentStep('submission');
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Okänt fel');
    } finally {
      setIsGeneratingDocuments(false);
    }
  };

  const handleSubmitApplication = (submittedReferenceNumber: string) => {
    setReferenceNumber(submittedReferenceNumber);
    setCurrentStep('confirmation');
  };

  const resetFlow = () => {
    setCurrentStep('property');
    setPropertyDesignation('');
    setMunicipalityCode('');
    setPe(8);
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
    { id: 'analysis', label: 'GIS-analys', icon: MapPin },
    { id: 'systemSelection', label: 'Systemval', icon: CheckCircle },
    { id: 'requirements', label: 'Krav', icon: AlertCircle },
    { id: 'documents', label: 'Dokument', icon: FileText },
    { id: 'submission', label: 'Inskickning', icon: Send },
  ];

  return (
    <div className="module-container sewage-portal-view">
      {/* Progress Indicator */}
      <div className="sewage-progress-bar">
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
            <div
              key={step.id}
              className={`sewage-progress-step ${isCurrent ? 'active' : ''} ${isDone ? 'done' : ''}`}
            >
              <div className={`sewage-progress-icon ${isCurrent ? 'active' : isDone ? 'done' : ''}`}>
                <Icon size={16} />
              </div>
              <span className="sewage-progress-label">{step.label}</span>
              {idx < progressSteps.length - 1 && <div className="sewage-progress-connector" />}
            </div>
          );
        })}
      </div>

      {/* Error Handling */}
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
        <div className="sewage-step-container">
          <div className="module-header">
            <h1 className="module-title">Börja här: Fastighetsuppgifter</h1>
            <p className="module-subtitle">
              Ange fastighetsbeteckning och antal personer som systemet ska dimensioneras för (1-200 PE)
            </p>
          </div>

          <form
            className="sewage-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleStartAnalysis();
            }}
          >
            <div className="sewage-form-group">
              <label htmlFor="propertyDesignation">Fastighetsbeteckning *</label>
              <input
                id="propertyDesignation"
                type="text"
                placeholder="t.ex. 1234-567-890"
                value={propertyDesignation}
                onChange={(e) => setPropertyDesignation(e.target.value)}
                required
              />
            </div>

            <div className="sewage-form-row">
              <div className="sewage-form-group">
                <label htmlFor="municipalityCode">Kommun *</label>
                <select
                  id="municipalityCode"
                  value={municipalityCode}
                  onChange={(e) => setMunicipalityCode(e.target.value)}
                  required
                >
                  <option value="">Välj kommun</option>
                  <option value="0180">Stockholm</option>
                  <option value="0184">Västerås</option>
                  <option value="0580">Göteborg</option>
                  <option value="1280">Malmö</option>
                  <option value="3100">Uppsala</option>
                  {/* Add more municipalities */}
                </select>
              </div>

              <div className="sewage-form-group">
                <label htmlFor="pe">Person Equivalents (PE) *</label>
                <div className="sewage-pe-input">
                  <input
                    id="pe"
                    type="number"
                    min="1"
                    max="200"
                    value={pe}
                    onChange={(e) => setPe(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                    required
                  />
                  <span className="sewage-pe-helper">1-200 personer</span>
                </div>
              </div>
            </div>

            <div className="sewage-form-group">
              <label>Lägg till geografiska koordinater (valfritt)</label>
              <div className="sewage-form-row">
                <input
                  type="number"
                  placeholder="Latitud"
                  value={latitude || ''}
                  onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                  step="0.0001"
                />
                <input
                  type="number"
                  placeholder="Longitud"
                  value={longitude || ''}
                  onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                  step="0.0001"
                />
              </div>
            </div>

            <button type="submit" className="sewage-button sewage-button-primary">
              Starta GIS-analys
            </button>
          </form>

          <div className="sewage-info-box">
            <AlertCircle size={18} />
            <div>
              <strong>Vad är PE?</strong>
              <p>Person Equivalents (PE) motsvarar belastningen från en person per dag. Vanligtvis:</p>
              <ul>
                <li>1 person = 1 PE</li>
                <li>Vi utgår från 8 PE för en genomsnittlig villa med 4 personer</li>
                <li>Stöd finns upp till 200 PE för större installationer</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: GIS Analysis */}
      {currentStep === 'analysis' && (
        <div className="sewage-step-container">
          {isAnalyzing ? (
            <LoadingSpinner message="Analyserar GIS-data från SGU, Lantmäteriet och Naturvårdsverket..." />
          ) : analysis && protectionProfile ? (
            <>
              <div className="module-header">
                <h1 className="module-title">GIS-Analys Genomförd</h1>
                <p className="module-subtitle">Resultatet baseras på:</p>
              </div>

              <div className="sewage-analysis-results">
                <div className="sewage-result-card">
                  <h3>📍 Läge & Avstånd</h3>
                  <p>Närmaste brunn: {analysis.sguBrunnarData.nearestOwnWell?.distance || 0}m (krav: 50m)</p>
                  <p>Avstånd till tomtgräns: {protectionProfile.distanceToPropertyLine}m (krav: 4.5m)</p>
                </div>

                <div className="sewage-result-card">
                  <h3>🌍 Miljöstatus</h3>
                  <p>
                    Skyddsnivå:{' '}
                    {protectionProfile.protectionLevel === 'HIGH'
                      ? '🔴 Högt skyddad område'
                      : '🟢 Normal skyddsnivå'}
                  </p>
                  <p>Risk-poäng: {analysis.overallRiskScore}/100</p>
                </div>

                <div className="sewage-result-card">
                  <h3>🏗️ Jordbeskaffenhet</h3>
                  <p>Jordtyp: {protectionProfile.soilProfile.soilType}</p>
                  <p>Infiltrationskapacitet: {protectionProfile.soilProfile.infiltrationCapacity}</p>
                </div>
              </div>

              <SewageMapView analysis={analysis} protectionProfile={protectionProfile} />

              <button
                className="sewage-button sewage-button-primary"
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

      {/* Step 4: Requirements & Gates */}
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

      {/* Step 5: Documents */}
      {currentStep === 'documents' && (
        <div className="sewage-step-container">
          <div className="module-header">
            <h1 className="module-title">Dokumentgenerering</h1>
            <p className="module-subtitle">Situationsplan, tvärsektion och ansökningssammanfattning</p>
          </div>

          {isGeneratingDocuments ? (
            <LoadingSpinner message="Genererar situationsplan och tvärsektion..." />
          ) : documentError ? (
            <ErrorAlert
              message={`Dokumentgenerering misslyckades: ${documentError}`}
              severity="error"
              onDismiss={() => setDocumentError(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              <button className="sewage-button sewage-button-primary" onClick={handleGenerateDocuments}>
                Generera underlag
              </button>
              <button
                type="button"
                className="sewage-button"
                disabled={!application?.situationPlan?.url}
                onClick={() => {
                  if (!application?.situationPlan?.url) return;
                  downloadDataUrl(application.situationPlan.url, 'situationsplan.svg');
                }}
              >
                Ladda ner situationskarta
              </button>
              <button
                type="button"
                className="sewage-button"
                onClick={() => void handleExportSewagePdf()}
                disabled={!application?.situationPlan?.url && !application?.crossSection?.url}
              >
                Exportera PDF
              </button>
              <button
                type="button"
                className="sewage-button"
                disabled={!application?.crossSection?.url}
                onClick={() => {
                  if (!application?.crossSection?.url) return;
                  downloadDataUrl(application.crossSection.url, 'tvarsektion.svg');
                }}
              >
                Ladda ner tvärsektion
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 6: Submission */}
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
        <div className="sewage-step-container">
          <div className="sewage-confirmation">
            <CheckCircle size={64} color="#4CAF50" />
            <h2>Ansökan skickad!</h2>
            <p>Din ansökan har skickats till kommunen.</p>
            <p className="sewage-reference">
              Referensnummer:{' '}
              {referenceNumber || localStorage.getItem('sewage-application-ref') || 'Läser...'}
            </p>
            <p className="sewage-timeline">Beräknad handläggningstid: 6-8 veckor</p>

            <button className="sewage-button sewage-button-primary" onClick={resetFlow}>
              Starta nytt ärende
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SewagePortalView;
