
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as LeafletLib from 'leaflet';
import App from './components/App';
import { ProjectStructureProvider } from './components/ProjectStructureContext';
import './index.css';

// Expose Leaflet as window.L so components that rely on the CDN global continue to work.
(window as unknown as Record<string, unknown>).L = LeafletLib;

/**
 * Initialiserar Miljobeslut.se 2.0 genom att rendera App-komponenten
 * till 'root'-elementet i index.html.
 */
const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ProjectStructureProvider>
        <App />
      </ProjectStructureProvider>
    </React.StrictMode>
  );
} else {
  console.error("Kunde inte hitta root-elementet. Kontrollera att index.html har en <div id='root'></div>.");
}
