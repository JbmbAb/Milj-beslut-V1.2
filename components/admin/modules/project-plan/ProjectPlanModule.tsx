import React, { useState, useMemo } from 'react';
import { Calendar, Users, Flag, BarChart3, Wand2 } from 'lucide-react';
import '../module-common.css';
import './project-plan-dashboard.css';
import { useProjectPlanQuery } from '../../hooks';
import { LoadingSpinner, ErrorAlert } from '../../shared';
import ProjectPlanGeneratorWithEditor from './ProjectPlanGeneratorWithEditor';

type ProjectTab = 'generator' | 'gantt' | 'phases' | 'stakeholders' | 'risks';

/**
 * ProjectPlanModule – Projektplan
 * Gantt-schema, fashantering, stakeholder-lista
 */
const ProjectPlanModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ProjectTab>('generator');
  const [dismissedError, setDismissedError] = useState(false);

  // Get selected project from localStorage
  const projectId = typeof window !== 'undefined' ? localStorage.getItem('admin-selected-project') || '' : '';
  const propertyDesignation =
    typeof window !== 'undefined' ? localStorage.getItem('admin-property-designation') || '' : '';

  // Fetch project plan (React Query)
  const { data: plan, isLoading, error } = useProjectPlanQuery(projectId);
  const loading = isLoading;

  // Extract phases from plan if available, otherwise empty
  const phases = useMemo(() => {
    if (!plan || !plan.plan) return [];
    const planData = plan.plan as any;
    return Array.isArray(planData.phases) ? planData.phases : [];
  }, [plan]);

  const stats = useMemo(() => {
    const completed = phases.filter((p: any) => p.status === 'DONE').length;
    const ongoing = phases.filter((p: any) => p.status === 'ONGOING').length;
    const total = phases.length;
    const overall = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      completedPhases: completed,
      ongoingPhases: ongoing,
      totalPhases: total,
      overallProgress: overall,
    };
  }, [phases]);

  return (
    <div className="module-container">
      {/* Error handling */}
      {error && !dismissedError && (
        <ErrorAlert
          message={`Fel vid hämtning av projektplan: ${error}`}
          severity="error"
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {!projectId && (
        <ErrorAlert
          message="Välj ett projekt från dropdown i headern för att visa projektplan"
          severity="info"
          onDismiss={() => {}}
        />
      )}

      {/* Header */}
      <div className="module-header">
        <div className="module-title-section">
          <Calendar size={32} color="#005293" />
          <div>
            <h1 className="module-title">Projektplan</h1>
            <p className="module-subtitle">Tidsplanering, faser och resurser</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="module-tabs">
        <button
          className={`module-tab ${activeTab === 'generator' ? 'active' : ''}`}
          onClick={() => setActiveTab('generator')}
        >
          <Wand2 size={18} />
          Generera
        </button>
        <button
          className={`module-tab ${activeTab === 'gantt' ? 'active' : ''}`}
          onClick={() => setActiveTab('gantt')}
        >
          <BarChart3 size={18} />
          Gantt-schema
        </button>
        <button
          className={`module-tab ${activeTab === 'phases' ? 'active' : ''}`}
          onClick={() => setActiveTab('phases')}
        >
          <Flag size={18} />
          Faser
        </button>
        <button
          className={`module-tab ${activeTab === 'stakeholders' ? 'active' : ''}`}
          onClick={() => setActiveTab('stakeholders')}
        >
          <Users size={18} />
          Stakeholders
        </button>
        <button
          className={`module-tab ${activeTab === 'risks' ? 'active' : ''}`}
          onClick={() => setActiveTab('risks')}
        >
          <Flag size={18} />
          Risker
        </button>
      </div>

      {/* Content */}
      <div className="module-content">
        {activeTab === 'generator' &&
          (projectId ? (
            <ProjectPlanGeneratorWithEditor
              projectId={projectId}
              propertyDesignation={propertyDesignation}
              onPlanSaved={() => {
                // Refresh project plan query and switch to gantt tab
                setActiveTab('gantt');
              }}
            />
          ) : (
            <div className="module-placeholder">
              <Wand2 size={48} color="#D1D5DB" />
              <p>Välj ett projekt för att generera en komplett projektplan</p>
            </div>
          ))}
        {activeTab === 'gantt' && (
          <>
            {loading ? (
              <LoadingSpinner message="Laddar projektplan..." />
            ) : !projectId ? (
              <div className="module-placeholder">
                <BarChart3 size={48} color="#D1D5DB" />
                <p>Välj ett projekt för att se Gantt-schema</p>
              </div>
            ) : phases.length === 0 ? (
              <div className="module-placeholder">
                <BarChart3 size={48} color="#D1D5DB" />
                <p>Inga faser definerade för detta projekt</p>
              </div>
            ) : (
              <div>
                {/* Progress Stats */}
                <div className="project-progress-grid">
                  <div className="project-progress-card">
                    <p className="project-progress-label">Övergripande Framsteg</p>
                    <div className="project-progress-value">{stats.overallProgress}%</div>
                  </div>
                  <div className="project-progress-card">
                    <p className="project-progress-label">Slutförda Faser</p>
                    <div className="project-progress-value">{stats.completedPhases}</div>
                  </div>
                  <div className="project-progress-card">
                    <p className="project-progress-label">Pågående Faser</p>
                    <div className="project-progress-value">{stats.ongoingPhases}</div>
                  </div>
                  <div className="project-progress-card">
                    <p className="project-progress-label">Totala Faser</p>
                    <div className="project-progress-value">{stats.totalPhases}</div>
                  </div>
                </div>

                {/* Gantt Chart */}
                <div className="project-gantt-container">
                  <ul className="project-phase-list">
                    {phases.map((phase: any) => (
                      <li key={phase.id} className="project-phase-item">
                        <div className="project-phase-name">{phase.name}</div>
                        <div
                          className="project-phase-bar"
                          style={{ width: `${Math.max(phase.progress || 5, 5)}%` }}
                        >
                          <span className="project-phase-bar-label">{phase.progress || 0}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
        {activeTab === 'phases' && (
          <div className="module-placeholder">
            <Flag size={48} color="#D1D5DB" />
            <p>Detaljerad fasöversikt kommer här</p>
          </div>
        )}
        {activeTab === 'stakeholders' && (
          <div className="module-placeholder">
            <Users size={48} color="#D1D5DB" />
            <p>Stakeholder-lista kommer här</p>
          </div>
        )}
        {activeTab === 'risks' && (
          <div className="module-placeholder">
            <BarChart3 size={48} color="#D1D5DB" />
            <p>Riskanalys kommer här</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectPlanModule;
