/**
 * 进度 Host DTO 与 watch 订阅的针对性测试。
 *
 * 只用 fake runtime / 手动变更源，不启动模型、Git 或 HTTP；重点覆盖公开字段
 * 映射、隐私与体积上界、会话归属、终态结束与取消。
 */

import { describe, expect, it } from 'vitest';

import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client';
import { SwarmError } from '../src/errors.ts';
import { emptyWorkerActivity, type WorkerActivityState } from '../src/worker-activity.ts';
import type { SwarmEvent } from '../src/types.ts';
import {
  PROGRESS_LIMITS,
  ProgressFeed,
  progressRemoteMethods,
  toProgressSnapshot,
  type ProgressChange,
  type ProgressRunDetail,
  type ProgressWatchItem,
} from '../src/progress.ts';
import type { RunStatus, WorkerStatusSummary } from '../src/runtime.ts';

const OWNER = 'owner-session';
const RUN = 'run-1';

function worker(overrides: Partial<WorkerStatusSummary> = {}): WorkerStatusSummary {
  return {
    id: 'w2',
    sessionId: 'worker-session-2',
    initializationState: 'ready',
    nativeStatus: 'running',
    nativeStatusError: null,
    currentTaskId: null,
    worktreePath: '/tmp/worktree',
    unavailableReason: null,
    initializationError: null,
    ...overrides,
  };
}

function status(overrides: Partial<RunStatus> = {}): RunStatus {
  return {
    runId: RUN,
    ownerSessionId: OWNER,
    phase: 'running',
    reason: null,
    quiesceTarget: null,
    deadline: 10_000,
    now: 4_000,
    budgetExpired: false,
    goalRevision: 0,
    goals: { total: 0, active: 0, deferred: 0, completed: 0 },
    baseCommit: 'a'.repeat(40),
    acceptedHead: 'b'.repeat(40),
    resultRef: 'refs/dsh-swarm/result',
    integrationWorktree: '/tmp/integration',
    tasks: { open: 1, claimed: 2, proposed: 3, done: 4, blocked: 5, cancelled: 6, total: 21 },
    workers: [
      worker({ id: 'w1', nativeStatus: 'running', currentTaskId: 'task-1' }),
      worker({ id: 'w2', nativeStatus: 'inactive' }),
      worker({
        id: 'w3',
        initializationState: 'failed',
        nativeStatus: 'unavailable',
        nativeStatusError: 'provider missing',
      }),
    ],
    proposals: { queued: 1, integrating: 2, accepted: 3, rejected: 4 },
    verifications: { queued: 1, running: 2, passed: 3, failed: 4, interrupted: 5 },
    finishRequest: { id: 'finish-1', acceptedHead: 'c'.repeat(40), verificationId: 'verify-1' },
    admission: 'open',
    diagnostics: ['internal detail that must not reach the panel'],
    ...overrides,
  };
}

function detail(): ProgressRunDetail {
  return {
    tasks: {
      'task-1': { id: 'task-1', subject: 'Implement progress DTO', status: 'claimed', revision: 3 },
    },
    workers: {
      w1: { currentTaskId: 'task-1' },
      w2: { currentTaskId: null },
    },
  };
}

