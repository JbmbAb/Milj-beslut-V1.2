import React, { useState, useCallback } from 'react';
import AdminNav from './AdminNav';
import AdminHeader from './AdminHeader';
import { useAdminPageMeta } from './hooks/useAdminPageMeta';
import './admin-shell.css';

export type AdminModuleId = 'permit-portal' | 'logistics' | 'project-plan' | 'green-check' | 'sewage-portal';

interface AdminShellProps {
  activeModule: AdminModuleId;
  onModuleChange: (moduleId: AdminModuleId) => void;
  children?: React.ReactNode;
  onLogout?: () => void;
}

/**
 * AdminShell – Övergripande admin-gränssnitt
 * Hanterar sidonav, header, och innehållsarea
 * WCAG 2.1 AA och DIGG-kompatibel
 */
const AdminShell: React.FC<AdminShellProps> = ({ activeModule, onModuleChange, children, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Update page metadata for SEO
  useAdminPageMeta(activeModule);

  const handleLogout = useCallback(() => {
    if (onLogout) {
      onLogout();
    } else {
      // Default logout
      window.location.href = '/logout';
    }
  }, [onLogout]);

  return (
    <div className="admin-shell">
      {/* Sidonavigation */}
      <AdminNav
        activeModule={activeModule}
        onModuleChange={onModuleChange}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onLogout={handleLogout}
      />

      {/* Huvudinnehål */}
      <div className="admin-main">
        {/* Top Header */}
        <AdminHeader
          activeModule={activeModule}
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          onLogout={handleLogout}
        />

        {/* Innehållsarea */}
        <main className="admin-content" role="main">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
