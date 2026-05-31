import React, { useState, useMemo } from 'react';
import { TrendingUp, PieChart, FileText, Check, Wand2 } from 'lucide-react';
import '../module-common.css';
import './green-check-dashboard.css';
import { useCarbonMetricsQuery, useCarbonWebSocket } from '../../hooks';
import { LoadingSpinner, ErrorAlert } from '../../shared';
import GreenCheckGeneratorWithEditor from './GreenCheckGeneratorWithEditor';

type GreenCheckTab = 'generator' | 'dashboard' | 'metrics' | 'reports' | 'compliance';

/**
 * GreenCheckModule – Grönkoll för Banker
 * Risk-bedömning, miljörapportering, finansiering
 */
const GreenCheckModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<GreenCheckTab>('generator');
  const [dismissedError, setDismissedError] = useState(false);

  // Get selected project from localStorage
  const projectId = typeof window !== 'undefined' ? localStorage.getItem('admin-selected-project') || '' : '';

  // Fetch carbon metrics and risk data (React Query)
  const { data, isLoading, error } = useCarbonMetricsQuery(projectId);
  // Extract from data object - structure varies based on API response
  const carbonResult = data?.result ?? null;
  const riskMetrics = useMemo(() => data?.riskMetrics ?? [], [data?.riskMetrics]);
  const loading = isLoading;

  // Subscribe to real-time CO₂ updates (WebSocket)
  useCarbonWebSocket(projectId);

  // Calculate KPIs from real data
  const complianceLabel = useMemo(() => {
    const complianceMetric = riskMetrics.find((m) => m.name === 'Compliance');
    if (complianceMetric && complianceMetric.score > 0) {
      return `${Math.round(complianceMetric.score)}%`;
    }
    if (riskMetrics.length > 0) {
      const passing = riskMetrics.filter((m) => m.status === 'low' || m.score >= m.threshold).length;
      return `${Math.round((passing / riskMetrics.length) * 100)}%`;
    }
    return '—';
  }, [riskMetrics]);

  const kpis = useMemo(
    () => [
      {
        label: 'ESG Rating',
        value: carbonResult ? (carbonResult.totalKgCo2e < 1000 ? 'AAA' : 'AA') : '—',
        trend: '↑',
      },
      {
        label: 'Carbon Ready',
        value: carbonResult && carbonResult.totalKgCo2e < 5000 ? 'Ja' : 'Nej',
        trend: carbonResult && carbonResult.totalKgCo2e < 5000 ? '✓' : '⚠',
      },
      {
        label: 'Compliance',
        value: complianceLabel,
        trend: complianceLabel === '—' ? '—' : '↑',
      },
      {
        label: 'Loan Eligible',
        value: carbonResult && carbonResult.quality === 'VERIFIED' ? 'Ja' : 'Nej',
        trend: carbonResult && carbonResult.quality === 'VERIFIED' ? '✓' : '⚠',
      },
    ],
    [carbonResult, complianceLabel],
  );

  const getGaugeClass = (status: string) => {
    switch (status) {
      case 'low':
        return 'green-check-gauge-low';
      case 'medium':
        return 'green-check-gauge-medium';
      case 'high':
        return 'green-check-gauge-high';
      default:
        return '';
    }
  };

  return (
    <div className="module-container">
      {/* Error handling */}
      {error && !dismissedError && (
        <ErrorAlert
          message={`Fel vid hämtning av riskmätetal: ${error}`}
          severity="error"
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {!projectId && (
        <ErrorAlert
          message="Välj ett projekt från dropdown i headern för att se risk-bedömning"
          severity="info"
          onDismiss={() => {}}
        />
      )}

      {/* Header */}
      <div className="module-header">
        <div className="module-title-section">
          <TrendingUp size={32} color="#005293" />
          <div>
            <h1 className="module-title">Grönkoll för Banker</h1>
            <p className="module-subtitle">Risk-bedömning, miljörapportering och finansiering</p>
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
          className={`module-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <PieChart size={18} />
          Dashboard
        </button>
        <button
          className={`module-tab ${activeTab === 'metrics' ? 'active' : ''}`}
          onClick={() => setActiveTab('metrics')}
        >
          <TrendingUp size={18} />
          Mätetal
        </button>
        <button
          className={`module-tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <FileText size={18} />
          Rapporter
        </button>
        <button
          className={`module-tab ${activeTab === 'compliance' ? 'active' : ''}`}
          onClick={() => setActiveTab('compliance')}
        >
          <Check size={18} />
          Compliance
        </button>
      </div>

      {/* Content */}
      <div className="module-content">
        {activeTab === 'generator' && (
          <GreenCheckGeneratorWithEditor
            onAssessmentSaved={() => {
              setActiveTab('dashboard');
            }}
          />
        )}

        {activeTab === 'dashboard' && (
          <>
            {loading ? (
              <LoadingSpinner message="Laddar risk-bedömning..." />
            ) : !projectId ? (
              <div className="module-placeholder">
                <PieChart size={48} color="#D1D5DB" />
                <p>Välj ett projekt för att se risk-dashboard</p>
              </div>
            ) : (
              <div>
                {/* KPI Cards */}
                <div className="green-check-kpi-grid">
                  {kpis.map((kpi, idx) => (
                    <div key={idx} className="green-check-kpi-card">
                      <p
                        style={{
                          margin: '0 0 var(--spacing-md) 0',
                          fontSize: 'var(--font-size-xs-digg)',
                          color: 'var(--color-text-muted-digg)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {kpi.label}
                      </p>
                      <p
                        style={{
                          margin: '0 0 var(--spacing-md) 0',
                          fontSize: 'var(--font-size-2xl-digg)',
                          fontWeight: 'bold',
                          color: 'var(--color-primary-digg)',
                        }}
                      >
                        {kpi.value}
                      </p>
                      <span
                        style={{ fontSize: 'var(--font-size-sm-digg)', color: 'var(--color-success-digg)' }}
                      >
                        {kpi.trend}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Risk Gauges */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                    gap: 'var(--spacing-xl)',
                  }}
                >
                  {riskMetrics.map((metric, idx) => (
                    <div key={idx} className="green-check-risk-gauge">
                      <div className={`green-check-gauge-circle ${getGaugeClass(metric.status)}`}>
                        {metric.score.toFixed(0)}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ margin: '0 0 var(--spacing-sm) 0', fontWeight: 'bold' }}>{metric.name}</p>
                        <span className={`green-check-score-indicator ${metric.status}`}>
                          {metric.status === 'low' && 'Låg Risk'}
                          {metric.status === 'medium' && 'Medel Risk'}
                          {metric.status === 'high' && 'Hög Risk'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'metrics' && (
          <div className="module-placeholder">
            <TrendingUp size={48} color="#D1D5DB" />
            <p>Detaljerade mätetal kommer här</p>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="module-placeholder">
            <FileText size={48} color="#D1D5DB" />
            <p>ESG- och riskcrapporter kommer här</p>
          </div>
        )}

        {activeTab === 'compliance' && (
          <div className="module-placeholder">
            <Check size={48} color="#D1D5DB" />
            <p>Compliance-checklista kommer här</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GreenCheckModule;
