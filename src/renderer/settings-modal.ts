// ============================================================================
// Settings Modal
// ============================================================================

import type { ConfigSavePayload, Language, RendererConfig } from '../shared/types';
import { applyTranslations } from './apply-translations';
import { connect, disconnect, handleConnectionReset } from './connection';
import {
  cancelCertResetBtn,
  cancelManagementRemoveBtn,
  cancelSettingsBtn,
  certPinValue,
  certResetConfirm,
  certResetMessage,
  clientIdInput,
  clientSecretInput,
  confirmCertResetBtn,
  connectBtn,
  languageSelect,
  managementRemovalNote,
  managementRemoveConfirm,
  managementSessionNote,
  passwordInput,
  removeManagementBtn,
  resetCertBtn,
  saveSettingsBtn,
  settingsModal,
  undoManagementRemovalBtn,
  urlInput,
  usernameInput,
} from './elements';
import { setLanguage, t, type Translations } from './i18n';
import { resetManagementTest } from './management';
import { clientSecretAffordance, planManagementSave, type ClientSecretAffordance, type ManagementFormError } from './management-form';
import { createFocusTrap, updateBackgroundInert } from './modal-focus';
import { isOperationInProgress, state } from './state';
import { showToast } from './toast';
import { isSameControllerUrl, isValidFingerprint, validateControllerUrl } from './validation';

// Focus trap for the settings modal (installed on open, removed on close).
// The element that opened the modal (focus returns there on close) and the
// "opening" flag live in state.ts (state.settingsOpener and
// state.isSettingsOpening)
const settingsFocusTrap = createFocusTrap(settingsModal);

/**
 * Opens the settings modal populated from the stored config. The password
 * never reaches the renderer: the field is always shown empty, with an
 * "(unchanged)" placeholder when a password is already stored (leaving it
 * blank keeps the stored one while the URL is unchanged, see
 * updatePasswordAffordance() and saveSettings()). The trusted-certificate
 * section shows the pinned fingerprint (or "none"). The "opening" flag and the
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
  state.settingsStoredUrl = config.url;
  state.settingsHasPassword = config.hasPassword;
  updatePasswordAffordance();
  languageSelect.value = config.language || 'es';
  renderCertificatePin(config.pinnedFingerprint);
  hideCertificateResetConfirm();
  loadManagementSection(config);
  document.addEventListener('keydown', settingsFocusTrap);
  settingsModal.classList.add('visible');
  updateBackgroundInert();
  state.isSettingsOpening = false;
  urlInput.focus();
} // End of function openSettings()

/**
 * Closes the settings modal (a no-op when it is not open), clears the typed
 * password and Client Secret, removes its Tab focus trap, lifts the
 * background inertness, and restores keyboard focus to
 * the element that opened it (in that order: focus cannot enter an inert
 * subtree). Covers every close path: the close/cancel buttons, the overlay
 * click, the Escape key, and the post-save close.
 */
export function closeSettings(): void {
  if (!settingsModal.classList.contains('visible')) return;
  settingsModal.classList.remove('visible');
  // A typed password or Client Secret never lingers in the DOM once the
  // modal is closed (saved or not)
  passwordInput.value = '';
  clientSecretInput.value = '';
  document.removeEventListener('keydown', settingsFocusTrap);
  updateBackgroundInert();
  state.settingsOpener?.focus();
  state.settingsOpener = null;
} // End of function closeSettings()

/**
 * Updates the password field's placeholder to what leaving it blank means
 * (credentials are URL-scoped, mirroring applyConfigSave() in
 * src/main/config-model.ts): "(unchanged)" only while a password is stored
 * AND the URL field still designates the stored controller URL; "(required
 * for the new URL)" when a password is stored but the URL was changed — the
 * stored password belongs to the old controller and is never reused; empty
 * when no password is stored. Called on open and on every URL edit.
 */
export function updatePasswordAffordance(): void {
  if (!state.settingsHasPassword) {
    passwordInput.placeholder = '';
  } else if (isSameControllerUrl(state.settingsStoredUrl, urlInput.value)) {
    passwordInput.placeholder = t('passwordUnchanged');
  } else {
    passwordInput.placeholder = t('passwordRequiredNewUrl');
  }
} // End of function updatePasswordAffordance()

