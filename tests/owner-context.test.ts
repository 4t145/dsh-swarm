import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { Session, SessionId, type SessionHeader } from '@deepseek-ai/dsh-session';
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt';
import { isFrontDeskOwner, OWNER_POLICY, ownerState, registerOwnerContext } from '../src/owner-context.ts';
import { SwarmError } from '../src/errors.ts';
import { createRun } from '../src/types.ts';
import type { RunStatus } from '../src/runtime.ts';
import type { OwnerContextRuntime } from '../src/owner-context.ts';

function runtime(runForOwner: OwnerContextRuntime['runForOwner'], controls?: () => RunStatus['workerControls']): OwnerContextRuntime {
  return { runForOwner, status: () => ({ ownerSessionId: 'owner', workerControls: controls ? controls() : {
    canAdd: ['running', 'paused'].includes(runForOwner('owner').phase), maxWorkers: 12, source: 'host', diagnostic: null,
  } }) };
}

function agent(overrides: Partial<SessionHeader> = {}) {
  const id = SessionId('owner');
  const seed = Session.create(id);
  return { id, session: Session.create(id, [], { ...seed.header, ...overrides }) };
}
function run() {
  return createRun({ id: 'run', ownerSessionId: 'owner', repositoryRoot: '/repo', gitCommonDir: '/repo/.git',
    goal: 'Build the application', acceptanceCriteria: ['Useful prototype'],
    verification: { setup: [], test: [{ argv: ['node', '--check', 'app.js'], timeoutMs: 1000 }] },
    baseCommit: 'base', resultRef: 'refs/heads/result', deadline: null, createdAt: 1 });
}

describe('owner front desk', () => {
  it('is visible only to ordinary top-level sessions', () => {
    expect(isFrontDeskOwner(agent())).toBe(true);
    expect(isFrontDeskOwner(undefined)).toBe(false);
    for (const header of [{ origin: 'subagent' as const }, { delegationDepth: 1 },
      { parentSession: SessionId('parent') }, { agentPreset: 'swarm-worker' }]) {
      expect(isFrontDeskOwner(agent(header))).toBe(false);
    }
  });

  it('distinguishes no run from unavailable or foreign state', () => {
    expect(ownerState(runtime(() => { throw new SwarmError('SWARM_NOT_FOUND', 'none'); }), 'owner')).toContain('no run');
    expect(ownerState(runtime(() => { throw new Error('internal secret'); }), 'owner')).toContain('could not be read');
    expect(ownerState(runtime(() => run()), 'other')).not.toContain('Build the application');
  });

  it('scopes post-merge cleanup to the completed run and forbids forced removal', () => {
    expect(OWNER_POLICY).toContain('clean up that run\'s local leftovers');
    expect(OWNER_POLICY).toContain('swarm-<runId>-result');
    expect(OWNER_POLICY).toContain('git worktree remove (no --force)');
    expect(OWNER_POLICY).toContain('git branch -d (never -D)');
    expect(OWNER_POLICY).toContain('Never clean up a run that is not completed');
  });

  it('points owners straight at swarm_manage start and reports scale-up headroom', () => {
    expect(OWNER_POLICY).toContain('action "start"');
    expect(OWNER_POLICY).toContain('"verification"');
    expect(OWNER_POLICY).toContain('add_workers');
    expect(ownerState(runtime(() => { throw new SwarmError('SWARM_NOT_FOUND', 'none'); }), 'owner')).toContain('action=start');
    const current = run();
    current.phase = 'running';
    expect(ownerState(runtime(() => current), 'owner')).toContain('"canAddWorkers":true');
    current.phase = 'completed';
    expect(ownerState(runtime(() => current), 'owner')).toContain('"canAddWorkers":false');
  });

  it('uses live status limits and source, with explicit diagnostics rather than a fallback', () => {
    const current = run();
    current.phase = 'running';
    let controls: RunStatus['workerControls'] = { canAdd: true, maxWorkers: 12, source: 'host', diagnostic: null };
    const host = runtime(() => current, () => controls);
    expect(ownerState(host, 'owner')).toContain('"workerLimit":12,"workerLimitSource":"host"');
    controls = { canAdd: false, maxWorkers: 1, source: 'override', diagnostic: null };
    expect(ownerState(host, 'owner')).toContain('"workerLimit":1,"workerLimitSource":"override"');
    expect(ownerState(host, 'owner')).toContain('"canAddWorkers":false');
    controls = { canAdd: false, maxWorkers: null, source: null, diagnostic: 'Native config unavailable' };
    expect(ownerState(host, 'owner')).toContain('"workerLimit":null,"workerLimitSource":null');
    expect(ownerState(host, 'owner')).toContain('Native config unavailable');
    expect(ownerState({ ...host, status: () => { throw new Error('private details'); } }, 'owner')).toContain('Worker limit unavailable');
    expect(ownerState(host, 'owner')).toContain('Build the application');
  });

  it('refreshes bounded facts without mutating the run or exposing acceptance bodies', () => {
    const current = run();
    current.phase = 'paused';
    for (let index = 0; index < 8; index++) {
      const id = `g${index}`;
      current.goals[id] = { id, seq: index + 1, text: 'x'.repeat(400), acceptanceCriteria: ['private details'],
        status: 'deferred', createdAt: index, completedAt: null, completedCommit: null, continuedInRunId: null };
    }
    const original = JSON.stringify(current);
    const text = ownerState(runtime(() => current), 'owner');
    expect(text).toContain('"phase":"paused"');
    expect(text).toContain('"pendingGoalCount":8');
    expect(text).toContain('"pendingGoalsOmitted":2');
    expect(text).not.toContain('private details');
    expect(text).not.toContain('x'.repeat(181));
    expect(JSON.stringify(current)).toBe(original);
    current.phase = 'completed';
    expect(ownerState(runtime(() => current), 'owner')).toContain('"phase":"completed"');
  });

  it('registers additive providers, omits diagnostics-only assemblies and disposes both', () => {
    const ctx = new Context();
    const sections: PromptSection[] = [];
    const contexts: PromptContext[] = [];
    const removeSection = vi.fn();
    const removeContext = vi.fn();
    ctx.provide('systemPrompt', {
      section: (value: PromptSection) => { sections.push(value); return removeSection; },
      context: (value: PromptContext) => { contexts.push(value); return removeContext; },
    });
    const dispose = registerOwnerContext(ctx, runtime(() => run()));
    expect(sections[0]?.complete).toBeUndefined();
    for (const provider of [...sections, ...contexts]) {
      if (typeof provider.text !== 'function') throw new Error('Expected conditional provider');
      expect(provider.text({})).toBe('');
    }
    dispose();
    expect(removeSection).toHaveBeenCalledTimes(1);
    expect(removeContext).toHaveBeenCalledTimes(1);
  });
});
