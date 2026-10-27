/**
 * events 模块针对性测试：可见性、§7.2 唤醒匹配表、appendEvent 的 seq 分配与 pending 抬高。
 * 纯函数测试：只用 createRun 与手工 worker fixture，不导入 schema/Store，不依赖 DSH。
 */

import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  isEventVisible,
  matchesWait,
  type EventInput,
} from '../src/events.ts';
import {
  createRun,
  type ProposalRecord,
  type Run,
  type SwarmEvent,
  type TaskStatus,
  type VerificationConfig,
  type WaitRegistration,
  type WorkerId,
  type WorkerRecord,
} from '../src/types.ts';

/* --------------------------- 测试夹具 --------------------------- */

const verification: VerificationConfig = {
  setup: [],
  test: [{ argv: ['true'], timeoutMs: 1000 }],
};

const NO_WAIT: WaitRegistration = { afterSeq: 0, mode: 'any', taskIds: [], proposalIds: [] };

function waitOf(
  overrides: Partial<WaitRegistration> = {},
): WaitRegistration {
  return { ...NO_WAIT, taskIds: [], proposalIds: [], ...overrides };
}

function makeWorker(id: WorkerId, waitRegistration: WaitRegistration | null = null): WorkerRecord {
  return {
    id,
    sessionId: `sess-${id}`,
    branch: `swarm/${id}`,
    worktreePath: `/tmp/swarm/${id}`,
    initializationState: 'ready',
    initializationError: null,
    unavailableReason: null,
    offeredSeq: 0,
    observedSeq: 0,
    notifiedSeq: 0,
    wakeTargetSeq: 0,
    waitRegistration,
    currentTaskId: null,
    createdAt: 0,
  };
}

function makeRun(...workers: WorkerRecord[]): Run {
  const run = createRun({
    id: 'run-1',
    ownerSessionId: 'owner-session',
    repositoryRoot: '/tmp/repo',
    gitCommonDir: '/tmp/repo/.git',
    goal: 'goal',
    acceptanceCriteria: ['criterion'],
    verification,
    baseCommit: 'a'.repeat(40),
    resultRef: 'refs/heads/swarm-r1-result',
    deadline: 1_000_000,
    createdAt: 0,
  });
  run.phase = 'running';
  for (const worker of workers) run.workers[worker.id] = worker;
  return run;
}

function makeProposal(id: string, authorWorkerId: WorkerId): ProposalRecord {
  return {
    id,
    taskId: `task-of-${id}`,
    authorWorkerId,
    sourceCommit: 'b'.repeat(40),
    resultRefAtSubmission: 'c'.repeat(40),
    proposalRef: `refs/swarm/proposals/${id}`,
    status: 'queued',
    acceptedCommit: null,
    diagnosticsRef: null,
    rejectionReason: null,
    attemptIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function workerOf(run: Run, id: WorkerId): WorkerRecord {
  const found = run.workers[id];
  if (found === undefined) throw new Error(`fixture 缺少 worker ${id}`);
  return found;
}

/** 断言并取出 events 中最后一条。 */
function lastEvent(run: Run): SwarmEvent {
  const last = run.events[run.events.length - 1];
  if (last === undefined) throw new Error('fixture 期望 run.events 非空');
  return last;
}

/* ------------------------------ 测试 ------------------------------ */

describe('isEventVisible', () => {
  it('all 全员可见，workers 只对列表内可见', () => {
    const run = makeRun(makeWorker('w1'), makeWorker('w2'));
    const task = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: 'w2',
        taskId: 't1',
        status: 'open',
        ownerWorkerId: null,
        audience: { kind: 'all' },
      },
      10,
    );
    expect(isEventVisible(task, 'w1')).toBe(true);
    expect(isEventVisible(task, 'nobody')).toBe(true);

    const message = appendEvent(
      run,
      {
        kind: 'message',
        authorWorkerId: 'w2',
        messageId: 'm1',
        targetWorkerId: 'w1',
        audience: { kind: 'workers', workerIds: ['w2', 'w1'] },
      },
      20,
    );
    expect(isEventVisible(message, 'w1')).toBe(true);
    expect(isEventVisible(message, 'w2')).toBe(true);
    expect(isEventVisible(message, 'w3')).toBe(false);
  });
});

