import { useState } from 'react';

interface UseSelectedProjectResult {
  projectId: string;
  setProjectId: (id: string) => void;
  clearProjectId: () => void;
}

/**
 * Hanterar det valda projektet
 * Sparar i localStorage för persistens mellan sidladdningar
 */
export const useSelectedProject = (): UseSelectedProjectResult => {
  const [projectId, setProjectIdState] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('admin-selected-project') || '';
  });

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('admin-selected-project', id);
    }
  };

  const clearProjectId = () => {
    setProjectIdState('');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin-selected-project');
    }
  };

  return { projectId, setProjectId, clearProjectId };
};