// i18n key of each Client Secret placeholder (see clientSecretAffordance())
const CLIENT_SECRET_PLACEHOLDERS: Record<Exclude<ClientSecretAffordance, 'none'>, keyof Translations> = {
  unchanged: 'passwordUnchanged',
  requiredNewUrl: 'clientSecretRequiredNewUrl',
  requiredNewClientId: 'clientSecretRequiredNewClientId',
};

// i18n key of each management-access refusal (renderer- or main-side)
const MANAGEMENT_ERROR_KEYS: Record<ManagementFormError, keyof Translations> = {
  invalidClientId: 'invalidClientId',
  clientIdRequired: 'clientIdRequired',
  clientSecretRequired: 'clientSecretRequired',
};

/**
 * Fills the management-access section from the loaded config: the stored
 * Client ID in its field, the Client Secret field always empty (the secret
 * never reaches the renderer; only `hasClientSecret` does), the flags in
 * state, no removal staged, no confirmation open and no old "Test management
 * access" result. Values arriving over IPC are type-checked (a missing field
 * reads as "nothing stored").
 * @param {RendererConfig} config - The config from loadConfig().
 */
function loadManagementSection(config: RendererConfig): void {
  state.settingsClientId = typeof config.clientId === 'string' ? config.clientId : '';
  state.settingsHasClientSecret = config.hasClientSecret === true;
  state.settingsClientSecretSessionOnly = config.clientSecretSessionOnly === true;
  state.settingsCanPersistClientSecret = config.canPersistClientSecret !== false;
  state.settingsRemoveManagement = false;
  clientIdInput.value = state.settingsClientId;
  clientSecretInput.value = '';
  managementRemoveConfirm.hidden = true;
  resetManagementTest();
  updateManagementAffordance();
} // End of function loadManagementSection()

/**
 * Brings the management-access section up to date with its state: the Client
 * Secret placeholder (what leaving it blank means, clientSecretAffordance()),
 * the session-only note (shown when a typed secret could not be stored
 * encrypted, or the current one is session-only; it then describes the
 * secret field), and the removal controls — "Remove management access" is
 * enabled only when something is stored, and once a removal is staged the
 * fields are emptied and disabled, the pending-removal note shows and "Keep
 * management access" replaces the Remove button. Called on open and on every
 * URL or Client ID edit.
 */
export function updateManagementAffordance(): void {
  const staged = state.settingsRemoveManagement;
  const affordance = staged
    ? 'none'
    : clientSecretAffordance({
        hasClientSecret: state.settingsHasClientSecret,
        sameUrl: isSameControllerUrl(state.settingsStoredUrl, urlInput.value),
        clientIdField: clientIdInput.value,
        storedClientId: state.settingsClientId,
      });
  clientSecretInput.placeholder = affordance === 'none' ? '' : t(CLIENT_SECRET_PLACEHOLDERS[affordance]);

  const sessionOnly = !staged && (!state.settingsCanPersistClientSecret || state.settingsClientSecretSessionOnly);
  managementSessionNote.hidden = !sessionOnly;
  if (sessionOnly) {
    clientSecretInput.setAttribute('aria-describedby', 'managementSessionNote');
  } else {
    clientSecretInput.removeAttribute('aria-describedby');
  }

  clientIdInput.disabled = staged;
  clientSecretInput.disabled = staged;
  managementRemovalNote.hidden = !staged;
  undoManagementRemovalBtn.hidden = !staged;
  removeManagementBtn.hidden = staged || !managementRemoveConfirm.hidden;
  removeManagementBtn.disabled = state.settingsClientId === '' && !state.settingsHasClientSecret;
} // End of function updateManagementAffordance()

/**
 * "Remove management access" handler: asks for confirmation inline (no
 * second modal), with focus on its Cancel.
 */
export function requestManagementRemoval(): void {
  if (removeManagementBtn.disabled || state.settingsRemoveManagement) return;
  managementRemoveConfirm.hidden = false;
  removeManagementBtn.hidden = true;
  cancelManagementRemoveBtn.focus();
}

/**
 * Cancel handler of the inline removal confirmation: back to the Remove button.
 */
export function cancelManagementRemoval(): void {
  managementRemoveConfirm.hidden = true;
  updateManagementAffordance();
  removeManagementBtn.focus();
}