describe('toProgressSnapshot', () => {
  it('projects readable member names and authoritative addition capability', () => {
    const snapshot = toProgressSnapshot(status({ workers: [worker({ displayName: 'Sunny Otter' })],
      workerControls: { canAdd: true, maxWorkers: 4 } }), detail(), 4_500);
    expect(snapshot.workers[0]?.displayName).toBe('Sunny Otter');
    expect(snapshot.workerControls).toEqual({ canAdd: true, maxWorkers: 4 });
    const legacy = toProgressSnapshot(status({ workers: [worker()] }), detail(), 4_500);
    expect(legacy.workers[0]?.displayName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/u);
    expect(legacy.workerControls).toBeNull();
  });

  it('projects append-only goals, full bounded criteria and distinct continuation states', () => {
    const base = detail();
    const goal = {
      id: 'goal-1', seq: 10, text: 'Add export', acceptanceCriteria: ['CSV can be downloaded'],
      status: 'active' as const, createdAt: 2_000, completedAt: null, completedCommit: null, continuedInRunId: null,
    };
    const snapshot = toProgressSnapshot(status(), {
      ...base, goal: 'Initial import', acceptanceCriteria: ['Import works'], goalRevision: 3,
      goals: {
        'goal-1': goal,
        'goal-2': { ...goal, id: 'goal-2', seq: 11, status: 'deferred' },
        'goal-3': { ...goal, id: 'goal-3', seq: 12, status: 'completed', completedCommit: 'a'.repeat(40), completedAt: 3_000 },
        'goal-4': { ...goal, id: 'goal-4', seq: 13, continuedInRunId: 'next-round' },
      },
    }, 4_500);
    expect(snapshot.goal).toBe('Initial import');
    expect(snapshot.acceptanceCriteria).toEqual(['Import works']);
    expect(snapshot.goalBoard).toMatchObject({ total: 4, revision: 3, truncated: false,
      counts: { active: 1, deferred: 1, completed: 1, continued: 1 } });
    expect(snapshot.goalBoard?.items.map((item) => item.id)).toEqual(['goal-2', 'goal-1', 'goal-4', 'goal-3']);
    expect(snapshot.goalBoard?.items.find((item) => item.id === 'goal-3')).toMatchObject({ completedCommit: 'a'.repeat(40), completedAt: 3_000 });
    expect(snapshot.goalBoard?.items.find((item) => item.id === 'goal-4')).toMatchObject({ continuedInRunId: 'next-round' });
    expect(toProgressSnapshot(status(), base, 4_500).goalBoard).toBeNull();
  });

  it('bounds goal history, counts every state and preserves the default whole-goal criterion', () => {
    const text = 'x'.repeat(PROGRESS_LIMITS.goalChars);
    const goals = Object.fromEntries(Array.from({ length: PROGRESS_LIMITS.goalBoard + 5 }, (_, index) => [String(index), {
      id: String(index), seq: index, text, acceptanceCriteria: [text],
      status: index === 0 ? 'deferred' as const : 'completed' as const,
      createdAt: 1_000, completedAt: null, completedCommit: null, continuedInRunId: null,
    }]));
    const snapshot = toProgressSnapshot(status(), { ...detail(), goals, goalRevision: 1 }, 4_500);
    expect(snapshot.goalBoard?.items).toHaveLength(PROGRESS_LIMITS.goalBoard);
    expect(snapshot.goalBoard?.total).toBe(PROGRESS_LIMITS.goalBoard + 5);
    expect(snapshot.goalBoard?.truncated).toBe(true);
    expect(snapshot.goalBoard?.counts).toEqual({ active: 0, deferred: 1, completed: PROGRESS_LIMITS.goalBoard + 4, continued: 0 });
    expect(snapshot.goalBoard?.items[0]).toMatchObject({ id: '0', text, acceptanceCriteria: [text], truncated: false });
    const clipped = toProgressSnapshot(status(), { ...detail(), goal: text + 'x',
      acceptanceCriteria: ['c'.repeat(PROGRESS_LIMITS.criterionChars + 1)] }, 4_500);
    expect(clipped.originalGoalTruncated).toBe(true);
    expect(clipped.goal).toHaveLength(PROGRESS_LIMITS.goalChars);
    expect(clipped.acceptanceCriteria[0]).toHaveLength(PROGRESS_LIMITS.criterionChars);
  });

  it('maps the bounded public facts without inventing percentages', () => {
    const snapshot = toProgressSnapshot(status(), detail(), 4_500);

    expect(snapshot.runId).toBe(RUN);
    expect(snapshot.phase).toBe('running');
    expect(snapshot.remainingMs).toBe(5_500);
    expect(snapshot.tasks).toEqual({
      open: 1, claimed: 2, proposed: 3, done: 4, blocked: 5, cancelled: 6, total: 21,
    });
    expect(snapshot.proposals).toEqual({ queued: 1, integrating: 2, accepted: 3, rejected: 4 });
    expect(snapshot.verifications).toEqual({
      queued: 1, running: 2, passed: 3, failed: 4, interrupted: 5,
    });
    expect(snapshot.finishRequest?.verificationId).toBe('verify-1');

    const [first, second, third] = snapshot.workers;
    expect(first?.nativeStatus).toBe('running');
    expect(first?.currentTask).toEqual({
      id: 'task-1', subject: 'Implement progress DTO', status: 'claimed', revision: 3,
    });
    expect(second?.nativeStatus).toBe('inactive');
    expect(second?.currentTask).toBeNull();
    expect(third?.nativeStatus).toBe('unavailable');
    expect(third?.diagnostic).toBe('provider missing');
    expect(JSON.stringify(snapshot)).not.toContain('percent');
  });

  it('keeps inactive distinct from done and clamps expired budgets at zero', () => {
    const snapshot = toProgressSnapshot(
      status({ deadline: 1_000, now: 9_999, tasks: { ...status().tasks, done: 0 } }),
      detail(),
      9_999,
    );
    expect(snapshot.remainingMs).toBe(0);
    expect(snapshot.tasks.done).toBe(0);
    expect(snapshot.workers[1]?.nativeStatus).toBe('inactive');
  });

  it('truncates long text and never forwards diagnostics or message bodies', () => {
    const secret = `SECRET-${'x'.repeat(500)}`;
    const snapshot = toProgressSnapshot(
      status({
        reason: secret,
        diagnostics: [secret],
        workers: [worker({ nativeStatusError: secret, currentTaskId: 'task-1' })],
      }),
      {
        tasks: { 'task-1': { id: 'task-1', subject: secret, status: 'claimed', revision: 1 } },
        workers: { w2: { currentTaskId: 'task-1' } },
      },
      1,
    );

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(secret);
    expect(snapshot.reason?.length).toBeLessThanOrEqual(PROGRESS_LIMITS.reasonChars);
    expect(snapshot.workers[0]?.diagnostic?.length).toBeLessThanOrEqual(PROGRESS_LIMITS.diagnosticChars);
    expect(snapshot.workers[0]?.currentTask?.subject.length)
      .toBeLessThanOrEqual(PROGRESS_LIMITS.subjectChars);
    expect(serialized.length).toBeLessThan(8_000);
    expect(snapshot).not.toHaveProperty('diagnostics');
    expect(snapshot).not.toHaveProperty('messages');
  });

  it('caps the worker list even if a broken runtime returns more', () => {
    const workers = Array.from({ length: PROGRESS_LIMITS.workers + 4 }, (_, index) =>
      worker({ id: `w${index}` }));
    const snapshot = toProgressSnapshot(status({ workers }), undefined, 1);
    expect(snapshot.workers).toHaveLength(PROGRESS_LIMITS.workers);
  });
});

