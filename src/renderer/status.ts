// ============================================================================
// Status Management (connection indicator and text in the title bar)
// ============================================================================

import { refreshBtn, statusIndicator, statusText } from './elements';
import { t } from './i18n';
import { state } from './state';

/**
 * Sets the connection status shown in the title bar (indicator colour and
 * text), keeps `state.isConnected` in sync, and enables the Refresh button
 * only while connected.
 * @param {'disconnected' | 'connecting' | 'connected' | 'error'} status - The
 *   new connection status.
 * @param {string} [message] - For 'connected', the controller URL (its host
 *   is displayed); for 'error', the localized error text to display.
 */
export function setStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) {
  statusIndicator.className = 'status-indicator';

  switch (status) {
    case 'disconnected':
      statusText.textContent = t('disconnected');
      state.isConnected = false;
      break;
    case 'connecting':
      statusIndicator.classList.add('connecting');
      statusText.textContent = t('connecting');
      break;
    case 'connected': {
      statusIndicator.classList.add('connected');
      // Show server URL (extract hostname from URL, falling back to the raw
      // string if it is not a parseable URL)
      let serverDisplay = t('connected');
      if (message) {
        try {
          serverDisplay = new URL(message).host;
        } catch {
          serverDisplay = message;
        }
      }
      statusText.textContent = serverDisplay;
      state.isConnected = true;
      break;
    }
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = message || t('error');
      state.isConnected = false;
      break;
  }

  // Refresh is only meaningful with a live connection
  refreshBtn.disabled = status !== 'connected';
} // End of function setStatus()
