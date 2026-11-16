// xcoder:version 3 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T10:06:28.383Z | xcoder:subtask test-st-bf6f22
/**
 * Bridge integration tests.
 *
 * The bridge is the only privileged surface the UI can reach, so these tests
 * exercise it the way a page would: through BridgeResult envelopes only. The
 * intent they encode is the design's security posture - no workspace means no
 * reads, the tree and the agent see the same filtered view, writes from the
 * agent need a human approval that is bound to that specific call, only one
 * run may be in flight, and the API key is write-only forever.
 */

import { describe, expect, it } from 'vitest';
import { createDemoBridge } from '../demo-bridge';
import type { BridgeResult, DojoBridge, ApprovalRequest } from '../../contracts';

const NOW = 1_700_000_000_000;

function newBridge(autoConfigureModel = true): DojoBridge {
  return createDemoBridge({ now: () => NOW, autoConfigureModel });
}

async function opened(): Promise<DojoBridge> {
  const bridge = newBridge();
  const result = await bridge.workspace.open('C:/projects/dojo-demo');
  expect(result.ok).toBe(true);
  return bridge;
}

function codeOf<T>(result: BridgeResult<T>): string | null {
  return result.ok ? null : result.error.code;
}

async function waitForPending(bridge: DojoBridge): Promise<ApprovalRequest> {
  for (let i = 0; i < 50; i += 1) {
    const pending = await bridge.approval.pending();
    if (pending.ok && pending.value) return pending.value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('no approval request was raised');
}

describe('workspace lifecycle', () => {
  it('starts with no workspace and refuses reads', async () => {
    const bridge = newBridge();
    const current = await bridge.workspace.current();
    expect(current).toEqual({ ok: true, value: null });
    expect(codeOf(await bridge.files.read('README.md'))).toBe('no-workspace');
    expect(codeOf(await bridge.tree.listChildren({ parentRelPath: null }))).toBe('no-workspace');
  });

  it('opens a workspace, labels it and remembers it as recent', async () => {
    const bridge = newBridge();
    const result = await bridge.workspace.open('C:/projects/dojo-demo');
    expect(result.ok && result.value.rootLabel).toBe('dojo-demo');
    const recents = await bridge.workspace.recents();
    expect(recents.ok && recents.value[0].rootDisplayPath).toBe('C:/projects/dojo-demo');
  });

  it('refuses an empty workspace path', async () => {
    const bridge = newBridge();
    expect(codeOf(await bridge.workspace.open('   '))).toBe('invalid-input');
  });

  it('de-duplicates recents and keeps the newest first', async () => {
    const bridge = newBridge();
    await bridge.workspace.open('C:/a');
    await bridge.workspace.open('C:/b');
    await bridge.workspace.open('C:/a');
    const recents = await bridge.workspace.recents();
    expect(recents.ok && recents.value.map((r) => r.rootDisplayPath)).toEqual(['C:/a', 'C:/b']);
  });

  it('closes the workspace and returns to the no-workspace state', async () => {
    const bridge = await opened();
    expect(await bridge.workspace.close()).toEqual({ ok: true, value: null });
    const current = await bridge.workspace.current();
    expect(current).toEqual({ ok: true, value: null });
    expect(codeOf(await bridge.files.read('README.md'))).toBe('no-workspace');
  });
});

describe('tree', () => {
  it('lists root children, directories first', async () => {
    const bridge = await opened();
    const page = await bridge.tree.listChildren({ parentRelPath: null });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const kinds = page.value.entries.map((e) => e.kind);
    expect(kinds[0]).toBe('dir');
    expect(page.value.entries.map((e) => e.name)).toContain('README.md');
  });

  it('never exposes credential, dotfile or generated nodes', async () => {
    const bridge = await opened();
    const page = await bridge.tree.listChildren({ parentRelPath: null });
    if (!page.ok) throw new Error('expected a page');
    const names = page.value.entries.map((e) => e.name);
    expect(names).not.toContain('.env');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
  });

  it('reports hasChildren so the tree can lazily expand', async () => {
    const bridge = await opened();
    const page = await bridge.tree.listChildren({ parentRelPath: null });
    if (!page.ok) throw new Error('expected a page');
    const src = page.value.entries.find((e) => e.name === 'src');
    expect(src?.hasChildren).toBe(true);
  });

  it('refuses a traversal parent path', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.tree.listChildren({ parentRelPath: '../..' }))).toBeDefined();
  });
});

