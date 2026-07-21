import type { InterfaceMode } from '../../types';

export type ModeCardConfig = {
  mode: InterfaceMode;
  title: string;
  description: string;
  icon: string;
  accent: string;
  defaultTab: string;
  flag?: string;
};

export const MODE_CARDS: ModeCardConfig[] = [
  {
    mode: 'LOGISTICS_MARKET',
    title: 'Logistik schaktmassor',
    description: 'Planera mottagning, transport och regelefterlevnad för masshantering.',
    icon: 'fa-chart-mixed',
    accent: 'bg-indigo-600',
    defaultTab: 'archive',
    flag: 'show-logistics-workspace',
  },
  {
    mode: 'PERMIT_PORTAL',
    title: 'Provningsportal (legacy)',
    description: 'Kart- och riskstöd. C-anmälan schaktmassor finns under Huvudmoduler.',
    icon: 'fa-file-shield',
    accent: 'bg-emerald-600',
    defaultTab: 'map',
  },
  {
    mode: 'PROJECT_MANAGER',
    title: 'Projektplansportfölj',
    description: 'Gantt, riskanalys, intressenter, ansvar och grindar for huvudmodulerna.',
    icon: 'fa-list-check',
    accent: 'bg-amber-600',
    defaultTab: 'plan',
    flag: 'show-project-manager',
  },
  {
    mode: 'COMPLIANCE_AUDIT',
    title: 'Egenkontroll och revision',
    description: 'Bedömning av regelefterlevnad, revisionslogg och automatiserad rapportering.',
    icon: 'fa-shield-check',
    accent: 'bg-slate-700',
    defaultTab: 'score',
    flag: 'show-compliance-audit',
  },
  {
    mode: 'ADMIN_CONSOLE',
    title: 'Administrator',
    description: 'Separat adminyta med utökad sökning och analys.',
    icon: 'fa-user-shield',
    accent: 'bg-rose-600',
    defaultTab: 'admin-search',
    flag: 'show-admin-console',
  },
  {
    mode: 'Core_WORKFLOW',
    title: 'Huvudmoduler',
    description: 'Enskilt avlopp, C-anmalan och lokaliseringsutredning.',
    icon: 'fa-folder-open',
    accent: 'bg-indigo-600',
    defaultTab: 'core',
  },
];

export function buildModeCardMap(cards: ModeCardConfig[]): Record<InterfaceMode, ModeCardConfig> {
  return cards.reduce<Record<InterfaceMode, ModeCardConfig>>(
    (acc, item) => {
      acc[item.mode] = item;
      return acc;
    },
    {} as Record<InterfaceMode, ModeCardConfig>,
  );
}
