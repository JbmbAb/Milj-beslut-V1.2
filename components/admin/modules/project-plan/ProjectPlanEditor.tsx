/**
 * ProjectPlanEditor – Interactive AI-generated plan with full CRUD
 * Users can add, edit, remove, and reorder all plan components
 * AI provides initial data, user has full control
 */

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, GripVertical, Save, X, FileDown } from 'lucide-react';
import { downloadPdfFromJson } from '../../../../services/pdfExportClient';
import '../module-common.css';
import './project-plan-editor.css';

export interface EditablePhase {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  budget: number;
  resources: string[];
}

export interface EditableRisk {
  id: string;
  name: string;
  description: string;
  category: string;
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string;
  owner: string;
}

export interface EditableStakeholder {
  id: string;
  name: string;
  role: string;
  interestLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  powerLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  communicationStrategy: string;
}

export interface EditablePlan {
  phases: EditablePhase[];
  risks: EditableRisk[];
  stakeholders: EditableStakeholder[];
}

interface ProjectPlanEditorProps {
  initialPlan: EditablePlan;
  onSave: (plan: EditablePlan) => Promise<void>;
  onCancel?: () => void;
}

type TabType = 'phases' | 'risks' | 'stakeholders';

const ProjectPlanEditor: React.FC<ProjectPlanEditorProps> = ({ initialPlan, onSave, onCancel }) => {
  const [plan, setPlan] = useState<EditablePlan>(initialPlan);
  const [activeTab, setActiveTab] = useState<TabType>('phases');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ============ PHASES ============

  const addPhase = useCallback(() => {
    const newPhase: EditablePhase = {
      id: `phase-${Date.now()}`,
      name: 'Ny Fas',
      description: '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      budget: 0,
      resources: [],
    };
    setPlan((prev) => ({ ...prev, phases: [...prev.phases, newPhase] }));
  }, []);

  const removePhase = useCallback((id: string) => {
    setPlan((prev) => ({ ...prev, phases: prev.phases.filter((p) => p.id !== id) }));
  }, []);

  const updatePhase = useCallback((id: string, updates: Partial<EditablePhase>) => {
    setPlan((prev) => ({
      ...prev,
      phases: prev.phases.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  }, []);

  // ============ RISKS ============

  const addRisk = useCallback(() => {
    const newRisk: EditableRisk = {
      id: `risk-${Date.now()}`,
      name: 'Ny Risk',
      description: '',
      category: 'OPERATIONAL',
      probability: 'MEDIUM',
      impact: 'MEDIUM',
      mitigation: '',
      owner: '',
    };
    setPlan((prev) => ({ ...prev, risks: [...prev.risks, newRisk] }));
  }, []);

  const removeRisk = useCallback((id: string) => {
    setPlan((prev) => ({ ...prev, risks: prev.risks.filter((r) => r.id !== id) }));
  }, []);

  const updateRisk = useCallback((id: string, updates: Partial<EditableRisk>) => {
    setPlan((prev) => ({
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
      communicationStrategy: '',
    };
    setPlan((prev) => ({ ...prev, stakeholders: [...prev.stakeholders, newStakeholder] }));
  }, []);

  const removeStakeholder = useCallback((id: string) => {
    setPlan((prev) => ({
      ...prev,
      stakeholders: prev.stakeholders.filter((s) => s.id !== id),
    }));
  }, []);

  const updateStakeholder = useCallback((id: string, updates: Partial<EditableStakeholder>) => {
    setPlan((prev) => ({
      ...prev,
      stakeholders: prev.stakeholders.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  }, []);

  // ============ DRAG AND DROP ============

  const movePhase = useCallback((fromIndex: number, toIndex: number) => {
    setPlan((prev) => {
      const newPhases = [...prev.phases];
      const [moved] = newPhases.splice(fromIndex, 1);
      newPhases.splice(toIndex, 0, moved);
      return { ...prev, phases: newPhases };
    });
  }, []);

  const moveRisk = useCallback((fromIndex: number, toIndex: number) => {
    setPlan((prev) => {
      const newRisks = [...prev.risks];
      const [moved] = newRisks.splice(fromIndex, 1);
      newRisks.splice(toIndex, 0, moved);
      return { ...prev, risks: newRisks };
    });
  }, []);

  // ============ SAVE ============

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(plan);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadPdfFromJson({
        title: 'Projektplan',
        subtitle: `Exporterad ${new Date().toLocaleString('sv-SE')}`,
        json: plan,
        fallbackFilename: 'projektplan.pdf',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-export misslyckades.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="plan-editor-container">
      {/* Tabs */}
      <div className="editor-tabs">
        <button
          className={`editor-tab ${activeTab === 'phases' ? 'active' : ''}`}
          onClick={() => setActiveTab('phases')}
        >
          Faser ({plan.phases.length})
        </button>
        <button
          className={`editor-tab ${activeTab === 'risks' ? 'active' : ''}`}
          onClick={() => setActiveTab('risks')}
        >
          Risker ({plan.risks.length})
        </button>
        <button
          className={`editor-tab ${activeTab === 'stakeholders' ? 'active' : ''}`}
          onClick={() => setActiveTab('stakeholders')}
        >
          Intressenter ({plan.stakeholders.length})
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
            <span>Plan sparad framgångsrikt!</span>
          </div>
        )}

        {/* PHASES TAB */}
        {activeTab === 'phases' && (
          <div className="editor-section">
            <div className="section-header">
              <h3>Projektfaser</h3>
              <button className="btn-add" onClick={addPhase}>
                <Plus size={18} /> Lägg till fas
              </button>
            </div>

            <div className="editor-items">
              {plan.phases.map((phase, idx) => (
                <div
                  key={phase.id}
                  className="editor-item"
                  draggable
                  onDragStart={() => setDraggedId(phase.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId && draggedId !== phase.id) {
                      const draggedIdx = plan.phases.findIndex((p) => p.id === draggedId);
                      movePhase(draggedIdx, idx);
                      setDraggedId(null);
                    }
                  }}
                >
                  <div className="item-handle">
                    <GripVertical size={18} />
                  </div>

                  <div className="item-content">
                    <input
                      type="text"
                      placeholder="Fasnamn"
                      value={phase.name}
                      onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                      className="input-title"
                    />
                    <textarea
                      placeholder="Beskrivning"
                      value={phase.description}
                      onChange={(e) => updatePhase(phase.id, { description: e.target.value })}
                      className="input-description"
                      rows={2}
                    />
                    <div className="item-grid">
                      <div className="grid-item">
                        <label>Startdatum</label>
                        <input
                          type="date"
                          value={phase.startDate}
                          onChange={(e) => updatePhase(phase.id, { startDate: e.target.value })}
                          className="input-field"
                        />
                      </div>
                      <div className="grid-item">
                        <label>Slutdatum</label>
                        <input
                          type="date"
                          value={phase.endDate}
                          onChange={(e) => updatePhase(phase.id, { endDate: e.target.value })}
                          className="input-field"
                        />
                      </div>
                      <div className="grid-item">
                        <label>Budget (SEK)</label>
                        <input
                          type="number"
                          value={phase.budget}
                          onChange={(e) => updatePhase(phase.id, { budget: Number(e.target.value) })}
                          className="input-field"
                        />
                      </div>
                    </div>
                  </div>

                  <button className="btn-remove" onClick={() => removePhase(phase.id)} title="Radera fas">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {plan.phases.length === 0 && <p className="empty-message">Inga faser än. Lägg till en!</p>}
            </div>
          </div>
        )}

        {/* RISKS TAB */}
        {activeTab === 'risks' && (
          <div className="editor-section">
            <div className="section-header">
              <h3>Riskanalys</h3>
              <button className="btn-add" onClick={addRisk}>
                <Plus size={18} /> Lägg till risk
              </button>
            </div>

            <div className="editor-items">
              {plan.risks.map((risk, idx) => (
                <div
                  key={risk.id}
                  className="editor-item"
                  draggable
                  onDragStart={() => setDraggedId(risk.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId && draggedId !== risk.id) {
                      const draggedIdx = plan.risks.findIndex((r) => r.id === draggedId);
                      moveRisk(draggedIdx, idx);
                      setDraggedId(null);
                    }
                  }}
                >
                  <div className="item-handle">
                    <GripVertical size={18} />
                  </div>

                  <div className="item-content">
                    <input
                      type="text"
                      placeholder="Risknamn"
                      value={risk.name}
                      onChange={(e) => updateRisk(risk.id, { name: e.target.value })}
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
                          <option>REGULATORY</option>
                          <option>ENVIRONMENTAL</option>
                          <option>FINANCIAL</option>
                          <option>OPERATIONAL</option>
                          <option>TECHNICAL</option>
                        </select>
                      </div>
                      <div className="grid-item">
                        <label>Sannolikhet</label>
                        <select
                          value={risk.probability}
                          onChange={(e) =>
                            updateRisk(risk.id, {
                              probability: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH',
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
                        <label>Påverkan</label>
                        <select
                          value={risk.impact}
                          onChange={(e) =>
                            updateRisk(risk.id, { impact: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' })
                          }
                          className="input-field"
                        >
                          <option value="LOW">Låg</option>
                          <option value="MEDIUM">Medel</option>
                          <option value="HIGH">Hög</option>
                        </select>
                      </div>
                    </div>
                    <textarea
                      placeholder="Åtgärd/Mitigation"
                      value={risk.mitigation}
                      onChange={(e) => updateRisk(risk.id, { mitigation: e.target.value })}
                      className="input-description"
                      rows={2}
                    />
                    <input
                      type="text"
                      placeholder="Riskägare"
                      value={risk.owner}
                      onChange={(e) => updateRisk(risk.id, { owner: e.target.value })}
                      className="input-field"
                    />
                  </div>

                  <button className="btn-remove" onClick={() => removeRisk(risk.id)} title="Radera risk">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {plan.risks.length === 0 && <p className="empty-message">Inga risker än. Lägg till en!</p>}
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
              {plan.stakeholders.map((stakeholder) => (
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
                              interestLevel: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH',
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
                              powerLevel: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH',
                            })
                          }
                          className="input-field"
                        >
                          <option value="LOW">Låg</option>
                          <option value="MEDIUM">Medel</option>
                          <option value="HIGH">Hög</option>
                        </select>
                      </div>
                    </div>
                    <textarea
                      placeholder="Kommunikationsstrategi"
                      value={stakeholder.communicationStrategy}
                      onChange={(e) =>
                        updateStakeholder(stakeholder.id, {
                          communicationStrategy: e.target.value,
                        })
                      }
                      className="input-description"
                      rows={2}
                    />
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
              {plan.stakeholders.length === 0 && (
                <p className="empty-message">Inga intressenter än. Lägg till en!</p>
              )}
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
              <Save size={18} /> Spara plan
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ProjectPlanEditor;
