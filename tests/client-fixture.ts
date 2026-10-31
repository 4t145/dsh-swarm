import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

/** The shipped browser entry, not a copy of its implementation. */
export const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8');

interface BrowserModule<T> {
  readonly id: string;
  factory(require: (name: string) => unknown): T;
}

/** Each call owns an isolated browser realm and factory; only React is a supported import. */
export function loadClient<T>(react: object = {}, globals: Record<string, unknown> = {}): T {
  let captured: BrowserModule<T> | undefined;
  runInNewContext(clientSource, {
    console, AbortController, Date, Error, TypeError,
    setInterval: (callback: () => void, ms: number) => globalThis.setInterval(callback, ms),
    clearInterval: (timer: ReturnType<typeof setInterval>) => globalThis.clearInterval(timer),
    ...globals,
    window: { __ModuleLoader__: { load(module: BrowserModule<T>) {
      if (captured) throw new Error('Client entry registered more than one module');
      captured = module;
    } } },
  });
  if (!captured || captured.id !== '@local/dsh-swarm') throw new Error('Client entry did not register @local/dsh-swarm');
  return captured.factory((name) => {
    if (name === 'react') return react;
    throw new Error(`Unexpected browser import ${name}`);
  });
}
