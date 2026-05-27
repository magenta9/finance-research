import { asString, isRecord } from '@quantdesk/shared/type-guards';

import type { PiWrapperSessionTranscript, PiWrapperTranscriptMessage } from '../types';

type TranscriptPhase = 'assistant' | 'thinking';

export const QUANTDESK_ATTACHMENT_CONTEXT_START = '<quantdesk_attachment_context>';
export const QUANTDESK_ATTACHMENT_CONTEXT_END = '</quantdesk_attachment_context>';

const joinContentParts = (parts: string[]): string => parts.filter((part) => part.trim().length > 0).join('\n');

export const stripQuantDeskAttachmentContext = (content: string): string => {
  let result = content;

  while (result.includes(QUANTDESK_ATTACHMENT_CONTEXT_START)) {
    const start = result.indexOf(QUANTDESK_ATTACHMENT_CONTEXT_START);
    const end = result.indexOf(QUANTDESK_ATTACHMENT_CONTEXT_END, start);

    if (end < 0) {
      result = result.slice(0, start).trimEnd();
      break;
    }

    result = `${result.slice(0, start)}${result.slice(end + QUANTDESK_ATTACHMENT_CONTEXT_END.length)}`;
  }

  return result.trim();
};

const normalizeVisibleText = (content: string) => stripQuantDeskAttachmentContext(content);

const extractVisibleContent = (
  content: unknown,
  phaseHint?: TranscriptPhase,
): { assistant: string; thinking: string } => {
  if (typeof content === 'string') {
    const visibleContent = normalizeVisibleText(content);

    return phaseHint === 'thinking'
      ? { assistant: '', thinking: visibleContent }
      : { assistant: visibleContent, thinking: '' };
  }

  if (!Array.isArray(content)) {
    return { assistant: '', thinking: '' };
  }

  const assistantParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const entry of content) {
    if (!isRecord(entry)) {
      continue;
    }

    if (entry.type === 'text') {
      const text = normalizeVisibleText(asString(entry.text));

      if (!text) {
        continue;
      }

      if (phaseHint === 'thinking') {
        thinkingParts.push(text);
      } else {
        assistantParts.push(text);
      }

      continue;
    }

    if (entry.type === 'image') {
      if (phaseHint === 'thinking') {
        thinkingParts.push('[image]');
      } else {
        assistantParts.push('[image]');
      }

      continue;
    }

    if (entry.type === 'thinking') {
      const thinking = normalizeVisibleText(asString(entry.thinking) || asString(entry.text) || asString(entry.content));

      if (thinking) {
        thinkingParts.push(thinking);
      }
    }
  }

  return {
    assistant: joinContentParts(assistantParts),
    thinking: joinContentParts(thinkingParts),
  };
};

