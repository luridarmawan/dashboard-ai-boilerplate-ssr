import { describe, expect, test } from 'bun:test';
import {
  normalizeUsage,
  type ProviderMessage,
  parseResponsesEvent,
  readResponsesReply,
  toResponsesInput,
  toResponsesTools,
} from '../api/responses.ts';

/**
 * Unit (no DB, no app): the chat ⇄ Responses translation of AI-Roadmap F2. The shapes asserted
 * here were observed on a live provider (§12), so these cases are a record of what the wire
 * really looks like as much as they are a test.
 */

describe('toResponsesInput', () => {
  test('system turns become instructions; user and assistant text become input items', () => {
    const { instructions, input } = toResponsesInput([
      { role: 'system', content: 'Jadilah ringkas.' },
      { role: 'user', content: 'halo' },
      { role: 'assistant', content: 'hai' },
    ]);
    expect(instructions).toBe('Jadilah ringkas.');
    expect(input).toEqual([
      { type: 'message', role: 'user', content: 'halo' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hai' }] },
    ]);
  });

  test('the tool round-trip becomes function_call + function_call_output on the same call_id', () => {
    // This is the mapping with no counterpart in Responses: there is no `tool` role.
    const convo: ProviderMessage[] = [
      { role: 'user', content: 'cuaca Jakarta?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Jakarta"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"tempC":31}' },
    ];
    expect(toResponsesInput(convo).input).toEqual([
      { type: 'message', role: 'user', content: 'cuaca Jakarta?' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"Jakarta"}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: '{"tempC":31}' },
    ]);
  });

  test('an attachment turn becomes input_text + input_image parts (H-11)', () => {
    const { input } = toResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'apa ini?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ]);
    expect(input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'apa ini?' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
        ],
      },
    ]);
  });

  test('a tool reply with no call id is dropped rather than sent unaddressed', () => {
    const { input } = toResponsesInput([{ role: 'tool', content: 'yatim' }]);
    expect(input).toEqual([]);
  });

  test('tools lose the nested `function` wrapper', () => {
    expect(
      toResponsesTools([
        { type: 'function', function: { name: 'ping', description: 'p', parameters: { a: 1 } } },
      ]),
    ).toEqual([{ type: 'function', name: 'ping', description: 'p', parameters: { a: 1 } }]);
  });
});

describe('normalizeUsage (§5.1a)', () => {
  test('exclusive provider: reasoning sits outside output_tokens and is added', () => {
    // Exactly the numbers the live provider returned (§12 no. 4).
    expect(
      normalizeUsage({
        input_tokens: 67,
        output_tokens: 56,
        output_tokens_details: { reasoning_tokens: 53, text_tokens: 56 },
      }),
    ).toEqual({ usage: { prompt_tokens: 67, completion_tokens: 109 }, reasoningTokens: 53 });
  });

  test('inclusive provider: output_tokens already contains the reasoning, so it is left alone', () => {
    expect(
      normalizeUsage({
        input_tokens: 10,
        output_tokens: 56,
        output_tokens_details: { reasoning_tokens: 53, text_tokens: 3 },
      }),
    ).toEqual({ usage: { prompt_tokens: 10, completion_tokens: 56 }, reasoningTokens: 53 });
  });

  test('no details: the provider headline number is trusted as-is', () => {
    expect(normalizeUsage({ input_tokens: 4, output_tokens: 9 })).toEqual({
      usage: { prompt_tokens: 4, completion_tokens: 9 },
      reasoningTokens: null,
    });
  });

  test('chat-shaped usage still reads', () => {
    expect(normalizeUsage({ prompt_tokens: 2, completion_tokens: 3 }).usage).toEqual({
      prompt_tokens: 2,
      completion_tokens: 3,
    });
  });

  test('nothing usable', () => {
    expect(normalizeUsage(null)).toEqual({ usage: null, reasoningTokens: null });
  });
});

describe('readResponsesReply', () => {
  test('output_text is preferred, and function calls come out chat-shaped', () => {
    const r = readResponsesReply({
      output_text: 'pong',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_9',
          name: 'get_weather',
          arguments: '{"city":"Jakarta"}',
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(r.content).toBe('pong');
    expect(r.toolCalls).toEqual([
      {
        id: 'call_9',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Jakarta"}' },
      },
    ]);
    expect(r.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2 });
  });

  test('without output_text the message parts are walked instead', () => {
    expect(
      readResponsesReply({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'ha' },
              { type: 'output_text', text: 'lo' },
            ],
          },
        ],
      }).content,
    ).toBe('halo');
  });
});

describe('parseResponsesEvent', () => {
  test('only output_text.delta is answer text — the reasoning summary is NOT', () => {
    // The regression this guards: reasoning_summary_text.delta arrives first in a real turn.
    expect(
      parseResponsesEvent('{"type":"response.reasoning_summary_text.delta","delta":"pikir dulu"}'),
    ).toEqual({});
    expect(
      parseResponsesEvent(
        '{"type":"response.output_text.delta","item_id":"m1","output_index":1,"delta":"pong"}',
      ),
    ).toEqual({ text: 'pong' });
  });

  test('bookkeeping events contribute nothing', () => {
    for (const type of [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.done',
      'response.reasoning_summary_part.added',
    ]) {
      expect(parseResponsesEvent(JSON.stringify({ type }))).toEqual({});
    }
  });

  test('a finished function_call item becomes a tool call', () => {
    expect(
      parseResponsesEvent(
        '{"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_2","name":"ping","arguments":"{}"}}',
      ),
    ).toEqual({
      toolCall: { id: 'call_2', type: 'function', function: { name: 'ping', arguments: '{}' } },
    });
  });

  test('a finished message item is not a tool call', () => {
    expect(
      parseResponsesEvent('{"type":"response.output_item.done","item":{"type":"message"}}'),
    ).toEqual({});
  });

  test('response.completed carries the usage', () => {
    const ev = parseResponsesEvent(
      '{"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":7,"output_tokens_details":{"reasoning_tokens":4,"text_tokens":7}}}}',
    );
    expect(ev.done).toBe(true);
    expect(ev.usage).toEqual({ prompt_tokens: 5, completion_tokens: 11 });
    expect(ev.reasoningTokens).toBe(4);
  });

  test('an error event is surfaced, junk is ignored', () => {
    expect(parseResponsesEvent('{"type":"error","error":{"message":"kuota habis"}}').error).toBe(
      'kuota habis',
    );
    expect(parseResponsesEvent('bukan json')).toEqual({});
    expect(parseResponsesEvent('[DONE]')).toEqual({ done: true });
  });
});
