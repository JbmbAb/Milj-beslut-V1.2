
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';

/**
 * Initialiserar RiskGuard-plattformen genom att rendera App-komponenten 
 * till 'root'-elementet i index.html.
 */
const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Kunde inte hitta root-elementet. Kontrollera att index.html har en <div id='root'></div>.");
}
