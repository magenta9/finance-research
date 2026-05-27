import { createRequire } from 'node:module';

const require = createRequire(__filename);

export interface SecretStore {
  get: (service: string, account: string) => Promise<string | null>;
  set: (service: string, account: string, password: string) => Promise<void>;
  delete: (service: string, account: string) => Promise<void>;
  isAvailable: () => boolean;
  maskSecret: (value: string | null | undefined) => string | null;
}

export interface KeytarLike {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (
    service: string,
    account: string,
    password: string,
  ) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

const loadKeytar = (): KeytarLike => {
  const resolved = require('keytar') as KeytarLike | { default: KeytarLike };

  return ('default' in resolved ? resolved.default : resolved) as KeytarLike;
};

const defaultMaskSecret = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}****`;
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

export const createSecretStore = (adapter?: KeytarLike): SecretStore => {
  let resolvedAdapter = adapter;

  if (!resolvedAdapter) {
    try {
      resolvedAdapter = loadKeytar();
    } catch (error) {
      void error;
      resolvedAdapter = undefined;
    }
  }

  return {
    async get(service, account) {
      if (!resolvedAdapter) {
        return null;
      }

      return resolvedAdapter.getPassword(service, account);
    },
    async set(service, account, password) {
      if (!resolvedAdapter) {
        throw new Error('当前环境不可用 keytar，无法保存密钥。');
      }

      await resolvedAdapter.setPassword(service, account, password);
    },
    async delete(service, account) {
      if (!resolvedAdapter) {
        return;
      }

      await resolvedAdapter.deletePassword(service, account);
    },
    isAvailable() {
      return Boolean(resolvedAdapter);
    },
    maskSecret(value) {
      return defaultMaskSecret(value);
    },
  };
};
