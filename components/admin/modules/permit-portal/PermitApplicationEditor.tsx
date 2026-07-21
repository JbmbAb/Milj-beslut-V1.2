/**
 * PermitApplicationEditor – Interactive permit application with full CRUD
 * Users can edit all sections, add/remove risks, documents, stakeholders, etc.
 * AI provides initial data, user has full control
 */

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, Save, X, FileText, AlertTriangle, Users, CheckSquare, FileDown } from 'lucide-react';
import { downloadPdfFromJson } from '../../../../services/pdfExportClient';
import './permit-application-editor.css';

export interface EditableApplicationSummary {
  title: string;
  operationType: string;
  location: string;
  duration: string;
  expectedEnvironmentalLoad: string;
  mainActivities: string[];
}

export interface EditableRisk {
  id: string;
  category: string;
  riskName: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  mitigationMeasures: string[];
}

export interface EditableStakeholder {
  id: string;
  name: string;
  role: string;
  interestLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  powerLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  communicationNeeded: boolean;
}

export interface EditableDocument {
  id: string;
  documentType: string;
  description: string;
  mandatory: boolean;
  template?: string;
  relatedRisk?: string;
}

export interface EditableBudget {
  estimatedCost: number;
  permittingFees: number;
  environmentalStudies: number;
  monitoring: number;
  contingency: number;
  other: number;
}

export interface EditablePermitApplication {
  applicationSummary: EditableApplicationSummary;
  risks: EditableRisk[];
  stakeholders: EditableStakeholder[];
  requiredDocuments: EditableDocument[];
  budgetEstimate: EditableBudget;
}

interface PermitApplicationEditorProps {
  initialApplication: EditablePermitApplication;
  onSave: (application: EditablePermitApplication) => Promise<void>;
  onCancel?: () => void;
}

type TabType = 'summary' | 'risks' | 'stakeholders' | 'documents' | 'budget';

