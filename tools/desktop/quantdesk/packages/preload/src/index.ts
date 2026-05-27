import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import { createQuantdeskApi } from './api';

const api = createQuantdeskApi(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, ...args) => ipcRenderer.send(channel, ...args),
    (channel, listener) => {
        const wrappedListener = (_event: IpcRendererEvent, payload: unknown) => {
            listener(payload as never);
        };

        ipcRenderer.on(channel, wrappedListener);

        return () => {
            ipcRenderer.off(channel, wrappedListener);
        };
    },
);

contextBridge.exposeInMainWorld('api', api);

export { createQuantdeskApi } from './api';
