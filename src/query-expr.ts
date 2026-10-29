/**
 * 搜索表达式：swarm_read query 与公开协作查询（public-query）共用的唯一解析/匹配模块。
 *
 * 纯模块：不读 Store、不依赖 DSH；输入字符串，输出 AST 或抛 `SWARM_INVALID_INPUT`。
 *
 * 语法（大小写不敏感）：
 *   expr    := or
 *   or      := and ( '|' and )*
 *   and     := unary ( '&'? unary )*        空白与 & 都表示 AND
 *   unary   := ( '-' | '!' ) unary | primary
 *   primary := '(' expr ')' | field ':' value | "phrase" | term
 *   field   := kind | author | task         其它 `x:y` 视作普通词
 *   value   := term | "phrase"
 *
 * 词与短语按子串匹配记录全文；`kind:` 精确匹配，`author:`/`task:` 子串匹配任一候选值
 * （作者可同时提供 worker id 与显示名）。`-`/`!` 仅在词首表示 NOT，`foo-bar` 仍是一个词。
 * 错误信息中的 position 为 0 起始的字符偏移，同时写入 details.position。
 */

import { SwarmError } from './errors.ts';

export const QUERY_FIELDS = ['kind', 'author', 'task'] as const;
export type QueryField = (typeof QUERY_FIELDS)[number];

/** 表达式长度与嵌套上限：拒绝病态输入，避免递归栈溢出。 */
export const QUERY_MAX_LENGTH = 500;
export const QUERY_MAX_DEPTH = 32;

export type QueryNode =
  | { type: 'term'; value: string; phrase: boolean }
  | { type: 'field'; field: QueryField; value: string }
  | { type: 'not'; operand: QueryNode }
  | { type: 'and'; operands: QueryNode[] }
  | { type: 'or'; operands: QueryNode[] };

/** 被搜索的记录投影：全文与字段候选值；调用方负责把各自记录映射到这里。 */
export interface QuerySubject {
  text: string;
  fields?: Partial<Record<QueryField, readonly (string | null | undefined)[]>>;
}

type Token =
  | { type: '(' | ')' | '|' | '&' | 'not'; pos: number }
  | { type: 'word'; value: string; pos: number }
  | { type: 'phrase'; value: string; pos: number }
  | { type: 'field'; field: QueryField; value: string; pos: number; valuePos: number };

const FIELD_SET: ReadonlySet<string> = new Set(QUERY_FIELDS);
const DELIMS = new Set(['(', ')', '|', '&', '"']);

function fail(source: string, position: number, problem: string): never {
  const where = position >= source.length ? 'end of input' : `'${source.slice(position, position + 10)}'`;
  throw new SwarmError('SWARM_INVALID_INPUT', `invalid query at position ${position} (${where}): ${problem}`, {
    details: { query: source, position, problem },
  });
}

function isSpace(ch: string): boolean {
  return /\s/u.test(ch);
}