const normalizePiTranscriptMessage = (
  sessionId: string,
  message: unknown,
  index: number,
): PiWrapperTranscriptMessage[] => {
  const record = isRecord(message) ? message : {};
  const nestedMessage = isRecord(record.message) ? record.message : null;
  const payload = nestedMessage ?? record;
  const errorMessage = asString(record.errorMessage) || asString(payload.errorMessage);
  const phase = asString(record.phase) || asString(payload.phase);
  const stopReason = asString(record.stopReason) || asString(payload.stopReason);
  const phaseHint = phase === 'assistant' || phase === 'thinking' ? phase : undefined;
  const extractedContent = extractVisibleContent(payload.content ?? record.content, phaseHint);
  const rawFallbackContent =
    asString(record.output)
    || asString(payload.output)
    || asString(record.summary)
    || asString(payload.summary)
    || errorMessage;
  const fallbackContent = rawFallbackContent ? normalizeVisibleText(rawFallbackContent) : rawFallbackContent;
  const id = asString(record.id) || asString(payload.id) || `${sessionId}:message:${index}`;
  const isError = Boolean(record.isError || payload.isError || stopReason === 'error' || errorMessage);
  const role = asString(payload.role) || asString(record.role) || 'unknown';
  const toolCallId = asString(record.toolCallId) || asString(payload.toolCallId) || undefined;
  const toolName = asString(record.toolName) || asString(payload.toolName) || asString(payload.name) || undefined;
  const buildMessage = (
    content: string,
    contentPhase?: TranscriptPhase,
    allowEmpty = false,
  ): PiWrapperTranscriptMessage | null => {
    if (!allowEmpty && content.trim().length === 0) {
      return null;
    }

    return {
      content,
      id,
      isError,
      phase: contentPhase,
      raw: message,
      role,
      toolCallId,
      toolName,
    };
  };

  if (role !== 'assistant') {
    const content = extractedContent.assistant || extractedContent.thinking || fallbackContent;
    const normalizedMessage = buildMessage(content, phaseHint, isError);
    return normalizedMessage ? [normalizedMessage] : [];
  }

  if (phaseHint) {
    const content = phaseHint === 'thinking'
      ? extractedContent.thinking || extractedContent.assistant || fallbackContent
      : extractedContent.assistant || extractedContent.thinking || fallbackContent;
    const normalizedMessage = buildMessage(content, phaseHint, isError);
    return normalizedMessage ? [normalizedMessage] : [];
  }

  const normalizedMessages: PiWrapperTranscriptMessage[] = [];
  const thinkingMessage = buildMessage(extractedContent.thinking, 'thinking');

  if (thinkingMessage) {
    normalizedMessages.push(thinkingMessage);
  }

  const assistantMessage = buildMessage(
    extractedContent.assistant || fallbackContent,
    'assistant',
    isError && normalizedMessages.length === 0,
  );

  if (assistantMessage) {
    normalizedMessages.push(assistantMessage);
  }

  return normalizedMessages;
};

const buildAssistantSnapshotKey = (message: PiWrapperTranscriptMessage): string | null => {
  if (message.role !== 'assistant') {
    return null;
  }

  return `${message.id}:${message.phase ?? 'assistant'}`;
};

export const normalizePiTranscriptMessages = (
  sessionId: string,
  messages: unknown[],
): PiWrapperTranscriptMessage[] => {
  const normalizedMessages: PiWrapperTranscriptMessage[] = [];

  for (const [index, message] of (Array.isArray(messages) ? messages : []).entries()) {
    normalizedMessages.push(...normalizePiTranscriptMessage(sessionId, message, index));
  }

  const dedupedMessages: PiWrapperTranscriptMessage[] = [];
  const assistantSnapshotIndexes = new Map<string, number>();

  for (const message of normalizedMessages) {
    const assistantSnapshotKey = buildAssistantSnapshotKey(message);

    if (!assistantSnapshotKey) {
      dedupedMessages.push(message);
      continue;
    }

    const existingIndex = assistantSnapshotIndexes.get(assistantSnapshotKey);

    if (existingIndex == null) {
      assistantSnapshotIndexes.set(assistantSnapshotKey, dedupedMessages.length);
      dedupedMessages.push(message);
      continue;
    }

    const existingMessage = dedupedMessages[existingIndex];
    dedupedMessages[existingIndex] = {
      ...existingMessage,
      ...message,
      content: message.content || existingMessage.content,
      isError: Boolean(existingMessage.isError || message.isError),
      raw: message.raw ?? existingMessage.raw,
      toolCallId: message.toolCallId ?? existingMessage.toolCallId,
      toolName: message.toolName ?? existingMessage.toolName,
    };
  }

  return dedupedMessages;
};

export const getPiTranscriptTerminalMessage = (transcript: PiWrapperSessionTranscript): PiWrapperTranscriptMessage | null => {
  for (let index = transcript.messages.length - 1; index >= 0; index -= 1) {
    const message = transcript.messages[index];

    if (message.content.trim().length > 0 || message.isError) {
      return message;
    }
  }

  return null;
};

export const hasPiTranscriptTerminalAssistantResponse = (transcript: PiWrapperSessionTranscript): boolean => {
  const message = getPiTranscriptTerminalMessage(transcript);

  return Boolean(message && message.role === 'assistant' && !message.isError && message.content.trim().length > 0);
};

export const getPiTranscriptFailureMessage = (transcript: PiWrapperSessionTranscript): string | null => {
  const message = getPiTranscriptTerminalMessage(transcript);

  if (!message?.isError) {
    return null;
  }

  const content = message.content.trim();
  return content.length > 0 ? content : 'Pi run failed without an error message.';
};
