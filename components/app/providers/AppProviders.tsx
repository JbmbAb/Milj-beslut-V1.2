import React, { type ReactNode } from 'react';
import { AppSessionProvider } from './AppSessionProvider';
import { AppWorkspaceProvider } from './AppWorkspaceProvider';
import { OperationsCenterProvider } from '../../context/OperationsCenterContext';
import { ThemeProvider } from '../../context/ThemeContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppSessionProvider>
      <AppWorkspaceProvider>
        <ThemeProvider>
          <OperationsCenterProvider>{children}</OperationsCenterProvider>
        </ThemeProvider>
      </AppWorkspaceProvider>
    </AppSessionProvider>
  );
}

