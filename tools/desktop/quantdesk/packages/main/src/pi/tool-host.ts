import Ajv from 'ajv';

import {
  createFinanceHandlers,
  financeToolDefinitions,
  type FinanceCapabilityContext,
} from '../agent/capabilities/finance';
import type {
  PiFinanceToolStatus,
  PiToolHostExecuteRequest,
  PiToolHostExecuteResponse,
} from './types';

export interface PiToolHost {
  execute: (request: PiToolHostExecuteRequest) => Promise<PiToolHostExecuteResponse>;
  getStatus: () => PiFinanceToolStatus;
}

export const createPiToolHost = (context: FinanceCapabilityContext): PiToolHost => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const handlers = createFinanceHandlers(context);
  const validators = new Map(
    financeToolDefinitions.map((definition) => [definition.name, ajv.compile(definition.inputSchema)]),
  );
  let lastError: string | null = null;

  return {
    async execute(request) {
      const validate = validators.get(request.toolName);
      const handler = handlers[request.toolName];

      if (!validate || !handler) {
        lastError = `Unknown finance tool: ${request.toolName}`;
        throw new Error(lastError);
      }

      const args = request.args ?? {};

      if (!validate(args)) {
        const detail = ajv.errorsText(validate.errors, { separator: '; ' }) || 'invalid tool arguments';
        lastError = `Invalid arguments for ${request.toolName}: ${detail}`;
        const error = new Error(lastError);
        error.name = 'PiToolValidationError';
        throw error;
      }

      try {
        const payload = await handler(args);
        lastError = null;
        return { payload };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    getStatus() {
      return {
        available: financeToolDefinitions.length > 0,
        lastError,
        names: financeToolDefinitions.map((definition) => definition.name),
      };
    },
  };
};