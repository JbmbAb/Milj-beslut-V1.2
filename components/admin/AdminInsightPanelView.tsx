import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type {
  AdminDatabaseDumpResponse,
  AdminExamSummary,
  DbAnalysisResponse,
  DbContentsResponse,
  DbStatsResponse,
  ExternalHealthReport,
} from '../../types';
import DatabaseStatsSection from './DatabaseStatsSection';
import ExternalHealthSection from './ExternalHealthSection';
import DatabaseAnalysisSection from './DatabaseAnalysisSection';
import DatabaseContentsSection from './DatabaseContentsSection';
import ExamSummarySection from './ExamSummarySection';
import DatabaseDumpSection from './DatabaseDumpSection';
import InsightPanel from './InsightPanel';

const OrganizationInvitations = lazy(() => import('./OrganizationInvitations'));
const ProjectScoringDashboard = lazy(() => import('./ProjectScoringDashboard'));
const AdminRequirementsStudio = lazy(() => import('../AdminRequirementsStudio'));

type SecureRequest = <T>(
  path: string,
  method: 'GET' | 'POST',
  payload?: Record<string, unknown>
) => Promise<T>;

interface AdminInsightPanelViewProps {
  dbStats: DbStatsResponse | null;
  externalHealth: ExternalHealthReport | null;
  dbAnalysis: DbAnalysisResponse | null;
  dbContents: DbContentsResponse | null;
  dbContentsTable: string;
  setDbContentsTable: React.Dispatch<React.SetStateAction<string>>;
  examSummary: AdminExamSummary | null;
  databaseDump: AdminDatabaseDumpResponse | null;
  busy: string;
  token: string;
  projectId: string;
  organisationId: string;
  secure: SecureRequest;
  onLoadDbStats: () => Promise<void>;
  onLoadExternalHealth: () => Promise<void>;
  onLoadDbAnalysis: () => Promise<void>;
  onLoadDbContents: () => Promise<void>;
  onLoadExamSummary: () => Promise<void>;
  onLoadDatabaseDump: () => Promise<void>;
  onError: React.Dispatch<React.SetStateAction<string>>;
  onInfo: React.Dispatch<React.SetStateAction<string>>;
}

const DeferredSectionFallback: React.FC<{ label: string; loading?: boolean }> = ({ label, loading = false }) => (
  <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 text-center text-slate-500 shadow-sm">
    {loading ? (
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
    ) : null}
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
  </div>
);

const DeferredSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (shouldRender) return;

    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: '360px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={sectionRef} className="min-h-[220px]">
      {shouldRender ? (
        <Suspense fallback={<DeferredSectionFallback label={`Laddar ${label}`} loading />}>{children}</Suspense>
      ) : (
        <DeferredSectionFallback label={`${label} laddas nar sektionen narmar sig`} />
      )}
    </div>
  );
};

const AdminInsightPanelView: React.FC<AdminInsightPanelViewProps> = ({
  dbStats,
  externalHealth,
  dbAnalysis,
  dbContents,
  dbContentsTable,
  setDbContentsTable,
  examSummary,
  databaseDump,
  busy,
  token,
  projectId,
  organisationId,
  secure,
  onLoadDbStats,
  onLoadExternalHealth,
  onLoadDbAnalysis,
  onLoadDbContents,
  onLoadExamSummary,
  onLoadDatabaseDump,
  onError,
  onInfo,
}) => (
  <>
    <div className="space-y-10">
      <DatabaseStatsSection
        dbStats={dbStats}
        busy={busy === 'dbstats'}
        token={token}
        onLoad={onLoadDbStats}
      />

      <ExternalHealthSection
        externalHealth={externalHealth}
        busy={busy === 'externalhealth'}
        token={token}
        onLoad={onLoadExternalHealth}
      />

      <DatabaseAnalysisSection
        dbAnalysis={dbAnalysis}
        busy={busy === 'dbanalysis'}
        token={token}
        onLoad={onLoadDbAnalysis}
      />

      <DatabaseContentsSection
        dbContents={dbContents}
        activeTable={dbContentsTable}
        setActiveTable={setDbContentsTable}
        busy={busy === 'dbcontents'}
        token={token}
        onLoad={onLoadDbContents}
      />
    </div>

    <div className="space-y-10">
      <InsightPanel dbAnalysis={dbAnalysis} />

      <ExamSummarySection
        examSummary={examSummary}
        busy={busy === 'exam'}
        token={token}
        onLoad={onLoadExamSummary}
      />

      <DatabaseDumpSection
        dbDump={databaseDump}
        busy={busy === 'dbdump'}
        token={token}
        onLoad={onLoadDatabaseDump}
      />
    </div>

    <DeferredSection label="kravstudio">
      <AdminRequirementsStudio token={token} onError={onError} onInfo={onInfo} />
    </DeferredSection>

    <DeferredSection label="bank-scoring">
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
          <h2 className="text-xl font-black uppercase tracking-widest text-slate-800">Bank-scoring & Compliance</h2>
        </div>
        <ProjectScoringDashboard projectId={projectId} token={token} />
      </section>
    </DeferredSection>

    <DeferredSection label="organisationsinbjudningar">
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-indigo-600" />
          <h2 className="text-xl font-black uppercase tracking-widest text-slate-800">Organisationsinbjudningar</h2>
        </div>
        <OrganizationInvitations orgId={organisationId} secure={secure} />
      </section>
    </DeferredSection>
  </>
);

export default AdminInsightPanelView;
