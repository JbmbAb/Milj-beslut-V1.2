import React, { useState } from 'react';
import type { AppCompletionResponse } from '../../types';

interface CompletionTrackerProps {
  appCompletion: AppCompletionResponse | null;
  hasActiveSession: boolean;
}

const CompletionTracker: React.FC<CompletionTrackerProps> = ({ appCompletion, hasActiveSession }) => {
  const [expanded, setExpanded] = useState(false);

  if (!hasActiveSession) return null;

  return (
    <div
      data-testid="completion-bar"
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-black text-slate-700">
            {appCompletion ? `${appCompletion.donePercent}%` : '…'}
          </span>
          <span className="font-semibold text-slate-500">klart</span>
          {appCompletion && (
            <>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-slate-400">
                {appCompletion.remainingPercent}% återstår innan komplett app
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-400">
                {appCompletion.counts.done} klara
                {appCompletion.counts.partial > 0 && (
                  <>, <span className="text-yellow-600">{appCompletion.counts.partial} delvisa</span></>
                )}
                , <span className="text-red-500">{appCompletion.counts.pending} återstår</span>
                {' '}/ {appCompletion.counts.total} funktioner
              </span>
            </>
          )}
        </div>
        {appCompletion && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
          >
            {expanded ? 'Dölj detaljer' : 'Visa detaljer'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700"
          style={{ width: appCompletion ? `${appCompletion.donePercent}%` : '0%' }}
        />
      </div>

      {/* Category breakdown (expandable) */}
      {expanded && appCompletion && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {appCompletion.categories.map((cat) => (
            <div
              key={cat.name}
              className="rounded-xl border border-slate-100 bg-slate-50 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-black text-slate-700">{cat.name}</span>
                <span
                  className={`font-black ${
                    cat.percent === 100
                      ? 'text-emerald-600'
                      : cat.percent >= 60
                      ? 'text-teal-600'
                      : cat.percent >= 30
                      ? 'text-yellow-600'
                      : 'text-red-500'
                  }`}
                >
                  {cat.percent}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    cat.percent === 100
                      ? 'bg-emerald-500'
                      : cat.percent >= 60
                      ? 'bg-teal-400'
                      : cat.percent >= 30
                      ? 'bg-yellow-400'
                      : 'bg-red-400'
                  }`}
                  style={{ width: `${cat.percent}%` }}
                />
              </div>
              <div className="mt-1.5 text-slate-400">
                {cat.done} klara
                {cat.partial > 0 && <>, <span className="text-yellow-600">{cat.partial} delvisa</span></>}
                {cat.pending > 0 && <>, <span className="text-red-400">{cat.pending} återstår</span></>}
              </div>
              {/* Feature list */}
              <ul className="mt-2 space-y-0.5">
                {cat.features.map((f) => (
                  <li key={f.id} className="flex items-start gap-1.5">
                    <span
                      className={`mt-0.5 shrink-0 text-[10px] ${
                        f.status === 'DONE'
                          ? 'text-emerald-500'
                          : f.status === 'PARTIAL'
                          ? 'text-yellow-500'
                          : 'text-red-400'
                      }`}
                    >
                      {f.status === 'DONE' ? '✓' : f.status === 'PARTIAL' ? '◐' : '○'}
                    </span>
                    <span className="text-slate-600">
                      {f.label}
                      {f.note && (
                        <span className="ml-1 text-slate-400 italic"> — {f.note}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompletionTracker;
