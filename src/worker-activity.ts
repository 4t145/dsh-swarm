/** Pure, bounded tool/lifecycle projection. Never retain arguments, results or model text. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';

export const WORKER_ACTIVITY_KEY = 'swarm.workerActivity';
export const ACTIVITY_LIMITS = Object.freeze({ activeTools: 16, recentTools: 8, nameChars: 120, idChars: 200 });

export interface WorkerToolActivity {
  readonly id: string;
  readonly name: string;
  readonly status: 'executing' | 'completed' | 'failed' | 'interrupted';
  readonly turn: number;
  readonly step: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

export interface WorkerActivityState {
  readonly status: 'idle' | 'running' | 'executing';
  readonly turn: number | null;
  readonly step: number | null;
  readonly startedAt: number | null;
  readonly updatedAt: number | null;
  readonly activeTools: readonly WorkerToolActivity[];
  /** Omitted concurrent calls keep activity conservative until the step/turn closes. */
  readonly activeToolsTruncated: boolean;
  readonly recentTools: readonly WorkerToolActivity[];
}

export interface WorkerActivity extends Omit<WorkerActivityState, 'status'> {
  readonly status: WorkerActivityState['status'] | 'unavailable';
  readonly diagnostic: string | null;
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'swarm.workerActivity': WorkerActivityState;
  }
  interface SessionProjectionMap {
    'swarm.workerActivity': WorkerActivityState;
  }
}

const toolSchema = z.strictObject({
  id: z.string().max(ACTIVITY_LIMITS.idChars),
  name: z.string().max(ACTIVITY_LIMITS.nameChars),
  status: z.enum(['executing', 'completed', 'failed', 'interrupted']),
  turn: z.number(), step: z.number(), startedAt: z.number(), finishedAt: z.number().nullable(),
});
export const workerActivitySchema: z.ZodType<WorkerActivityState> = z.strictObject({
  status: z.enum(['idle', 'running', 'executing']),
  turn: z.number().nullable(), step: z.number().nullable(),
  startedAt: z.number().nullable(), updatedAt: z.number().nullable(),
  activeTools: z.array(toolSchema).max(ACTIVITY_LIMITS.activeTools),
  activeToolsTruncated: z.boolean(),
  recentTools: z.array(toolSchema).max(ACTIVITY_LIMITS.recentTools),
});

/** Fresh JSON state; the registry owns each session's current value. */
export function emptyWorkerActivity(): WorkerActivityState {
  return { status: 'idle', turn: null, step: null, startedAt: null, updatedAt: null, activeTools: [], activeToolsTruncated: false, recentTools: [] };
}

function interrupted(state: WorkerActivityState, time: number): readonly WorkerToolActivity[] {
  return [...state.activeTools.map((tool): WorkerToolActivity => ({ ...tool, status: 'interrupted', finishedAt: time })),
    ...state.recentTools].slice(0, ACTIVITY_LIMITS.recentTools);
}

/** Fold only lifecycle facts and tool identity/timing/status; ignored events preserve identity. */
export function applyWorkerActivity(state: WorkerActivityState, event: SessionEvent): WorkerActivityState {
  switch (event.type) {
    case 'turn/start':
      return { status: 'running', turn: event.data.turn, step: null, startedAt: event.time,
        updatedAt: event.time, activeTools: [], activeToolsTruncated: false, recentTools: interrupted(state, event.time) };
    case 'step/start':
      return { ...state, status: state.activeTools.length || state.activeToolsTruncated ? 'executing' : 'running',
        turn: event.data.turn, step: event.data.step, startedAt: event.time, updatedAt: event.time };
    case 'tool/call': {
      const { callId, name, turn, step } = event.data;
      const id = callId.slice(0, ACTIVITY_LIMITS.idChars);
      if (state.activeTools.some((tool) => tool.id === id)) return state;
      const tool: WorkerToolActivity = { id, name: name.slice(0, ACTIVITY_LIMITS.nameChars),
        turn, step, status: 'executing', startedAt: event.time, finishedAt: null };
      return { ...state, status: 'executing', turn, step, startedAt: state.startedAt ?? event.time,
        updatedAt: event.time, activeTools: [...state.activeTools, tool].slice(-ACTIVITY_LIMITS.activeTools),
        activeToolsTruncated: state.activeToolsTruncated || state.activeTools.length >= ACTIVITY_LIMITS.activeTools };
    }
    case 'tool/result': {
      const id = event.data.message.toolCallId.slice(0, ACTIVITY_LIMITS.idChars);
      const tool = state.activeTools.find((item) => item.id === id);
      if (!tool) return state;
      const activeTools = state.activeTools.filter((item) => item.id !== id);
      const completed: WorkerToolActivity = { ...tool, finishedAt: event.time,
        status: event.data.message.isError || event.data.error ? 'failed' : 'completed' };
      return { ...state, status: activeTools.length || state.activeToolsTruncated ? 'executing' : 'running', updatedAt: event.time,
        activeTools, recentTools: [completed, ...state.recentTools].slice(0, ACTIVITY_LIMITS.recentTools) };
    }
    case 'step/end':
      if (state.turn !== event.data.turn || state.step !== event.data.step) return state;
      return { ...state, status: 'running', updatedAt: event.time, activeTools: [], activeToolsTruncated: false,
        recentTools: interrupted(state, event.time) };
    case 'turn/end':
      if (state.turn !== event.data.turn) return state;
      return { ...state, status: 'idle', updatedAt: event.time, activeTools: [], activeToolsTruncated: false,
        recentTools: interrupted(state, event.time) };
    default:
      return state;
  }
}

