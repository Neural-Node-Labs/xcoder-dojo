<!-- xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:18:09.895Z | xcoder:subtask test-st-bf6f22 -->
# Defect 0003 — Approval expiry timer is never cleared, hanging any Node process that uses the bridge

- **Defect ID:** defect0003
- **Discovered by:** tester (`test-st-bf6f22`)
- **Severity:** high
- **Affected file(s):** `xcoder-dojo/src/backend/demo-bridge.ts`
- **Status:** fixed and covered by regression tests

## Observed behaviour

`npm run regression` never terminated. The `test:unit` stage passed, then the
`test:smoke` stage printed its final line:

```
40 passed, 0 failed
```

and then hung indefinitely. The `node` process stayed alive with almost no CPU
(0.09 s consumed) and no further output, and had to be killed externally, so the
gate exited non-zero (timeout) despite every assertion passing.

Reproduction showed the assertions were not at fault: running the bundle with
output redirected to a file produced all 40 PASS lines and the summary, then the
process remained resident.

## Expected behaviour

When `test/smoke.ts` reaches the end of `main()`, all simulated work is finished
and the process should exit on its own with code 0. More generally: once an
approval request is answered, the bridge must hold no live timer for it, so a
host (smoke runner, CI, a future headless CLI) can exit normally.

## Reproduction steps

1. `cd xcoder-dojo`
2. `npm run test:smoke`
3. Observe all 40 checks PASS and the summary printed.
4. Observe the process does not exit; it must be killed.
5. Equivalent: `npm run regression` from the workspace root hangs after the unit
   stage instead of completing.

Minimal demonstration of the leaked handle:

```ts
const bridge = createDemoBridge({ now: () => NOW, autoConfigureModel: true });
await bridge.workspace.open('C:/projects/dojo-demo');
const launch = bridge.delegation.launch({ goal: 'rename a symbol' });
// ... read bridge.approval.pending(), then answer it ...
await bridge.approval.respond({ approvalId, decision: 'denied' });
// the 120s expiry timer is STILL registered -> event loop stays alive
```

## Root cause hypothesis

`requestApproval()` in `demo-bridge.ts` armed a 120 s expiry timer:

```ts
return new Promise((resolve) => {
  pendingApprovals.set(approvalId, { ...request, resolve });
  emit({ type: 'approval-requested', request });
  setTimeout(() => { /* resolve('expired') */ }, APPROVAL_TTL_MS); // 120_000
});
```

The timer handle was discarded, so no resolution path could cancel it. The
denial/approval path in the `approval.respond` facade removed the ticket from
`pendingApprovals` and resolved the promise, but never called `clearTimeout` on
the expiry timer. That orphaned timer remained referenced by the Node timer
subsystem, keeping the event loop alive for the full 120 s TTL after every test
run that exercised the approval gate.

The smoke test never called `process.exit()`, which is correct — a test should
not need an explicit kill. The leak was in the bridge, not the harness.

A mitigated second factor: the expiry callback used the captured `resolve`
closure rather than re-reading the ticket, so an already-answered request could
still route an `expired` resolution. Clearing the timer removes that path.

## Fix applied

1. `ApprovalTicket` now carries an optional `timer` handle.
2. `requestApproval()` stores the handle on the ticket and calls `unref()` when
   available, so the timer can never by itself keep a process alive (guarded, so
   browser environments where `setTimeout` returns a number are unaffected).
3. `approval.respond` clears the timer with `clearTimeout(ticket.timer)` before
   deleting the ticket, so a resolved approval leaves no scheduled work behind.

## Regression coverage

`xcoder-dojo/src/backend/__tests__/approval-timer.test.ts` (4 tests) encodes the
intended behaviour with fake timers:

- exactly one expiry timer is armed while an approval is pending;
- denying an approval leaves zero outstanding timers and yields
  `approval-denied` for the gated delegation;
- approving clears the expiry timer, and after the simulated delegation drains,
  no timers remain;
- an unanswered approval expires at the TTL and a late response is refused with
  `approval-expired`.

These fail against the pre-fix code (the timer count stays at 1 after a
response) and pass after it.
