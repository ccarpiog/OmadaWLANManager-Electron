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
