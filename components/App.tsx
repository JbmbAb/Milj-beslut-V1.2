import React from 'react';
import { AppShell } from './app/AppShell';
import { AppProviders } from './app/providers/AppProviders';

const App: React.FC = () => (
  <AppProviders>
    <AppShell />
  </AppProviders>
);

export default App;
