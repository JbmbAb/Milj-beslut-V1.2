import React, { Suspense, lazy } from 'react';
import type { Permit } from '../types';

interface PermitPortalViewProps {
  permits: Permit[];
  mode?: 'map' | 'apply';
}

const PermitPortalApplyPanel = lazy(() => import('./PermitPortalApplyPanel'));
const PermitPortalMapPanel = lazy(() => import('./PermitPortalMapPanel'));

const ContentFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex min-h-[320px] items-center justify-center">
    <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  </div>
);

const PermitPortalView: React.FC<PermitPortalViewProps> = ({ permits, mode = 'map' }) => (
  <Suspense fallback={<ContentFallback label={mode === 'apply' ? 'Laddar ansokan' : 'Laddar karta'} />}>
    {mode === 'apply' ? <PermitPortalApplyPanel permits={permits} /> : <PermitPortalMapPanel permits={permits} />}
  </Suspense>
);

export default PermitPortalView;
