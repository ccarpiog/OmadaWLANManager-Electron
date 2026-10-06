// ============================================================================
// Header bar status: the connection state (indicator colour + text), the
// connected controller's host and site, the "Updated hh:mm" time of the last
// successful load (or "Refreshing…" while a refresh runs) and the controller
// version
// ============================================================================

import {
  controllerHostText,
  controllerVersionText,
  lastUpdatedText,
  refreshBtn,
  siteNameText,
  statusIndicator,
  statusText,
} from './elements';
import { t, tFormat } from './i18n';
import { state } from './state';

/**
 * Sets the connection status shown in the header (indicator colour and
 * text), keeps `state.isConnected` and `state.controllerHost` in sync,
 * enables the Refresh button only while connected, and re-renders the header
 * details (see renderHeaderMeta()).
 * @param {'disconnected' | 'connecting' | 'connected' | 'error'} status - The
 *   new connection status.
 * @param {string} [message] - For 'connected', the controller URL (its host
 *   is displayed next to the site); for 'error', the localized error text to
 *   display.
 */
export function setStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', message?: string) {
  statusIndicator.className = 'status-indicator';

  switch (status) {
    case 'disconnected':
      statusText.textContent = t('disconnected');
      state.isConnected = false;
      state.controllerHost = null;
      break;
    case 'connecting':
      statusIndicator.classList.add('connecting');
      statusText.textContent = t('connecting');
      state.controllerHost = null;
      break;
    case 'connected': {
      statusIndicator.classList.add('connected');
      statusText.textContent = t('connected');
      // The controller's host (extracted from its URL, falling back to the
      // raw string if it is not a parseable URL)
      let host: string | null = null;
      if (message) {
        try {
          host = new URL(message).host;
        } catch {
          host = message;
        }
      }
      state.controllerHost = host;
      state.isConnected = true;
      break;
    }
    case 'error':
      statusIndicator.classList.add('error');
      statusText.textContent = message || t('error');
      state.isConnected = false;
      state.controllerHost = null;
      break;
  }
  // The text may be ellipsized in a narrow window: the tooltip keeps it whole
  statusText.title = statusText.textContent ?? '';

  // Refresh is only meaningful with a live connection
  refreshBtn.disabled = status !== 'connected';
  renderHeaderMeta();
} // End of function setStatus()

/**
 * Formats a time of day as hh:mm (24-hour clock) in the active language.
 * @param {number} timestamp - Milliseconds since the epoch.
 * @returns {string} The formatted time, e.g. "10:42".
 */
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(state.currentLanguage, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}

/**
 * Shows or hides one header detail with the given text.
 * @param {HTMLElement} element - The header element.
 * @param {string | null} text - Its text, or null to hide it.
 */
function setHeaderDetail(element: HTMLElement, text: string | null): void {
  element.textContent = text ?? '';
  element.hidden = text === null;
}

/**
 * Re-renders the header details from the state: while connected, the site
 * name (when the renderer knows it — see state.siteName), the controller
 * host, "Updated hh:mm" of the last successful load ("Refreshing…" while a
 * refresh keeps the previous data on screen; a failed refresh brings the
 * previous time back) and "Omada <version>". Everything is hidden while not
 * connected. The load time is also exposed as `data-updated-at` (ms since
 * the epoch). Called by setStatus(), loadData() and applyTranslations().
 */
export function renderHeaderMeta(): void {
  const connected = state.isConnected;

  setHeaderDetail(siteNameText, connected && state.siteName !== null ? tFormat('siteLabel', { site: state.siteName }) : null);
  setHeaderDetail(controllerHostText, connected ? state.controllerHost : null);
  controllerHostText.title = t('controllerHostTitle');

  const refreshing = state.isLoadingData && state.lastUpdatedAt !== null;
  if (!connected || state.lastUpdatedAt === null) {
    setHeaderDetail(lastUpdatedText, null);
    delete lastUpdatedText.dataset.updatedAt;
  } else {
    setHeaderDetail(lastUpdatedText, refreshing ? t('refreshing') : tFormat('updatedAt', { time: formatTime(state.lastUpdatedAt) }));
    lastUpdatedText.dataset.updatedAt = String(state.lastUpdatedAt);
  }
  lastUpdatedText.classList.toggle('is-refreshing', connected && refreshing);

  const version = connected ? state.controllerVersion : null;
  setHeaderDetail(controllerVersionText, version !== null ? tFormat('controllerVersionLabel', { version }) : null);
  controllerVersionText.title = t('controllerVersionTitle');
} // End of function renderHeaderMeta()
