// ============================================================================
// Settings Modal
// ============================================================================

import type { ConfigSavePayload, Language } from '../shared/types';
import { applyTranslations } from './apply-translations';
import { connect } from './connection';
import {
  languageSelect,
  passwordInput,
  saveSettingsBtn,
  settingsModal,
  urlInput,
  usernameInput,
} from './elements';
import { setLanguage, t } from './i18n';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';

// Focus trap for the settings modal (installed on open, removed on close).
// The element that opened the modal (focus returns there on close) and the
// "opening" flag live in state.ts (state.settingsOpener and
// state.isSettingsOpening)
const settingsFocusTrap = createFocusTrap(settingsModal);

/**
 * Opens the settings modal populated from the stored config. The password
 * never reaches the renderer: the field is always shown empty, with an
 * "(unchanged)" placeholder when a password is already stored (leaving it
 * blank keeps the stored one, see saveSettings()). The "opening" flag and the
 * opener element are captured synchronously BEFORE the config-load await
 * (see state.isSettingsOpening); if that load fails, both are rolled back
 * and an error toast is shown. On success it installs the Tab focus trap and
 * makes the background app container inert.
 * @returns {Promise<void>}
 */
export async function openSettings(): Promise<void> {
  // While a connection attempt is in flight the Settings button is disabled;
  // this guard is the belt-and-braces for any other invocation path (a save
  // mid-connect could otherwise start a competing attempt)
  if (state.isConnecting) return;
  if (state.isSettingsOpening || settingsModal.classList.contains('visible')) return;
  // Reserve the modal and remember the opener before any await: re-entry is
  // now a no-op, and the opener can never be a modal-internal element
  state.isSettingsOpening = true;
  state.settingsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let config: Awaited<ReturnType<typeof window.omadaAPI.loadConfig>>;
  try {
    config = await window.omadaAPI.loadConfig();
  } catch (error) {
    // Roll back the reservation: the modal never opened
    console.error('Error loading configuration for the settings modal:', error);
    state.isSettingsOpening = false;
    state.settingsOpener = null;
    showToast(t('configLoadError'), 'error');
    return;
  }

  urlInput.value = config.url;
  usernameInput.value = config.username;
  passwordInput.value = '';
  passwordInput.placeholder = config.hasPassword ? t('passwordUnchanged') : '';
  languageSelect.value = config.language || 'es';
  document.addEventListener('keydown', settingsFocusTrap);
  settingsModal.classList.add('visible');
  updateBackgroundInert();
  state.isSettingsOpening = false;
  urlInput.focus();
} // End of function openSettings()

/**
 * Closes the settings modal (a no-op when it is not open), removes its Tab
 * focus trap, lifts the background inertness, and restores keyboard focus to
 * the element that opened it (in that order: focus cannot enter an inert
 * subtree). Covers every close path: the close/cancel buttons, the overlay
 * click, the Escape key, and the post-save close.
 */
export function closeSettings(): void {
  if (!settingsModal.classList.contains('visible')) return;
  settingsModal.classList.remove('visible');
  document.removeEventListener('keydown', settingsFocusTrap);
  updateBackgroundInert();
  state.settingsOpener?.focus();
  state.settingsOpener = null;
} // End of function closeSettings()

/**
 * Validates and normalizes the controller URL. Mirrors the main-process rules
 * (normalizeControllerUrl() in src/main/config.ts — keep both in sync): it
 * must parse, use HTTPS, and carry no embedded credentials or fragment; a
 * trailing slash is stripped.
 * @param {string} raw - The URL as typed by the user.
 * @returns {string | null} The normalized URL, or null when invalid.
 */
function validateControllerUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username || parsed.password || parsed.hash) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function validateControllerUrl()

/**
 * Validates the settings form and saves the configuration. The password is
 * sent to the main process ONLY when the user typed one: a blank field keeps
 * the previously stored (encrypted) password, and is a validation error when
 * no password is stored yet (the main process enforces both rules too). The
 * URL is validated/normalized here and again in the main process. A no-op
 * while any exclusive operation is pending (including a previous save still
 * in flight — e.g. Enter-key repeat); the Save button is disabled while
 * saving so it cannot double-submit.
 * @returns {Promise<void>}
 */
export async function saveSettings(): Promise<void> {
  if (isOperationInProgress()) return;
  state.isSavingSettings = true;
  saveSettingsBtn.disabled = true;
  // Session generation at save start: if a disconnect or another operation
  // supersedes the session while the save is awaiting, the auto-connect
  // below must not start
  const generation = state.sessionGeneration;
  // Set when the save succeeds: the auto-connect starts AFTER the in-flight
  // flag is released (connect() is itself guarded by isOperationInProgress())
  let connectAfterSave = false;

  try {
    const url = urlInput.value.trim();
    const username = usernameInput.value.trim();
    const typedPassword = passwordInput.value;

    if (!url || !username) {
      showToast(t('fillUrlAndUser'), 'error');
      return;
    }

    const normalizedUrl = validateControllerUrl(url);
    if (!normalizedUrl) {
      showToast(t('invalidUrl'), 'error');
      return;
    }

    if (!typedPassword) {
      const existingConfig = await window.omadaAPI.loadConfig();
      if (!existingConfig.hasPassword) {
        // Blank field and nothing stored: refuse to save an unusable config
        showToast(t('passwordRequired'), 'error');
        return;
      }
      // Blank field while editing: the main process keeps the stored password
    }

    const payload: ConfigSavePayload = {
      url: normalizedUrl,
      username,
      language: languageSelect.value as Language
    };
    // Send the password only when the user typed a new one
    if (typedPassword) {
      payload.password = typedPassword;
    }

    const result = await window.omadaAPI.saveConfig(payload);

    if (result.success) {
      // A usable configuration now exists: the empty states can suggest
      // connecting instead of configuring
      state.hasStoredConfig = true;

      // Apply language change
      setLanguage(payload.language);
      applyTranslations();

      closeSettings();
      connectAfterSave = true;
    } else if (result.error === 'invalidUrl') {
      showToast(t('invalidUrl'), 'error');
    } else if (result.error === 'passwordRequired') {
      showToast(t('passwordRequired'), 'error');
    } else {
      showToast(t('saveError'), 'error');
    }
  } finally {
    state.isSavingSettings = false;
    saveSettingsBtn.disabled = false;
  }

  // Auto-connect only when the save's session is still current and nothing
  // else is in flight: a save that completes after a disconnect (or after a
  // newer operation started) must not start a connection
  if (connectAfterSave && generation === state.sessionGeneration && !isOperationInProgress()) {
    // Auto-connect after saving (the main process reads its own stored
    // password; nothing credential-related comes from the renderer)
    connect();
  }
} // End of function saveSettings()
