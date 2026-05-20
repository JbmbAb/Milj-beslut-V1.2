import React, { useState } from 'react';
import { FileText, Plus, CheckCircle, Clock, X, Wand2 } from 'lucide-react';
import './permit-portal.css';
import PermitForm from './PermitForm';
import DocumentUpload from './DocumentUpload';
import './permit-form.css';
import './document-upload.css';
import './permit-application-generator.css';
import './permit-application-editor.css';
import { useAdminProjectsQuery } from '../../hooks';
import { usePaginationState } from '../../hooks/usePaginationState';
import { LoadingSpinner, ErrorAlert, Pagination } from '../../shared';
import PermitApplicationGeneratorWithEditor from './PermitApplicationGeneratorWithEditor';
import type { Project } from '../../types/admin';

type PermitTab = 'generator' | 'applications' | 'decisions' | 'documents' | 'tracking';

/**
 * PermitPortalModule – Core Tillståndsportal
 * Hantering av miljötillståndsansökningar med pagination
 * WCAG 2.1 AA kompatibel
 */
const PermitPortalModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<PermitTab>('generator');
  const [showNewApplicationForm, setShowNewApplicationForm] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const selectedProjectId =
    typeof window === 'undefined' ? '' : window.localStorage.getItem('admin-selected-project') || '';

  // Pagination state
  const pageSize = 10;
  const pagination = usePaginationState(pageSize);

  // Fetch real data from API with pagination (React Query)
  const { data, isLoading, error, refetch } = useAdminProjectsQuery(pagination.page, pagination.pageSize);

  // Extract projects and total from React Query response
  const projects = data?.projects || [];
  const totalItems = data?.total || 0;
  const loading = isLoading;

  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'COMPLETED':
        return '#2E8B57';
      case 'ACTIVE':
        return '#D97706';
      case 'ARCHIVED':
        return '#DC2626';
      case 'DRAFT':
        return '#005293';
      default:
        return '#6B7280';
    }
  };

  const getStatusLabel = (status: Project['status']) => {
    const labels: Record<Project['status'], string> = {
      DRAFT: 'Utkast',
      ACTIVE: 'Aktiv',
      COMPLETED: 'Slutförd',
      ARCHIVED: 'Arkiverad',
    };
    return labels[status];
  };

  const handleFormSubmit = (_data: unknown) => {
    refetch();
    setShowNewApplicationForm(false);
  };

  return (
    <div className="permit-portal-module">
      {/* Modal för ny ansökan */}
      {showNewApplicationForm && (
        <div className="permit-portal-modal-overlay" onClick={() => setShowNewApplicationForm(false)}>
          <div className="permit-portal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="permit-portal-modal-header">
              <h2>Ny tillståndsansökan</h2>
              <button
                className="permit-portal-modal-close"
                onClick={() => setShowNewApplicationForm(false)}
                aria-label="Stäng dialog"
              >
                <X size={24} />
              </button>
            </div>
            <div className="permit-portal-modal-content">
              <PermitForm onSubmit={handleFormSubmit} onCancel={() => setShowNewApplicationForm(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Error handling */}
      {error && !dismissedError && (
        <ErrorAlert
          message={`Fel vid hämtning av projekt: ${error}`}
          severity="error"
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Header */}
      <div className="permit-portal-header">
        <div className="permit-portal-title-section">
          <FileText size={32} color="#005293" />
          <div>
            <h1 className="permit-portal-title">Core Tillståndsportal</h1>
            <p className="permit-portal-subtitle">
              Hantera miljötillståndsansökningar från initiering till beslut
            </p>
          </div>
        </div>

        <button className="permit-portal-btn-primary" onClick={() => setShowNewApplicationForm(true)}>
          <Plus size={20} />
          <span>Ny ansökan</span>
        </button>
      </div>

      {/* Tabbar */}
      <div className="permit-portal-tabs">
        <button
          className={`permit-portal-tab ${activeTab === 'generator' ? 'active' : ''}`}
          onClick={() => setActiveTab('generator')}
          aria-current={activeTab === 'generator' ? 'page' : undefined}
        >
          <Wand2 size={18} />
          Generera
        </button>
        <button
          className={`permit-portal-tab ${activeTab === 'applications' ? 'active' : ''}`}
          onClick={() => setActiveTab('applications')}
          aria-current={activeTab === 'applications' ? 'page' : undefined}
        >
          <FileText size={18} />
          Ansökningar ({totalItems})
        </button>
        <button
          className={`permit-portal-tab ${activeTab === 'decisions' ? 'active' : ''}`}
          onClick={() => setActiveTab('decisions')}
          aria-current={activeTab === 'decisions' ? 'page' : undefined}
        >
          <CheckCircle size={18} />
          Beslut
        </button>
        <button
          className={`permit-portal-tab ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
          aria-current={activeTab === 'documents' ? 'page' : undefined}
        >
          <FileText size={18} />
          Dokument
        </button>
        <button
          className={`permit-portal-tab ${activeTab === 'tracking' ? 'active' : ''}`}
          onClick={() => setActiveTab('tracking')}
          aria-current={activeTab === 'tracking' ? 'page' : undefined}
        >
          <Clock size={18} />
          Spårning
        </button>
      </div>

      {/* Innehål */}
      <div className="permit-portal-content">
        {activeTab === 'generator' && (
          <PermitApplicationGeneratorWithEditor
            projectId={selectedProjectId}
            onApplicationSaved={() => {
              setActiveTab('applications');
            }}
          />
        )}

        {activeTab === 'applications' && (
          <>
            {loading ? (
              <LoadingSpinner message="Laddar projekt..." />
            ) : projects.length === 0 ? (
              <div className="permit-portal-placeholder">
                <FileText size={48} color="#D1D5DB" />
                <p>Inga projekt hittades</p>
              </div>
            ) : (
              <div>
                <div className="permit-portal-table-wrapper">
                  <table className="permit-portal-table" role="table">
                    <thead>
                      <tr>
                        <th scope="col">Beteckning</th>
                        <th scope="col">Organisation</th>
                        <th scope="col">Status</th>
                        <th scope="col">Skapad</th>
                        <th scope="col">Risk-score</th>
                        <th scope="col">Åtgärder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((project) => (
                        <tr key={project.id}>
                          <td>
                            <span className="permit-portal-app-name">{project.propertyDesignation}</span>
                          </td>
                          <td>{project.organisationId.slice(0, 8)}...</td>
                          <td>
                            <span
                              className="permit-portal-status-badge"
                              style={{ borderColor: getStatusColor(project.status) }}
                            >
                              {getStatusLabel(project.status)}
                            </span>
                          </td>
                          <td>{new Date(project.createdAt).toLocaleDateString('sv-SE')}</td>
                          <td>
                            {project.regulatoryRiskScore ? project.regulatoryRiskScore.toFixed(1) : '—'}
                          </td>
                          <td>
                            <button className="permit-portal-action-btn">Visa</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalItems > pageSize && (
                  <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages || Math.ceil(totalItems / pageSize)}
                    hasNextPage={pagination.page < Math.ceil(totalItems / pageSize)}
                    hasPreviousPage={pagination.page > 1}
                    onPreviousPage={pagination.previousPage}
                    onNextPage={pagination.nextPage}
                    onGoToPage={pagination.goToPage}
                  />
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'decisions' && (
          <div className="permit-portal-placeholder">
            <CheckCircle size={48} color="#D1D5DB" />
            <p>Beslutöversikt kommer här</p>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="permit-portal-documents-section">
            <h2 className="permit-portal-section-title">Dokumenthantering</h2>
            <p className="permit-portal-section-description">
              Ladda upp och hantera dokument för tillståndsansökningar
            </p>
            <DocumentUpload maxFiles={10} maxFileSize={25} />
          </div>
        )}

        {activeTab === 'tracking' && (
          <div className="permit-portal-placeholder">
            <Clock size={48} color="#D1D5DB" />
            <p>Statusspårning kommer här</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PermitPortalModule;
