// ============================================================================
// Internationalization: the es/en string tables and the lookup helpers. The
// `Translations` interface enforces key parity between the two languages.
// Applying the strings to the static UI lives in apply-translations.ts.
// ============================================================================

import type { Language } from '../shared/types';
import { state } from './state';

export interface Translations {
  disconnected: string;
  connecting: string;
  connected: string;
  error: string;
  connectionError: string;
  connect: string;
  disconnect: string;
  apply: string;
  applying: string;
  save: string;
  cancel: string;
  confirm: string;
  settings: string;
  accessPoints: string;
  wlanGroups: string;
  noAccessPoints: string;
  noWlanGroups: string;
  connectToSeeAPs: string;
  connectToSeeWLANs: string;
  noResultsFor: string;
  selectApAndWlan: string;
  selectAp: string;
  selectWlan: string;
  wlanLabel: string;
  unassigned: string;
  noSsids: string;
  more: string;
  connectionSettings: string;
  controllerUrl: string;
  username: string;
  password: string;
  language: string;
  fillUrlAndUser: string;
  passwordRequired: string;
  passwordUnchanged: string;
  invalidUrl: string;
  saveError: string;
  confirmChange: string;
  confirmAssign: string;
  changeApplied: string;
  changeError: string;
  filter: string;
  refresh: string;
  loading: string;
  loadError: string;
  configLoadError: string;
  close: string;
  configIncomplete: string;
  connectFailed: string;
  configureHint: string;
  siteSelectionTitle: string;
  siteSelectionMessage: string;
  siteSelectError: string;
  connectionSuperseded: string;
  // URL-scoped credentials: password placeholder when the URL field no longer
  // matches the stored controller URL (the stored password does not apply)
  passwordRequiredNewUrl: string;
  // Certificate trust on first use (cert-modal.ts, connection.ts) and the
  // trusted-certificate section of the settings modal
  certUntrustedTitle: string;
  certUntrustedMessage: string;
  certChangedTitle: string;
  certChangedMessage: string;
  certChangedHint: string;
  certHost: string;
  certFingerprint: string;
  certPinnedFingerprint: string;
  certPresentedFingerprint: string;
  certTrustAndConnect: string;
  certUntrustedStatus: string;
  certChangedStatus: string;
  certTrustError: string;
  certPinLabel: string;
  certPinNone: string;
  certReset: string;
  certResetConfirm: string;
  certResetConfirmConnected: string;
  certResetAction: string;
  certResetDone: string;
  certResetError: string;
  // AP status categories (see AP_STATUS in ap-list.ts). Shown as the
  // accessible name of the status dot, so the state is not conveyed by colour
  // alone.
  statusApConnected: string;
  statusApPending: string;
  statusApHeartbeatMissed: string;
  statusApIsolated: string;
  statusApDisconnected: string;
  statusApUnknown: string;
}