const PermitApplicationEditor: React.FC<PermitApplicationEditorProps> = ({
  initialApplication,
  onSave,
  onCancel,
}) => {
  const [application, setApplication] = useState<EditablePermitApplication>(initialApplication);
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [isSaving, setIsSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ============ SUMMARY ============

  const updateSummary = useCallback((updates: Partial<EditableApplicationSummary>) => {
    setApplication((prev) => ({
      ...prev,
      applicationSummary: { ...prev.applicationSummary, ...updates },
    }));
  }, []);

  // ============ RISKS ============

  const addRisk = useCallback(() => {
    const newRisk: EditableRisk = {
      id: `risk-${Date.now()}`,
      category: 'ENVIRONMENTAL',
      riskName: 'Ny Risk',
      description: '',
      severity: 'MEDIUM',
      mitigationMeasures: [],
    };
    setApplication((prev) => ({ ...prev, risks: [...prev.risks, newRisk] }));
  }, []);

  const removeRisk = useCallback((id: string) => {
    setApplication((prev) => ({ ...prev, risks: prev.risks.filter((r) => r.id !== id) }));
  }, []);

  const updateRisk = useCallback((id: string, updates: Partial<EditableRisk>) => {
    setApplication((prev) => ({
      ...prev,
      risks: prev.risks.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
  }, []);

  // ============ STAKEHOLDERS ============

  const addStakeholder = useCallback(() => {
    const newStakeholder: EditableStakeholder = {
      id: `stakeholder-${Date.now()}`,
      name: 'Ny Intressent',
      role: '',
      interestLevel: 'MEDIUM',
      powerLevel: 'MEDIUM',
      communicationNeeded: true,
    };
    setApplication((prev) => ({ ...prev, stakeholders: [...prev.stakeholders, newStakeholder] }));
  }, []);

  const removeStakeholder = useCallback((id: string) => {
    setApplication((prev) => ({
      ...prev,
      stakeholders: prev.stakeholders.filter((s) => s.id !== id),
    }));
  }, []);

  const updateStakeholder = useCallback((id: string, updates: Partial<EditableStakeholder>) => {
    setApplication((prev) => ({
      ...prev,
      stakeholders: prev.stakeholders.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  }, []);

  // ============ DOCUMENTS ============

  const addDocument = useCallback(() => {
    const newDoc: EditableDocument = {
      id: `doc-${Date.now()}`,
      documentType: 'Nytt Dokument',
      description: '',
      mandatory: true,
    };
    setApplication((prev) => ({ ...prev, requiredDocuments: [...prev.requiredDocuments, newDoc] }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setApplication((prev) => ({
      ...prev,
      requiredDocuments: prev.requiredDocuments.filter((d) => d.id !== id),
    }));
  }, []);

  const updateDocument = useCallback((id: string, updates: Partial<EditableDocument>) => {
    setApplication((prev) => ({
      ...prev,
      requiredDocuments: prev.requiredDocuments.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    }));
  }, []);

  // ============ BUDGET ============

  const updateBudget = useCallback((updates: Partial<EditableBudget>) => {
    setApplication((prev) => ({
      ...prev,
      budgetEstimate: { ...prev.budgetEstimate, ...updates },
    }));
  }, []);

  // ============ SAVE ============

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(application);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save application');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      const title =
        application.applicationSummary.title?.trim() || 'Tillståndsansökan';
      await downloadPdfFromJson({
        title,
        subtitle: `Exporterad ${new Date().toLocaleString('sv-SE')}`,
        json: application,
        fallbackFilename: 'tillstandsansokan.pdf',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-export misslyckades.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="permit-editor-container">
      {/* Tabs */}
      <div className="editor-tabs">
        <button
          className={`editor-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <FileText size={18} />
          Sammanfattning
        </button>
        <button
          className={`editor-tab ${activeTab === 'risks' ? 'active' : ''}`}
          onClick={() => setActiveTab('risks')}
        >
          <AlertTriangle size={18} />
          Risker ({application.risks.length})
        </button>
        <button
          className={`editor-tab ${activeTab === 'stakeholders' ? 'active' : ''}`}
          onClick={() => setActiveTab('stakeholders')}
        >
          <Users size={18} />
          Intressenter ({application.stakeholders.length})
        </button>
        <button
          className={`editor-tab ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >
          <FileText size={18} />
          Dokument ({application.requiredDocuments.length})
        </button>
        <button
          className={`editor-tab ${activeTab === 'budget' ? 'active' : ''}`}
          onClick={() => setActiveTab('budget')}
        >
          <CheckSquare size={18} />
          Budget
        </button>
      </div>

      {/* Content */}
      <div className="editor-content">
        {/* Messages */}
        {error && (
          <div className="editor-message error">
            <span>{error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {success && (
          <div className="editor-message success">
            <span>Ansökan sparad framgångsrikt!</span>
          </div>
        )}

        {/* SUMMARY TAB */}
        {activeTab === 'summary' && (
          <div className="editor-section">
            <h3>Ansökningssammanfattning</h3>

            <div className="form-group">
              <label>Titel</label>
              <input
                type="text"
                value={application.applicationSummary.title}
                onChange={(e) => updateSummary({ title: e.target.value })}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label>Verksamhetstyp</label>
              <input
                type="text"
                value={application.applicationSummary.operationType}
                onChange={(e) => updateSummary({ operationType: e.target.value })}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label>Plats</label>
              <input
                type="text"
                value={application.applicationSummary.location}
                onChange={(e) => updateSummary({ location: e.target.value })}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label>Varaktighet</label>
              <input
                type="text"
                value={application.applicationSummary.duration}
                onChange={(e) => updateSummary({ duration: e.target.value })}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label>Förväntad miljöbelastning</label>
              <textarea
                value={application.applicationSummary.expectedEnvironmentalLoad}
                onChange={(e) => updateSummary({ expectedEnvironmentalLoad: e.target.value })}
                className="input-field"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>Huvudsakliga aktiviteter</label>
              <textarea
                value={application.applicationSummary.mainActivities.join('\n')}
                onChange={(e) =>
                  updateSummary({ mainActivities: e.target.value.split('\n').filter((a) => a.trim()) })
                }
                className="input-field"
                rows={3}
                placeholder="En aktivitet per rad"
              />
            </div>
          </div>
        )}

        {/* RISKS TAB */}
        {activeTab === 'risks' && (
          <div className="editor-section">
            <div className="section-header">
              <h3>Miljörisker</h3>
              <button className="btn-add" onClick={addRisk}>
                <Plus size={18} /> Lägg till risk
              </button>
            </div>

            <div className="editor-items">
              {application.risks.map((risk) => (
                <div key={risk.id} className="editor-item">
                  <div className="item-content">
                    <input
                      type="text"
                      placeholder="Risknamn"
                      value={risk.riskName}
                      onChange={(e) => updateRisk(risk.id, { riskName: e.target.value })}
                      className="input-title"
                    />
                    <textarea
                      placeholder="Beskrivning"
                      value={risk.description}
                      onChange={(e) => updateRisk(risk.id, { description: e.target.value })}
                      className="input-description"
                      rows={2}
                    />
                    <div className="item-grid">
                      <div className="grid-item">
                        <label>Kategori</label>
                        <select
                          value={risk.category}
                          onChange={(e) => updateRisk(risk.id, { category: e.target.value })}
                          className="input-field"
                        >
                          <option>ENVIRONMENTAL</option>
                          <option>REGULATORY</option>
                          <option>OPERATIONAL</option>
                          <option>HEALTH_SAFETY</option>
                        </select>
                      </div>
                      <div className="grid-item">
                        <label>Allvarlighetsgrad</label>
                        <select
                          value={risk.severity}
                          onChange={(e) =>
                            updateRisk(risk.id, { severity: e.target.value as EditableRisk['severity'] })
                          }
                          className="input-field"
                        >
                          <option value="LOW">Låg</option>
                          <option value="MEDIUM">Medel</option>
                          <option value="HIGH">Hög</option>
                          <option value="CRITICAL">Kritisk</option>
                        </select>
                      </div>
                    </div>
                    <textarea
                      placeholder="Åtgärdsförslag (ett per rad)"
                      value={risk.mitigationMeasures.join('\n')}
                      onChange={(e) =>
                        updateRisk(risk.id, {
                          mitigationMeasures: e.target.value.split('\n').filter((a) => a.trim()),
                        })
                      }
                      className="input-description"
                      rows={2}
                    />
                  </div>

                  <button className="btn-remove" onClick={() => removeRisk(risk.id)} title="Radera risk">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {application.risks.length === 0 && (
                <p className="empty-message">Inga risker än. Lägg till en!</p>
              )}
            </div>
          </div>
        )}

        {/* STAKEHOLDERS TAB */}
        {activeTab === 'stakeholders' && (
          <div className="editor-section">
            <div className="section-header">
              <h3>Intressenter</h3>
              <button className="btn-add" onClick={addStakeholder}>
                <Plus size={18} /> Lägg till intressent
              </button>
            </div>

            <div className="editor-items">
              {application.stakeholders.map((stakeholder) => (
                <div key={stakeholder.id} className="editor-item">
                  <div className="item-content">
                    <input
                      type="text"
                      placeholder="Namn"
                      value={stakeholder.name}
                      onChange={(e) => updateStakeholder(stakeholder.id, { name: e.target.value })}
                      className="input-title"
                    />
                    <input
                      type="text"
                      placeholder="Roll"
                      value={stakeholder.role}
                      onChange={(e) => updateStakeholder(stakeholder.id, { role: e.target.value })}
                      className="input-field"
                    />
                    <div className="item-grid">
                      <div className="grid-item">
                        <label>Intressesnivå</label>
                        <select
                          value={stakeholder.interestLevel}
                          onChange={(e) =>
                            updateStakeholder(stakeholder.id, {
                              interestLevel: e.target.value as EditableStakeholder['interestLevel'],
                            })
                          }
                          className="input-field"
                        >
                          <option value="LOW">Låg</option>
                          <option value="MEDIUM">Medel</option>
                          <option value="HIGH">Hög</option>
                        </select>
                      </div>
                      <div className="grid-item">
                        <label>Maktsnivå</label>
                        <select
                          value={stakeholder.powerLevel}
                          onChange={(e) =>
                            updateStakeholder(stakeholder.id, {
                              powerLevel: e.target.value as EditableStakeholder['powerLevel'],
                            })
                          }
                          className="input-field"
                        >
                          <option value="LOW">Låg</option>
                          <option value="MEDIUM">Medel</option>
                          <option value="HIGH">Hög</option>
                        </select>
                      </div>
                      <div className="grid-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={stakeholder.communicationNeeded}
                            onChange={(e) =>
                              updateStakeholder(stakeholder.id, { communicationNeeded: e.target.checked })
                            }
                          />
                          Kommunikation behövs
                        </label>
                      </div>
                    </div>
                  </div>

                  <button
                    className="btn-remove"
                    onClick={() => removeStakeholder(stakeholder.id)}
                    title="Radera intressent"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {application.stakeholders.length === 0 && (
                <p className="empty-message">Inga intressenter än. Lägg till en!</p>
              )}
            </div>
          </div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === 'documents' && (
          <div className="editor-section">
            <div className="section-header">
              <h3>Obligatoriska och Frivilliga Dokument</h3>
              <button className="btn-add" onClick={addDocument}>
                <Plus size={18} /> Lägg till dokument
              </button>
            </div>

            <div className="editor-items">
              {application.requiredDocuments.map((doc) => (
                <div key={doc.id} className="editor-item">
                  <div className="item-content">
                    <input
                      type="text"
                      placeholder="Dokumenttyp"
                      value={doc.documentType}
                      onChange={(e) => updateDocument(doc.id, { documentType: e.target.value })}
                      className="input-title"
                    />
                    <textarea
                      placeholder="Beskrivning"
                      value={doc.description}
                      onChange={(e) => updateDocument(doc.id, { description: e.target.value })}
                      className="input-description"
                      rows={2}
                    />
                    <div className="item-grid">
                      <div className="grid-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={doc.mandatory}
                            onChange={(e) => updateDocument(doc.id, { mandatory: e.target.checked })}
                          />
                          Obligatorisk
                        </label>
                      </div>
                      {doc.template && (
                        <div className="grid-item">
                          <label>Mall</label>
                          <input
                            type="text"
                            value={doc.template}
                            onChange={(e) => updateDocument(doc.id, { template: e.target.value })}
                            className="input-field"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    className="btn-remove"
                    onClick={() => removeDocument(doc.id)}
                    title="Radera dokument"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {application.requiredDocuments.length === 0 && (
                <p className="empty-message">Inga dokument än. Lägg till ett!</p>
              )}
            </div>
          </div>
        )}

        {/* BUDGET TAB */}
        {activeTab === 'budget' && (
          <div className="editor-section">
            <h3>Budgetöversikt</h3>

            <div className="budget-grid">
              <div className="budget-item">
                <label>Total kostnad (SEK)</label>
                <input
                  type="number"
                  value={application.budgetEstimate.estimatedCost}
                  onChange={(e) => updateBudget({ estimatedCost: Number(e.target.value) })}
                  className="input-field"
                />
              </div>

              <div className="budget-item">
                <label>Tillståndsavgifter</label>
                <input
                  type="number"
                  value={application.budgetEstimate.permittingFees}
                  onChange={(e) => updateBudget({ permittingFees: Number(e.target.value) })}
                  className="input-field"
                />
              </div>

              <div className="budget-item">
                <label>Miljöundersökningar</label>
                <input
                  type="number"
                  value={application.budgetEstimate.environmentalStudies}
                  onChange={(e) => updateBudget({ environmentalStudies: Number(e.target.value) })}
                  className="input-field"
                />
              </div>

              <div className="budget-item">
                <label>Övervakning</label>
                <input
                  type="number"
                  value={application.budgetEstimate.monitoring}
                  onChange={(e) => updateBudget({ monitoring: Number(e.target.value) })}
                  className="input-field"
                />
              </div>

              <div className="budget-item">
                <label>Beredskap/Buffert</label>
                <input
                  type="number"
                  value={application.budgetEstimate.contingency}
                  onChange={(e) => updateBudget({ contingency: Number(e.target.value) })}
                  className="input-field"
                />
              </div>

              <div className="budget-item">
                <label>Övrigt</label>
                <input
                  type="number"
                  value={application.budgetEstimate.other}
                  onChange={(e) => updateBudget({ other: Number(e.target.value) })}
                  className="input-field"
                />
              </div>
            </div>

            <div className="budget-summary">
              <strong>Summa komponenter:</strong>
              {(
                application.budgetEstimate.permittingFees +
                application.budgetEstimate.environmentalStudies +
                application.budgetEstimate.monitoring +
                application.budgetEstimate.contingency +
                application.budgetEstimate.other
              ).toLocaleString('sv-SE')}{' '}
              SEK
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="editor-actions">
        <button className="btn-cancel" onClick={onCancel} disabled={isSaving || pdfBusy}>
          <X size={18} /> Avbryt
        </button>
        <button
          type="button"
          className="btn-export-pdf"
          onClick={() => void handleExportPdf()}
          disabled={isSaving || pdfBusy}
        >
          <FileDown size={18} /> {pdfBusy ? 'PDF…' : 'Exportera PDF'}
        </button>
        <button className="btn-save" onClick={handleSave} disabled={isSaving || pdfBusy}>
          {isSaving ? (
            <>
              <span className="spinner-small"></span> Sparar...
            </>
          ) : (
            <>
              <Save size={18} /> Spara Ansökan
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default PermitApplicationEditor;