describe('ProgressFeed.snapshot', () => {
  it('returns null when the runtime has no run for the session', () => {
    const feed = new ProgressFeed(
      {
        status: () => {
          throw new SwarmError('SWARM_NOT_FOUND', 'no run', { details: { ownerSessionId: OWNER } });
        },
      },
      { subscribe: () => () => undefined },
    );
    expect(feed.snapshot(OWNER)).toBeNull();
  });

  it('rejects another session reading a run it does not own', () => {
    const feed = new ProgressFeed(
      { status: () => status({ ownerSessionId: 'someone-else' }) },
      { subscribe: () => () => undefined },
    );
    try {
      feed.snapshot(OWNER);
      throw new Error('expected forbidden');
    } catch (error) {
      expect(isRemoteFailure(error)).toBe(true);
      if (isRemoteFailure(error)) {
        expect(error.code).toBe('swarm-progress/forbidden');
        expect(error.details).toEqual({ sessionId: OWNER, runId: RUN });
      }
    }
  });

  it('rejects invalid session ids before touching the runtime', () => {
    let called = false;
    const feed = new ProgressFeed(
      {
        status: () => {
          called = true;
          return status();
        },
      },
      { subscribe: () => () => undefined },
    );
    expect(() => feed.snapshot('   ')).toThrowError(/sessionId/);
    expect(called).toBe(false);
  });

  it('keeps working when the optional task detail lookup fails', () => {
    const feed = new ProgressFeed(
      { status: () => status() },
      {
        subscribe: () => () => undefined,
        detail: () => {
          throw new Error('store hiccup');
        },
      },
    );
    const snapshot = feed.snapshot(OWNER);
    expect(snapshot?.workers[0]?.currentTask).toBeNull();
    expect(snapshot?.detailError).toContain('store hiccup');
  });
});

/** 手动变更源：测试显式决定何时发布，不依赖 sleep。 */
function manualChanges(): {
  feed: ProgressFeed;
  emit: (change: ProgressChange) => void;
  emitAgent: (agentSessionId: string) => void;
  unsubscribeCount: () => number;
  runtime: { status: (sessionId: string) => RunStatus; setPhase: (next: RunStatus) => void };
} {
  let current = status();
  const listeners = new Set<(change: ProgressChange) => void>();
  const agentListeners = new Set<(agentSessionId: string) => void>();
  let unsubscribed = 0;
  const runtime = {
    status: (_sessionId: string): RunStatus => current,
    setPhase: (next: RunStatus): void => {
      current = next;
    },
  };
  const feed = new ProgressFeed(runtime, {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribed += 1;
      };
    },
    detail,
    now: () => 4_500,
    agentEvents: (listener) => {
      agentListeners.add(listener);
      return () => {
        agentListeners.delete(listener);
      };
    },
  });
  return {
    feed,
    runtime,
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
    emitAgent: (agentSessionId) => {
      for (const listener of [...agentListeners]) listener(agentSessionId);
    },
    unsubscribeCount: () => unsubscribed,
  };
}