const translations: Record<Language, Translations> = {
  es: {
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    connected: 'Conectado',
    error: 'Error',
    connectionError: 'Error de conexión',
    connect: 'Conectar',
    disconnect: 'Desconectar',
    apply: 'Aplicar cambio',
    applying: 'Aplicando...',
    save: 'Guardar',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    settings: 'Ajustes',
    accessPoints: 'Access Points',
    wlanGroups: 'Grupos WLAN',
    noAccessPoints: 'No hay access points disponibles',
    noWlanGroups: 'No hay grupos WLAN disponibles',
    connectToSeeAPs: 'Conecta al controlador para ver los access points',
    connectToSeeWLANs: 'Conecta al controlador para ver los grupos WLAN',
    noResultsFor: 'No hay resultados para',
    selectApAndWlan: 'Selecciona un AP y un grupo WLAN',
    selectAp: 'Selecciona un AP',
    selectWlan: 'Selecciona un grupo WLAN',
    wlanLabel: 'WLAN',
    unassigned: 'Sin asignar',
    noSsids: 'Sin SSIDs',
    more: 'más',
    connectionSettings: 'Ajustes de conexión',
    controllerUrl: 'URL del controlador',
    username: 'Usuario',
    password: 'Contraseña',
    language: 'Idioma',
    fillUrlAndUser: 'Por favor, completa la URL y el usuario',
    passwordRequired: 'Por favor, introduce la contraseña',
    passwordUnchanged: '(sin cambios)',
    invalidUrl: 'URL no válida: debe empezar por https:// y no contener credenciales ni fragmentos',
    saveError: 'Error al guardar la configuración',
    confirmChange: 'Confirmar cambio',
    confirmAssign: '¿Asignar "{wlan}" al AP "{ap}"?',
    changeApplied: 'Cambio aplicado correctamente',
    changeError: 'Error al aplicar el cambio',
    filter: 'Filtrar...',
    refresh: 'Actualizar',
    loading: 'Cargando...',
    loadError: 'Error al cargar los datos del controlador',
    configLoadError: 'Error al cargar la configuración',
    close: 'Cerrar',
    configIncomplete: 'Configuración incompleta. Por favor, configura la conexión.',
    connectFailed: 'No se pudo conectar al controlador.',
    configureHint: 'Configura la conexión en Ajustes para empezar',
    siteSelectionTitle: 'Seleccionar sitio',
    siteSelectionMessage: 'Este controlador gestiona varios sitios. Elige cuál quieres administrar:',
    siteSelectError: 'No se pudo seleccionar el sitio',
    connectionSuperseded: 'Conexión descartada: se inició un intento más reciente',
    passwordRequiredNewUrl: '(obligatoria para la nueva URL)',
    certUntrustedTitle: 'Verificar el certificado del controlador',
    certUntrustedMessage: 'El controlador presenta un certificado autofirmado que esta aplicación aún no conoce. Antes de confiar en él, comprueba que la huella SHA-256 coincide con la del certificado de tu controlador. Todavía no se ha enviado ninguna contraseña.',
    certChangedTitle: 'El certificado del controlador ha cambiado',
    certChangedMessage: 'El controlador presenta un certificado distinto del que marcaste como de confianza. Podría tratarse de una interceptación de la conexión, así que no se ha conectado ni se ha enviado ninguna contraseña.',
    certChangedHint: 'Si esperabas el cambio (por ejemplo, porque se regeneró el certificado del controlador), restablece el certificado de confianza en Ajustes y vuelve a conectar.',
    certHost: 'Controlador',
    certFingerprint: 'Huella SHA-256',
    certPinnedFingerprint: 'Huella de confianza',
    certPresentedFingerprint: 'Huella presentada',
    certTrustAndConnect: 'Confiar y conectar',
    certUntrustedStatus: 'Certificado no verificado: conexión cancelada',
    certChangedStatus: 'Certificado cambiado: conexión rechazada',
    certTrustError: 'No se pudo guardar el certificado de confianza',
    certPinLabel: 'Certificado de confianza (SHA-256)',
    certPinNone: 'Ninguno',
    certReset: 'Restablecer certificado de confianza',
    certResetConfirm: '¿Olvidar el certificado de confianza? La próxima conexión te pedirá verificar de nuevo el certificado del controlador.',
    certResetConfirmConnected: '¿Olvidar el certificado de confianza? Se cerrará la conexión actual y la próxima te pedirá verificar de nuevo el certificado del controlador.',
    certResetAction: 'Restablecer',
    certResetDone: 'Certificado de confianza restablecido',
    certResetError: 'No se pudo restablecer el certificado de confianza',
    statusApConnected: 'Conectado',
    statusApPending: 'Adoptando',
    statusApHeartbeatMissed: 'Sin respuesta',
    statusApIsolated: 'Aislado',
    statusApDisconnected: 'Desconectado',
    statusApUnknown: 'Estado desconocido',
  },
  en: {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    error: 'Error',
    connectionError: 'Connection error',
    connect: 'Connect',
    disconnect: 'Disconnect',
    apply: 'Apply change',
    applying: 'Applying...',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    settings: 'Settings',
    accessPoints: 'Access Points',
    wlanGroups: 'WLAN Groups',
    noAccessPoints: 'No access points available',
    noWlanGroups: 'No WLAN groups available',
    connectToSeeAPs: 'Connect to the controller to see access points',
    connectToSeeWLANs: 'Connect to the controller to see WLAN groups',
    noResultsFor: 'No results for',
    selectApAndWlan: 'Select an AP and a WLAN group',
    selectAp: 'Select an AP',
    selectWlan: 'Select a WLAN group',
    wlanLabel: 'WLAN',
    unassigned: 'Unassigned',
    noSsids: 'No SSIDs',
    more: 'more',
    connectionSettings: 'Connection settings',
    controllerUrl: 'Controller URL',
    username: 'Username',
    password: 'Password',
    language: 'Language',
    fillUrlAndUser: 'Please fill in the URL and username',
    passwordRequired: 'Please enter the password',
    passwordUnchanged: '(unchanged)',
    invalidUrl: 'Invalid URL: it must start with https:// and contain no credentials or fragments',
    saveError: 'Error saving configuration',
    confirmChange: 'Confirm change',
    confirmAssign: 'Assign "{wlan}" to AP "{ap}"?',
    changeApplied: 'Change applied successfully',
    changeError: 'Error applying change',
    filter: 'Filter...',
    refresh: 'Refresh',
    loading: 'Loading...',
    loadError: 'Error loading data from the controller',
    configLoadError: 'Error loading the configuration',
    close: 'Close',
    configIncomplete: 'Configuration incomplete. Please set up the connection.',
    connectFailed: 'Could not connect to the controller.',
    configureHint: 'Set up the connection in Settings to get started',
    siteSelectionTitle: 'Select site',
    siteSelectionMessage: 'This controller manages several sites. Choose which one to manage:',
    siteSelectError: 'Could not select the site',
    connectionSuperseded: 'Connection discarded: a newer attempt was started',
    passwordRequiredNewUrl: '(required for the new URL)',
    certUntrustedTitle: 'Verify the controller certificate',
    certUntrustedMessage: 'The controller presents a self-signed certificate this app does not know yet. Before trusting it, check that the SHA-256 fingerprint matches your controller\'s certificate. No password has been sent yet.',
    certChangedTitle: 'Controller certificate changed',
    certChangedMessage: 'The controller presents a different certificate from the one you trusted. This could mean the connection is being intercepted, so the app did not connect and sent no password.',
    certChangedHint: 'If you expected this change (for example, the controller\'s certificate was regenerated), reset the trusted certificate in Settings and connect again.',
    certHost: 'Controller',
    certFingerprint: 'SHA-256 fingerprint',
    certPinnedFingerprint: 'Trusted fingerprint',
    certPresentedFingerprint: 'Presented fingerprint',
    certTrustAndConnect: 'Trust and connect',
    certUntrustedStatus: 'Certificate not verified: connection cancelled',
    certChangedStatus: 'Certificate changed: connection refused',
    certTrustError: 'Could not save the trusted certificate',
    certPinLabel: 'Trusted certificate (SHA-256)',
    certPinNone: 'None',
    certReset: 'Reset trusted certificate',
    certResetConfirm: 'Forget the trusted certificate? The next connection will ask you to verify the controller\'s certificate again.',
    certResetConfirmConnected: 'Forget the trusted certificate? The current connection will be closed, and the next one will ask you to verify the controller\'s certificate again.',
    certResetAction: 'Reset',
    certResetDone: 'Trusted certificate reset',
    certResetError: 'Could not reset the trusted certificate',
    statusApConnected: 'Connected',
    statusApPending: 'Adopting',
    statusApHeartbeatMissed: 'Heartbeat missed',
    statusApIsolated: 'Isolated',
    statusApDisconnected: 'Disconnected',
    statusApUnknown: 'Unknown status',
  },
};

/**
 * Sets the active UI language and keeps the document language attribute in
 * sync (so assistive technology announces text with the right voice).
 * @param {Language} lang - The language to activate ('es' | 'en').
 */
export function setLanguage(lang: Language): void {
  if (translations[lang]) {
    state.currentLanguage = lang;
    document.documentElement.lang = lang;
  }
}

/**
 * Looks up a UI string in the active language.
 * @param {keyof Translations} key - The translation key.
 * @returns {string} The localized string.
 */
export function t(key: keyof Translations): string {
  return translations[state.currentLanguage][key];
}

/**
 * Looks up a UI string in the active language and substitutes its `{name}`
 * placeholders (first occurrence of each) with the given values.
 * @param {keyof Translations} key - The translation key.
 * @param {Record<string, string>} vars - Placeholder names mapped to values.
 * @returns {string} The localized, formatted string.
 */
export function tFormat(key: keyof Translations, vars: Record<string, string>): string {
  let text = translations[state.currentLanguage][key];
  for (const [varName, value] of Object.entries(vars)) {
    text = text.replace(`{${varName}}`, value);
  }
  return text;
}