describe('matchesWait 匹配表', () => {
  it('分布式 Omit 后的 message 输入不含 seq/createdAt，追加后补齐', () => {
    const messageInput: Extract<EventInput, { kind: 'message' }> = {
      kind: 'message',
      authorWorkerId: 'w2',
      messageId: 'm1',
      targetWorkerId: 'w1',
      audience: { kind: 'workers', workerIds: ['w2', 'w1'] },
    };
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2'));
    const event = appendEvent(run, messageInput, 1234);
    expect(event.kind).toBe('message');
    expect(event.seq).toBe(1);
    expect(event.createdAt).toBe(1234);
  });

  it('自己发出的普通 finding 不唤醒自己（any 模式）', () => {
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2'));
    const event = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w1',
        findingId: 'f1',
        taskId: 't1',
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(false);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(0);
  });

  it('自己的 proposal 终态结果唤醒自己，queued 不唤醒', () => {
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2'));
    run.proposals.p1 = makeProposal('p1', 'w1');

    const queued = appendEvent(
      run,
      {
        kind: 'proposal',
        authorWorkerId: 'w1',
        proposalId: 'p1',
        taskId: 't1',
        status: 'queued',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), queued)).toBe(false);

    const accepted = appendEvent(
      run,
      {
        kind: 'proposal',
        authorWorkerId: null,
        proposalId: 'p1',
        taskId: 't1',
        status: 'accepted',
        audience: { kind: 'all' },
      },
      20,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), accepted)).toBe(true);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(2);

    const rejected = appendEvent(
      run,
      {
        kind: 'proposal',
        authorWorkerId: null,
        proposalId: 'p1',
        taskId: 't1',
        status: 'rejected',
        audience: { kind: 'all' },
      },
      30,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), rejected)).toBe(true);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(3);
  });

  it('自己 proposal 的终态结果在 selected 模式且列表为空时也唤醒', () => {
    const run = makeRun(
      makeWorker('w1', waitOf({ mode: 'selected', taskIds: ['other'], proposalIds: [] })),
    );
    run.proposals.p1 = makeProposal('p1', 'w1');
    const event = appendEvent(
      run,
      {
        kind: 'proposal',
        authorWorkerId: null,
        proposalId: 'p1',
        taskId: 't1',
        status: 'accepted',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(true);
  });

  it('他作者 finding：any 恒匹配，selected 仅 taskId 在列表内', () => {
    const run = makeRun(
      makeWorker('w1', waitOf()),
      makeWorker('w2', waitOf({ mode: 'selected', taskIds: ['t9'], proposalIds: [] })),
      makeWorker('w3'),
    );
    const event = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w2',
        findingId: 'f1',
        taskId: 't1',
        findingKind: 'fail',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(true);
    expect(matchesWait(run, workerOf(run, 'w2'), event)).toBe(false);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(1);
  });

  it('task open：any 恒匹配，selected 仅 id 匹配；其他状态 only selected 匹配', () => {
    const selected = makeWorker('w1', waitOf({ mode: 'selected', taskIds: ['t1'], proposalIds: [] }));
    const run = makeRun(selected, makeWorker('w2', waitOf()), makeWorker('w3', waitOf()));

    const openOther = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: 'w2',
        taskId: 't8',
        status: 'open',
        ownerWorkerId: null,
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), openOther)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w2'), openOther)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w3'), openOther)).toBe(true);

    const openMine = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: 'w2',
        taskId: 't1',
        status: 'open',
        ownerWorkerId: null,
        audience: { kind: 'all' },
      },
      20,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), openMine)).toBe(true);

    const claimedOther = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: 'w2',
        taskId: 't8',
        status: 'claimed',
        ownerWorkerId: 'w2',
        audience: { kind: 'all' },
      },
      30,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), claimedOther)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w2'), claimedOther)).toBe(false);

    const claimedMine = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: 'w2',
        taskId: 't1',
        status: 'claimed',
        ownerWorkerId: 'w1',
        audience: { kind: 'all' },
      },
      40,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), claimedMine)).toBe(true);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(4);
  });

  it('task 状态顺序不影响匹配：done 在 selected 匹配时唤醒', () => {
    const run = makeRun(
      makeWorker('w1', waitOf({ mode: 'selected', taskIds: ['t1'], proposalIds: [] })),
      makeWorker('w2', waitOf()),
    );
    for (const status of ['proposed', 'done', 'blocked', 'cancelled'] as TaskStatus[]) {
      const event = appendEvent(
        run,
        {
          kind: 'task',
          authorWorkerId: 'w2',
          taskId: 't1',
          status,
          ownerWorkerId: 'w2',
          audience: { kind: 'all' },
        },
        10,
      );
      expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(true);
    }
  });

  it('直接消息：目标是自己才唤醒，两种模式都恒匹配', () => {
    const run = makeRun(
      makeWorker('w1', waitOf({ mode: 'selected', taskIds: ['zz'], proposalIds: ['zz'] })),
      makeWorker('w2', waitOf()),
      makeWorker('w3'),
    );
    const toOther = appendEvent(
      run,
      {
        kind: 'message',
        authorWorkerId: 'w1',
        messageId: 'm1',
        targetWorkerId: 'w2',
        audience: { kind: 'workers', workerIds: ['w1', 'w2'] },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), toOther)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w2'), toOther)).toBe(true);

    const toMe = appendEvent(
      run,
      {
        kind: 'message',
        authorWorkerId: 'w3',
        messageId: 'm2',
        targetWorkerId: 'w1',
        audience: { kind: 'workers', workerIds: ['w3', 'w1'] },
      },
      20,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), toMe)).toBe(true);
    expect(matchesWait(run, workerOf(run, 'w2'), toMe)).toBe(false);
  });

  it('他人私信对被排除的 worker 不可见，也不进入匹配', () => {
    const run = makeRun(
      makeWorker('w1', waitOf()),
      makeWorker('w2', waitOf()),
      makeWorker('w3', waitOf()),
    );
    const privateMessage = appendEvent(
      run,
      {
        kind: 'message',
        authorWorkerId: 'w3',
        messageId: 'm1',
        targetWorkerId: 'w2',
        audience: { kind: 'workers', workerIds: ['w3', 'w2'] },
      },
      10,
    );
    expect(isEventVisible(privateMessage, 'w1')).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w1'), privateMessage)).toBe(false);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(0);
    expect(matchesWait(run, workerOf(run, 'w2'), privateMessage)).toBe(true);
    expect(workerOf(run, 'w2').wakeTargetSeq).toBe(1);
  });

  it('seq <= afterSeq 不匹配，seq > afterSeq 才匹配', () => {
    const run = makeRun(makeWorker('w1', waitOf({ afterSeq: 2 })), makeWorker('w2'));
    // 先用 run 控制事件占掉 seq=1，让下面的 finding 正好落在 seq=2（== afterSeq）。
    appendEvent(
      run,
      { kind: 'run', authorWorkerId: null, phase: 'running', target: null, reason: null, audience: { kind: 'all' } },
      10,
    );
    const atAfterSeq = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w2',
        findingId: 'f2',
        taskId: null,
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      30,
    );
    expect(atAfterSeq.seq).toBe(2);
    expect(matchesWait(run, workerOf(run, 'w1'), atAfterSeq)).toBe(false);

    const beyond = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w2',
        findingId: 'f3',
        taskId: null,
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      40,
    );
    expect(beyond.seq).toBe(3);
    expect(matchesWait(run, workerOf(run, 'w1'), beyond)).toBe(true);
  });

  it('没有等待登记的 worker 永不匹配', () => {
    const run = makeRun(makeWorker('w1', null), makeWorker('w2'));
    const event = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w2',
        findingId: 'f1',
        taskId: null,
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(false);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(0);
  });

  it('head：any 恒匹配，selected 仅非空 proposalId 在列表内', () => {
    const run = makeRun(
      makeWorker('w1', waitOf({ mode: 'selected', taskIds: [], proposalIds: ['p1'] })),
      makeWorker('w2', waitOf()),
      makeWorker('w3'),
    );
    const unlinked = appendEvent(
      run,
      { kind: 'head', authorWorkerId: null, acceptedHead: 'd'.repeat(40), proposalId: null, audience: { kind: 'all' } },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), unlinked)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w2'), unlinked)).toBe(true);

    const linked = appendEvent(
      run,
      { kind: 'head', authorWorkerId: null, acceptedHead: 'd'.repeat(40), proposalId: 'p1', audience: { kind: 'all' } },
      20,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), linked)).toBe(true);
  });

  it('其他 proposal 终态：any 匹配，selected 仅 proposalId 在列表内', () => {
    const run = makeRun(
      makeWorker('w1', waitOf({ mode: 'selected', taskIds: [], proposalIds: ['p1'] })),
      makeWorker('w2', waitOf()),
      makeWorker('w3', waitOf()),
    );
    run.proposals.p9 = makeProposal('p9', 'w2');
    const otherResult = appendEvent(
      run,
      {
        kind: 'proposal',
        authorWorkerId: null,
        proposalId: 'p9',
        taskId: 't9',
        status: 'accepted',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), otherResult)).toBe(false);
    expect(matchesWait(run, workerOf(run, 'w3'), otherResult)).toBe(true);
  });

  it('run 控制事件永不唤醒', () => {
    const run = makeRun(makeWorker('w1', waitOf()));
    const event = appendEvent(
      run,
      { kind: 'run', authorWorkerId: null, phase: 'paused', target: null, reason: 'user_pause', audience: { kind: 'all' } },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(false);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(0);
  });
});