export const workerActivityProjection = {
  key: WORKER_ACTIVITY_KEY,
  stateVersion: 1,
  stateSchema: workerActivitySchema,
  init: emptyWorkerActivity,
  apply: applyWorkerActivity,
  wire: { viewSchema: workerActivitySchema, view: (state: WorkerActivityState) => state },
} satisfies ProjectionDefinition<typeof WORKER_ACTIVITY_KEY, WorkerActivityState>;

/** Native liveness wins over historical projection state, without mutating that state. */
export function toWorkerActivity(
  state: WorkerActivityState | undefined,
  nativeStatus: 'running' | 'inactive' | 'unavailable',
  diagnostic: string | null = null,
): WorkerActivity {
  const value = state ?? emptyWorkerActivity();
  const active = nativeStatus === 'running';
  return {
    ...value,
    status: nativeStatus === 'inactive' ? 'idle' : nativeStatus === 'unavailable' || !state
      ? 'unavailable' : value.activeTools.length || value.activeToolsTruncated ? 'executing' : 'running',
    activeTools: active ? value.activeTools : [],
    activeToolsTruncated: active && value.activeToolsTruncated,
    // An interrupted call has no observed finish time when native liveness alone ends it.
    recentTools: active ? value.recentTools : [...value.activeTools.map((tool): WorkerToolActivity => ({
      ...tool, status: 'interrupted', finishedAt: null,
    })), ...value.recentTools].slice(0, ACTIVITY_LIMITS.recentTools),
    diagnostic: diagnostic ?? (active && !state ? 'worker activity projection unavailable'
      : active && value.activeToolsTruncated ? 'additional tool calls omitted; awaiting step/turn end' : null),
  };
}

export interface WorkerActivitySource {
  read(sessionId: string): WorkerActivityState | undefined;
  subscribe(listener: (sessionId: string) => void): () => void;
  dispose(): void;
}

/** Plugin-owned registry registration and listeners; reads live agents, never rescans logs. */
export async function registerWorkerActivity(ctx: Context): Promise<WorkerActivitySource> {
  const registry = ctx.get('sessionProjections');
  if (!registry) throw new Error('Swarm progress requires sessionProjections');
  // DSH 0.2.2: registration is awaitable and reads go through the owned handle.
  const handle = await registry.register(workerActivityProjection);
  const subscriptions = new Set<() => void>();
  let disposed = false;
  return {
    read: (sessionId) => {
      if (disposed) throw new Error('worker activity projection is disposed');
      const agent = ctx.agents.get(SessionId(sessionId));
      if (!agent) return undefined;
      return handle.stateOf(agent.session);
    },
    subscribe: (listener) => {
      if (disposed) throw new Error('worker activity projection is disposed');
      const unsubscribe = registry.onChanged((session, key) => {
        if (key === WORKER_ACTIVITY_KEY) listener(session.id);
      });
      const close = (): void => { unsubscribe(); subscriptions.delete(close); };
      subscriptions.add(close);
      return close;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const close of [...subscriptions]) close();
      void handle.dispose().catch((error: unknown) => {
        ctx.logger.warn('Swarm worker activity projection release failed: %s', error instanceof Error ? error.message : String(error));
      });
    },
  };
}
