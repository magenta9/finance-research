import type { QuantdeskApi } from '@quantdesk/shared/types/api';

declare global {
  interface Window {
    api: QuantdeskApi;
  }
}

export { };
