import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from '../../components/AppSidebar';
import { OperationsCenterProvider } from '../../components/context/OperationsCenterContext';

// LEGAL-ANSWER-PRODUCT-WIRING-01: proves the real UI entry point hop (AppSidebar click ->
// activeTab='legal') actually fires, using the real AppSidebar component -- not asserted from
// reading the source alone.
describe('AppSidebar "Juridiskt Stöd" wiring', () => {
  it('clicking the Juridiskt Stöd button calls setActiveTab("legal")', () => {
    const setActiveTab = vi.fn();

    render(
      <OperationsCenterProvider>
        <AppSidebar
          mode="Core_WORKFLOW"
          activeTab="core"
          setActiveTab={setActiveTab}
          setMode={vi.fn()}
          bootstrap={null}
          activeMode={{ title: 'Core', accent: 'cyan' }}
          modeCards={[]}
          openMode={vi.fn()}
          setShowUpload={vi.fn()}
        />
      </OperationsCenterProvider>,
    );

    const legalButton = screen.getByTitle('Juridiskt Stöd');
    fireEvent.click(legalButton);

    expect(setActiveTab).toHaveBeenCalledWith('legal');
  });

  it('the Juridiskt Stöd button is present regardless of active mode (rendered outside any mode conditional)', () => {
    for (const mode of ['Core_WORKFLOW', 'PERMIT_PORTAL', 'LOGISTICS_MARKET'] as const) {
      const { unmount } = render(
        <OperationsCenterProvider>
          <AppSidebar
            mode={mode}
            activeTab="core"
            setActiveTab={vi.fn()}
            setMode={vi.fn()}
            bootstrap={null}
            activeMode={{ title: mode, accent: 'cyan' }}
            modeCards={[]}
            openMode={vi.fn()}
            setShowUpload={vi.fn()}
          />
        </OperationsCenterProvider>,
      );
      expect(screen.getByTitle('Juridiskt Stöd')).toBeInTheDocument();
      unmount();
    }
  });
});
