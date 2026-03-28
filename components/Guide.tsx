import React, { useMemo } from 'react';
import type { InterfaceMode } from '../types';
import { countReadyModules } from '../services/projectStructure';
import { useProjectStructure } from './ProjectStructureContext';
import { MetricCard } from './ui/MetricCard';
import { ActionCard } from './ui/ActionCard';

interface GuideProps {
  mode?: InterfaceMode | null;
  onNavigate?: (tab: string) => void;
}

type ActionCard = {
  id: string;
  title: string;
  desc: string;
  tab: string;
  tone: 'default' | 'ok' | 'warn';
};

function resolveModeTabs(mode: InterfaceMode | null | undefined): {
  planTab: string;
  docsTab: string;
  riskTab: string;
  reportTab: string;
} {
  if (mode === 'PROJECT_MANAGER') {
    return {
      planTab: 'plan',
      docsTab: 'plan',
      riskTab: 'risks',
      reportTab: 'timeline',
    };
  }
  if (mode === 'PERMIT_PORTAL') {
    return {
      planTab: 'apply',
      docsTab: 'forms',
      riskTab: 'risks',
      reportTab: 'map',
    };
  }
  if (mode === 'LOGISTICS_MARKET') {
    return {
      planTab: 'archive',
      docsTab: 'archive',
      riskTab: 'triage',
      reportTab: 'logistics',
    };
  }
  if (mode === 'COMPLIANCE_AUDIT') {
    return {
      planTab: 'score',
      docsTab: 'audit',
      riskTab: 'score',
      reportTab: 'reports',
    };
  }
  return {
    planTab: 'admin-search',
    docsTab: 'admin-search',
    riskTab: 'admin-insight',
    reportTab: 'admin-insight',
  };
}

const Guide: React.FC<GuideProps> = ({ mode = null, onNavigate }) => {
  const { plan, gateStats, remoteSync } = useProjectStructure();

  const totalRequiredGates = useMemo(() => plan.stageGates.filter((gate) => gate.required).length, [plan.stageGates]);
  const blockedRequiredGates = gateStats.blocked;
  const passedRequiredGates = gateStats.passed;
  const gateCompletionPct = totalRequiredGates > 0 ? Math.round((passedRequiredGates / totalRequiredGates) * 100) : 0;

  const totalDocs = plan.documentArchive.length;
  const draftDocs = useMemo(() => plan.documentArchive.filter((doc) => doc.status === 'DRAFT').length, [plan.documentArchive]);
  const verifiedDocs = useMemo(() => plan.documentArchive.filter((doc) => doc.status === 'VERIFIED').length, [plan.documentArchive]);
  const readyModules = useMemo(() => countReadyModules(plan), [plan]);
  const carbonReady = Boolean(plan.carbonSummary.lastResult);

  const tabs = useMemo(() => resolveModeTabs(mode), [mode]);

  const actions = useMemo<ActionCard[]>(() => {
    const next: ActionCard[] = [];

    next.push(
      blockedRequiredGates > 0
        ? {
            id: 'gates',
            title: 'Los blockerade stage-gates',
            desc: `${blockedRequiredGates} gate(s) blockerar fortsatt flode. Kor utvardering och komplettera underlag.`,
            tab: tabs.planTab,
            tone: 'warn',
          }
        : {
            id: 'gates',
            title: 'Gate-status ar stabil',
            desc: `Gate completion ${gateCompletionPct}%. Verifiera att nasta fas har ratt indata.`,
            tab: tabs.planTab,
            tone: 'ok',
          }
    );

    next.push(
      draftDocs > 0
        ? {
            id: 'docs',
            title: 'Verifiera dokument',
            desc: `${draftDocs} dokument ligger i DRAFT. Flytta kritiska underlag till VERIFIED for kortare handlaggning.`,
            tab: tabs.docsTab,
            tone: 'warn',
          }
        : {
            id: 'docs',
            title: 'Dokumentlager ar verifierat',
            desc: `${verifiedDocs}/${totalDocs} dokument verifierade. Fortsatt med risk- och rapportsteg.`,
            tab: tabs.docsTab,
            tone: 'ok',
          }
    );

    next.push(
      carbonReady
        ? {
            id: 'carbon',
            title: 'Carbon-check ar klar',
            desc: 'CO2-resultat finns i planen. Anvand det i rapport och externa beslutsunderlag.',
            tab: tabs.reportTab,
            tone: 'ok',
          }
        : {
            id: 'carbon',
            title: 'Saknad carbon-berakning',
            desc: 'Kor CO2-kalkyl och utvardera CARBON_CHECK innan signering.',
            tab: tabs.riskTab,
            tone: 'warn',
          }
    );

    if (!remoteSync.enabled) {
      next.push({
        id: 'sync',
        title: 'Aktivera DB-session',
        desc: 'Ingen aktiv project/token-session hittad. Logga in i admin for att synka plan och dashboard-data.',
        tab: 'admin-search',
        tone: 'default',
      });
    }

    return next;
  }, [
    blockedRequiredGates,
    gateCompletionPct,
    tabs,
    draftDocs,
    verifiedDocs,
    totalDocs,
    carbonReady,
    remoteSync.enabled,
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500 pb-10 text-slate-800">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
              <i className="fas fa-book-open" /> Anvandarstod
            </div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">Guide for nasta steg</h2>
            <p className="mt-2 text-sm text-slate-600">
              Datadriven rekommendation baserad pa gates, dokument, moduler och synkstatus.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
            {remoteSync.enabled ? `DB sync aktiv (${remoteSync.projectId})` : 'DB sync lokal fallback'}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <MetricCard label="Gates" value={`${passedRequiredGates}/${totalRequiredGates}`} />
        <MetricCard label="Blockers" value={String(blockedRequiredGates)} tone={blockedRequiredGates > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Docs" value={`${verifiedDocs}/${totalDocs}`} />
        <MetricCard label="Draft" value={String(draftDocs)} tone={draftDocs > 0 ? 'warn' : 'ok'} />
        <MetricCard label="Moduler redo" value={String(readyModules)} />
        <MetricCard label="Carbon" value={carbonReady ? 'READY' : 'MISSING'} tone={carbonReady ? 'ok' : 'warn'} />
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-black text-slate-900">Prioriterade atgarder</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {actions.map((item) => (
            <ActionCard
              key={item.id}
              title={item.title}
              description={item.desc}
              tone={item.tone}
              onAction={() => {
                if (onNavigate) onNavigate(item.tab);
              }}
              actionLabel={`Oppna ${item.tab}`}
            />
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-900">Arbetsordning for examensunderlag</h3>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <StepRow
            num="1"
            title="Sakra datakvalitet"
            text="Verifiera dokumentstatus och kontrollera att stage-gates ar uppdaterade pa aktuell planversion."
          />
          <StepRow
            num="2"
            title="Jamfor myndighetskrav"
            text="Anvand sok- och filterfloden for att strukturera krav per kommun/lansstyrelse och kravkategori."
          />
          <StepRow
            num="3"
            title="Bygg mall och slutsatser"
            text="Sammanfatta minimikrav, vanliga tillagg och rekommenderad C-anmalningsmall i rapportformat."
          />
        </div>
      </section>
    </div>
  );
};

const StepRow: React.FC<{ num: string; title: string; text: string }> = ({ num, title, text }) => (
  <div className="flex items-start gap-3">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white">
      {num}
    </div>
    <div>
      <p className="text-sm font-black text-slate-900">{title}</p>
      <p className="text-xs leading-relaxed text-slate-600">{text}</p>
    </div>
  </div>
);

export default Guide;