/**
 * Confirm handler of the inline removal confirmation: stages the removal
 * (applied by Save as `removeManagementAccess: true`; Cancel, closing the
 * modal or "Keep management access" drop it), empties the fields and moves
 * focus to "Keep management access".
 */
export function confirmManagementRemoval(): void {
  state.settingsRemoveManagement = true;
  managementRemoveConfirm.hidden = true;
  clientIdInput.value = '';
  clientSecretInput.value = '';
  updateManagementAffordance();
  undoManagementRemovalBtn.focus();
}

/**
 * "Keep management access" handler: drops the staged removal and restores the
 * stored Client ID in its field.
 */
export function undoManagementRemoval(): void {
  state.settingsRemoveManagement = false;
  clientIdInput.value = state.settingsClientId;
  updateManagementAffordance();
  removeManagementBtn.focus();
}

/**
 * Shows the pinned certificate fingerprint in the trusted-certificate
 * section (or "none"), and enables the reset button only when something is
 * pinned. The value comes over IPC, so it is format-checked before display.
 * @param {unknown} fingerprint - The pinned fingerprint from loadConfig().
 */
function renderCertificatePin(fingerprint: unknown): void {
  const pinned = isValidFingerprint(fingerprint) ? fingerprint : null;
  certPinValue.textContent = pinned ?? t('certPinNone');
  certPinValue.classList.toggle('muted-text', pinned === null);
  resetCertBtn.disabled = pinned === null;
} // End of function renderCertificatePin()

/**
 * Hides the inline reset confirmation and shows the reset button again.
 */
function hideCertificateResetConfirm(): void {
  certResetConfirm.hidden = true;
  resetCertBtn.hidden = false;
}

/**
 * "Reset trusted certificate" handler: asks for confirmation inline (inside
 * the settings modal, so no second modal is stacked on top of it). The
 * question mentions that a live connection will be closed.
 */
export function requestCertificateReset(): void {
  if (isOperationInProgress() || resetCertBtn.disabled) return;
  certResetMessage.textContent = state.isConnected ? t('certResetConfirmConnected') : t('certResetConfirm');
  resetCertBtn.hidden = true;
  certResetConfirm.hidden = false;
  cancelCertResetBtn.focus();
} // End of function requestCertificateReset()

/**
 * Cancel handler of the inline reset confirmation: back to the reset button.
 */
export function cancelCertificateReset(): void {
  hideCertificateResetConfirm();
  resetCertBtn.focus();
}

/**
 * Confirm handler of the inline reset confirmation: closes a live session
 * first (while its connection is still trusted, so the logout reaches the
 * controller), then asks the main process to forget the pinned certificate.
 * The main process closes the connection itself as part of the reset (it
 * does not rely on this renderer-side disconnect) and reports it with
 * `connectionReset`, which the renderer mirrors locally. On success the
 * section shows "none" and the next connection is a first use again.
 * Serialized with the other exclusive operations.
 * @returns {Promise<void>}
 */
export async function confirmCertificateReset(): Promise<void> {
  if (isOperationInProgress()) return;
  if (state.isConnected) {
    await disconnect();
  }
  if (isOperationInProgress()) return;
  state.isResettingCertificate = true;
  confirmCertResetBtn.disabled = true;
  cancelCertResetBtn.disabled = true;
  try {
    const result = await window.omadaAPI.resetCertificate();
    if (result.connectionReset) {
      // Main closed the connection on its own: drop any connected UI left
      handleConnectionReset();
    }
    if (result.success) {
      renderCertificatePin(null);
      showToast(t('certResetDone'), 'success');
    } else {
      showToast(t('certResetError'), 'error');
    }
  } catch (error) {
    console.error('Error resetting the trusted certificate:', error);
    showToast(t('certResetError'), 'error');
  } finally {
    state.isResettingCertificate = false;
    confirmCertResetBtn.disabled = false;
    cancelCertResetBtn.disabled = false;
    hideCertificateResetConfirm();
    // Keep keyboard focus inside the (still open) modal: on the reset button
    // when it is still usable, else on Cancel
    if (settingsModal.classList.contains('visible')) {
      (resetCertBtn.disabled ? cancelSettingsBtn : resetCertBtn).focus();
    }
  }
} // End of function confirmCertificateReset()

