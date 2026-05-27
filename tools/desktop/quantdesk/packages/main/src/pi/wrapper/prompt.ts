import fs from 'node:fs';

import type { PiSendMessageInput } from '../types';
import {
  QUANTDESK_ATTACHMENT_CONTEXT_END,
  QUANTDESK_ATTACHMENT_CONTEXT_START,
} from './transcript';

type PiPromptImage = {
  data: string;
  mimeType: string;
  type: 'image';
};

const MAX_ATTACHMENT_PROMPT_CHARS = 100_000;

const formatAttachmentSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (size >= 1024) {
    return `${Math.ceil(size / 1024)} KB`;
  }

  return `${size} B`;
};

export const buildPromptWithAttachments = (input: PiSendMessageInput) => {
  const attachments = input.attachments ?? [];
  const images: PiPromptImage[] = [];
  const contextBlocks: string[] = [];
  let remainingDocumentChars = MAX_ATTACHMENT_PROMPT_CHARS;

  attachments.forEach((attachment) => {
    if (attachment.kind === 'image') {
      images.push({
        data: fs.readFileSync(attachment.path).toString('base64'),
        mimeType: attachment.mimeType,
        type: 'image',
      });
      contextBlocks.push(`- Image: ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`);
      return;
    }

    if (remainingDocumentChars <= 0) {
      contextBlocks.push(`- Document skipped because attachment context is full: ${attachment.name}`);
      return;
    }

    const raw = fs.readFileSync(attachment.path, 'utf8').split('\u0000').join('');
    const slice = raw.slice(0, remainingDocumentChars);
    const truncated = raw.length > slice.length;

    remainingDocumentChars -= slice.length;
    contextBlocks.push([
      `- Document: ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`,
      '```',
      slice,
      truncated ? '```\n[Attachment truncated by QuantDesk.]' : '```',
    ].join('\n'));
  });

  if (contextBlocks.length === 0) {
    return { images, message: input.message };
  }

  return {
    images,
    message: [
      input.message,
      '',
      QUANTDESK_ATTACHMENT_CONTEXT_START,
      'QuantDesk attachments:',
      ...contextBlocks,
      QUANTDESK_ATTACHMENT_CONTEXT_END,
    ].join('\n'),
  };
};
