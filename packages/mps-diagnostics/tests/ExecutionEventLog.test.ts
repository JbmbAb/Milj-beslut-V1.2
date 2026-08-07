/**
 * Package 22.1 conformance — ExecutionEventLog governance evidence stream
 */
import { describe, expect, it } from "vitest";
import {
  createExecutionEvent,
  InMemoryExecutionEventLog,
  verifyExecutionEventIntegrity,
  computeTransitionHash,
  ExecutionEventLogError,
} from "../src/index.js";

describe("P22.1 ExecutionEvent + ExecutionEventLog", () => {
  it("P22-C2: sequence defines order; metadata timestamps excluded from transition_hash", () => {
    const a = createExecutionEvent({
      execution_id: "exec-1",
      sequence: 1,
      from_state: "CREATED",
      to_state: "HARVESTING",
      stage: "HARVEST",
      occurred_at: "2026-08-07T10:00:00.000Z",
      actor: "SYSTEM",
    });
    const b = createExecutionEvent({
      execution_id: "exec-1",
      sequence: 1,
      from_state: "CREATED",
      to_state: "HARVESTING",
      stage: "HARVEST",
      occurred_at: "2099-01-01T00:00:00.000Z",
      actor: "DIFFERENT_ACTOR",
      request_id: "req-xyz",
      runtime_version: "9.9.9",
    });
    expect(a.transition_hash).toBe(b.transition_hash);
    expect(a.sequence).toBe(1);
  });

  it("P22-C3: append-only chain with previous_event_hash", () => {
    const log = new InMemoryExecutionEventLog();
    const e1 = log.append({
      execution_id: "exec-chain",
      from_state: "CREATED",
      to_state: "HARVESTED",
      stage: "HARVEST",
      occurred_at: "2026-08-07T10:00:00.000Z",
      actor: "SYSTEM",
    });
    expect(e1.sequence).toBe(1);
    expect(e1.previous_event_hash).toBeUndefined();

    const e2 = log.append({
      execution_id: "exec-chain",
      from_state: "HARVESTED",
      to_state: "VERIFIED",
      stage: "VERIFY",
      occurred_at: "2026-08-07T10:00:01.000Z",
      actor: "SYSTEM",
    });
    expect(e2.sequence).toBe(2);
    expect(e2.previous_event_hash).toBe(e1.transition_hash);

    const e3 = log.append({
      execution_id: "exec-chain",
      from_state: "VERIFIED",
      to_state: "IMPORT_GATE",
      stage: "IMPORT_GATE",
      occurred_at: "2026-08-07T09:00:00.000Z", // earlier clock — must not break order
      actor: "POLICY",
    });
    expect(e3.sequence).toBe(3);
    expect(e3.previous_event_hash).toBe(e2.transition_hash);
    expect(log.verifyChain("exec-chain")).toBe(true);

    const listed = log.list("exec-chain");
    expect(listed.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("rejects state gaps and refuses mutation of committed events", () => {
    const log = new InMemoryExecutionEventLog();
    log.append({
      execution_id: "exec-gap",
      from_state: "CREATED",
      to_state: "HARVESTED",
      stage: "HARVEST",
      occurred_at: "2026-08-07T10:00:00.000Z",
      actor: "SYSTEM",
    });
    expect(() =>
      log.append({
        execution_id: "exec-gap",
        from_state: "CREATED",
        to_state: "VERIFIED",
        stage: "VERIFY",
        occurred_at: "2026-08-07T10:00:01.000Z",
        actor: "SYSTEM",
      }),
    ).toThrow(ExecutionEventLogError);

    const e1 = log.get("exec-gap", 1)!;
    expect(() => {
      (e1 as { to_state: string }).to_state = "BLOCKED";
    }).toThrow();
  });

  it("integrity check fails if identity payload is tampered", () => {
    const event = createExecutionEvent({
      execution_id: "exec-tamper",
      sequence: 1,
      from_state: "CREATED",
      to_state: "HARVESTED",
      stage: "HARVEST",
      occurred_at: "2026-08-07T10:00:00.000Z",
      actor: "SYSTEM",
    });
    expect(verifyExecutionEventIntegrity(event)).toBe(true);

    const tampered = { ...event, to_state: "BLOCKED" as const };
    expect(verifyExecutionEventIntegrity(tampered)).toBe(false);

    const hashOnlyIdentity = computeTransitionHash({
      execution_id: event.execution_id,
      sequence: event.sequence,
      from_state: event.from_state,
      to_state: event.to_state,
      stage: event.stage,
      input_refs: event.input_refs,
      output_refs: event.output_refs,
      previous_event_hash: event.previous_event_hash,
    });
    expect(hashOnlyIdentity).toBe(event.transition_hash);
  });
});
