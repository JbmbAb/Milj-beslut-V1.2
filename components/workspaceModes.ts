import type { InterfaceMode } from '../types';

export type ModeCardConfig = {
  mode: InterfaceMode;
  title: string;
  description: string;
  icon: string;
  accent: string;
  defaultTab: string;
};

export const MODE_CARDS: ModeCardConfig[] = [
  {
    mode: 'LOGISTICS_MARKET',
    title: 'Logistik schaktmassor',
    description: 'Planera mottagning, transport och regelefterlevnad för masshantering.',
    icon: 'fa-chart-mixed',
    accent: 'bg-indigo-600',
    defaultTab: 'archive',
  },
  {
    mode: 'PERMIT_PORTAL',
    title: 'Provningsportal',
    description: 'Sök tillstånd, bygg ansökan och validera regelkrav.',
    icon: 'fa-file-shield',
    accent: 'bg-emerald-600',
    defaultTab: 'map',
  },
  {
    mode: 'PROJECT_MANAGER',
    title: 'Projektledning',
    description: 'Planera tid, resurser, risk och uppföljning i en vy.',
    icon: 'fa-list-check',
    accent: 'bg-amber-600',
    defaultTab: 'plan',
  },
  {
    mode: 'COMPLIANCE_AUDIT',
    title: 'Egenkontroll och revision',
    description: 'Bedömning av regelefterlevnad, revisionslogg och automatiserad rapportering.',
    icon: 'fa-shield-check',
    accent: 'bg-slate-700',
    defaultTab: 'score',
  },
  {
    mode: 'ADMIN_CONSOLE',
    title: 'Administrator',
    description: 'Separat adminyta med utökad sökning och analys.',
    icon: 'fa-user-shield',
    accent: 'bg-rose-600',
    defaultTab: 'admin-search',
  },
  {
    mode: 'MVP_WORKFLOW',
    title: 'Ärendeportal',
    description: 'Beslutsstöd för miljöärenden: Dashboard → Sök → Granskning → Anmälan.',
    icon: 'fa-folder-open',
    accent: 'bg-indigo-600',
    defaultTab: 'mvp',
  },
];

export function resolveInterfaceModeFromModuleId(id: string): InterfaceMode | null {
  if (id === 'mvp' || id === 'ansokan') return 'MVP_WORKFLOW';
  if (id === 'logistik') return 'LOGISTICS_MARKET';
  if (id === 'projekt') return 'PROJECT_MANAGER';
  if (id === 'gronkoll') return 'COMPLIANCE_AUDIT';
  if (id === 'admin') return 'ADMIN_CONSOLE';
  return null;
}
