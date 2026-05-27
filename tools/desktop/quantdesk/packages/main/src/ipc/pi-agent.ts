import type { PiRiskGatePreferences } from '../pi/preferences';
import type { PiManager } from '../pi/manager';
import { createPiAgentHandlers, createUnavailablePiAgentHandlers } from '../pi/ipc-handlers';
import type { ContractBinder } from './contract-binder';

export const registerPiAgentIpc = (
  binder: ContractBinder,
  piManager: PiManager | undefined,
  riskGatePreferences: PiRiskGatePreferences,
) => {
  const handlers = piManager
    ? createPiAgentHandlers(piManager, riskGatePreferences)
    : createUnavailablePiAgentHandlers('Pi manager is not available.');

  binder.bindSubscription('piAgent', 'onStream', (listener) => handlers.subscribe(listener));
  binder.registerInvokeNamespace('piAgent', {
    cancelRun: handlers.cancelRun,
    deleteSession: handlers.deleteSession,
    discardAttachments: handlers.discardAttachments,
    getSession: handlers.getSession,
    getSessionTranscript: handlers.getSessionTranscript,
    listSessions: handlers.listSessions,
    listSkills: handlers.listSkills,
    stageAttachments: handlers.stageAttachments,
    sendMessage: handlers.sendMessage,
  });
};
