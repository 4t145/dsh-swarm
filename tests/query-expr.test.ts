/**
 * query-expr 纯模块测试：词法、优先级、字段过滤、错误位置与分页。
 */

import { describe, expect, it } from 'vitest';
import { SwarmError } from '../src/errors.ts';
import { compileQuery, matchQuery, parseQuery, searchPage, type QuerySubject } from '../src/query-expr.ts';

const doc = (text: string, fields: QuerySubject['fields'] = {}): QuerySubject => ({ text, fields });

function matches(query: string, subject: QuerySubject): boolean {
  return compileQuery(query)(subject);
}

function errorOf(query: string): SwarmError {
  try {
    parseQuery(query);
  } catch (error) {
    expect(error).toBeInstanceOf(SwarmError);
    return error as SwarmError;
  }
  throw new Error(`expected '${query}' to fail`);
}

describe('parseQuery', () => {
  it('returns null for empty or blank input', () => {
    expect(parseQuery('')).toBeNull();
    expect(parseQuery('   ')).toBeNull();
    expect(matchQuery(null, doc('anything'))).toBe(true);
  });

  it('treats whitespace and & as AND, with OR binding looser', () => {
    expect(parseQuery('a b & c | d')).toEqual({
      type: 'or',
      operands: [
        {
          type: 'and',
          operands: [
            { type: 'term', value: 'a', phrase: false },
            { type: 'term', value: 'b', phrase: false },
            { type: 'term', value: 'c', phrase: false },
          ],
        },
        { type: 'term', value: 'd', phrase: false },
      ],
    });
  });

  it('parses NOT prefixes, phrases and field filters', () => {
    expect(parseQuery('-x !"Hello World" kind:Fact author:"Ada L"')).toEqual({
      type: 'and',
      operands: [
        { type: 'not', operand: { type: 'term', value: 'x', phrase: false } },
        { type: 'not', operand: { type: 'term', value: 'hello world', phrase: true } },
        { type: 'field', field: 'kind', value: 'fact' },
        { type: 'field', field: 'author', value: 'ada l' },
      ],
    });
  });

  it('keeps inner hyphens and unknown field prefixes as plain words', () => {
    expect(parseQuery('foo-bar')).toEqual({ type: 'term', value: 'foo-bar', phrase: false });
    expect(parseQuery('http://x')).toEqual({ type: 'term', value: 'http://x', phrase: false });
  });

  it.each([
    ['(a | b', 0, "unclosed '('"],
    ['a)', 1, "unmatched ')'"],
    ['a | ', 4, 'expected a term'],
    ['| a', 0, "operator '|'"],
    ['a & & b', 4, "operator '&'"],
    ['"abc', 0, 'unterminated quoted phrase'],
    ['()', 1, 'empty parentheses'],
    ['kind:', 5, "missing value for field 'kind:'"],
    ['x -', 3, 'expected a term'],
  ])('rejects %j at position %i', (query, position, problem) => {
    const error = errorOf(query);
    expect(error.code).toBe('SWARM_INVALID_INPUT');
    expect(error.message).toContain(`position ${position}`);
    expect(error.message).toContain(problem);
    expect(error.details).toMatchObject({ position });
  });

  it('rejects overly long and overly nested queries', () => {
    expect(errorOf('a'.repeat(501)).code).toBe('SWARM_INVALID_INPUT');
    expect(errorOf(`${'('.repeat(40)}a${')'.repeat(40)}`).message).toContain('nesting');
  });
});

describe('matchQuery', () => {
  const finding = doc('Build FAILS on Node 22\nsee details', {
    kind: ['fail'],
    author: ['swarm-w1', 'Ada'],
    task: ['task-123'],
  });

  it('matches case-insensitive substrings and phrases', () => {
    expect(matches('build', finding)).toBe(true);
    expect(matches('"fails on node"', finding)).toBe(true);
    expect(matches('"node fails"', finding)).toBe(false);
  });

  it('evaluates boolean operators and parentheses', () => {
    expect(matches('build & node', finding)).toBe(true);
    expect(matches('build missing', finding)).toBe(false);
    expect(matches('missing | node', finding)).toBe(true);
    expect(matches('build -node', finding)).toBe(false);
    expect(matches('build !missing', finding)).toBe(true);
    expect(matches('(missing | build) & -(other | nothing)', finding)).toBe(true);
    expect(matches('missing | build & other', finding)).toBe(false);
  });

  it('applies field filters: kind exact, author/task substring over any value', () => {
    expect(matches('kind:fail', finding)).toBe(true);
    expect(matches('kind:fa', finding)).toBe(false);
    expect(matches('author:ada', finding)).toBe(true);
    expect(matches('author:w1', finding)).toBe(true);
    expect(matches('task:123 kind:FAIL', finding)).toBe(true);
    expect(matches('kind:fact | kind:claim', finding)).toBe(false);
    expect(matches('-kind:fail', finding)).toBe(false);
    expect(matches('task:x', doc('task:x text'))).toBe(false);
  });
});

describe('searchPage', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it('returns bounded pages with total and truncation flag', () => {
    expect(searchPage(items, (n) => n % 2 === 0, { limit: 2 })).toEqual({ items: [0, 2], total: 5, truncated: true });
    expect(searchPage(items, (n) => n % 2 === 0, { limit: 2, offset: 4 })).toEqual({ items: [8], total: 5, truncated: false });
    expect(searchPage(items, () => true, { limit: 20 })).toEqual({ items, total: 10, truncated: false });
  });
});
