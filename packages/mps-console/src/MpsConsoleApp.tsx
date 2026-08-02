import React from "react";
import type { MpsProjectionApi } from "./ProjectionApi";
import { MpsCompass } from "@miljobeslut/mps-compass";
import { designTokens } from "@miljobeslut/mps-identity";

interface ConsoleProps {
  api: MpsProjectionApi;
}

export const MpsConsoleApp: React.FC<ConsoleProps> = ({ api }) => {
  return (
    <div 
      className="mps-console-root flex flex-col min-h-screen"
      style={{
        backgroundColor: designTokens.colors.surfaceDarkStone.hex,
        color: designTokens.colors.coreTurquoise.hex,
        fontFamily: "'Plus Jakarta Sans', sans-serif" // Assuming this is part of the identity package but just in case
      }}
    >
      <header className="flex items-center justify-between p-4 border-b" style={{ borderColor: designTokens.colors.coreGraphite.hex }}>
        <div className="flex items-center space-x-3">
          <MpsCompass size={32} ringColor={designTokens.colors.coreTurquoise.hex} coreColor={designTokens.colors.flowLightCyan.hex} />
          <h1 className="text-xl font-bold uppercase tracking-widest">Mimer Console</h1>
        </div>
        <div className="text-xs tracking-widest uppercase opacity-70" style={{ color: designTokens.colors.statusAudit.hex }}>
          Sovereign Control Plane
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r p-4" style={{ borderColor: designTokens.colors.coreGraphite.hex }}>
          <nav>
            <ul className="space-y-4 text-sm font-semibold tracking-wider uppercase opacity-80">
              <li className="cursor-pointer hover:opacity-100">Dashboard</li>
              <li className="cursor-pointer hover:opacity-100">Pipelines</li>
              <li className="cursor-pointer hover:opacity-100">Artifacts</li>
              <li className="cursor-pointer hover:opacity-100">Registry</li>
              <li className="cursor-pointer hover:opacity-100">Audit Chain</li>
              <li className="cursor-pointer hover:opacity-100">Workers</li>
            </ul>
          </nav>
        </aside>

        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl">
            <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
            <div className="p-6 rounded-lg border" style={{ borderColor: designTokens.colors.coreGraphite.hex, backgroundColor: 'rgba(0,0,0,0.2)' }}>
              <p>Welcome to the Mimer Execution Control Plane monitoring dashboard.</p>
              <p className="mt-2 text-sm opacity-60">
                (Legacy UI is currently disabled. All views are rendered as pure projections via MpsProjectionApi.)
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MpsConsoleApp;
