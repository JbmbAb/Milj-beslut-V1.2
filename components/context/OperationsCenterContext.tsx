/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, ReactNode } from 'react';

export type WorkflowStepId = 1 | 2 | 3 | 4 | 5;

export interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
}

export interface InspectorSource {
  id: string;
  title: string;
  type: string;
  citation?: string;
}

export interface InspectorData {
  title: string;
  subtitle: string;
  type: string;
  confidence?: number;
  status?: 'success' | 'warning' | 'danger' | 'info' | string;
  statusText?: string;
  metadata: Record<string, any>;
  explainText: string;
  sources?: InspectorSource[];
}

export interface AiActivity {
  id: string;
  text: string;
  type: 'info' | 'success' | 'warning' | 'danger';
  timestamp: Date;
}

interface OperationsCenterContextType {
  activeStep: WorkflowStepId;
  setActiveStep: (step: WorkflowStepId) => void;
  workflowSteps: WorkflowStep[];
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  caseId: string;
  setCaseId: (id: string) => void;
  inspectorData: InspectorData | null;
  setInspectorData: (data: InspectorData | null) => void;
  activities: AiActivity[];
  addAiActivity: (text: string, type?: 'info' | 'success' | 'warning' | 'danger') => void;
}

const OperationsCenterContext = createContext<OperationsCenterContextType | undefined>(undefined);

const DEFAULT_WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 1, label: 'Fastighet' },
  { id: 2, label: 'Geodata' },
  { id: 3, label: 'Juridik' },
  { id: 4, label: 'MKB / Miljö' },
  { id: 5, label: 'Beslut' },
];

export const OperationsCenterProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeStep, setActiveStep] = useState<WorkflowStepId>(1);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [caseId, setCaseId] = useState<string>('24-0387');
  const [inspectorData, setInspectorData] = useState<InspectorData | null>(null);
  const [activities, setActivities] = useState<AiActivity[]>([]);

  const addAiActivity = (text: string, type: 'info' | 'success' | 'warning' | 'danger' = 'info') => {
    const newActivity: AiActivity = {
      id: Math.random().toString(36).substring(7),
      text,
      type,
      timestamp: new Date(),
    };
    setActivities((prev) => [newActivity, ...prev]);
    console.log(`[AI Activity] [${type.toUpperCase()}] ${text}`);
  };

  return (
    <OperationsCenterContext.Provider
      value={{
        activeStep,
        setActiveStep,
        workflowSteps: DEFAULT_WORKFLOW_STEPS,
        commandPaletteOpen,
        setCommandPaletteOpen,
        caseId,
        setCaseId,
        inspectorData,
        setInspectorData,
        activities,
        addAiActivity,
      }}
    >
      {children}
    </OperationsCenterContext.Provider>
  );
};

export const useOperationsCenter = (): OperationsCenterContextType => {
  const context = useContext(OperationsCenterContext);

  if (context) return context;

  if (import.meta.env.MODE === "test") {
    return {
      activeStep: 1,
      setActiveStep: () => {},
      workflowSteps: [],
      commandPaletteOpen: false,
      setCommandPaletteOpen: () => {},
      caseId: '',
      setCaseId: () => {},
      inspectorData: null,
      setInspectorData: () => {},
      activities: [],
      addAiActivity: () => {},
    };
  }

  throw new Error('useOperationsCenter must be used within OperationsCenterProvider');
};

export default OperationsCenterContext;
