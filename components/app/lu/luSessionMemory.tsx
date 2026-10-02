import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * W-M2d item 8 (M2c verification finding 6) -- what the LU view must remember across view switches.
 *
 * A run that produced no assessment (GOVERNANCE_DENIED, NOT_ASSESSED, EXECUTION_FAILED) leaves no
 * trace in the server's read model, so the workspace is the only place that knows about it. The
 * workspace is unmounted when the user leaves the Lokalisering view, so the notice is kept HERE, in
 * the product shell's state, keyed by project, for as long as the shell (the logged-in session in this
 * tab) lives. Nothing is written to the server or to browser storage: a reload cannot show it, and the
 * workspace says so.
 */
export interface LuRunOutcomeRecord {
  readonly status: string;
  readonly messageSv: string | null;
  readonly retryable: boolean | null;
  /** When the run ended, by this browser's clock (ISO 8601). */
  readonly endedAt: string;
  /** W-M2e item 1: the run record's own reason codes (executionMotor.reason_codes), technical section only. */
  readonly reasonCodes?: readonly string[];
}

interface LuSessionMemory {
  readonly runOutcomeFor: (projectId: string) => LuRunOutcomeRecord | null;
  readonly setRunOutcomeFor: (projectId: string, outcome: LuRunOutcomeRecord | null) => void;
}

const LuSessionMemoryContext = createContext<LuSessionMemory | null>(null);

export const LuSessionMemoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = useRef(new Map<string, LuRunOutcomeRecord>());
  const [, setVersion] = useState(0);
  const runOutcomeFor = useCallback((projectId: string) => store.current.get(projectId) ?? null, []);
  const setRunOutcomeFor = useCallback((projectId: string, outcome: LuRunOutcomeRecord | null) => {
    if (outcome) store.current.set(projectId, outcome);
    else store.current.delete(projectId);
    setVersion((v) => v + 1);
  }, []);
  const value = useMemo(() => ({ runOutcomeFor, setRunOutcomeFor }), [runOutcomeFor, setRunOutcomeFor]);
  return <LuSessionMemoryContext.Provider value={value}>{children}</LuSessionMemoryContext.Provider>;
};

/**
 * The latest no-assessment run of `projectId`, from the shell when there is one; outside a shell (a
 * workspace rendered on its own) it lives only as long as the workspace.
 */
export function useLuRunOutcome(projectId: string | null): readonly [
  LuRunOutcomeRecord | null,
  (outcome: LuRunOutcomeRecord | null) => void,
  boolean,
] {
  const memory = useContext(LuSessionMemoryContext);
  const [local, setLocal] = useState<{ readonly projectId: string | null; readonly outcome: LuRunOutcomeRecord } | null>(null);
  const set = useCallback(
    (outcome: LuRunOutcomeRecord | null) => {
      if (memory && projectId) memory.setRunOutcomeFor(projectId, outcome);
      else setLocal(outcome ? { projectId, outcome } : null);
    },
    [memory, projectId],
  );
  const current = memory && projectId ? memory.runOutcomeFor(projectId) : local && local.projectId === projectId ? local.outcome : null;
  return [current, set, Boolean(memory)] as const;
}
