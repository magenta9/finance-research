import '@fontsource/noto-serif-sc/500.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-sans-sc/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/error-boundary';
import { ensureBrowserApi } from './dev/browser-api';
import { logger } from './lib/logger';
import './styles/index.css';

ensureBrowserApi();

window.addEventListener('error', (event) => {
  logger.error(
    'Uncaught error',
    event.error instanceof Error ? event.error : new Error(event.message),
    {
      colno: event.colno,
      filename: event.filename,
      lineno: event.lineno,
    },
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  logger.error('Unhandled promise rejection', error);
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
