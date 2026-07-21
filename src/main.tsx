import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import * as LeafletLib from 'leaflet';
import 'leaflet/dist/leaflet.css';
import App from '../components/App';
import { ProjectStructureProvider } from '../components/ProjectStructureContext';
import './index.css';

declare global {
  interface Window {
    L?: typeof LeafletLib;
  }
}

window.L = LeafletLib;

const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ProjectStructureProvider>
          <App />
        </ProjectStructureProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
} else {
  console.error("Kunde inte hitta root-elementet. Kontrollera att index.html har en <div id='root'></div>.");
}
