import React from 'react';

type LegacyPermitPortalBannerProps = {
  onOpenMassModule?: () => void;
};

/**
 * Visas i legacy PERMIT_PORTAL / PermitPortalView.
 * C-anmälan schaktmassor är canonical modul sedan 2026-05.
 */
const LegacyPermitPortalBanner: React.FC<LegacyPermitPortalBannerProps> = ({ onOpenMassModule }) => (
  <div
    className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    role="status"
  >
    <p className="font-black uppercase tracking-[0.12em] text-[11px] text-amber-800">Legacy — Provningsportal</p>
    <p className="mt-1">
      Denna vy är föregångaren till modulen{' '}
      <strong>C-anmälan schaktmassor</strong>. Använd Huvudmoduler → C-anmälan för inlämning, audit och staging-E2E.
    </p>
    {onOpenMassModule && (
      <button
        type="button"
        onClick={onOpenMassModule}
        className="mt-3 rounded-xl bg-amber-900 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-amber-800"
      >
        Öppna C-anmälan schaktmassor
      </button>
    )}
  </div>
);

export default LegacyPermitPortalBanner;