describe('ProgressFeed.watch', () => {
  it('emits one opening frame, then the terminal frame and ends', async () => {
    const { feed, runtime, emit } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();

    const opening = await iterator.next();
    expect(opening.done).toBe(false);
    expect(opening.value?.seq).toBe(1);
    expect(opening.value?.progress?.phase).toBe('running');

    const completed = status({ phase: 'completed', now: 9_000 });
    runtime.setPhase(completed);
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });

    const terminal = await iterator.next();
    expect(terminal.done).toBe(false);
    expect(terminal.value?.seq).toBe(2);
    expect(terminal.value?.progress?.phase).toBe('completed');

    const end = await iterator.next();
    expect(end.done).toBe(true);
    await feed.dispose();
  });

  it('ignores changes owned by other sessions', async () => {
    const { feed, emit, runtime } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    emit({ runId: 'run-other', ownerSessionId: 'other-owner', phase: 'running' });
    let settled = false;
    const pending = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    runtime.setPhase(status({ tasks: { ...status().tasks, done: 9 } }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    const next = await pending;
    expect(next.value?.seq).toBe(2);
    expect(next.value?.progress?.tasks.done).toBe(9);
    await feed.dispose();
  });

  it('stops an in-flight watch when the caller aborts', async () => {
    const { feed } = manualChanges();
    const controller = new AbortController();
    const iterator = feed.watch(OWNER, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();

    controller.abort();
    const end = await iterator.next();
    expect(end.done).toBe(true);
  });

  it('closes subscriptions when a terminal frame ends the stream', async () => {
    const { feed, runtime, emit, unsubscribeCount } = manualChanges();
    runtime.setPhase(status({ phase: 'failed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'failed' });

    const frames: ProgressWatchItem[] = [];
    for await (const frame of feed.watch(OWNER)) frames.push(frame);
    expect(frames.at(-1)?.progress?.phase).toBe('failed');
    expect(unsubscribeCount()).toBe(1);
  });

  it('dispose ends every active watch', async () => {
    const { feed } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();
    await feed.dispose();
    expect((await iterator.next()).done).toBe(true);
    expect(() => feed.snapshot(OWNER)).toThrowError(/disposed/);
  });
});

describe('ProgressFeed native agent refresh', () => {
  it('notifies a new frame for a run worker without closing the stream', async () => {
    const { feed, runtime, emit, emitAgent } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    runtime.setPhase(status({ workers: [
      worker({ id: 'w1', nativeStatus: 'inactive' }),
      worker({ id: 'w2', nativeStatus: 'inactive' }),
      worker({ id: 'w3', initializationState: 'failed', nativeStatus: 'unavailable' }),
    ] }));
    emitAgent('worker-session-2');

    const refreshed = await iterator.next();
    expect(refreshed.done).toBe(false);
    expect(refreshed.value?.seq).toBe(2);
    expect(refreshed.value?.progress?.workers[0]?.nativeStatus).toBe('inactive');

    // 后续业务变更仍能产生新帧，证明 agent 通知没有关闭 watcher。
    runtime.setPhase(status({ phase: 'completed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });
    const terminal = await iterator.next();
    expect(terminal.value?.progress?.phase).toBe('completed');
    expect((await iterator.next()).done).toBe(true);
    await feed.dispose();
  });

  it('ignores agent events from sessions that are not run workers', async () => {
    const { feed, emitAgent } = manualChanges();
    const iterator = feed.watch(OWNER)[Symbol.asyncIterator]();
    await iterator.next();

    emitAgent('unrelated-agent-session');
    let settled = false;
    const pending = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await feed.dispose();
    await pending;
  });
});

describe('Remote markers', () => {
  it('exports snapshot as unary and watch as a stream on the swarmProgress namespace', () => {
    expect(progressRemoteMethods()).toEqual([
      { method: 'worktreeHistory' },
      { method: 'snapshot' },
      { method: 'watch', mode: 'stream' },
      { method: 'watchSession', mode: 'stream' },
    ]);
  });
});
describe('progress v2 public facts', () => {
  it('includes bounded task board, goal, wait and pending proposal without leaking run-private data', () => {
    const tasks = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`task-${index}`, {
      id: `task-${index}`, subject: 'public subject', status: index === 59 ? 'claimed' : 'done', revision: 1,
      ownerWorkerId: 'w1', proposalId: null, acceptance: 'PRIVATE ACCEPTANCE',
    }]));
    const run = {
      goal: 'g'.repeat(PROGRESS_LIMITS.goalChars + 100), createdAt: 50, tasks,
      workers: { w1: { currentTaskId: 'task-59', waitRegistration: {
        mode: 'selected' as const, afterSeq: 10,
        taskIds: Array.from({ length: 30 }, (_, index) => `t${index}`), proposalIds: ['proposal-1'],
      } } },
      proposals: { p: { id: 'proposal-1', taskId: 'task-59', status: 'integrating' as const,
        authorWorkerId: 'w1', createdAt: 200, updatedAt: 300, diagnosticsRef: 'PRIVATE ARTIFACT' } },
      messages: { private: { body: 'PRIVATE MESSAGE' } }, findings: { private: { summary: 'PRIVATE FINDING' } },
    };
    const snapshot = toProgressSnapshot(status({ workers: [worker({ id: 'w1', currentTaskId: 'task-59' })] }), run, 500);
    expect(snapshot.protocolVersion).toBe(2);
    expect(snapshot.goal).toHaveLength(PROGRESS_LIMITS.goalChars);
    expect(snapshot.createdAt).toBe(50);
    expect(snapshot.taskBoard).toMatchObject({ total: 60, truncated: true });
    expect(snapshot.taskBoard.items).toHaveLength(PROGRESS_LIMITS.taskBoard);
    expect(snapshot.taskBoard.items[0]?.id).toBe('task-59');
    expect(snapshot.workers[0]?.wait?.taskIds).toHaveLength(PROGRESS_LIMITS.waitIds);
    expect(snapshot.workers[0]?.currentProposal).toEqual({ id: 'proposal-1', taskId: 'task-59',
      status: 'integrating', createdAt: 200, updatedAt: 300 });
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|"acceptance":|diagnosticsRef|messages|findings/);
    expect(snapshot.acceptanceCriteria).toEqual([]);
  });

  it('filters stale terminal task pointers in the DTO without rewriting completed history', () => {
    const run = detail();
    const historical = { ...run, tasks: { 'task-1': { ...run.tasks['task-1']!, status: 'done' } } };
    const before = JSON.stringify(historical);
    const snapshot = toProgressSnapshot(status({ phase: 'completed' }), historical, 500);
    expect(snapshot.workers[0]?.currentTask).toBeNull();
    expect(snapshot.taskBoard.items[0]?.status).toBe('done');
    expect(JSON.stringify(historical)).toBe(before);
  });

  it('publishes only a bounded public task/proposal/head/run timeline in chronological order', () => {
    const events: SwarmEvent[] = Array.from({ length: 30 }, (_, index) => ({
      seq: index + 1, createdAt: index, authorWorkerId: 'w1', audience: { kind: 'all' },
      kind: 'task', taskId: `task-${index}`, status: 'claimed', ownerWorkerId: 'w1',
    }));
    events.push({ seq: 31, createdAt: 31, authorWorkerId: 'w1', audience: { kind: 'all' },
      kind: 'finding', findingId: 'PRIVATE FINDING ID', taskId: null, findingKind: 'fact' },
    { seq: 32, createdAt: 32, authorWorkerId: 'w1', audience: { kind: 'workers', workerIds: ['w1'] },
      kind: 'message', messageId: 'PRIVATE MESSAGE ID', targetWorkerId: 'w1' },
    { seq: 33, createdAt: 33, authorWorkerId: 'w1', audience: { kind: 'all' },
      kind: 'proposal', proposalId: 'p1', taskId: 'task-1', status: 'accepted' },
    { seq: 34, createdAt: 34, authorWorkerId: null, audience: { kind: 'all' },
      kind: 'head', acceptedHead: 'abcd', proposalId: 'p1' },
    { seq: 35, createdAt: 35, authorWorkerId: null, audience: { kind: 'all' },
      kind: 'run', phase: 'completed', target: null, reason: 'PRIVATE REASON' });
    const snapshot = toProgressSnapshot(status(), { ...detail(), events }, 100);
    expect(snapshot.recentEvents).toHaveLength(PROGRESS_LIMITS.recentEvents);
    expect(snapshot.recentEvents.slice(-3).map((event) => event.kind)).toEqual(['proposal', 'head', 'run']);
    expect(snapshot.recentEvents.map((event) => event.seq)).toEqual([...snapshot.recentEvents.map((event) => event.seq)].sort((a, b) => a - b));
    expect(JSON.stringify(snapshot.recentEvents)).not.toMatch(/PRIVATE|finding|message|reason/);
  });

  it('checks owner before reading full detail or worker activity', () => {
    let details = 0;
    let activities = 0;
    const feed = new ProgressFeed({ status: () => status({ ownerSessionId: 'other' }) }, {
      subscribe: () => () => undefined,
      detail: () => { details++; return detail(); },
      activity: { read: () => { activities++; return emptyWorkerActivity(); },
        subscribe: () => () => undefined, dispose: () => undefined },
    });
    expect(() => feed.snapshot(OWNER)).toThrow(/another session/);
    expect(details).toBe(0);
    expect(activities).toBe(0);
  });
});

describe('ProgressFeed continuous session stream', () => {
  it('observes terminal run then a new run without ending or resetting frame sequence', async () => {
    const { feed, runtime, emit, unsubscribeCount } = manualChanges();
    const controller = new AbortController();
    const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.progress?.runId).toBe(RUN);
    runtime.setPhase(status({ phase: 'completed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });
    expect((await iterator.next()).value?.progress?.phase).toBe('completed');
    expect(unsubscribeCount()).toBe(0);
    const next = iterator.next();
    runtime.setPhase(status({ runId: 'run-2', phase: 'preparing' }));
    emit({ runId: 'run-2', ownerSessionId: OWNER, phase: 'preparing' });
    expect(await next).toMatchObject({ done: false, value: { seq: 3, progress: { runId: 'run-2' } } });
    controller.abort();
    expect(unsubscribeCount()).toBe(1);
    expect((await iterator.next()).done).toBe(true);
    await feed.dispose();
  });

  it('starts without a run and remains subscribed until one is created', async () => {
    let current: RunStatus | null = null;
    let notify: ((change: ProgressChange) => void) | undefined;
    const feed = new ProgressFeed({ status: () => {
      if (!current) throw new SwarmError('SWARM_NOT_FOUND', 'no run');
      return current;
    } }, { subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; } });
    const controller = new AbortController();
    const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ seq: 1, progress: null });
    current = status();
    notify?.({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    expect((await iterator.next()).value?.progress?.runId).toBe(RUN);
    controller.abort();
    expect(notify).toBeUndefined();
    await feed.dispose();
  });

  it('deduplicates clock-only or private-record updates while retaining public changes', async () => {
    let clock = 100;
    let current = status();
    let notify: ((change: ProgressChange) => void) | undefined;
    const feed = new ProgressFeed({ status: () => current }, {
      now: () => clock,
      detail: () => ({ ...detail(), updatedAt: clock }),
      subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; },
    });
    const iterator = feed.watchSession(OWNER)[Symbol.asyncIterator]();
    await iterator.next();
    let settled = false;
    const pending = iterator.next().then((value) => { settled = true; return value; });
    clock = 200;
    notify?.({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    current = status({ tasks: { ...status().tasks, done: 10 } });
    notify?.({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    expect(await pending).toMatchObject({ value: { seq: 2, progress: { now: 200, tasks: { done: 10 } } } });
    await feed.dispose();
  });

  it('refreshes only relevant worker activity and disposes the source once', async () => {
    let activity: WorkerActivityState = emptyWorkerActivity();
    let notify: ((sessionId: string) => void) | undefined;
    let reads = 0;
    let disposed = 0;
    const feed = new ProgressFeed({ status: () => status({ workers: [worker()] }) }, {
      subscribe: () => () => undefined,
      activity: { read: () => { reads++; return activity; },
        subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; },
        dispose: () => { disposed++; },
      },
    });
    const iterator = feed.watchSession(OWNER)[Symbol.asyncIterator]();
    await iterator.next();
    let settled = false;
    const pending = iterator.next().then((value) => { settled = true; return value; });
    activity = { ...activity, turn: 3, step: 5, updatedAt: 700 };
    notify?.('unrelated');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(reads).toBe(1);
    notify?.('worker-session-2');
    expect(await pending).toMatchObject({ value: { progress: { workers: [{ activity: { turn: 3, step: 5 } }] } } });
    expect(reads).toBe(2);
    await feed.dispose();
    await feed.dispose();
    expect(disposed).toBe(1);
    expect(notify).toBeUndefined();
  });
});

describe('ProgressFeed strict cancellation', () => {
  it('does not subscribe or read for a signal aborted before the opening frame', async () => {
    let touched = false;
    const controller = new AbortController();
    controller.abort();
    const feed = new ProgressFeed({ status: () => { touched = true; return status(); } }, {
      subscribe: () => { touched = true; return () => undefined; },
    });
    const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(true);
    expect(touched).toBe(false);
  });

  it('cleans up immediately when cancelled while suspended at yield', async () => {
    const { feed, unsubscribeCount } = manualChanges();
    const controller = new AbortController();
    const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    expect(unsubscribeCount()).toBe(1);
    expect((await iterator.next()).done).toBe(true);
    await feed.dispose();
    expect(unsubscribeCount()).toBe(1);
  });

  it('settles a pending next on abort without emitting a buffered change', async () => {
    const { feed, runtime, emit, unsubscribeCount } = manualChanges();
    const controller = new AbortController();
    const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    runtime.setPhase(status({ phase: 'completed' }));
    emit({ runId: RUN, ownerSessionId: OWNER, phase: 'completed' });
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(unsubscribeCount()).toBe(1);
    await feed.dispose();
  });

  it('honors synchronous cancellation during subscription and snapshot reads', async () => {
    for (const during of ['subscribe', 'snapshot']) {
      const controller = new AbortController();
      let closed = 0;
      const feed = new ProgressFeed({ status: () => {
        if (during === 'snapshot') controller.abort();
        return status();
      } }, { subscribe: () => {
        if (during === 'subscribe') controller.abort();
        return () => { closed++; };
      } });
      const iterator = feed.watchSession(OWNER, controller.signal)[Symbol.asyncIterator]();
      expect((await iterator.next()).done).toBe(true);
      expect(closed).toBe(1);
      await feed.dispose();
    }
  });

  it('propagates ongoing subscription failures rather than ending successfully', async () => {
    let fail = false;
    let notify: ((change: ProgressChange) => void) | undefined;
    const feed = new ProgressFeed({ status: () => {
      if (fail) throw new Error('status unavailable');
      return status();
    } }, { subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; } });
    const iterator = feed.watchSession(OWNER)[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    fail = true;
    notify?.({ runId: RUN, ownerSessionId: OWNER, phase: 'running' });
    await expect(pending).rejects.toThrow('status unavailable');
    expect(notify).toBeUndefined();
    await feed.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* 浏览器插件：conversation.view order=5 + ctx.remote.$mount            */
/* ------------------------------------------------------------------ */

interface LoadedPlugin {
  exports: {
    apply: (ctx: unknown) => Promise<void>;
    inject: readonly string[];
  };
  contribution: {
    package: string;
    descriptors: readonly {
      id: string;
      namespace: string;
      method: string;
      mode?: string;
      cancellation?: { parameter: string };
      parameters: readonly { codec: { mode: string } }[];
      result: { mode: string };
    }[];
  };
  locale: { zh: Record<string, string>; en: Record<string, string> };
  registration: {
    options: {
      name: string;
      id: string;
      order: number;
      locale: string;
      label: () => string;
      inject: (sessionId: string) => Record<string, unknown>;
    };
    component: (props: Record<string, unknown>) => unknown;
  };
  render: (sessionId?: string) => { text: string; element: unknown };
  selectTab: (tab: string) => void;
}
/** 最小假 React：只为提取注册与渲染文本服务，不模拟真实调度。 */
function fakeReact(): {
  createElement: (tag: unknown, props: unknown, ...children: unknown[]) => unknown;
  useState: (initial: unknown) => [unknown, (next: unknown) => void];
  useRef: (initial: unknown) => { current: unknown };
  useEffect: (effect: () => unknown, deps?: readonly unknown[]) => void;
  reset: () => void;
} {
  let slots: Array<{ value?: unknown; deps?: readonly unknown[] }> = [];
  let cursor = 0;
  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]): boolean =>
    left !== undefined && right !== undefined && left.length === right.length
      && left.every((value, index) => value === right[index]);
  return {
    createElement: (tag, props, ...children) => typeof tag === 'function'
      ? (tag as (props: unknown) => unknown)(props)
      : { tag, props: (props ?? {}) as Record<string, unknown>, children: children.flat(Infinity) },
    useState: (initial) => {
      const index = cursor++;
      if (slots[index] === undefined) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, (next: unknown) => {
        slot.value = typeof next === 'function' ? (next as (value: unknown) => unknown)(slot.value) : next;
      }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (slots[index] === undefined) slots[index] = { value: { current: initial } };
      return slots[index].value as { current: unknown };
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        slots[index] = { deps };
        effect();
      }
    },
    reset: () => {
      cursor = 0;
    },
  };
}

function flattenText(node: unknown): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (typeof node === 'object' && node !== null && 'tag' in node && node.tag === 'style') return '';
  if (typeof node === 'object' && node !== null && 'children' in node) {
    if ('props' in node && (node.props as Record<string, unknown> | null)?.['hidden']) return '';
    const children = (node as { children: unknown[] }).children;
    return children.map(flattenText).join(' ');
  }
  return '';
}

interface ClientModule {
  id: string;
  factory: (require: (name: string) => unknown) => LoadedPlugin['exports'];
}

let clientModule: Promise<ClientModule> | null = null;

/** 只加载一次浏览器 bundle；每次测试用新的 factory 实例隔离状态。 */
async function clientModuleOnce(): Promise<ClientModule> {
  if (clientModule !== null) return clientModule;
  clientModule = (async () => {
    const captures: ClientModule[] = [];
    Reflect.set(globalThis, 'window', {
      __ModuleLoader__: { load: (module: ClientModule) => captures.push(module) },
    });
    // @ts-expect-error client.js is an untyped browser bundle that registers through window.
    await import('../client.js');
    const loaded = captures[0];
    if (loaded === undefined) throw new Error('client.js did not register with the module loader');
    return loaded;
  })();
  return clientModule;
}

interface LoadPluginOptions {
  readonly items?: readonly unknown[];
  readonly mountFails?: boolean;
}

async function loadPlugin(options: LoadPluginOptions = {}): Promise<LoadedPlugin> {
  const loaded = await clientModuleOnce();
  expect(loaded.id).toBe('@local/dsh-swarm');

  let locale: LoadedPlugin['locale'] = { zh: {}, en: {} };
  let contribution: LoadedPlugin['contribution'] | undefined;
  let registration: LoadedPlugin['registration'] | undefined;
  const react = fakeReact();

  const pluginExports = loaded.factory((name) => {
    if (name === 'react') return react;
    if (name === 'zod') return { z: { string: () => 'string', unknown: () => 'unknown' } };
    throw new Error(`unexpected require(${name})`);
  });

  const t = (key: string, vars?: Record<string, unknown>): string => {
    const template = locale.zh[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
      vars?.[name] === undefined ? `{${name}}` : String(vars[name]));
  };
  const ctx = {
    effect: (fn: () => () => void) => fn(),
    locale: {
      register: (_namespace: string, dictionaries: LoadedPlugin['locale']) => {
        locale = dictionaries;
        return () => undefined;
      },
      bind: () => t,
    },
    slots: {
      inject: (_slot: string, fn: () => LoadedPlugin['registration']) => {
        registration = fn();
      },
      register: (options: LoadedPlugin['registration']['options'], component: LoadedPlugin['registration']['component']) => ({
        options,
        component,
      }),
    },
    remote: {
      $mount: async (mounted: LoadedPlugin['contribution']) => {
        if (options.mountFails === true) throw new Error('mount failed');
        contribution = mounted;
        return async () => undefined;
      },
    },
    // Mounted namespaces are their own `remote.<ns>` services, read via ctx.get().
    get: (name: string) => (name === 'remote.swarmProgress' && contribution !== undefined ? progressRemote : undefined),
  };
  const progressRemote = {
        watchSession() { return this.watch(); },
        snapshot: async () => ({ ok: true, value: null }),
        watch: () => {
          let index = 0;
          return {
            async *[Symbol.asyncIterator]() {
              const items = options.items ?? [{ seq: 1, progress: null }];
              while (index < items.length) {
                const item = items[index];
                index += 1;
                yield item;
                await Promise.resolve();
              }
            },
            dispose: () => undefined,
          };
        },
  };

  await pluginExports.apply(ctx);
  if (registration === undefined) throw new Error('client plugin did not register conversation.view');
  if (contribution === undefined && options.mountFails !== true) {
    throw new Error('client plugin did not mount its Remote contribution');
  }
  const registered = registration;
  let rendered: unknown;
  function clickTab(node: unknown, tab: string): boolean {
    if (node === null || typeof node !== 'object') return false;
    if ('props' in node) {
      const props = node.props as Record<string, unknown>;
      if (props['data-swarm-tab'] === tab && typeof props['onClick'] === 'function') { props['onClick'](); return true; }
    }
    return 'children' in node && (node.children as unknown[]).some((child) => clickTab(child, tab));
  }

  return {
    exports: pluginExports,
    contribution: contribution ?? { package: '', descriptors: [] },
    locale,
    registration: registered,
    selectTab: (tab) => { if (!clickTab(rendered, tab)) throw new Error(`Missing tab ${tab}`); },
    render: (sessionId = OWNER) => {
      react.reset();
      const props = {
        sessionId,
        t,
        ...registered.options.inject(sessionId),
      };
      const element = registered.component(props);
      rendered = element;
      return { element, text: flattenText(element) };
    },
  };
}

describe('client.js conversation view', () => {
  it('mounts strict-codec Remote descriptors and registers conversation.view order 5', async () => {
    const plugin = await loadPlugin();
    expect(plugin.exports.inject).toEqual(['slots', 'locale', 'remote']);
    expect(plugin.contribution.package).toBe('@local/dsh-swarm');

    const [snapshot, watch] = plugin.contribution.descriptors;
    expect(snapshot?.id).toBe('@local/dsh-swarm#swarmProgress/snapshot');
    expect(snapshot?.mode).toBeUndefined();
    expect(snapshot?.parameters[0]?.codec.mode).toBe('strict');
    expect(snapshot?.result.mode).toBe('strict');
    expect(watch?.mode).toBe('stream');
    expect(watch?.cancellation).toEqual({ parameter: 'signal' });
    expect(watch?.parameters[0]?.codec.mode).toBe('strict');

    expect(plugin.registration.options.name).toBe('conversation.view');
    expect(plugin.registration.options.id).toBe('swarm-progress');
    expect(plugin.registration.options.order).toBe(5);
    expect(plugin.registration.options.locale).toBe('swarmProgress');
    expect(plugin.registration.options.label()).toBe(plugin.locale.zh['view.label']);
    expect(typeof plugin.registration.component).toBe('function');
  });

  it('registers zh/en dictionaries with identical keys', async () => {
    const plugin = await loadPlugin();
    expect(Object.keys(plugin.locale.zh).sort()).toEqual(Object.keys(plugin.locale.en).sort());
    for (const phase of ['preparing', 'running', 'draining', 'quiescing', 'paused', 'completed', 'stopped', 'failed']) {
      expect(plugin.locale.zh[`phase.${phase}`]).toBeTruthy();
    }
    expect(plugin.locale.zh['noRun.body']).toContain('对话');
    expect(plugin.locale.zh['noRun.body']).toContain('Agent');
  });
});

describe('client.js progress panel rendering', () => {
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it('renders phase, budget, task counts, worker states and current task', async () => {
    const progress = toProgressSnapshot(status(), detail(), 4_500);
    const plugin = await loadPlugin({ items: [{ seq: 1, progress }] });
    plugin.render();
    await flush();
    const { text } = plugin.render();
    const zh = (key: string): string => {
      const value = plugin.locale.zh[key];
      if (value === undefined) throw new Error(`missing zh key: `);
      return value;
    };

    expect(text).toContain(zh('title'));
    expect(text).toContain(RUN);
    expect(text).toContain(zh('phase.running'));
    expect(text).toContain('4 / 21');
    expect(text).toContain(zh('budget.kpi'));
    expect(text).toMatch(/0:0[45]/);
    // 每个 worker 的原生状态在独立成员页签展示；inactive 不得显示成完成。
    expect(text).not.toContain(zh('worker.native').replace('{status}', 'running'));
    plugin.selectTab('members');
    const members = plugin.render().text;
    expect(members).toContain('w1');
    expect(members).toContain('w2');
    expect(members).toContain('w3');
    for (const native of ['running', 'inactive', 'unavailable']) {
      expect(members).toContain(zh('worker.native').replace('{status}', native));
    }
    // Inactivity is rendered as idle/unassigned, never as completed work.
    expect(members).toContain(zh('work.unassigned'));
    expect(members).toContain(zh('activity.idle'));
    expect(members).not.toContain(zh('worker.inactiveNote'));
    expect(members).toContain(zh('stale.title'));
    expect(members).toContain('provider missing');
    expect(members).toContain('Implement progress DTO');
    expect(members).toContain('3');
    expect(members).not.toContain('%');
  });

  it('renders the publishing entry and expandable pending/handled goals without claiming terminal work is executing', async () => {
    const progress = toProgressSnapshot(status({ phase: 'stopped' }), {
      ...detail(), goal: 'Initial import', acceptanceCriteria: ['Import works'], goalRevision: 2,
      goals: {
        pending: { id: 'pending', seq: 2, text: 'Add CSV export', acceptanceCriteria: ['CSV downloads'], status: 'active', createdAt: 100,
          completedAt: null, completedCommit: null, continuedInRunId: null },
        handled: { id: 'handled', seq: 1, text: 'Add preview', acceptanceCriteria: ['Preview works'], status: 'completed', createdAt: 50,
          completedAt: 90, completedCommit: 'b'.repeat(40), continuedInRunId: null },
      },
    }, 4_500);
    const plugin = await loadPlugin({ items: [{ seq: 1, progress }] });
    plugin.render();
    await flush();
    plugin.render();
    plugin.selectTab('goals');
    const { text } = plugin.render();
    for (const key of ['goals.wish', 'goals.todo', 'goals.doing', 'goals.done', 'goals.publish', 'goals.criteria', 'goals.continue', 'goal.deferred', 'goal.completed']) {
      expect(text).toContain(plugin.locale.zh[key]);
    }
    expect(text).toContain('CSV downloads');
    expect(text).toContain('Import works');
    expect(text).not.toContain(plugin.locale.zh['goal.active']);
    expect(text.indexOf(plugin.locale.zh['goals.publish']!)).toBeLessThan(text.indexOf('Add CSV export'));
  });

  it('shows a friendly start hint when the session has no run', async () => {
    const plugin = await loadPlugin({ items: [{ seq: 1, progress: null }] });
    plugin.render();
    await flush();
    const { text } = plugin.render();
    expect(text).toContain(plugin.locale.zh['noRun.title']);
    expect(text).toContain('对话');
    expect(text).toContain('整理目标');
    expect(text).not.toContain('swarm_manage');
  });

  it('reports the Host interface as unavailable when the Remote mount fails', async () => {
    const plugin = await loadPlugin({ mountFails: true });
    const { text } = plugin.render();
    expect(text).toContain(plugin.locale.zh['connection.unavailable']);
    expect(text).toContain('mount failed');
  });
});
