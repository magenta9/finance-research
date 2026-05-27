import type { DataServices } from '../db/services';
import type { ContractBinder } from './contract-binder';

export const createSettingsHandlers = (services: DataServices) => ({
  get: (key: string) => services.repositories.preferencesRepository.get(key),
  getAll: () => services.repositories.preferencesRepository.getAll(),
  set: (key: string, value: string) =>
    services.repositories.preferencesRepository.set(key, value),
  delete: (key: string) => services.repositories.preferencesRepository.delete(key),
});

export const registerSettingsIpc = (binder: ContractBinder, services: DataServices) => {
  binder.registerInvokeNamespace('settings', createSettingsHandlers(services));
};
