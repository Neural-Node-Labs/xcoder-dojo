// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:17:18.587Z | xcoder:subtask test-st-bf6f22
/**
 * Regression tests for approval expiry timers.
 *
 * Intent encoded here (from the design's approval-sheet requirements): an
 * approval request is time-bounded, and once it is answered the request is
 * finished. "Finished" must include releasing the expiry timer.
 *
 * Why this matters beyond tidiness: a dangling 120s expiry timer keeps the
 * Node event loop alive, so any process that imports the bridge (the smoke
 * runner, CI, a future headless CLI) never exits even though all work is done.
 * That is exactly how `npm run regression` failed - it hung instead of exiting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBridge } from '../demo-bridge';
import type { DojoBridge } from '../../contracts';

const NOW = 1_700_000_000_000;

async function opened(): Promise<DojoBridge> {
  const bridge = createDemoBridge({ now: () => NOW, autoConfigureModel: true });
  const result = await bridge.workspace.open('C:/projects/dojo-demo');
  if (!result.ok) throw new Error(`workspace open failed: ${result.error.code}`);
  return bridge;
}

async function pendingId(bridge: DojoBridge): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const pending = await bridge.approval.pending();
    if (pending.ok && pending.value) return pending.value.approvalId;
    await Promise.resolve();
  }
  throw new Error('no approval request was raised');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('approval expiry timer lifecycle', () => {
  it('arms exactly one expiry timer while an approval is pending', async () => {
    vi.useFakeTimers();
    const bridge = await opened();

    void bridge.delegation.launch({ goal: 'rename a symbol' });
    await pendingId(bridge);

    // The pending approval is bounded in time: exactly one expiry timer is
    // outstanding while it waits for a human.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears the expiry timer when the approval is denied', async () => {
    vi.useFakeTimers();
    const bridge = await opened();

    const launch = bridge.delegation.launch({ goal: 'rename a symbol' });
    const approvalId = await pendingId(bridge);

    const decision = await bridge.approval.respond({ approvalId, decision: 'denied' });
    expect(decision.ok && decision.value).toBe('denied');

    // THE REGRESSION: a resolved approval must not leave its expiry timer
    // registered, or the event loop stays alive for the full 120s TTL.
    expect(vi.getTimerCount()).toBe(0);

    const result = await launch;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('approval-denied');
  });

  it('clears the expiry timer when the approval is approved', async () => {
    vi.useFakeTimers();
    const bridge = await opened();

    const launch = bridge.delegation.launch({ goal: 'rename a symbol' });
    const approvalId = await pendingId(bridge);

    const decision = await bridge.approval.respond({ approvalId, decision: 'approved' });
    expect(decision.ok && decision.value).toBe('approved');

    const run = await launch;
    expect(run.ok).toBe(true);

    // The simulated delegation run schedules its own chunk timers, so drain
    // them and then assert nothing of the approval's remains: once the run has
    // finished no timer may still be holding the event loop open.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a pending approval once the TTL elapses', async () => {
    vi.useFakeTimers();
    const bridge = await opened();

    const launch = bridge.delegation.launch({ goal: 'rename a symbol' });
    const approvalId = await pendingId(bridge);

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await launch;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('approval-expired');

    // A late human response to an expired request is refused, not honoured.
    const late = await bridge.approval.respond({ approvalId, decision: 'approved' });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('approval-expired');
  });
});
