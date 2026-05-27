import type { SecretStore } from './store';

export const createNullSecretStore = (): SecretStore => ({
  async delete() {
    return;
  },
  async get() {
    return null;
  },
  isAvailable() {
    return false;
  },
  maskSecret(value) {
    return value ? '****' : null;
  },
  async set() {
    throw new Error('Null secret store cannot persist secrets.');
  },
});