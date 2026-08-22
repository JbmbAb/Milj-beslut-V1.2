import React, { useState } from 'react';
import { MpsCompass } from '@miljobeslut/mps-compass';
import { designTokens } from '@miljobeslut/mps-identity';
import { MpsConsoleApp, type MpsProjectionApi } from '@miljobeslut/mps-console';
import { PropertyFirstLuEntry } from './lu/PropertyFirstLuEntry';

export type ProductViewId = 'home' | 'localization' | 'admin';

const NAV: { id: ProductViewId; label: string }[] = [
  { id: 'home', label: 'Start' },
  { id: 'localization', label: 'Lokalisering' },
  { id: 'admin', label: 'Admin-konsol' },
];

export interface MimerProductShellProps {
  userName?: string;
  organisationName?: string;
  activeProjectLabel?: string | null;
}

/**
 * Product entry — only LU + admin console in scope.
 * Other legacy modules are not surfaced (no replacements required).
 */
export const MimerProductShell: React.FC<MimerProductShellProps> = ({
  userName = 'Användare',
  organisationName,
  activeProjectLabel,
}) => {
  const [view, setView] = useState<ProductViewId>('home');
  const colors = designTokens.colors;
  const stubApi = {} as MpsProjectionApi;

  return (
    <div
      data-testid="mimer-product-shell"
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: colors.surfaceDarkStone.hex,
        color: colors.coreTurquoise.hex,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: colors.coreGraphite.hex }}
      >
        <div className="flex items-center gap-3">
          <MpsCompass
            size={28}
            ringColor={colors.coreTurquoise.hex}
            coreColor={colors.flowLightCyan.hex}
          />
          <div>
            <p className="text-lg font-bold tracking-wide">Miljöbeslut</p>
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-60">Mimer Platform</p>
          </div>
        </div>
        <div className="text-right text-xs opacity-70" style={{ color: colors.statusAudit.hex }}>
          <p>{userName}</p>
          {organisationName ? <p>{organisationName}</p> : null}
          {activeProjectLabel ? <p className="opacity-80">{activeProjectLabel}</p> : null}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          className="w-56 border-r px-4 py-6 shrink-0"
          style={{ borderColor: colors.coreGraphite.hex }}
        >
          <nav aria-label="Huvudmeny">
            <ul className="space-y-1">
              {NAV.map((item) => {
                const active = view === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`nav-${item.id}`}
                      onClick={() => setView(item.id)}
                      className="w-full text-left px-3 py-2 text-sm tracking-wide transition-opacity"
                      style={{
                        opacity: active ? 1 : 0.55,
                        color: active ? colors.flowLightCyan.hex : colors.coreTurquoise.hex,
                        borderLeft: active
                          ? `2px solid ${colors.coreTurquoise.hex}`
                          : '2px solid transparent',
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto min-w-0">
          {view === 'home' && (
            <section className="max-w-3xl px-8 py-10" data-testid="product-home">
              <h1 className="text-3xl font-bold tracking-tight mb-3">Arbetsyta</h1>
              <p className="text-sm opacity-70 leading-relaxed mb-8">
                Aktiv scope: lokaliseringsutredning och admin-konsol. Övriga legacy-moduler är
                avstängda från produktmenyn.
              </p>
              <ul className="space-y-3 text-sm">
                {NAV.filter((n) => n.id !== 'home').map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`home-open-${item.id}`}
                      onClick={() => setView(item.id)}
                      className="underline underline-offset-4 opacity-80 hover:opacity-100"
                    >
                      Öppna {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view === 'localization' && (
            <div data-testid="product-localization">
              <PropertyFirstLuEntry />
            </div>
          )}

          {view === 'admin' && (
            <div data-testid="product-admin">
              <MpsConsoleApp api={stubApi} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default MimerProductShell;
