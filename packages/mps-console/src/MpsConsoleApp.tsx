import React from "react";
import type { MpsProjectionApi } from "./ProjectionApi";

interface ConsoleProps {
  api: MpsProjectionApi;
}

export const MpsConsoleApp: React.FC<ConsoleProps> = ({ api }) => {
  return (
    <div className="mps-console">
      <header className="mps-console-header">
        <h1>Mimer Platform Suite Console</h1>
      </header>
      <aside className="mps-console-sidebar">
        <nav>
          <ul>
            <li>Dashboard</li>
            <li>Pipelines</li>
            <li>Artifacts</li>
            <li>Registry Snapshots</li>
            <li>Audit Chain</li>
            <li>Workers</li>
          </ul>
        </nav>
      </aside>
      <main className="mps-console-main">
        <p>Welcome to the Mimer Execution Control Plane monitoring dashboard.</p>
      </main>
    </div>
  );
};
export default MpsConsoleApp;
