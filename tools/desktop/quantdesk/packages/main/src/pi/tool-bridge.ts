import type { FinanceToolPayload } from '../agent/capabilities/finance';

export const buildPiToolResultText = (payload: FinanceToolPayload) =>
  JSON.stringify(payload, null, 2);

export const buildPiToolResult = (payload: FinanceToolPayload) => ({
  content: [{
    text: buildPiToolResultText(payload),
    type: 'text' as const,
  }],
  details: payload,
});

export const createPiToolProgressUpdate = (message: string, details?: unknown) => ({
  content: [{
    text: message,
    type: 'text' as const,
  }],
  details,
});