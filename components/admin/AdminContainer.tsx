import React, { useState, useEffect } from 'react';
import AdminShell, { AdminModuleId } from './AdminShell';
import ModuleRouter from './ModuleRouter';
import './admin-tokens.css';

/**
 * AdminContainer – Root-komponent för admin-gränssnittet
 * Läser localStorage för sparad modulväxling
 * Hanterar modulväxling, logout, och React Query setup
 */
const AdminContainer: React.FC = () => {
  const [activeModule, setActiveModule] = useState<AdminModuleId>(() => {
    const saved = localStorage.getItem('admin-active-module');
    return (saved as AdminModuleId) || 'permit-portal';
  });

  useEffect(() => {
    localStorage.setItem('admin-active-module', activeModule);
  }, [activeModule]);

  const handleModuleChange = (moduleId: AdminModuleId) => {
    setActiveModule(moduleId);
  };

  const handleLogout = () => {
    window.location.href = '/logout';
  };

  return (
    <AdminShell activeModule={activeModule} onModuleChange={handleModuleChange} onLogout={handleLogout}>
      <ModuleRouter moduleId={activeModule} />
    </AdminShell>
  );
};

export default AdminContainer;
