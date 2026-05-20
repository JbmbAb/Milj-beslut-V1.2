import React from 'react';
import type { MetaFunction, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import UserDashboard from '~/figma-components/user-dashboard';

// Import our verified services
import { getAppCompletion } from '../../server/services/completionService';
import { getGraphStats } from '../../server/services/knowledgeGraphService';

export const meta: MetaFunction = () => {
  return [
    { title: 'Miljobeslut.se - Dashboard - Verifierad Status' },
    { name: 'description', content: 'Översikt över miljöärenden och kunskapsgrafen.' },
  ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // 1. Get real data from our services
  const completion = getAppCompletion();
  const graphStats = await getGraphStats();

  return json({ completion, graphStats });
};

export default function DashboardPage() {
  const { completion, graphStats } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: 'var(--bg-main)' }}>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Section with Glassmorphism */}
        <div className="glass-strong p-8 rounded-3xl border border-white/10 animate-slideUpIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="text-4xl font-black font-display text-white tracking-tight">
                Välkommen till <span style={{ color: 'var(--primary-light)' }}>Miljöbeslut</span>
              </h1>
              <p className="text-white/60 mt-2 font-medium">
                Systemet är nu <span className="text-white">{completion.donePercent}%</span> komplett.
                {graphStats.totalNodes} kunskapsnoder indexerade.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs uppercase tracking-widest text-white/40 font-bold">Kunskapsgraf</div>
                <div className="text-2xl font-mono font-bold text-white">
                  {graphStats.totalEdges} relationer
                </div>
              </div>
              <div className="h-12 w-[1px] bg-white/10" />
              <div className="px-5 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-bold text-white">
                {completion.donePercent >= 90
                  ? 'Produktionsklar'
                  : completion.donePercent >= 60
                    ? 'Pilot'
                    : 'Under uppbyggnad'}
              </div>
            </div>
          </div>
        </div>

        {/* Core Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {completion.categories.slice(0, 3).map((cat, idx) => (
            <div
              key={cat.name}
              className={`glass p-6 rounded-2xl border border-white/5 animate-scaleIn`}
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-2">{cat.name}</h3>
              <div className="flex items-end justify-between">
                <div className="text-3xl font-black text-white">{cat.percent}%</div>
                <div className="text-xs text-white/40">
                  {cat.done} / {cat.total} Klara
                </div>
              </div>
              <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-1000"
                  style={{ width: `${cat.percent}%`, backgroundColor: 'var(--primary)' }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Main Dashboard Interaction */}
        <div className="grid grid-cols-1 gap-6">
          <UserDashboard
            title="Georealp-analys (Verifierad)"
            className="hover:ring-2 hover:ring-indigo-500/50 transition-all duration-300 shadow-glow"
            data={{ completion, graphStats }}
          />
        </div>

        {/* Footer Audit Status */}
        <div className="flex justify-center py-8">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500/50" />
            Human-in-the-loop: Juridisk slutgranskning krävs enligt MB 2:3
          </div>
        </div>
      </div>
    </div>
  );
}
