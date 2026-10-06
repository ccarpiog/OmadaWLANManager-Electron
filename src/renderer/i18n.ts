// ============================================================================
// Internationalization: the es/en string tables and the lookup helpers. The
// `Translations` interface enforces key parity between the two languages.
// Applying the strings to the static UI lives in apply-translations.ts.
// ============================================================================

import type { GroupModel, Language } from '../shared/types';
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
  noAccessPoints: string;
  connectToSeeAPs: string;
  noResultsFor: string;
  selectAp: string;
  unassigned: string;
  // Group vocabulary (docs/management-design.md §4.1). Each concept has a
  // 6.3+ "AP groups" variant (...Ap) and a legacy "WLAN groups" variant
  // (...Legacy); tGroup() picks the one matching state.groupModel
  groupsTitleAp: string;
  groupsTitleLegacy: string;
  noGroupsAp: string;
  noGroupsLegacy: string;
  selectApAndGroupAp: string;
  selectApAndGroupLegacy: string;
  selectGroupAp: string;
  selectGroupLegacy: string;
  groupLabelAp: string;
  groupLabelLegacy: string;
  // Shown only while no controller data is loaded, hence 6.3+ vocabulary only
  connectToSeeGroups: string;
  // Subtitle of a group without Wi-Fi networks (§4.1 "empty group label")
  emptyGroup: string;
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
  // App shell (shell.ts, status.ts): the sidebar views, the placeholder of
  // the views that arrive in a later version, and the header details
  wifiNetworks: string;
  viewNavLabel: string;
  viewComingSoon: string;
  siteLabel: string;
  updatedAt: string;
  refreshing: string;
  controllerVersionLabel: string;
  controllerVersionTitle: string;
  controllerHostTitle: string;
  // Access points list (ap-list.ts): filters, selection controls, the
  // selection summary ("3 selected (1 hidden by filters)") and the row details
  searchAps: string;
  searchApsLabel: string;
  statusFilterLabel: string;
  statusFilterAll: string;
  groupFilterLabel: string;
  groupFilterAll: string;
  noMatchingAps: string;
  clearFilters: string;
  selectAllAps: string;
  selectAllApsFiltered: string;
  selectOneAp: string;
  selectOneApFiltered: string;
  clearSelection: string;
  selectionNone: string;
  selectionOne: string;
  selectionMany: string;
  hiddenByFiltersOne: string;
  hiddenByFiltersMany: string;
  selectedApsCount: string;
  networkCountOne: string;
  networkCountMany: string;
  networkCountNone: string;
  clientCountOne: string;
  clientCountMany: string;
  // Moving several selected APs (apply-change.ts)
  confirmAssignMany: string;
  applyingProgress: string;
  changeAppliedMany: string;
  changePartial: string;
  // AP status categories (see AP_STATUS in ap-list.ts). Shown as text next to
  // the coloured dot of each AP row and as the status filter's options, so
  // the state is not conveyed by colour alone.
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
    accessPoints: 'Puntos de acceso',
    noAccessPoints: 'No hay puntos de acceso disponibles',
    connectToSeeAPs: 'Conecta al controlador para ver los puntos de acceso',
    noResultsFor: 'No hay resultados para',
    selectAp: 'Selecciona un AP',
    unassigned: 'Sin asignar',
    groupsTitleAp: 'Grupos de AP',
    groupsTitleLegacy: 'Grupos WLAN (heredado)',
    noGroupsAp: 'No hay grupos de AP disponibles',
    noGroupsLegacy: 'No hay grupos WLAN disponibles',
    selectApAndGroupAp: 'Selecciona un AP y un grupo de AP',
    selectApAndGroupLegacy: 'Selecciona un AP y un grupo WLAN',
    selectGroupAp: 'Selecciona un grupo de AP',
    selectGroupLegacy: 'Selecciona un grupo WLAN',
    groupLabelAp: 'Grupo de AP',
    groupLabelLegacy: 'WLAN',
    connectToSeeGroups: 'Conecta al controlador para ver los grupos de AP',
    emptyGroup: 'Sin redes Wi-Fi — silencia estos AP',
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
    wifiNetworks: 'Redes Wi-Fi',
    viewNavLabel: 'Vistas',
    viewComingSoon: 'Esta vista llegará en una versión posterior. Mientras tanto, mueve los puntos de acceso entre grupos desde la vista Puntos de acceso.',
    siteLabel: 'Sitio: {site}',
    updatedAt: 'Actualizado {time}',
    refreshing: 'Actualizando…',
    controllerVersionLabel: 'Omada {version}',
    controllerVersionTitle: 'Versión del controlador',
    controllerHostTitle: 'Controlador',
    searchAps: 'Buscar AP…',
    searchApsLabel: 'Buscar puntos de acceso',
    statusFilterLabel: 'Filtrar por estado',
    statusFilterAll: 'Todos los estados',
    groupFilterLabel: 'Filtrar por grupo',
    groupFilterAll: 'Todos los grupos',
    noMatchingAps: 'Ningún punto de acceso coincide con los filtros',
    clearFilters: 'Borrar filtros',
    selectAllAps: 'Seleccionar los {count} AP',
    selectAllApsFiltered: 'Seleccionar los {count} AP filtrados',
    selectOneAp: 'Seleccionar el AP',
    selectOneApFiltered: 'Seleccionar el AP filtrado',
    clearSelection: 'Borrar selección',
    selectionNone: 'Ningún AP seleccionado',
    selectionOne: '1 seleccionado',
    selectionMany: '{count} seleccionados',
    hiddenByFiltersOne: '1 oculto por los filtros',
    hiddenByFiltersMany: '{count} ocultos por los filtros',
    selectedApsCount: '{count} AP seleccionados',
    networkCountOne: '1 red',
    networkCountMany: '{count} redes',
    networkCountNone: 'Sin redes',
    clientCountOne: '1 cliente',
    clientCountMany: '{count} clientes',
    confirmAssignMany: '¿Asignar "{wlan}" a {count} AP ({aps})?',
    applyingProgress: 'Aplicando {done}/{total}...',
    changeAppliedMany: '{count} AP movidos a "{wlan}"',
    changePartial: 'No se pudieron mover {failed} de {total} AP; siguen seleccionados para reintentarlo',
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
    accessPoints: 'Access points',
    noAccessPoints: 'No access points available',
    connectToSeeAPs: 'Connect to the controller to see access points',
    noResultsFor: 'No results for',
    selectAp: 'Select an AP',
    unassigned: 'Unassigned',
    groupsTitleAp: 'AP groups',
    groupsTitleLegacy: 'WLAN groups (legacy)',
    noGroupsAp: 'No AP groups available',
    noGroupsLegacy: 'No WLAN groups available',
    selectApAndGroupAp: 'Select an AP and an AP group',
    selectApAndGroupLegacy: 'Select an AP and a WLAN group',
    selectGroupAp: 'Select an AP group',
    selectGroupLegacy: 'Select a WLAN group',
    groupLabelAp: 'AP group',
    groupLabelLegacy: 'WLAN',
    connectToSeeGroups: 'Connect to the controller to see AP groups',
    emptyGroup: 'No Wi-Fi networks — silences these APs',
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
    wifiNetworks: 'Wi-Fi networks',
    viewNavLabel: 'Views',
    viewComingSoon: 'This view arrives in a later version. Meanwhile, move access points between groups from the Access points view.',
    siteLabel: 'Site: {site}',
    updatedAt: 'Updated {time}',
    refreshing: 'Refreshing…',
    controllerVersionLabel: 'Omada {version}',
    controllerVersionTitle: 'Controller version',
    controllerHostTitle: 'Controller',
    searchAps: 'Search APs…',
    searchApsLabel: 'Search access points',
    statusFilterLabel: 'Filter by status',
    statusFilterAll: 'All statuses',
    groupFilterLabel: 'Filter by group',
    groupFilterAll: 'All groups',
    noMatchingAps: 'No access points match the filters',
    clearFilters: 'Clear filters',
    selectAllAps: 'Select all {count} APs',
    selectAllApsFiltered: 'Select all {count} filtered APs',
    selectOneAp: 'Select the AP',
    selectOneApFiltered: 'Select the filtered AP',
    clearSelection: 'Clear selection',
    selectionNone: 'No APs selected',
    selectionOne: '1 selected',
    selectionMany: '{count} selected',
    hiddenByFiltersOne: '1 hidden by filters',
    hiddenByFiltersMany: '{count} hidden by filters',
    selectedApsCount: '{count} APs selected',
    networkCountOne: '1 network',
    networkCountMany: '{count} networks',
    networkCountNone: 'No networks',
    clientCountOne: '1 client',
    clientCountMany: '{count} clients',
    confirmAssignMany: 'Assign "{wlan}" to {count} APs ({aps})?',
    applyingProgress: 'Applying {done}/{total}...',
    changeAppliedMany: '{count} APs moved to "{wlan}"',
    changePartial: 'Could not move {failed} of {total} APs; they stay selected so you can retry',
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
    // A replacer function inserts the value verbatim: as a plain replacement
    // string, `$&`/`$'`-style sequences in controller-supplied names (groups,
    // APs, sites) would be expanded
    text = text.replace(`{${varName}}`, () => value);
  }
  return text;
}

