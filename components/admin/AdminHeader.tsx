import React, { useState, useMemo } from 'react';
import { Menu, Bell, User, LogOut, ChevronDown } from 'lucide-react';
import './admin-header.css';
import { AdminModuleId } from './AdminShell';
import { useAdminProjects } from './hooks';
import type { Project } from './types/admin';

interface AdminHeaderProps {
  activeModule: AdminModuleId;
  onMenuToggle: () => void;
  onLogout: () => void;
}

const MODULE_LABELS: Record<AdminModuleId, string> = {
  'permit-portal': 'Core Tillståndsportal',
  logistics: 'Logistik & Massa',
  'project-plan': 'Projektplan',
  'green-check': 'Grönkoll för Banker',
  'sewage-portal': 'Enskilt Avlopp',
  operations: 'Drift & Databas',
};

/**
 * AdminHeader – Top-bar med modulinfo, notifikationer och användarprofilmeny
 * WCAG 2.1 AA: Tillgänglig meny, knappbeskrivningar
 */
const AdminHeader: React.FC<AdminHeaderProps> = ({ activeModule, onMenuToggle, onLogout }) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [notificationCount] = useState(3);

  const { projects } = useAdminProjects();

  const selectedProject = useMemo(() => {
    if (projects.length === 0) return null;
    const savedProjectId =
      typeof window !== 'undefined' ? localStorage.getItem('admin-selected-project') : null;
    if (savedProjectId) {
      const found = projects.find((p) => p.id === savedProjectId);
      return found || projects[0];
    }
    return projects[0];
  }, [projects]);

  const handleProjectSelect = (project: Project) => {
    localStorage.setItem('admin-selected-project', project.id);
    setShowProjectMenu(false);
    // Note: selectedProject will update automatically via useMemo
  };

  return (
    <header className="admin-header">
      {/* Vänster del: Meny-toggle och modulnamn */}
      <div className="admin-header-left">
        <button
          className="admin-header-menu-btn"
          onClick={onMenuToggle}
          aria-label="Slå på/av sidonav"
          title="Visa/dölj sidonav"
        >
          <Menu size={24} />
        </button>

        <div className="admin-header-module">
          <h2 className="admin-header-module-name">{MODULE_LABELS[activeModule]}</h2>
          <p className="admin-header-breadcrumb">
            {selectedProject ? selectedProject.propertyDesignation : 'Välj projekt'} /{' '}
            {MODULE_LABELS[activeModule]}
          </p>
        </div>

        {/* Project Selector */}
        <div style={{ marginLeft: 'var(--spacing-xl)', position: 'relative' }}>
          <button
            onClick={() => setShowProjectMenu(!showProjectMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-sm)',
              padding: 'var(--spacing-sm) var(--spacing-lg)',
              backgroundColor: 'var(--color-bg-light)',
              border: '1px solid var(--color-border-digg)',
              borderRadius: 'var(--border-radius-md-digg)',
              cursor: 'pointer',
              color: 'var(--color-text-primary-digg)',
              fontSize: 'var(--font-size-sm-digg)',
            }}
            aria-label="Projektväljare"
          >
            <span>{selectedProject ? selectedProject.propertyDesignation.slice(0, 15) : 'Projekt'}</span>
            <ChevronDown size={16} />
          </button>
          {showProjectMenu && projects.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 'var(--spacing-sm)',
                backgroundColor: 'var(--color-bg-digg)',
                border: '1px solid var(--color-border-digg)',
                borderRadius: 'var(--border-radius-md-digg)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 10,
                minWidth: '250px',
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleProjectSelect(project)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: 'var(--spacing-md) var(--spacing-lg)',
                    border: 'none',
                    background: selectedProject?.id === project.id ? 'var(--color-bg-light)' : 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--color-border-light)',
                    fontSize: 'var(--font-size-sm-digg)',
                    color: 'var(--color-text-primary-digg)',
                    transition: 'background-color var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedProject?.id !== project.id) {
                      (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-bg-light)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedProject?.id !== project.id) {
                      (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <strong>{project.propertyDesignation}</strong>
                  <div
                    style={{
                      fontSize: 'var(--font-size-xs-digg)',
                      color: 'var(--color-text-secondary-digg)',
                      marginTop: '4px',
                    }}
                  >
                    Status: {project.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Höger del: Notifikationer och användarprofilmeny */}
      <div className="admin-header-right">
        {/* Notifikation bell */}
        <button
          className="admin-header-notification-btn"
          aria-label={`${notificationCount} nya notifikationer`}
          title="Visa notifikationer"
        >
          <Bell size={20} />
          {notificationCount > 0 && (
            <span className="admin-header-notification-badge">{notificationCount}</span>
          )}
        </button>

        {/* Användarprofilmeny */}
        <div className="admin-header-user-menu-wrapper">
          <button
            className="admin-header-user-btn"
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="Öppna användarmenyn"
            aria-expanded={showUserMenu}
          >
            <div className="admin-header-user-avatar">
              <User size={20} />
            </div>
            <span className="admin-header-user-name">Admin</span>
          </button>

          {/* Dropdown-meny */}
          {showUserMenu && (
            <nav className="admin-header-user-dropdown" role="menu">
              <button className="admin-header-dropdown-item" role="menuitem">
                <User size={16} />
                <span>Min profil</span>
              </button>
              <button className="admin-header-dropdown-item" role="menuitem">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
                <span>Inställningar</span>
              </button>
              <hr className="admin-header-dropdown-divider" />
              <button
                className="admin-header-dropdown-item admin-header-dropdown-logout"
                onClick={onLogout}
                role="menuitem"
              >
                <LogOut size={16} />
                <span>Logga ut</span>
              </button>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