describe('appendEvent', () => {
  it('原子分配 seq 并追加事件，不递增 Run.revision，不唤醒运行时', () => {
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2', waitOf()));
    const revisionBefore = run.revision;
    const updatedAtBefore = run.updatedAt;

    const first = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w1',
        findingId: 'f1',
        taskId: null,
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      100,
    );
    const second = appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: null,
        taskId: 't1',
        status: 'open',
        ownerWorkerId: null,
        audience: { kind: 'all' },
      },
      200,
    );

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(run.nextSeq).toBe(3);
    expect(run.events).toHaveLength(2);
    expect(lastEvent(run)).toBe(second);
    expect(run.events[0]).toMatchObject({ seq: 1, createdAt: 100 });
    expect(run.revision).toBe(revisionBefore);
    expect(run.updatedAt).toBe(updatedAtBefore);
    // 仅 open task 唤醒等待者 w1/w2；自己的 finding 不唤醒 w1。
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(2);
    expect(workerOf(run, 'w2').wakeTargetSeq).toBe(2);
  });

  it('wakeTargetSeq 只增不减（max(旧值, event.seq)）', () => {
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2', waitOf()));
    workerOf(run, 'w1').wakeTargetSeq = 9;
    const event = appendEvent(
      run,
      {
        kind: 'finding',
        authorWorkerId: 'w2',
        findingId: 'f1',
        taskId: null,
        findingKind: 'observed',
        audience: { kind: 'all' },
      },
      10,
    );
    expect(matchesWait(run, workerOf(run, 'w1'), event)).toBe(true);
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(9);
    // w2 是该 finding 的作者，自己的普通事件不唤醒自己。
    expect(workerOf(run, 'w2').wakeTargetSeq).toBe(0);
  });

  it('只抬高匹配等待者，未登记等待的 worker 保持原值', () => {
    const run = makeRun(makeWorker('w1', waitOf()), makeWorker('w2', null), makeWorker('w3'));
    appendEvent(
      run,
      {
        kind: 'message',
        authorWorkerId: 'w3',
        messageId: 'm1',
        targetWorkerId: 'w1',
        audience: { kind: 'workers', workerIds: ['w3', 'w1'] },
      },
      10,
    );
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(1);
    // 私信作者 w3 可见但目标不是自己，不唤醒。
    expect(workerOf(run, 'w3').wakeTargetSeq).toBe(0);
    expect(workerOf(run, 'w2').wakeTargetSeq).toBe(0);
  });

  it('等待登记被消费（清空）后追加事件不再唤醒', () => {
    const run = makeRun(makeWorker('w1', waitOf()));
    workerOf(run, 'w1').waitRegistration = null;
    appendEvent(
      run,
      {
        kind: 'task',
        authorWorkerId: null,
        taskId: 't1',
        status: 'open',
        ownerWorkerId: null,
        audience: { kind: 'all' },
      },
      10,
    );
    expect(workerOf(run, 'w1').wakeTargetSeq).toBe(0);
  });
});
