import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  PiAttachmentRejection,
  PiStagedAttachment,
} from '@quantdesk/shared';

import type { PiResolvedAttachment, PiRuntimeDirectories } from './types';

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_TOTAL_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_DOCUMENT_BYTES = 1024 * 1024;

const imageMimeByExtension: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const textMimeByExtension: Record<string, string> = {
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
};

interface StoredPiAttachment extends PiStagedAttachment {
  stagedAt: string;
  storedFileName: string;
}

const attachmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getAttachmentRoot = (directories: PiRuntimeDirectories) => path.join(directories.workspaceDir, 'attachments');

const sanitizeFileName = (name: string) => {
  const parsed = path.parse(path.basename(name));
  const base = parsed.name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'attachment';
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, '');

  return `${base}${ext}`;
};

const classifyFile = (filePath: string, size: number): Omit<PiStagedAttachment, 'id' | 'name' | 'size'> | null => {
  const extension = path.extname(filePath).toLowerCase();
  const imageMimeType = imageMimeByExtension[extension];

  if (imageMimeType) {
    if (size > MAX_IMAGE_BYTES) {
      throw new Error('图片不能超过 10MB。');
    }

    return { kind: 'image', mimeType: imageMimeType };
  }

  const textMimeType = textMimeByExtension[extension];

  if (textMimeType) {
    if (size > MAX_TEXT_DOCUMENT_BYTES) {
      throw new Error('文本文档不能超过 1MB。');
    }

    return { kind: 'text_document', mimeType: textMimeType };
  }

  return null;
};

const readStoredAttachment = (directories: PiRuntimeDirectories, attachmentId: string): PiResolvedAttachment => {
  if (!attachmentIdPattern.test(attachmentId)) {
    throw new Error('附件 id 无效。');
  }

  const attachmentDir = path.join(getAttachmentRoot(directories), attachmentId);
  const metadataPath = path.join(attachmentDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    throw new Error('附件已不存在，请重新选择文件。');
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as StoredPiAttachment;
  const storedFileName = sanitizeFileName(metadata.storedFileName);

  if (metadata.id !== attachmentId || storedFileName !== metadata.storedFileName) {
    throw new Error('附件元数据异常，请重新选择文件。');
  }

  const filePath = path.join(attachmentDir, storedFileName);

  if (!fs.existsSync(filePath)) {
    throw new Error('附件文件已不存在，请重新选择文件。');
  }

  const stats = fs.statSync(filePath);

  if (!stats.isFile() || stats.size !== metadata.size) {
    throw new Error('附件文件状态异常，请重新选择文件。');
  }

  return {
    id: metadata.id,
    kind: metadata.kind,
    mimeType: metadata.mimeType,
    name: metadata.name,
    path: filePath,
    size: metadata.size,
  };
};

export const createPiAttachmentService = ({
  getDirectories,
}: {
  getDirectories: () => Promise<PiRuntimeDirectories>;
}) => ({
  async discard(attachmentIds: string[]) {
    const directories = await getDirectories();
    const attachmentRoot = getAttachmentRoot(directories);

    attachmentIds.forEach((attachmentId) => {
      if (!attachmentIdPattern.test(attachmentId)) {
        return;
      }

      fs.rmSync(path.join(attachmentRoot, attachmentId), { force: true, recursive: true });
    });
  },

  async resolve(attachments: PiStagedAttachment[] | undefined): Promise<PiResolvedAttachment[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    if (attachments.length > MAX_TOTAL_ATTACHMENTS) {
      throw new Error(`一次最多附加 ${MAX_TOTAL_ATTACHMENTS} 个文件。`);
    }

    const directories = await getDirectories();
    const resolved = attachments.map((attachment) => readStoredAttachment(directories, attachment.id));
    const imageCount = resolved.filter((attachment) => attachment.kind === 'image').length;

    if (imageCount > MAX_IMAGE_ATTACHMENTS) {
      throw new Error(`一次最多附加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
    }

    return resolved;
  },

  async stageFilePaths(filePaths: string[]) {
    const directories = await getDirectories();
    const attachmentRoot = getAttachmentRoot(directories);
    const attachments: PiStagedAttachment[] = [];
    const rejected: PiAttachmentRejection[] = [];
    let imageCount = 0;

    fs.mkdirSync(attachmentRoot, { recursive: true });

    for (const filePath of filePaths.slice(0, MAX_TOTAL_ATTACHMENTS)) {
      const displayName = path.basename(filePath);

      try {
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) {
          rejected.push({ name: displayName, reason: '只能附加文件。' });
          continue;
        }

        const classification = classifyFile(filePath, stats.size);

        if (!classification) {
          rejected.push({ name: displayName, reason: '仅支持 PNG/JPEG/WebP/GIF 图片和 md/txt/csv/json/yaml/log 文本文档。' });
          continue;
        }

        if (classification.kind === 'image') {
          imageCount += 1;

          if (imageCount > MAX_IMAGE_ATTACHMENTS) {
            rejected.push({ name: displayName, reason: `一次最多附加 ${MAX_IMAGE_ATTACHMENTS} 张图片。` });
            continue;
          }
        }

        const id = crypto.randomUUID();
        const storedFileName = sanitizeFileName(displayName);
        const attachmentDir = path.join(attachmentRoot, id);
        const stagedFilePath = path.join(attachmentDir, storedFileName);
        const attachment: PiStagedAttachment = {
          id,
          kind: classification.kind,
          mimeType: classification.mimeType,
          name: displayName,
          size: stats.size,
        };
        const storedAttachment: StoredPiAttachment = {
          ...attachment,
          stagedAt: new Date().toISOString(),
          storedFileName,
        };

        fs.mkdirSync(attachmentDir, { recursive: true });
        fs.copyFileSync(filePath, stagedFilePath);
        fs.writeFileSync(path.join(attachmentDir, 'metadata.json'), JSON.stringify(storedAttachment, null, 2), 'utf8');
        attachments.push(attachment);
      } catch (error) {
        rejected.push({
          name: displayName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (filePaths.length > MAX_TOTAL_ATTACHMENTS) {
      rejected.push({
        name: `${filePaths.length - MAX_TOTAL_ATTACHMENTS} 个文件`,
        reason: `一次最多附加 ${MAX_TOTAL_ATTACHMENTS} 个文件。`,
      });
    }

    return { attachments, rejected };
  },
});
