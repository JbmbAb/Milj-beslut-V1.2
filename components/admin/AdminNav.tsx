import React, { useMemo } from 'react';
import {
  FileText,
  Truck,
  Calendar,
  TrendingUp,
  Droplets,
  ChevronDown,
  Menu,
  X,
  LogOut,
  User,
} from 'lucide-react';
import './admin-nav.css';
import { AdminModuleId } from './AdminShell';

interface Module {
  id: AdminModuleId;
  label: string;
  icon: React.ReactNode;
  description: string;
}

interface AdminNavProps {
  activeModule: AdminModuleId;
  onModuleChange: (moduleId: AdminModuleId) => void;
  isOpen: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

/**
 * AdminNav – Sidonavigation för admin-moduler
 * WCAG 2.1 AA: Tangentbordsnavigation, aria-labels, fokusering
 */
const AdminNav: React.FC<AdminNavProps> = ({ activeModule, onModuleChange, isOpen, onToggle, onLogout }) => {
  const modules: Module[] = useMemo(
    () => [
      {
        id: 'permit-portal',
        label: 'Core Tillståndsportal',
        icon: <FileText size={20} />,
        description: 'Tillståndshantering och ansökningar',
      },
      {
        id: 'logistics',
        label: 'Logistik & Massa',
        icon: <Truck size={20} />,
        description: 'Transport och lagerhantering',
      },
      {
        id: 'project-plan',
        label: 'Projektplan',
        icon: <Calendar size={20} />,
        description: 'Planering och milstolpar',
      },
      {
        id: 'green-check',
        label: 'Grönkoll för Banker',
        icon: <TrendingUp size={20} />,
        description: 'Risk- och miljörapportering',
      },
      {
        id: 'sewage-portal',
        label: 'Enskilt Avlopp',
        icon: <Droplets size={20} />,
        description: 'Ansökan för privata VA-anläggningar',
      },
    ],
    [],
  );

  const handleModuleClick = (moduleId: AdminModuleId) => {
    onModuleChange(moduleId);
    // Stäng sidebar på mobil efter val
    if (window.innerWidth < 1024) {
      onToggle();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, moduleId: AdminModuleId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleModuleClick(moduleId);
    }
  };

  return (
    <>
      {/* Hamburger button för mobil */}
      <button
        className="admin-nav-toggle"
        onClick={onToggle}
        aria-label="Slå på/av sidonav"
        aria-expanded={isOpen}
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay för mobil */}
      {isOpen && <div className="admin-nav-overlay" onClick={onToggle} />}

      {/* Sidonav */}
      <aside
        className={`admin-nav ${isOpen ? 'open' : ''}`}
        role="navigation"
        aria-label="Administrationsmoduler"
      >
        {/* Header */}
        <div className="admin-nav-header">
          <img src="/logo.png" alt="Miljobeslut.se" className="admin-nav-logo" />
          <h1 className="admin-nav-title">Admin</h1>
        </div>

        {/* Modul-lista */}
        <nav className="admin-nav-modules">
          <p className="admin-nav-section-title">Moduler</p>
          <ul className="admin-nav-list" role="list">
            {modules.map((module) => (
              <li key={module.id} role="listitem">
                <button
                  className={`admin-nav-button ${activeModule === module.id ? 'active' : ''}`}
                  onClick={() => handleModuleClick(module.id)}
                  onKeyDown={(e) => handleKeyDown(e, module.id)}
                  aria-current={activeModule === module.id ? 'page' : undefined}
                  aria-label={`${module.label}: ${module.description}`}
                >
                  <span className="admin-nav-icon">{module.icon}</span>
                  <span className="admin-nav-label">{module.label}</span>
                  {activeModule === module.id && <span className="admin-nav-indicator" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Användarsektion */}
        <div className="admin-nav-footer">
          <div className="admin-nav-user">
            <div className="admin-nav-user-avatar">
              <User size={20} />
            </div>
            <span className="admin-nav-user-name">Admin Användare</span>
            <button
              className="admin-nav-user-menu"
              aria-label="Användarmenyn"
              title="Användarmenyn är inte implementerad i denna skall"
            >
              <ChevronDown size={16} />
            </button>
          </div>

          <button className="admin-nav-logout" onClick={onLogout} aria-label="Logga ut från admin">
            <LogOut size={18} />
            <span>Logga ut</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default AdminNav;
