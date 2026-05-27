import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'vitest';

import {
  attachPiJsonlReader,
  parsePiWrapperMessage,
  serializePiWrapperMessage,
} from './protocol';

describe('pi wrapper protocol', () => {
  test('serializes and parses wrapper requests', () => {
    const line = serializePiWrapperMessage({
      id: '1',
      kind: 'request',
      method: 'health',
      params: undefined,
    });

    expect(parsePiWrapperMessage(line.trim())).toMatchObject({
      id: '1',
      kind: 'request',
      method: 'health',
    });
  });

  test('uses strict newline splitting and preserves unicode separators inside JSON strings', () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const detach = attachPiJsonlReader(stream, (line) => {
      lines.push(line);
    });

    stream.write('{"kind":"notification","event":"message_delta","params":{"type":"message_delta","delta":"a\u2028b"}}\n');
    stream.write('{"kind":"response","id":"1","ok":true,"result":{"ok":true}}\n');
    stream.end();
    detach();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('a\u2028b');
    expect(lines[1]).toContain('"id":"1"');
  });
});