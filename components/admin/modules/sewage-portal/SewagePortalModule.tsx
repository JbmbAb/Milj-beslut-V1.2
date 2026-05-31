import React, { useState } from 'react';
import { Droplets, MapPin, ClipboardList, CheckCircle, Plus } from 'lucide-react';
import '../module-common.css';
import './sewage-form.css';
import { useAdminProjectsQuery } from '../../hooks';
import { usePaginationState } from '../../hooks/usePaginationState';
import { LoadingSpinner, ErrorAlert, Pagination } from '../../shared';

type SewageTab = 'applications' | 'location' | 'inspections' | 'approvals';

/**
 * SewagePortalModule – Enskilt Avlopp
 * Ansökan för privata avloppsanläggningar, inspektion
 * (Fallback använder Project-modell tills dedikerad SewageApplication finns)
 */
const SewagePortalModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SewageTab>('applications');
  const [showNewForm, setShowNewForm] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);

  // Pagination state
  const pageSize = 10;
  const pagination = usePaginationState(pageSize);

  // Fetch sewage applications (using projects as fallback until dedicated API exists)
  const { data, isLoading, error, refetch } = useAdminProjectsQuery(pagination.page, pagination.pageSize);
  const projects = data?.projects || [];
  const totalItems = data?.total || 0;
  const loading = isLoading;

  const handleNewApplication = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void new FormData(e.currentTarget);

    // Canonical: POST /api/sewage/applications
    refetch();
    setShowNewForm(false);
  };

  return (
    <div className="module-container">
      {/* Error handling */}
      {error && !dismissedError && (
        <ErrorAlert
          message={`Fel vid hämtning av VA-ansökningar: ${error}`}
          severity="error"
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* New Application Modal */}
      {showNewForm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowNewForm(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--color-bg-digg)',
              borderRadius: 'var(--border-radius-lg-digg)',
              padding: 'var(--spacing-xl)',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: 'var(--spacing-xl)',
                color: 'var(--color-text-primary-digg)',
              }}
            >
              Ny ansökan – Enskilt Avlopp
            </h2>
            <form onSubmit={handleNewApplication} className="sewage-form-container">
              <div className="sewage-form-section">
                <h3 className="sewage-form-section-title">Fastighetsuppgifter</h3>
                <div className="sewage-form-group">
                  <label className="sewage-form-label">Fastighetsadress</label>
                  <input
                    type="text"
                    name="address"
                    className="sewage-form-input"
                    placeholder="T.ex. Vägen 123, Västerås"
                    required
                  />
                </div>
                <div className="sewage-form-group">
                  <label className="sewage-form-label">Antal personer i hushållet</label>
                  <input
                    type="number"
                    name="household"
                    className="sewage-form-input"
                    min="1"
                    max="20"
                    required
                  />
                </div>
              </div>

              <div className="sewage-form-section">
                <h3 className="sewage-form-section-title">Geografisk placering</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)' }}>
                  <div className="sewage-form-group">
                    <label className="sewage-form-label">Latitud</label>
                    <input
                      type="number"
                      name="lat"
                      step="0.0001"
                      className="sewage-form-input"
                      placeholder="59.6167"
                      required
                    />
                  </div>
                  <div className="sewage-form-group">
                    <label className="sewage-form-label">Longitud</label>
                    <input
                      type="number"
                      name="lng"
                      step="0.0001"
                      className="sewage-form-input"
                      placeholder="16.55"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="sewage-form-button-group">
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  style={{
                    padding: 'var(--spacing-md) var(--spacing-xl)',
                    background: 'transparent',
                    border: '1px solid var(--color-border-digg)',
                    borderRadius: 'var(--border-radius-md-digg)',
                    cursor: 'pointer',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--color-text-secondary-digg)',
                  }}
                >
                  Avbryt
                </button>
                <button type="submit" className="sewage-form-btn-submit">
                  Skapa ansökan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="module-header">
        <div className="module-title-section">
          <Droplets size={32} color="#005293" />
          <div>
            <h1 className="module-title">Enskilt Avlopp</h1>
            <p className="module-subtitle">Ansökan och övervakning av privata VA-anläggningar</p>
          </div>
        </div>
        <button
          className="permit-portal-btn-primary"
          onClick={() => setShowNewForm(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-md) var(--spacing-xl)',
            backgroundColor: 'var(--color-primary-digg)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--border-radius-md-digg)',
            fontWeight: 'var(--font-weight-semibold)',
            cursor: 'pointer',
            transition: 'all var(--transition-base)',
          }}
        >
          <Plus size={20} />
          <span>Ny ansökan</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="module-tabs">
        <button
          className={`module-tab ${activeTab === 'applications' ? 'active' : ''}`}
          onClick={() => setActiveTab('applications')}
        >
          <ClipboardList size={18} />
          Ansökningar
        </button>
        <button
          className={`module-tab ${activeTab === 'location' ? 'active' : ''}`}
          onClick={() => setActiveTab('location')}
        >
          <MapPin size={18} />
          Placering
        </button>
        <button
          className={`module-tab ${activeTab === 'inspections' ? 'active' : ''}`}
          onClick={() => setActiveTab('inspections')}
        >
          <CheckCircle size={18} />
          Inspektioner
        </button>
        <button
          className={`module-tab ${activeTab === 'approvals' ? 'active' : ''}`}
          onClick={() => setActiveTab('approvals')}
        >
          <CheckCircle size={18} />
          Godkännanden
        </button>
      </div>

      {/* Content */}
      <div className="module-content">
        {activeTab === 'applications' && (
          <>
            {loading ? (
              <LoadingSpinner message="Laddar VA-ansökningar..." />
            ) : projects.length === 0 ? (
              <div className="module-placeholder">
                <ClipboardList size={48} color="#D1D5DB" />
                <p>Inga VA-ansökningar registrerade</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)' }}>
                <div
                  style={{
                    backgroundColor: 'var(--color-bg-digg)',
                    border: '1px solid var(--color-border-digg)',
                    borderRadius: 'var(--border-radius-lg-digg)',
                    overflow: 'hidden',
                  }}
                >
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      backgroundColor: 'var(--color-bg-digg)',
                    }}
                  >
                    <thead style={{ backgroundColor: 'var(--color-bg-dark)' }}>
                      <tr>
                        <th
                          style={{
                            padding: 'var(--spacing-lg)',
                            textAlign: 'left',
                            fontWeight: 'bold',
                            borderBottom: '2px solid var(--color-border-digg)',
                          }}
                        >
                          Beteckning
                        </th>
                        <th
                          style={{
                            padding: 'var(--spacing-lg)',
                            textAlign: 'left',
                            fontWeight: 'bold',
                            borderBottom: '2px solid var(--color-border-digg)',
                          }}
                        >
                          Status
                        </th>
                        <th
                          style={{
                            padding: 'var(--spacing-lg)',
                            textAlign: 'left',
                            fontWeight: 'bold',
                            borderBottom: '2px solid var(--color-border-digg)',
                          }}
                        >
                          Skapad
                        </th>
                        <th
                          style={{
                            padding: 'var(--spacing-lg)',
                            textAlign: 'left',
                            fontWeight: 'bold',
                            borderBottom: '2px solid var(--color-border-digg)',
                          }}
                        >
                          Miljöscore
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((project) => (
                        <tr key={project.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: 'var(--spacing-lg)' }}>{project.propertyDesignation}</td>
                          <td style={{ padding: 'var(--spacing-lg)' }}>
                            <span
                              style={{
                                padding: 'var(--spacing-sm) var(--spacing-lg)',
                                borderRadius: 'var(--border-radius-md-digg)',
                                backgroundColor:
                                  project.status === 'COMPLETED'
                                    ? '#ecfdf5'
                                    : project.status === 'ACTIVE'
                                      ? '#fef3c7'
                                      : '#f3f4f6',
                                color:
                                  project.status === 'COMPLETED'
                                    ? 'var(--color-success-digg)'
                                    : project.status === 'ACTIVE'
                                      ? 'var(--color-warning-digg)'
                                      : 'var(--color-text-muted-digg)',
                                fontSize: 'var(--font-size-xs-digg)',
                                fontWeight: 'bold',
                              }}
                            >
                              {project.status === 'COMPLETED' && 'Godkänd'}
                              {project.status === 'ACTIVE' && 'Aktiv'}
                              {project.status === 'DRAFT' && 'Utkast'}
                              {project.status === 'ARCHIVED' && 'Arkiverad'}
                            </span>
                          </td>
                          <td style={{ padding: 'var(--spacing-lg)' }}>
                            {new Date(project.createdAt).toLocaleDateString('sv-SE')}
                          </td>
                          <td style={{ padding: 'var(--spacing-lg)' }}>
                            {project.environmentalScore ? project.environmentalScore.toFixed(1) : '—'}
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
        {activeTab === 'location' && (
          <div className="module-placeholder">
            <MapPin size={48} color="#D1D5DB" />
            <p>Karta över anläggningar kommer här</p>
          </div>
        )}
        {activeTab === 'inspections' && (
          <div className="module-placeholder">
            <CheckCircle size={48} color="#D1D5DB" />
            <p>Inspektionsschema kommer här</p>
          </div>
        )}
        {activeTab === 'approvals' && (
          <div className="module-placeholder">
            <CheckCircle size={48} color="#D1D5DB" />
            <p>Godkännandestatus kommer här</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SewagePortalModule;