/**
 * Validates the settings form and saves the configuration. The password is
 * sent to the main process ONLY when the user typed one: a blank field keeps
 * the previously stored (encrypted) password, and is a validation error when
 * no password is stored yet OR the URL now designates a different controller
 * (credentials are URL-scoped; the main process enforces the same rules).
 * The management-access fields follow planManagementSave()
 * (management-form.ts): the Client Secret is sent only when typed, a blank
 * one keeps the stored secret for the same controller and Client ID, and a
 * staged removal is sent as `removeManagementAccess`.
 * The URL is validated/normalized here and again in the main process. A save
 * that changed the controller URL makes the main process close the current
 * connection (reported as `connectionReset`): the connected UI is dropped
 * locally before the auto-connect starts. A no-op while any exclusive
 * operation is pending (including a previous save still in flight — e.g.
 * Enter-key repeat); the Save button is disabled while saving so it cannot
 * double-submit.
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
  // Set when the save succeeds while its session is still current: the
  // auto-connect starts AFTER the in-flight flag is released (connect() is
  // itself guarded by isOperationInProgress())
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
      if (!existingConfig.hasPassword || !isSameControllerUrl(existingConfig.url, normalizedUrl)) {
        // Blank field with nothing stored, or with a password that belongs to
        // another controller URL: refuse (mirrors applyConfigSave())
        showToast(t('passwordRequired'), 'error');
        return;
      }
      // Blank field, same controller: the main process keeps the stored password
    }

    // Management access (optional): the Client ID / typed Client Secret, a
    // staged removal, or nothing when unchanged (mirrors the main rules)
    const management = planManagementSave({
      removeStaged: state.settingsRemoveManagement,
      clientIdField: clientIdInput.value,
      clientSecretField: clientSecretInput.value,
      storedClientId: state.settingsClientId,
      hasClientSecret: state.settingsHasClientSecret,
      sameUrl: isSameControllerUrl(state.settingsStoredUrl, normalizedUrl),
    });
    if (!management.ok) {
      showToast(t(MANAGEMENT_ERROR_KEYS[management.error]), 'error');
      return;
    }

    const payload: ConfigSavePayload = {
      url: normalizedUrl,
      username,
      language: languageSelect.value as Language,
      ...management.fields
    };
    // Send the password only when the user typed a new one
    if (typedPassword) {
      payload.password = typedPassword;
    }

    const result = await window.omadaAPI.saveConfig(payload);

    if (result.success) {
      // A usable configuration now exists: the views can offer connecting
      // instead of configuring, and the header's Connect works
      state.hasStoredConfig = true;
      connectBtn.disabled = false;

      // Auto-connect only when the save's session is still current: a save
      // that completes after a disconnect (or after a newer operation
      // started) must not start a connection. Decided before the connection
      // reset below, which starts a new local session itself
      connectAfterSave = generation === state.sessionGeneration;
      if (result.connectionReset) {
        // The controller URL changed: main already closed the connection
        handleConnectionReset();
      }

      // Apply language change
      setLanguage(payload.language);
      applyTranslations();

      closeSettings();

      // A typed Client Secret that main could not store encrypted is kept for
      // this session only: say so (the modal showed the note before saving)
      if (payload.clientSecret !== undefined && result.managementAccess?.clientSecretSessionOnly === true) {
        showToast(t('managementSavedSessionOnly'), 'info');
      }
    } else if (result.error === 'invalidUrl') {
      showToast(t('invalidUrl'), 'error');
    } else if (result.error === 'passwordRequired') {
      showToast(t('passwordRequired'), 'error');
    } else if (result.error === 'invalidClientId' || result.error === 'clientIdRequired' || result.error === 'clientSecretRequired') {
      showToast(t(MANAGEMENT_ERROR_KEYS[result.error]), 'error');
    } else {
      showToast(t('saveError'), 'error');
    }
  } finally {
    state.isSavingSettings = false;
    saveSettingsBtn.disabled = false;
  }

  // Auto-connect only when the save's session was still current (see above)
  // and nothing else is in flight
  if (connectAfterSave && !isOperationInProgress()) {
    // Auto-connect after saving (the main process reads its own stored
    // password; nothing credential-related comes from the renderer)
    connect();
  }
} // End of function saveSettings()
