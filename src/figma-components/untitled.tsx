import React from 'react';

export interface UntitledProps {
  className?: string;
  title?: string;
}

const Untitled: React.FC<UntitledProps> = ({ className = '', title }) => {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`.trim()}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-900">{title || 'Untitled'}</h3>
        <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-600">
          "size unavailable"
        </span>
      </header>
      <p className="text-xs text-slate-600">Generated from Figma node "Ip0100hC1M8J4HhJ3vx498".</p>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-700">
        <li>"Public fallback export"</li>
        <li>"Add FIGMA_TOKEN for full component tree"</li>
        <li>
          "Thumbnail available:
          https://s3-alpha.figma.com/thumbnails/4aae93da-d1c3-46ec-98f4-2555f8ad0340?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQ4GOSFWC6RGVDPLF%2F20260322%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20260322T120000Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=1f3853841ad0980185d30a7cf111509e758e9f7256d1c26f5d377a07e78696db"
        </li>
      </ul>
    </section>
  );
};

export default Untitled;
