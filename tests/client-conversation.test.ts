import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Boundary validation and merge facts for the owner conversation reader.
interface Item { kind: string; seq: number; [key: string]: unknown }
interface Client {
  readConversationPage(page: unknown, runId: string): { items: Item[]; nextBeforeSeq: number | null };
  mergeConversation(current: Item[], incoming: Item[]): Item[];
  dictionaries: Record<'en' | 'zh', Record<string, string>>;
}
interface BrowserModule { factory(require: (name: string) => unknown): { progressClient: Client } }
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
let captured: BrowserModule | undefined;
runInNewContext(source, { window: { __ModuleLoader__: { load: (module: BrowserModule) => { captured = module; } } } });
if (!captured) throw new Error('Client module did not register');
const client = captured.factory(() => ({})).progressClient;

const message = (seq: number): Item => ({ kind: 'message', id: 'm' + seq, seq, authorWorkerId: 'w1', targetWorkerId: 'w2', body: 'hi', truncated: false, createdAt: seq });
const finding = (seq: number): Item => ({ kind: 'finding', id: 'f' + seq, seq, authorWorkerId: 'w2', findingKind: 'fact', taskId: null, body: 'fact', truncated: false, scope: ['a'], evidenceRefs: [], supersedesId: null, createdAt: seq });

describe('owner conversation reader', () => {
  it('accepts valid pages and rejects malformed or foreign ones', () => {
    expect(client.readConversationPage({ runId: 'run', items: [message(2), finding(1)], nextBeforeSeq: null }, 'run').items).toHaveLength(2);
    expect(() => client.readConversationPage({ runId: 'other', items: [], nextBeforeSeq: null }, 'run')).toThrow(/Run changed/);
    expect(() => client.readConversationPage(null, 'run')).toThrow(/Run changed/);
    expect(() => client.readConversationPage({ runId: 'run', items: [{ ...message(1), body: 1 }], nextBeforeSeq: null }, 'run')).toThrow(/Invalid/);
    expect(() => client.readConversationPage({ runId: 'run', items: [{ ...finding(1), scope: [1] }], nextBeforeSeq: null }, 'run')).toThrow(/Invalid/);
  });

  it('merges refreshed and older pages by seq without duplicates, newest first', () => {
    const merged = client.mergeConversation([message(5), message(3)], [message(6), message(5), finding(1)]);
    expect(merged.map((item) => item.seq)).toEqual([6, 5, 3, 1]);
  });

  it('has matching bilingual conversation labels', () => {
    const keys = (lang: 'en' | 'zh') => Object.keys(client.dictionaries[lang]).filter((key) => key.startsWith('conv.')).sort();
    expect(keys('zh')).toEqual(keys('en'));
  });
});
