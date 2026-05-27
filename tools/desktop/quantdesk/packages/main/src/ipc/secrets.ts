import type { DataServices } from '../db/services';
import type { ContractBinder } from './contract-binder';

export const createSecretsHandlers = (services: DataServices) => ({
  get: (service: string, account: string) => services.secretStore.get(service, account),
  set: async (service: string, account: string, password: string) => {
    await services.secretStore.set(service, account, password);
  },
  delete: async (service: string, account: string) => {
    await services.secretStore.delete(service, account);
  },
});

export const registerSecretsIpc = (binder: ContractBinder, services: DataServices) => {
  binder.registerInvokeNamespace('secrets', createSecretsHandlers(services));
};