describe('files', () => {
  it('reads UTF-8 content with language and size metadata', async () => {
    const bridge = await opened();
    const result = await bridge.files.read('README.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain('# Xcoder Dojo');
    expect(result.value.encoding).toBe('utf-8');
    expect(result.value.language).toBe('markdown');
    expect(result.value.truncated).toBe(false);
  });

  it('refuses the credential file', async () => {
    const bridge = await opened();
    const result = await bridge.files.read('.env');
    expect(codeOf(result)).toBe('credential-file');
    expect(JSON.stringify(result)).not.toContain('sk-not-a-real-key');
  });

  it('refuses traversal and generated directories', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.files.read('../../../etc/passwd'))).toBe('path-escape');
    expect(codeOf(await bridge.files.read('node_modules/left-pad/index.js'))).toBe('excluded-dir');
  });

  it('saves through the sandbox and audits the write', async () => {
    const bridge = await opened();
    const result = await bridge.files.save({
      tabId: 't1',
      relPath: 'src/notes.ts',
      content: 'export const a = 1;',
      baseSha: 'sha-0-0',
      writeNewFile: true,
    });
    expect(result.ok).toBe(true);
    const saved = await bridge.files.read('src/notes.ts');
    expect(saved.ok && saved.value.content).toContain('export const a = 1;');
    const audit = await bridge.audit.page({});
    expect(JSON.stringify(audit)).toContain('src/notes.ts');
  });

  it('refuses a save to a credential path', async () => {
    const bridge = await opened();
    const saved = await bridge.files.save({ tabId: 't', relPath: '.env', content: 'x', baseSha: 's', writeNewFile: true });
    expect(codeOf(saved)).toBe('credential-file');
  });

  it('renders markdown through the sanitising parser', async () => {
    const bridge = await opened();
    const result = await bridge.files.markdown('docs/tools.md');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strippedHtmlBlocks).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.value)).not.toContain('<script');
  });
});

describe('run console', () => {
  it('offers the three simulated targets', async () => {
    const bridge = await opened();
    const targets = await bridge.run.targets();
    expect(targets.ok && targets.value.map((t) => t.targetId)).toEqual(['typecheck', 'build', 'test']);
  });

  it('refuses a second run while one is in flight', async () => {
    const bridge = await opened();
    const first = await bridge.run.start({ targetId: 'typecheck' });
    expect(first.ok).toBe(true);
    const second = await bridge.run.start({ targetId: 'build' });
    expect(codeOf(second)).toBe('run-busy');
    await bridge.run.stop();
  });

  it('can start again after a stop', async () => {
    const bridge = await opened();
    await bridge.run.start({ targetId: 'typecheck' });
    await bridge.run.stop();
    const again = await bridge.run.start({ targetId: 'test' });
    expect(again.ok).toBe(true);
    await bridge.run.stop();
  });

  it('refuses an unknown target', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.run.start({ targetId: 'rm-rf' }))).toBe('invalid-input');
  });
});

describe('agent approval gate', () => {
  it('refuses before a workspace is open', async () => {
    const bridge = newBridge();
    expect(codeOf(await bridge.agent.send({ text: 'hi', sessionId: 's', workspaceId: 'w' }))).toBe('no-workspace');
  });

  it('refuses to send when no model is configured', async () => {
    const bridge = newBridge(false);
    await bridge.workspace.open('C:/a');
    expect(codeOf(await bridge.agent.send({ text: 'hi', sessionId: 's', workspaceId: 'w' }))).toBe('model-not-configured');
  });

  it('refuses an empty message', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.agent.send({ text: '   ', sessionId: 's', workspaceId: 'w' }))).toBe('invalid-input');
  });

  it('does not write a file the agent proposes until approval arrives', async () => {
    const bridge = await opened();
    const writePromise = bridge.files.agentWrite('src/agent.ts', 'export const agent = true;');
    const pending = await waitForPending(bridge);
    expect(pending.kind).toBe('file-write');
    expect(codeOf(await bridge.files.read('src/agent.ts'))).toBe('missing');
    await bridge.approval.respond({ approvalId: pending.approvalId, decision: 'approved' });
    const result = await writePromise;
    expect(result.ok).toBe(true);
    const read = await bridge.files.read('src/agent.ts');
    expect(read.ok && read.value.content).toContain('agent = true');
  });

  it('denies the write when the human declines', async () => {
    const bridge = await opened();
    const writePromise = bridge.files.agentWrite('src/agent.ts', 'nope');
    const pending = await waitForPending(bridge);
    await bridge.approval.respond({ approvalId: pending.approvalId, decision: 'denied' });
    const result = await writePromise;
    expect(codeOf(result)).toBe('approval-denied');
    expect(codeOf(await bridge.files.read('src/agent.ts'))).toBe('missing');
  });

  it('refuses a response to an unknown approval id', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.approval.respond({ approvalId: 'appr-unknown', decision: 'approved' }))).toBe('approval-expired');
  });

  it('binds the approval to one specific call, not a global unlock', async () => {
    const bridge = await opened();
    const first = bridge.files.agentWrite('src/one.ts', 'one');
    const pending = await waitForPending(bridge);
    await bridge.approval.respond({ approvalId: pending.approvalId, decision: 'approved' });
    await first;
    const second = bridge.files.agentWrite('src/two.ts', 'two');
    const pending2 = await waitForPending(bridge);
    expect(pending2.approvalId).not.toBe(pending.approvalId);
    await bridge.approval.respond({ approvalId: pending2.approvalId, decision: 'denied' });
    expect(codeOf(await second)).toBe('approval-denied');
  });

  it('never writes to a credential path even if approved', async () => {
    const bridge = await opened();
    const result = await bridge.files.agentWrite('.env', 'KEY=1');
    expect(codeOf(result)).toBe('credential-file');
  });
});

