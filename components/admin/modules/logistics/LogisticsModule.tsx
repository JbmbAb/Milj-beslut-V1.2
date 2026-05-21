import React, { useState } from 'react';
import { Truck, Package, Gauge, AlertTriangle, Wand2 } from 'lucide-react';
import '../module-common.css';
import './logistics-dashboard.css';
import './logistics-generator.css';
import { useTransportBookingsQuery } from '../../hooks/useTransportBookingsQuery';
import { useTransportWebSocket } from '../../hooks/useTransportWebSocket';
import { usePaginationState } from '../../hooks/usePaginationState';
import { LoadingSpinner, ErrorAlert, Pagination } from '../../shared';
import LogisticsGenerator from './LogisticsGenerator';
import { environmentalImpactService, EmissionImpact } from '../../../../services/environmentalImpactService';

type LogisticsTab = 'generator' | 'transports' | 'storage' | 'emissions' | 'alerts';

/**
 * LogisticsModule – Logistik & Massa Hantering
 * Transportövervakning, lagerstatus, CO2-rapportering
 */
const LogisticsModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<LogisticsTab>('generator');
  const [dismissedError, setDismissedError] = useState(false);
  const [smedStats, setSmedStats] = useState<EmissionImpact | null>(null);

  // Pagination state
  const pageSize = 10;
  const pagination = usePaginationState(pageSize);

  // Fetch real transport bookings (React Query)
  const { data, isLoading, error } = useTransportBookingsQuery(pagination.page, pagination.pageSize);

  // Extract bookings and total from React Query response
  const bookings = data?.bookings || [];
  const totalItems = data?.total || 0;
  const loading = isLoading;

  // Subscribe to real-time transport updates (WebSocket)
  useTransportWebSocket();

  // Calculate stats from real data
  const stats = {
    totalTransports: bookings.length,
    activeTransports: bookings.filter((b) => b.status === 'IN_TRANSIT').length,
    totalCo2kg: bookings.reduce((sum, b) => sum + b.co2EstimateKg, 0),
    totalTonnage: bookings.reduce((sum, b) => sum + b.tons, 0),
  };

  useEffect(() => {
    if (activeTab === 'emissions' && stats.totalTonnage > 0) {
      // Benchmark based on SMED DIESEL fleet (avg distance assumed 50km if not in data)
      void environmentalImpactService.getTransportEmissions(stats.totalTonnage, 50, 'DIESEL')
        .then(setSmedStats);
    }
  }, [activeTab, stats.totalTonnage]);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      PENDING: 'Väntar',
      CONFIRMED: 'Bekräftad',
      IN_TRANSIT: 'I transport',
      DELIVERED: 'Levererad',
      CANCELLED: 'Avbruten',
    };
    return labels[status] || status;
  };

  return (
    <div className="module-container">
      {/* Error handling */}
      {error && !dismissedError && (
        <ErrorAlert
          message={`Fel vid hämtning av transporter: ${error}`}
          severity="error"
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Header */}
      <div className="module-header">
        <div className="module-title-section">
          <Truck size={32} color="#005293" />
          <div>
            <h1 className="module-title">Logistik & Massa Hantering</h1>
            <p className="module-subtitle">Övervaka transporter, lagring och miljöpåverkan</p>
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
          className={`module-tab ${activeTab === 'transports' ? 'active' : ''}`}
          onClick={() => setActiveTab('transports')}
        >
          <Truck size={18} />
          Transporter
        </button>
        <button
          className={`module-tab ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          <Package size={18} />
          Lagerstatus
        </button>
        <button
          className={`module-tab ${activeTab === 'emissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('emissions')}
        >
          <Gauge size={18} />
          CO₂ Rapportering
        </button>
        <button
          className={`module-tab ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          <AlertTriangle size={18} />
          Aviseringar
        </button>
      </div>

      {/* Content */}
      <div className="module-content">
        {activeTab === 'generator' && (
          <LogisticsGenerator
            projectId={localStorage.getItem('admin-selected-project') || ''}
            onPlanGenerated={() => {
              setActiveTab('transports');
            }}
          />
        )}

        {activeTab === 'transports' && (
          <>
            {loading ? (
              <LoadingSpinner message="Laddar transportbokningar..." />
            ) : (
              <div>
                {/* KPI Cards */}
                <div className="logistics-kpi-grid">
                  <div className="logistics-kpi-card">
                    <p className="logistics-kpi-label">Totala Transporter</p>
                    <div className="logistics-kpi-value">{stats.totalTransports}</div>
                  </div>
                  <div className="logistics-kpi-card">
                    <p className="logistics-kpi-label">Aktiva Transporter</p>
                    <div className="logistics-kpi-value">{stats.activeTransports}</div>
                  </div>
                  <div className="logistics-kpi-card">
                    <p className="logistics-kpi-label">Total Vikt</p>
                    <div className="logistics-kpi-value">{stats.totalTonnage.toFixed(1)}</div>
                    <p className="logistics-kpi-unit">ton</p>
                  </div>
                  <div className="logistics-kpi-card">
                    <p className="logistics-kpi-label">CO₂ Utsläpp</p>
                    <div className="logistics-kpi-value">{stats.totalCo2kg.toFixed(0)}</div>
                    <p className="logistics-kpi-unit">kg CO₂e</p>
                  </div>
                </div>

                {/* Transport List */}
                <div className="logistics-transport-list">
                  <h3 style={{ margin: '0 0 var(--spacing-xl) 0' }}>Aktiva Transporter</h3>
                  {bookings.length === 0 ? (
                    <div
                      style={{
                        padding: 'var(--spacing-xl)',
                        textAlign: 'center',
                        color: 'var(--color-text-secondary-digg)',
                      }}
                    >
                      Inga transporter registrerade
                    </div>
                  ) : (
                    bookings.map((booking) => (
                      <div key={booking.id} className="logistics-transport-item">
                        <div>
                          <p
                            style={{
                              margin: '0 0 4px 0',
                              fontWeight: 'bold',
                              fontSize: 'var(--font-size-sm-digg)',
                            }}
                          >
                            {booking.receiverName}
                          </p>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 'var(--font-size-xs-digg)',
                              color: 'var(--color-text-muted-digg)',
                            }}
                          >
                            Kod: {booking.wasteCode}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: 'var(--font-size-xs-digg)' }}>
                            Vikt: {booking.tons} ton
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: 'var(--font-size-xs-digg)' }}>
                            CO₂: {booking.co2EstimateKg.toFixed(0)} kg
                          </p>
                        </div>
                        <span
                          className={`logistics-status-badge ${booking.status.toLowerCase().replace('_', '-')}`}
                        >
                          {getStatusLabel(booking.status)}
                        </span>
                      </div>
                    ))
                  )}
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

        {activeTab === 'storage' && (
          <div className="module-placeholder">
            <Package size={48} color="#D1D5DB" />
            <p>Lagerstatusöversikt kommer här</p>
          </div>
        )}

        {activeTab === 'emissions' && (
          <div className="emissions-report-container" style={{ padding: 'var(--spacing-xl)', background: 'white', borderRadius: 'var(--border-radius-lg-digg)', border: '1px solid var(--color-border-digg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', padding: '16px', background: '#F0FDF4', borderRadius: '12px', border: '1px solid #BBF7D0' }}>
              <ShieldCheck size={28} color="#059669" />
              <div>
                <h3 style={{ margin: 0, color: '#065F46' }}>SMED-Verifierad Miljörapport</h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#047857' }}>
                  Officiella svenska utsläppsdata för vägtrafik (SMED/Naturvårdsverket).
                </p>
              </div>
            </div>

            <div className="logistics-kpi-grid">
              <div className="logistics-kpi-card" style={{ borderLeft: '4px solid #059669' }}>
                <p className="logistics-kpi-label">Beräknad CO₂e</p>
                <div className="logistics-kpi-value">{smedStats?.co2e.toFixed(1) || '...'}</div>
                <p className="logistics-kpi-unit">kg</p>
              </div>
              <div className="logistics-kpi-card" style={{ borderLeft: '4px solid #059669' }}>
                <p className="logistics-kpi-label">Kväveoxider (NOx)</p>
                <div className="logistics-kpi-value">{smedStats?.nox.toFixed(1) || '...'}</div>
                <p className="logistics-kpi-unit">g</p>
              </div>
              <div className="logistics-kpi-card" style={{ borderLeft: '4px solid #059669' }}>
                <p className="logistics-kpi-label">Partiklar (PM10)</p>
                <div className="logistics-kpi-value">{smedStats?.pm10.toFixed(2) || '...'}</div>
                <p className="logistics-kpi-unit">g</p>
              </div>
            </div>

            <div style={{ marginTop: '32px', padding: '20px', borderRadius: '16px', background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold' }}>Analys & Compliance</h4>
              <p style={{ margin: 0, fontSize: '13px', color: '#4B5563', lineHeight: '1.6' }}>
                Dessa värden används för att automatiskt fylla i Miljörapporten (Svenska Miljörapporteringsportalen - SMP) 
                och för att verifiera efterlevnad av Miljökvalitetsnormer (MKN) för luftkvalitet. 
                Värdena baseras på en genomsnittlig svensk lastbilsflotta 2024.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="module-placeholder">
            <AlertTriangle size={48} color="#D1D5DB" />
            <p>Aviseringslista kommer här</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogisticsModule;
