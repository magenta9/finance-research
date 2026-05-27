import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createPiAttachmentService } from './attachments';

describe('createPiAttachmentService', () => {
  test('rejects staged metadata with an escaped stored file path', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-attachment-service-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const sourcePath = path.join(tempDir, 'notes.md');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(sourcePath, '# Notes\nKeep paths contained.');

    try {
      const service = createPiAttachmentService({
        getDirectories: async () => ({
          agentDir: path.join(tempDir, 'agent'),
          sessionDir: path.join(tempDir, 'sessions'),
          toolInvocationDir: path.join(tempDir, 'tools'),
          workspaceDir,
        }),
      });
      const staged = await service.stageFilePaths([sourcePath]);
      const attachment = staged.attachments[0]!;
      const metadataPath = path.join(workspaceDir, 'attachments', attachment.id, 'metadata.json');
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { storedFileName: string };
      fs.writeFileSync(metadataPath, JSON.stringify({
        ...metadata,
        storedFileName: '../outside.md',
      }), 'utf8');

      await expect(service.resolve([attachment])).rejects.toThrow('附件元数据异常');
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