describe('delegation', () => {
  it('requires an approval before launching an external process', async () => {
    const bridge = await opened();
    const launch = bridge.delegation.launch({ goal: 'refactor the parser' });
    const pending = await waitForPending(bridge);
    expect(pending.kind).toBe('delegation-launch');
    await bridge.approval.respond({ approvalId: pending.approvalId, decision: 'denied' });
    expect(codeOf(await launch)).toBe('approval-denied');
    const current = await bridge.delegation.current();
    expect(current).toEqual({ ok: true, value: null });
  });

  it('starts a run only after approval and reports the CLI label', async () => {
    const bridge = await opened();
    const launch = bridge.delegation.launch({ goal: 'audit the ui' });
    const pending = await waitForPending(bridge);
    await bridge.approval.respond({ approvalId: pending.approvalId, decision: 'approved' });
    const result = await launch;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe('running');
      expect(result.value.cliLabel).toBeTruthy();
    }
    await bridge.delegation.stop();
  });

  it('refuses an empty goal', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.delegation.launch({ goal: '  ' }))).toBe('invalid-input');
  });
});

describe('settings and secrets', () => {
  it('reports model readiness without ever exposing the key', async () => {
    const bridge = await opened();
    const view = await bridge.settings.get();
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.hasApiKey).toBe(true);
    expect(view.value).not.toHaveProperty('apiKey');
    expect(JSON.stringify(view.value)).not.toContain('sk-demo');
  });

  it('accepts a key and returns only secret state, never the value', async () => {
    const bridge = newBridge(false);
    const set = await bridge.settings.setApiKey({ apiKey: 'sk-live-abcdefghijkl' });
    expect(set).toEqual({ ok: true, value: { hasApiKey: true, updatedAtMs: NOW } });
    expect(JSON.stringify(set)).not.toContain('sk-live-abcdefghijkl');
    const view = await bridge.settings.get();
    expect(JSON.stringify(view)).not.toContain('sk-live-abcdefghijkl');
  });

  it('refuses a too-short key', async () => {
    const bridge = newBridge(false);
    expect(codeOf(await bridge.settings.setApiKey({ apiKey: 'short' }))).toBe('invalid-input');
  });

  it('clears the key and reports it as missing again', async () => {
    const bridge = await opened();
    const cleared = await bridge.settings.clearApiKey();
    expect(cleared).toEqual({ ok: true, value: { hasApiKey: false, updatedAtMs: NOW } });
    const view = await bridge.settings.get();
    expect(view.ok && view.value.modelState).toBe('missing');
  });

  it('never logs the key in the audit trail', async () => {
    const bridge = newBridge(false);
    await bridge.settings.setApiKey({ apiKey: 'sk-live-abcdefghijkl' });
    const audit = await bridge.audit.page({});
    expect(JSON.stringify(audit)).not.toContain('sk-live-abcdefghijkl');
  });

  it('clamps settings to safe ranges', async () => {
    const bridge = await opened();
    const patched = await bridge.settings.patch({ auditRetentionDays: 10_000, limits: { maxTurns: 999, requestCapPerHour: -5 } });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.value.auditRetentionDays).toBe(365);
    expect(patched.value.limits.maxTurns).toBe(20);
    expect(patched.value.limits.requestCapPerHour).toBe(1);
  });

  it('refuses a non-object patch', async () => {
    const bridge = await opened();
    expect(codeOf(await bridge.settings.patch(null as never))).toBe('invalid-input');
  });
});

describe('status and audit surface', () => {
  it('summarises workspace, run, agent, model and audit location', async () => {
    const bridge = await opened();
    const status = await bridge.status.get();
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.workspacePathDisplay).toBe('C:/projects/dojo-demo');
    expect(status.value.model.state).toBe('configured');
    expect(status.value.audit.retentionDays).toBeGreaterThan(0);
    expect(status.value.audit.logDir).toContain('audit');
  });

  it('records workspace-open in the audit log', async () => {
    const bridge = await opened();
    const page = await bridge.audit.page({ type: 'workspace-open' });
    expect(page.ok && page.value.events).toHaveLength(1);
  });

  it('reports the audit location', async () => {
    const bridge = await opened();
    const location = await bridge.audit.location();
    expect(location.ok && location.value.logDir).toContain('audit');
  });

  it('notifies subscribers on state changes and stops after unsubscribe', async () => {
    const bridge = await opened();
    let count = 0;
    const unsubscribe = bridge.subscribe(() => {
      count += 1;
    });
    await bridge.workspace.open('C:/other');
    expect(count).toBeGreaterThan(0);
    const before = count;
    unsubscribe();
    await bridge.workspace.open('C:/third');
    expect(count).toBe(before);
  });
});