function readPhrase(source: string, start: number): { value: string; end: number } {
  // start 指向开引号；支持 \" 与 \\ 转义。
  let value = '';
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\' && i + 1 < source.length) {
      value += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') return { value, end: i + 1 };
    value += ch;
    i += 1;
  }
  return fail(source, start, 'unterminated quoted phrase');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '|' || ch === '&') {
      tokens.push({ type: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '-' || ch === '!') {
      tokens.push({ type: 'not', pos: i });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const { value, end } = readPhrase(source, i);
      if (value.trim() === '') fail(source, i, 'empty quoted phrase');
      tokens.push({ type: 'phrase', value, pos: i });
      i = end;
      continue;
    }
    const start = i;
    while (i < source.length && !isSpace(source[i]!) && !DELIMS.has(source[i]!)) i += 1;
    const word = source.slice(start, i);
    const colon = word.indexOf(':');
    const name = colon > 0 ? word.slice(0, colon).toLowerCase() : '';
    if (colon > 0 && FIELD_SET.has(name)) {
      const field = name as QueryField;
      const valuePos = start + colon + 1;
      let value = word.slice(colon + 1);
      if (value === '' && source[i] === '"') {
        const phrase = readPhrase(source, i);
        value = phrase.value;
        i = phrase.end;
      }
      if (value.trim() === '') fail(source, valuePos, `missing value for field '${field}:'`);
      tokens.push({ type: 'field', field, value, pos: start, valuePos });
      continue;
    }
    tokens.push({ type: 'word', value: word, pos: start });
  }
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
  ) {}

  parse(): QueryNode {
    const node = this.parseOr();
    const rest = this.peek();
    if (rest) {
      fail(this.source, rest.pos, rest.type === ')' ? "unmatched ')'" : `unexpected '${rest.type}'`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private endPos(): number {
    return this.source.length;
  }

  private parseOr(): QueryNode {
    const operands = [this.parseAnd()];
    while (this.peek()?.type === '|') {
      this.index += 1;
      operands.push(this.parseAnd());
    }
    return operands.length === 1 ? operands[0]! : { type: 'or', operands };
  }

  private parseAnd(): QueryNode {
    const operands = [this.parseUnary()];
    for (;;) {
      const next = this.peek();
      if (!next || next.type === ')' || next.type === '|') break;
      if (next.type === '&') this.index += 1;
      operands.push(this.parseUnary());
    }
    return operands.length === 1 ? operands[0]! : { type: 'and', operands };
  }

  private parseUnary(): QueryNode {
    const token = this.peek();
    if (token?.type === 'not') {
      this.index += 1;
      return { type: 'not', operand: this.nested(() => this.parseUnary(), token.pos) };
    }
    return this.parsePrimary();
  }

  private nested(parse: () => QueryNode, pos: number): QueryNode {
    this.depth += 1;
    if (this.depth > QUERY_MAX_DEPTH) fail(this.source, pos, `nesting deeper than ${QUERY_MAX_DEPTH}`);
    try {
      return parse();
    } finally {
      this.depth -= 1;
    }
  }

  private parsePrimary(): QueryNode {
    const token = this.peek();
    if (!token) return fail(this.source, this.endPos(), 'expected a term, phrase, field filter or (');
    switch (token.type) {
      case 'word':
        this.index += 1;
        return { type: 'term', value: token.value.toLowerCase(), phrase: false };
      case 'phrase':
        this.index += 1;
        return { type: 'term', value: token.value.toLowerCase(), phrase: true };
      case 'field':
        this.index += 1;
        return { type: 'field', field: token.field, value: token.value.toLowerCase() };
      case '(': {
        this.index += 1;
        if (this.peek()?.type === ')') fail(this.source, this.peek()!.pos, 'empty parentheses');
        const inner = this.nested(() => this.parseOr(), token.pos);
        if (this.peek()?.type !== ')') fail(this.source, token.pos, "unclosed '('");
        this.index += 1;
        return inner;
      }
      case ')':
        return fail(this.source, token.pos, "unexpected ')'");
      case '|':
      case '&':
        return fail(this.source, token.pos, `operator '${token.type}' needs an operand before it`);
      case 'not':
        return this.parseUnary();
    }
  }
}

/**
 * 解析表达式。空白或空串返回 null（表示不过滤）；非法输入抛 `SWARM_INVALID_INPUT`，
 * 消息与 details.position 指出出错位置。
 */
export function parseQuery(source: string): QueryNode | null {
  if (source.length > QUERY_MAX_LENGTH) {
    fail(source, QUERY_MAX_LENGTH, `query longer than ${QUERY_MAX_LENGTH} characters`);
  }
  const tokens = tokenize(source);
  if (tokens.length === 0) return null;
  return new Parser(source, tokens).parse();
}

/** 判断记录是否满足表达式；node 为 null 时恒真。 */
export function matchQuery(node: QueryNode | null, subject: QuerySubject): boolean {
  if (node === null) return true;
  const text = subject.text.toLowerCase();
  const visit = (current: QueryNode): boolean => {
    switch (current.type) {
      case 'term':
        return text.includes(current.value);
      case 'field': {
        const values = subject.fields?.[current.field] ?? [];
        return values.some((raw) => {
          if (typeof raw !== 'string') return false;
          const value = raw.toLowerCase();
          return current.field === 'kind' ? value === current.value : value.includes(current.value);
        });
      }
      case 'not':
        return !visit(current.operand);
      case 'and':
        return current.operands.every(visit);
      case 'or':
        return current.operands.some(visit);
    }
  };
  return visit(node);
}

/** 解析一次，返回可复用的谓词；适合在一页记录上反复匹配。 */
export function compileQuery(source: string | null | undefined): (subject: QuerySubject) => boolean {
  const node = source === null || source === undefined ? null : parseQuery(source);
  return (subject) => matchQuery(node, subject);
}

export interface QueryPage<T> {
  items: T[];
  /** 全部命中条数（不受 limit 影响）。 */
  total: number;
  /** 命中超过本页返回范围时为 true。 */
  truncated: boolean;
}

/** 在完整历史上过滤并按 offset/limit 截取一页，同时给出总命中数与截断标志。 */
export function searchPage<T>(
  items: Iterable<T>,
  predicate: (item: T) => boolean,
  options: { limit: number; offset?: number },
): QueryPage<T> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(0, options.limit);
  const page: T[] = [];
  let total = 0;
  for (const item of items) {
    if (!predicate(item)) continue;
    if (total >= offset && page.length < limit) page.push(item);
    total += 1;
  }
  return { items: page, total, truncated: total > offset + page.length };
}
