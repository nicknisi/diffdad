import { describe, expect, it } from 'vitest';
import { normalizeSession } from '../normalize';

describe('normalizeSession', () => {
  it('extracts user, assistant, and tool events and skips malformed lines', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Add rate limiting to the API' } }),
      '{ this is not json',
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'planning' },
            { type: 'text', text: 'On it.' },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/api.ts', description: 'add limiter' } },
          ],
        },
      }),
      '',
    ].join('\n');

    const events = normalizeSession(jsonl);
    expect(events).toEqual([
      { kind: 'user', text: 'Add rate limiting to the API' },
      { kind: 'assistant', markdown: 'On it.' },
      { kind: 'tool', tool: 'Edit', title: 'add limiter', filePath: 'src/api.ts' },
    ]);
  });

  it('reads text parts from array user content and drops tool_result noise', () => {
    const jsonl = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the failing test' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'ok', tool_use_id: 'x' }] },
      }),
    ].join('\n');

    const events = normalizeSession(jsonl);
    expect(events).toEqual([{ kind: 'user', text: 'Fix the failing test' }]);
  });

  it('returns [] for empty input', () => {
    expect(normalizeSession('')).toEqual([]);
  });
});
