import React, { type ReactNode } from 'react';
import { AppSessionProvider } from './AppSessionProvider';
import { AppWorkspaceProvider } from './AppWorkspaceProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppSessionProvider>
      <AppWorkspaceProvider>{children}</AppWorkspaceProvider>
    </AppSessionProvider>
  );
}
