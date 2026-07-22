/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { InterfaceMode, Permit } from '../../../types';
import { callApi } from '../../../services/coreApiClient';
import { useAppSession } from './AppSessionProvider';
import { MODE_CARDS, buildModeCardMap, type ModeCardConfig } from '../modeCards';

export type AppWorkspaceContextValue = {
  mode: InterfaceMode | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  setMode: (mode: InterfaceMode | null) => void;
  openMode: (nextMode: InterfaceMode) => void;
  permits: Permit[];
  selectedPermit: Permit | null;
  setSelectedPermit: (permit: Permit | null) => void;
  showUpload: boolean;
  setShowUpload: (show: boolean) => void;
  modeCardMap: Record<InterfaceMode, ModeCardConfig>;
  activeMode: ModeCardConfig | null;
  activeProjectLabel: string | null;
};

const AppWorkspaceContext = createContext<AppWorkspaceContextValue | null>(null);

export function AppWorkspaceProvider({ children }: { children: ReactNode }) {
  const { sessionState, bootstrap, hasAutoOpenedWorkspaceRef } = useAppSession();
  const [permits, setPermits] = useState<Permit[]>([]);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [mode, setMode] = useState<InterfaceMode | null>(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [showUpload, setShowUpload] = useState(false);

  const modeCardMap = useMemo(() => buildModeCardMap(MODE_CARDS), []);

  useEffect(() => {
    if (sessionState !== 'ready') return;
    if (!bootstrap?.activeProjectId) return;
    if (mode !== null) return;
    if (hasAutoOpenedWorkspaceRef.current) return;

    const timer = window.setTimeout(() => {
      hasAutoOpenedWorkspaceRef.current = true;
      setMode('PERMIT_PORTAL');
      setActiveTab('map');
    }, 0);

    return () => window.clearTimeout(timer);
  }, [bootstrap?.activeProjectId, mode, sessionState, hasAutoOpenedWorkspaceRef]);

  useEffect(() => {
    if (sessionState !== 'ready') return;
    void callApi<{ ok: boolean; permits?: Permit[] }>('/api/permits', { method: 'GET' })
      .then((data) => {
        if (data.ok && data.permits) setPermits(data.permits);
      })
      .catch(() => setPermits([]));
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready' && sessionState !== 'loading') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(null);

      setPermits([]);

      setSelectedPermit(null);
    }
  }, [sessionState]);

  const openMode = useCallback(
    (nextMode: InterfaceMode) => {
      setMode(nextMode);
      setActiveTab(modeCardMap[nextMode].defaultTab);
    },
    [modeCardMap],
  );

  const activeProject = useMemo(
    () => bootstrap?.projects.find((project) => project.id === bootstrap.activeProjectId) || null,
    [bootstrap],
  );

  const activeMode = mode ? modeCardMap[mode] : null;

  const value = useMemo<AppWorkspaceContextValue>(
    () => ({
      mode,
      activeTab,
      setActiveTab,
      setMode,
      openMode,
      permits,
      selectedPermit,
      setSelectedPermit,
      showUpload,
      setShowUpload,
      modeCardMap,
      activeMode,
      activeProjectLabel: activeProject?.propertyDesignation || null,
    }),
    [mode, activeTab, openMode, permits, selectedPermit, showUpload, modeCardMap, activeMode, activeProject],
  );

  return <AppWorkspaceContext.Provider value={value}>{children}</AppWorkspaceContext.Provider>;
}

export function useAppWorkspace(): AppWorkspaceContextValue {
  const ctx = useContext(AppWorkspaceContext);
  if (!ctx) {
    throw new Error('useAppWorkspace must be used within AppWorkspaceProvider');
  }
  return ctx;
}
