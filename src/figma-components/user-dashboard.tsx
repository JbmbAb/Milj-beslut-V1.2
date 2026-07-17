import React from 'react';

export interface UserDashboardProps {
  className?: string;
  title?: string;
}

const UserDashboard: React.FC<UserDashboardProps> = ({ className = '', title }) => {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-900">{title || 'User dashboard'}</h3>
        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-600">
          "size unavailable"
        </span>
      </header>
      <p className="text-xs text-slate-600">Generated from Figma node "NsXMGXB0ljuk3l1D0NOVyK".</p>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-700">
        <li>"Public fallback export"</li>
        <li>"Add FIGMA_TOKEN for full component tree"</li>
        <li>"Thumbnail URL redacted"</li>
      </ul>
    </section>
  );
};

export default UserDashboard;
