import { shell } from 'electron';

import type { PiRuntimeDirectoryTarget, PiRuntimeStatus } from '@quantdesk/shared';

import type { PiRiskGatePreferences } from '../pi/preferences';
import type { PiManager } from '../pi/manager';
import type { ContractBinder } from './contract-binder';

const createUnavailablePiRuntimeHandlers = (message: string) => ({
  acknowledgeHighPrivilegeRisk: async () => {
    throw new Error(message);
  },
  getRiskGateState: async () => {
    throw new Error(message);
  },
  getStatus: async () => {
    throw new Error(message);
  },
  openDirectory: async () => {
    throw new Error(message);
  },
});

const resolveDirectory = (status: PiRuntimeStatus, target: PiRuntimeDirectoryTarget) => status.directories[target];

export const createPiRuntimeHandlers = (
  piManager: PiManager,
  riskGatePreferences: PiRiskGatePreferences,
) => ({
  acknowledgeHighPrivilegeRisk: async () => riskGatePreferences.acknowledgeHighPrivilegeRisk(),
  getRiskGateState: async () => riskGatePreferences.getRiskGateState(),
  getStatus: async () => await piManager.getStatus(),
  openDirectory: async (target: PiRuntimeDirectoryTarget) => {
    const status = await piManager.getStatus();
    const error = await shell.openPath(resolveDirectory(status, target));

    if (error) {
      throw new Error(error);
    }
  },
});

export const registerPiRuntimeIpc = (
  binder: ContractBinder,
  piManager: PiManager | undefined,
  riskGatePreferences: PiRiskGatePreferences,
) => {
  const handlers = piManager
    ? createPiRuntimeHandlers(piManager, riskGatePreferences)
    : createUnavailablePiRuntimeHandlers('Pi manager is not available.');

  binder.registerInvokeNamespace('piRuntime', {
    acknowledgeHighPrivilegeRisk: handlers.acknowledgeHighPrivilegeRisk,
    getRiskGateState: handlers.getRiskGateState,
    getStatus: handlers.getStatus,
    openDirectory: handlers.openDirectory,
  });
};