/**
 * Green Check Editor
 * Display and edit ESG assessment with source tracing
 */

import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, FileDown } from 'lucide-react';
import { downloadPdfFromJson } from '../../../../services/pdfExportClient';
import type { GeneratedGreenCheck } from '../../../../src/types/generators';
import './green-check-editor.css';

export interface GreenCheckEditorProps {
  assessment: GeneratedGreenCheck;
  onSave?: (updated: GeneratedGreenCheck) => void;
  onCancel?: () => void;
}

type EditorTab = 'overview' | 'esg' | 'taxonomy' | 'regulatory' | 'financing' | 'csrd' | 'recommendations';

const GreenCheckEditor: React.FC<GreenCheckEditorProps> = ({ assessment, onSave, onCancel }) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('overview');
  const [editable] = useState<GeneratedGreenCheck>(assessment);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleSave = () => {
    onSave?.(editable);
  };

  const handleExportPdf = async () => {
    setPdfError(null);
    setPdfBusy(true);
    try {
      await downloadPdfFromJson({
        title: 'Green Check – bedömning',
        subtitle: editable.organizationNumber,
        json: editable,
        fallbackFilename: 'green-check.pdf',
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF-export misslyckades.');
    } finally {
      setPdfBusy(false);
    }
  };

  const getRatingColor = (rating: string): string => {
    const colors: Record<string, string> = {
      AAA: '#10b981',
      AA: '#34d399',
      A: '#6ee7b7',
      BBB: '#fbbf24',
      BB: '#f97316',
      B: '#f97316',
      CCC: '#dc2626',
      CC: '#991b1b',
      C: '#7f1d1d',
      D: '#500724',
    };
    return colors[rating] || '#6b7280';
  };

  const getRiskColor = (score: number): string => {
    if (score < 30) return '#10b981'; // Low
    if (score < 60) return '#fbbf24'; // Medium
    return '#dc2626'; // High
  };

  return (
    <div className="green-check-editor">
      {/* Tabs */}
      <div className="green-check-editor-tabs">
        <button
          className={`green-check-editor-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          📊 Överblick
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'esg' ? 'active' : ''}`}
          onClick={() => setActiveTab('esg')}
        >
          🌍 ESG-rating
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'taxonomy' ? 'active' : ''}`}
          onClick={() => setActiveTab('taxonomy')}
        >
          🏭 EU Taxonomy
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'regulatory' ? 'active' : ''}`}
          onClick={() => setActiveTab('regulatory')}
        >
          ⚖️ Risk & Regler
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'financing' ? 'active' : ''}`}
          onClick={() => setActiveTab('financing')}
        >
          💰 Grön Finansiering
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'csrd' ? 'active' : ''}`}
          onClick={() => setActiveTab('csrd')}
        >
          📋 CSRD
        </button>
        <button
          className={`green-check-editor-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          💡 Rekommendationer
        </button>
      </div>

      {/* Content */}
      <div className="green-check-editor-content">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="green-check-editor-section">
            <h2>Bedömningsöverblick</h2>

            {/* Rating Cards */}
            <div className="green-check-editor-grid-2">
              <div className="green-check-editor-card">
                <h3>ESG-rating</h3>
                <div
                  className="green-check-rating-badge"
                  style={{ color: getRatingColor(editable.esgRating.rating) }}
                >
                  {editable.esgRating.rating}
                </div>
                <p className="label">Totalpoäng: {editable.esgRating.overallScore}</p>
              </div>

              <div className="green-check-editor-card">
                <h3>Regulatorisk Risk</h3>
                <div
                  className="green-check-rating-badge"
                  style={{ color: getRiskColor(editable.regulatoryRiskAssessment.overallRiskScore) }}
                >
                  {editable.regulatoryRiskAssessment.overallRiskScore}
                </div>
                <p className="label">
                  {editable.regulatoryRiskAssessment.overallRiskScore < 30 && 'Låg risk'}
                  {editable.regulatoryRiskAssessment.overallRiskScore >= 30 &&
                    editable.regulatoryRiskAssessment.overallRiskScore < 60 &&
                    'Medel risk'}
                  {editable.regulatoryRiskAssessment.overallRiskScore >= 60 && 'Hög risk'}
                </p>
              </div>
            </div>

            {/* Sub-scores */}
            <div className="green-check-editor-subsection">
              <h3>ESG-komponenter</h3>
              <div className="green-check-score-row">
                <div className="green-check-score-item">
                  <span className="label">Miljö (E)</span>
                  <div
                    className="green-check-score-bar"
                    style={{
                      width: editable.esgRating.environmentalScore + '%',
                      backgroundColor: '#10b981',
                    }}
                  />
                  <span className="value">{editable.esgRating.environmentalScore}</span>
                </div>
                <div className="green-check-score-item">
                  <span className="label">Socialt (S)</span>
                  <div
                    className="green-check-score-bar"
                    style={{
                      width: editable.esgRating.socialScore + '%',
                      backgroundColor: '#3b82f6',
                    }}
                  />
                  <span className="value">{editable.esgRating.socialScore}</span>
                </div>
                <div className="green-check-score-item">
                  <span className="label">Styrning (G)</span>
                  <div
                    className="green-check-score-bar"
                    style={{
                      width: editable.esgRating.governanceScore + '%',
                      backgroundColor: '#8b5cf6',
                    }}
                  />
                  <span className="value">{editable.esgRating.governanceScore}</span>
                </div>
              </div>
            </div>

            {/* Strengths & Weaknesses */}
            <div className="green-check-editor-grid-2">
              <div className="green-check-editor-subsection">
                <h3>✓ Styrkor</h3>
                <ul className="green-check-list">
                  {editable.esgRating.strengths.map((strength, idx) => (
                    <li key={idx}>{strength}</li>
                  ))}
                </ul>
              </div>
              <div className="green-check-editor-subsection">
                <h3>⚠ Svaghet</h3>
                <ul className="green-check-list">
                  {editable.esgRating.weaknesses.map((weakness, idx) => (
                    <li key={idx}>{weakness}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ESG Tab */}
        {activeTab === 'esg' && (
          <div className="green-check-editor-section">
            <h2>ESG-klassificering</h2>
            <p className="description">
              Miljö-, sociala och styrningskriterier enligt internationell standard
            </p>
            {/* Detailed ESG breakdown */}
          </div>
        )}

        {/* Taxonomy Tab */}
        {activeTab === 'taxonomy' && (
          <div className="green-check-editor-section">
            <h2>EU Taxonomy Compliance</h2>

            <div className="green-check-editor-subsection">
              <h3>Aktiviteter enligt EU Taxonomy</h3>
              <div className="green-check-taxonomy-breakdown">
                <div className="green-check-taxonomy-item">
                  <div className="green-check-taxonomy-label">Hållbara aktiviteter (ALIGNED)</div>
                  <div className="green-check-taxonomy-bar">
                    <div
                      className="green-check-taxonomy-portion aligned"
                      style={{ width: editable.euTaxonomyCompliance.alignmentPercentage + '%' }}
                    />
                    <span>{editable.euTaxonomyCompliance.alignmentPercentage}%</span>
                  </div>
                </div>
                <div className="green-check-taxonomy-item">
                  <div className="green-check-taxonomy-label">Övergångsaktiviteter (TRANSITION)</div>
                  <div className="green-check-taxonomy-bar">
                    <div
                      className="green-check-taxonomy-portion transition"
                      style={{ width: editable.euTaxonomyCompliance.transitionPercentage + '%' }}
                    />
                    <span>{editable.euTaxonomyCompliance.transitionPercentage}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Aligned Activities */}
            {editable.euTaxonomyCompliance.alignedActivities.length > 0 && (
              <div className="green-check-editor-subsection">
                <h3>✓ Hållbara aktiviteter</h3>
                {editable.euTaxonomyCompliance.alignedActivities.map((activity, idx) => (
                  <div key={idx} className="green-check-activity-card aligned">
                    <div className="green-check-activity-header">
                      <h4>{activity.name}</h4>
                      <span className="badge">{activity.percentage}%</span>
                    </div>
                    <p>{activity.description}</p>
                    <div className="green-check-criteria">
                      {activity.technicalScreeningCriteria.map((criterion, cidx) => (
                        <span key={cidx} className="criterion">
                          {criterion}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DNSH Assessment */}
            <div className="green-check-editor-subsection">
              <h3>Do No Significant Harm (DNSH)</h3>
              <div className="green-check-dnsh-grid">
                {[
                  { key: 'climateChange', label: 'Klimat' },
                  { key: 'waterPollution', label: 'Vatten' },
                  { key: 'circularEconomy', label: 'Cirkulär ekonomi' },
                  { key: 'pollution', label: 'Föroreningar' },
                  { key: 'biodiversity', label: 'Biodiversitet' },
                ].map((item) => (
                  <div key={item.key} className="green-check-dnsh-item">
                    <h4>{item.label}</h4>
                    <p>
                      {
                        editable.euTaxonomyCompliance.doNoSignificantHarmAssessment[
                          item.key as keyof typeof editable.euTaxonomyCompliance.doNoSignificantHarmAssessment
                        ] as string
                      }
                    </p>
                  </div>
                ))}
              </div>
              <div className="green-check-dnsh-status">
                Status:{' '}
                <strong>{editable.euTaxonomyCompliance.doNoSignificantHarmAssessment.overallStatus}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Regulatory Risk Tab */}
        {activeTab === 'regulatory' && (
          <div className="green-check-editor-section">
            <h2>Regulatorisk Risk & Compliance</h2>

            {/* CSRD Compliance */}
            <div className="green-check-editor-subsection">
              <h3>CSRD-rapportéringskrav</h3>
              <div className="green-check-compliance-card">
                <div className="green-check-compliance-item">
                  <strong>Kräv:</strong>{' '}
                  {editable.regulatoryRiskAssessment.csrdCompliance.required ? 'JA' : 'NEJ'}
                </div>
                <div className="green-check-compliance-item">
                  <strong>Anledning:</strong> {editable.regulatoryRiskAssessment.csrdCompliance.reason}
                </div>
                <div className="green-check-compliance-item">
                  <strong>Deadline:</strong> {editable.regulatoryRiskAssessment.csrdCompliance.deadline}
                </div>
                <div className="green-check-compliance-item">
                  <strong>Risknivå:</strong>{' '}
                  <span
                    className={`risk-level ${editable.regulatoryRiskAssessment.csrdCompliance.riskLevel.toLowerCase()}`}
                  >
                    {editable.regulatoryRiskAssessment.csrdCompliance.riskLevel}
                  </span>
                </div>
              </div>
            </div>

            {/* Taxonomy Risks */}
            <div className="green-check-editor-subsection">
              <h3>Taxonomy-relaterade risker</h3>
              <div className="green-check-taxonomy-risks">
                <div className="green-check-risk-item">
                  <h4>Greenwashing Risk</h4>
                  <div className="green-check-risk-bar">
                    <div
                      style={{
                        width: editable.regulatoryRiskAssessment.taxonomyRisks.greenwashingRisk + '%',
                        height: '100%',
                        backgroundColor: getRiskColor(
                          editable.regulatoryRiskAssessment.taxonomyRisks.greenwashingRisk,
                        ),
                      }}
                    />
                  </div>
                  <span>{editable.regulatoryRiskAssessment.taxonomyRisks.greenwashingRisk}%</span>
                </div>
                <div className="green-check-risk-item">
                  <h4>Mismatch Risk</h4>
                  <div className="green-check-risk-bar">
                    <div
                      style={{
                        width: editable.regulatoryRiskAssessment.taxonomyRisks.mismatchRisk + '%',
                        height: '100%',
                        backgroundColor: getRiskColor(
                          editable.regulatoryRiskAssessment.taxonomyRisks.mismatchRisk,
                        ),
                      }}
                    />
                  </div>
                  <span>{editable.regulatoryRiskAssessment.taxonomyRisks.mismatchRisk}%</span>
                </div>
                <div className="green-check-risk-item">
                  <h4>Transition Risk</h4>
                  <div className="green-check-risk-bar">
                    <div
                      style={{
                        width: editable.regulatoryRiskAssessment.taxonomyRisks.transitionRisk + '%',
                        height: '100%',
                        backgroundColor: getRiskColor(
                          editable.regulatoryRiskAssessment.taxonomyRisks.transitionRisk,
                        ),
                      }}
                    />
                  </div>
                  <span>{editable.regulatoryRiskAssessment.taxonomyRisks.transitionRisk}%</span>
                </div>
              </div>
            </div>

            {/* Upcoming Regulations */}
            {editable.regulatoryRiskAssessment.upcomingRegulations.length > 0 && (
              <div className="green-check-editor-subsection">
                <h3>Kommande regleringar</h3>
                {editable.regulatoryRiskAssessment.upcomingRegulations.map((reg, idx) => (
                  <div key={idx} className="green-check-regulation-card">
                    <div className="green-check-regulation-header">
                      <h4>{reg.name}</h4>
                      <span className={`impact-badge ${reg.impact.toLowerCase()}`}>{reg.impact}</span>
                    </div>
                    <p>{reg.description}</p>
                    <div className="green-check-deadline">
                      <strong>Deadline:</strong> {reg.deadline}
                    </div>
                    <div className="green-check-prepared">
                      <strong>Förberedda åtgärder:</strong>
                      <ul>
                        {reg.preparedItems.map((item, pidx) => (
                          <li key={pidx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Financing Tab */}
        {activeTab === 'financing' && (
          <div className="green-check-editor-section">
            <h2>Gröna Finansieringsmöjligheter</h2>

            <div className="green-check-financing-grid">
              {[
                {
                  name: 'EU Green Bonds',
                  eligible: editable.greenFinanceEligibility.euGreenBondEligible,
                },
                {
                  name: 'Sustainability-Linked Loans',
                  eligible: editable.greenFinanceEligibility.sustainabilityLinkedLoanEligible,
                },
                {
                  name: 'EU Funding',
                  eligible: editable.greenFinanceEligibility.euFundingEligible,
                },
                {
                  name: 'Public Green Finance',
                  eligible: editable.greenFinanceEligibility.publicGreenFinanceEligible,
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className={`green-check-financing-option ${item.eligible ? 'eligible' : 'not-eligible'}`}
                >
                  <h4>{item.name}</h4>
                  <div className="status">
                    {item.eligible ? (
                      <>
                        <CheckCircle size={24} color="#10b981" />
                        <span>Berättigad</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={24} color="#f97316" />
                        <span>Ej berättigad</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {editable.greenFinanceEligibility.estimatedLoanTerms && (
              <div className="green-check-editor-subsection">
                <h3>Beräknade lånevillkor</h3>
                <div className="green-check-loan-terms">
                  <div className="term">
                    <strong>Räntereduktion:</strong>{' '}
                    {editable.greenFinanceEligibility.estimatedLoanTerms.rateReduction}
                  </div>
                  <div className="term">
                    <strong>Tillgänglig volym:</strong>{' '}
                    {editable.greenFinanceEligibility.estimatedLoanTerms.volumeAvailable}
                  </div>
                </div>
              </div>
            )}

            <div className="green-check-editor-subsection">
              <h3>Nästa steg</h3>
              <ol className="green-check-list">
                {editable.greenFinanceEligibility.nextSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* CSRD Tab */}
        {activeTab === 'csrd' && (
          <div className="green-check-editor-section">
            <h2>CSRD Rapportéringskrav</h2>
            {editable.csrdReportingRequirements.map((req, idx) => (
              <div key={idx} className="green-check-csrd-item">
                <div className="green-check-csrd-header">
                  <h4>{req.topic}</h4>
                  <span className={`materiality ${req.materialityLevel.toLowerCase()}`}>
                    {req.materialityLevel}
                  </span>
                </div>
                <p>{req.requirement}</p>
                <div className="green-check-csrd-details">
                  <div>
                    <strong>Deadline:</strong> {req.deadline}
                  </div>
                  <div>
                    <strong>Arbetsinsats:</strong> {req.estimatedEffort}
                  </div>
                </div>
                {req.suggestedMetrics.length > 0 && (
                  <div className="green-check-metrics">
                    <strong>Föreslagna mätetal:</strong>
                    <ul>
                      {req.suggestedMetrics.map((metric, midx) => (
                        <li key={midx}>{metric}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Recommendations Tab */}
        {activeTab === 'recommendations' && (
          <div className="green-check-editor-section">
            <h2>Rekommendationer</h2>
            {editable.recommendations.map((rec, idx) => (
              <div key={idx} className="green-check-recommendation-card">
                <div className="green-check-recommendation-header">
                  <h4>{rec.title}</h4>
                  <span className={`priority ${rec.priority.toLowerCase()}`}>{rec.priority}</span>
                </div>
                <p>{rec.description}</p>
                <div className="green-check-recommendation-details">
                  <div className="detail">
                    <strong>Kategori:</strong> {rec.category}
                  </div>
                  <div className="detail">
                    <strong>Beräknad kostnad:</strong> {rec.estimatedCost.toLocaleString('sv-SE')} SEK
                  </div>
                  <div className="detail">
                    <strong>Förväntad nytta:</strong> {rec.expectedBenefit}
                  </div>
                  <div className="detail">
                    <strong>Tidsram:</strong> {rec.timeframe}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pdfError ? (
        <div
          className="green-check-editor-section"
          style={{ margin: '0 var(--spacing-lg)', color: '#b91c1c', fontSize: '0.875rem' }}
        >
          {pdfError}
        </div>
      ) : null}

      {/* Action Buttons */}
      <div className="green-check-editor-actions">
        <button type="button" onClick={onCancel} className="btn-cancel" disabled={pdfBusy}>
          Avbryt
        </button>
        <button
          type="button"
          onClick={() => void handleExportPdf()}
          className="btn-export-pdf"
          disabled={pdfBusy}
        >
          <FileDown size={18} /> {pdfBusy ? 'PDF…' : 'Exportera PDF'}
        </button>
        <button type="button" onClick={handleSave} className="btn-save" disabled={pdfBusy}>
          💾 Spara Bedömning
        </button>
      </div>
    </div>
  );
};

export default GreenCheckEditor;
