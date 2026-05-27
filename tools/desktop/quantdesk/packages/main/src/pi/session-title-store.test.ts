import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { PiSessionTitleStore } from './session-title-store';
import type { PiRuntimeDirectories, PiWrapperSessionSummary } from './types';

const tempDirs: string[] = [];

const createDirectories = (): PiRuntimeDirectories => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-title-store-'));
  tempDirs.push(root);

  return {
    agentDir: path.join(root, 'agent'),
    sessionDir: path.join(root, 'sessions'),
    toolInvocationDir: path.join(root, 'tool-invocations'),
    workspaceDir: path.join(root, 'workspace'),
  };
};

const createSession = (patch: Partial<PiWrapperSessionSummary> = {}): PiWrapperSessionSummary => ({
  cwd: '/workspace',
  firstMessage: '分析今天的市场情绪',
  id: 'session-1',
  modifiedAt: '2026-04-27T00:00:00.000Z',
  name: null,
  path: '/workspace/session-1.jsonl',
  title: null,
  titleSource: 'placeholder',
  titleStatus: 'ready',
  titleUpdatedAt: null,
  ...patch,
});

describe('PiSessionTitleStore', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
  });

  test('persists generated metadata and resolves it for session summaries', () => {
    const directories = createDirectories();
    const store = new PiSessionTitleStore({ directories });

    store.update('session-1', {
      title: 'Fake Generated Title',
      titleSource: 'generated',
      titleStatus: 'ready',
      titleUpdatedAt: '2026-04-27T00:00:10.000Z',
    });

    const reloaded = new PiSessionTitleStore({ directories });

    expect(reloaded.resolveSessionSummary(createSession())).toMatchObject({
      title: 'Fake Generated Title',
      titleSource: 'generated',
      titleStatus: 'ready',
      titleUpdatedAt: '2026-04-27T00:00:10.000Z',
    });
  });
});