// The group-vocabulary concepts and, per group model, the translation key of
// each (docs/management-design.md §4.1: "AP groups" on Omada 6.3+, "WLAN
// groups (legacy)" before; the legacy suffix belongs to the view title only)
const GROUP_VOCABULARY = {
  groupsTitle: { apGroup: 'groupsTitleAp', wlanGroup: 'groupsTitleLegacy' },
  noGroups: { apGroup: 'noGroupsAp', wlanGroup: 'noGroupsLegacy' },
  selectApAndGroup: { apGroup: 'selectApAndGroupAp', wlanGroup: 'selectApAndGroupLegacy' },
  selectGroup: { apGroup: 'selectGroupAp', wlanGroup: 'selectGroupLegacy' },
  groupLabel: { apGroup: 'groupLabelAp', wlanGroup: 'groupLabelLegacy' },
} as const satisfies Record<string, Record<GroupModel, keyof Translations>>;

// A concept of the group vocabulary (see GROUP_VOCABULARY)
export type GroupConcept = keyof typeof GROUP_VOCABULARY;

/**
 * Looks up a group-vocabulary string in the active language, in the variant
 * of the connected controller's group model (state.groupModel). While no
 * controller data is loaded (groupModel null) the 6.3+ "AP groups" variant is
 * used: those are the product's current terms, and the legacy wording only
 * describes a controller known to be older (or of unknown version).
 * @param {GroupConcept} concept - The vocabulary concept.
 * @returns {string} The localized string for the current group model.
 */
export function tGroup(concept: GroupConcept): string {
  return t(GROUP_VOCABULARY[concept][state.groupModel ?? 'apGroup']);
}
