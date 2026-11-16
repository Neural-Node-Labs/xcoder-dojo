// xcoder:version 1 | xcoder:task task-f1d1f4 | xcoder:updated 2026-11-16T09:33:52.950Z | xcoder:subtask code-st-1de5aa
/**
 * Entry point. Builds the demo bridge and mounts the shell inside the provider.
 * The bridge is created once and passed down; no component constructs its own
 * privileged channel.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDemoBridge } from './backend/demo-bridge';
import { AppProvider } from './ui/AppProvider';
import { App } from './ui/App';
import './ui/styles.css';

const bridge = createDemoBridge({ autoConfigureModel: true });
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container not found');
}

createRoot(container).render(
  <StrictMode>
    <AppProvider bridge={bridge}>
      <App />
    </AppProvider>
  </StrictMode>,
);
