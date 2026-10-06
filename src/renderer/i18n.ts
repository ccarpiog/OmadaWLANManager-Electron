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
  save: string;
  cancel: string;
  settings: string;
  accessPoints: string;
  noAccessPoints: string;
  connectToSeeAPs: string;
  unassigned: string;
  // Group vocabulary (docs/management-design.md §4.1). Each concept has a
  // 6.3+ "AP groups" variant (...Ap) and a legacy "WLAN groups" variant
  // (...Legacy); tGroup() picks the one matching state.groupModel
  groupsTitleAp: string;
  groupsTitleLegacy: string;
  noGroupsAp: string;
  noGroupsLegacy: string;
  selectGroupAp: string;
  selectGroupLegacy: string;
  groupLabelAp: string;
  groupLabelLegacy: string;
  // Shown only while no controller data is loaded, hence 6.3+ vocabulary only
  connectToSeeGroups: string;
  // Label of a group without Wi-Fi networks (§4.1 "empty group label")
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
  networkCountOne: string;
  networkCountMany: string;
  networkCountNone: string;
  clientCountOne: string;
  clientCountMany: string;
  // Destination pane (destination-pane.ts, move-text.ts): the group search,
  // the pinned "Silence" section, the move preview (mixed selections, the
  // networks gained / lost / unchanged) and the "Move AP" / "Move N APs"
  // button labels (§4.1)
  destinationTitle: string;
  destinationSearch: string;
  destinationSearchLabel: string;
  silenceSection: string;
  noDestinationResults: string;
  clearSearch: string;
  moveNoSelection: string;
  moveDestination: string;
  alreadyInGroupOne: string;
  alreadyInGroupMany: string;
  willMoveOne: string;
  willMoveMany: string;
  allAlreadyInGroupOne: string;
  allAlreadyInGroupMany: string;
  includesHiddenOne: string;
  includesHiddenMany: string;
  networksGained: string;
  networksLost: string;
  networksUnchanged: string;
  noneValue: string;
  networkPartial: string;
  unknownSourcesOne: string;
  unknownSourcesMany: string;
  moveNone: string;
  moveOne: string;
  moveMany: string;
  // Why a group whose name another group shares cannot be a destination
  // (its radio is disabled; move-plan.ts isAmbiguousGroup())
  destinationAmbiguous: string;
  // Review dialog, progress and per-AP results (move-dialog.ts)
  moveReviewTitle: string;
  moveReviewSummaryOne: string;
  moveReviewSummaryMany: string;
  moveFrom: string;
  moveTo: string;
  apCountOne: string;
  apCountMany: string;
  alreadySkippedOne: string;
  alreadySkippedMany: string;
  clientsOnMovingAps: string;
  clientsMissingOne: string;
  clientsMissingMany: string;
  clientsUnknown: string;
  moveNotAtomic: string;
  overridesUnavailable: string;
  moveProgress: string;
  moveResultsTitle: string;
  moveResultsAllOne: string;
  moveResultsAllMany: string;
  moveResultsPartial: string;
  moveResultsNoneOne: string;
  moveResultsNoneMany: string;
  moveResultOk: string;
  moveResultFailed: string;
  moveRejected: string;
  retryFailed: string;
  // The results' notes on "Retry failed" after the reload (move-text.ts
  // retryNotes()): failed APs no longer listed or already in the
  // destination, what the retry covers, or why it is unavailable
  retryMissingOne: string;
  retryMissingMany: string;
  retryInDestinationOne: string;
  retryInDestinationMany: string;
  retryRemainingOne: string;
  retryRemainingMany: string;
  retryDestinationGone: string;
  retryDestinationAmbiguous: string;
  retryNothingLeft: string;
  moveError: string;
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
    save: 'Guardar',
    cancel: 'Cancelar',
    settings: 'Ajustes',
    accessPoints: 'Puntos de acceso',
    noAccessPoints: 'No hay puntos de acceso disponibles',
    connectToSeeAPs: 'Conecta al controlador para ver los puntos de acceso',
    unassigned: 'Sin asignar',
    groupsTitleAp: 'Grupos de AP',
    groupsTitleLegacy: 'Grupos WLAN (heredado)',
    noGroupsAp: 'No hay grupos de AP disponibles',
    noGroupsLegacy: 'No hay grupos WLAN disponibles',
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
    networkCountOne: '1 red',
    networkCountMany: '{count} redes',
    networkCountNone: 'Sin redes',
    clientCountOne: '1 cliente',
    clientCountMany: '{count} clientes',
    destinationTitle: 'Mover los AP seleccionados',
    destinationSearch: 'Buscar grupos o redes…',
    destinationSearchLabel: 'Buscar grupos de destino o redes Wi-Fi',
    silenceSection: 'Silenciar',
    noDestinationResults: 'Ningún grupo ni red coincide con "{query}"',
    clearSearch: 'Borrar búsqueda',
    moveNoSelection: 'Selecciona los puntos de acceso que quieres mover',
    moveDestination: 'Destino: {group}',
    alreadyInGroupOne: '1 ya está en este grupo',
    alreadyInGroupMany: '{count} ya están en este grupo',
    willMoveOne: '1 se moverá',
    willMoveMany: '{count} se moverán',
    allAlreadyInGroupOne: 'El AP seleccionado ya está en este grupo',
    allAlreadyInGroupMany: 'Los {count} AP seleccionados ya están en este grupo',
    includesHiddenOne: 'Incluye 1 AP oculto por los filtros',
    includesHiddenMany: 'Incluye {count} AP ocultos por los filtros',
    networksGained: 'Gana',
    networksLost: 'Pierde',
    networksUnchanged: 'Sin cambios',
    noneValue: 'Ninguna',
    networkPartial: '{name} ({count} de {total})',
    unknownSourcesOne: 'No se conocen las redes actuales de 1 AP (sin grupo o con un grupo no reconocido): no se incluye arriba',
    unknownSourcesMany: 'No se conocen las redes actuales de {count} AP (sin grupo o con un grupo no reconocido): no se incluyen arriba',
    moveNone: 'Mover AP',
    moveOne: 'Mover AP',
    moveMany: 'Mover {count} AP',
    destinationAmbiguous: 'Otro grupo tiene el mismo nombre — cambia el nombre de uno en Omada para mover AP aquí',
    moveReviewTitle: 'Revisar el movimiento',
    moveReviewSummaryOne: '"{ap}" se moverá a "{group}".',
    moveReviewSummaryMany: 'Se moverán {count} AP a "{group}".',
    moveFrom: 'Desde',
    moveTo: 'Hacia',
    apCountOne: '1 AP',
    apCountMany: '{count} AP',
    alreadySkippedOne: '1 ya está en este grupo y no se moverá',
    alreadySkippedMany: '{count} ya están en este grupo y no se moverán',
    clientsOnMovingAps: 'Clientes conectados a estos AP',
    clientsMissingOne: '(1 AP no informa de sus clientes)',
    clientsMissingMany: '({count} AP no informan de sus clientes)',
    clientsUnknown: 'Desconocido: el controlador no informa del número de clientes',
    moveNotAtomic: 'Los AP se mueven de uno en uno y la operación no es atómica: si alguno falla, los demás se mueven igualmente.',
    overridesUnavailable: 'No se pueden mostrar las redes personalizadas de cada AP: la API interna del controlador no informa de ellas.',
    moveProgress: 'Moviendo {done} de {total}…',
    moveResultsTitle: 'Resultado del movimiento',
    moveResultsAllOne: 'Se movió el AP a "{group}".',
    moveResultsAllMany: 'Se movieron los {count} AP a "{group}".',
    moveResultsPartial: 'Se movieron {moved} de {total} AP a "{group}". Los que fallaron siguen seleccionados.',
    moveResultsNoneOne: 'No se pudo mover el AP; sigue seleccionado.',
    moveResultsNoneMany: 'No se pudo mover ninguno de los {count} AP; siguen seleccionados.',
    moveResultOk: 'Movido',
    moveResultFailed: 'Error',
    moveRejected: 'El controlador no aceptó el cambio',
    retryFailed: 'Reintentar los fallidos',
    retryMissingOne: '1 AP fallido ya no está en el controlador y no se reintentará.',
    retryMissingMany: '{count} AP fallidos ya no están en el controlador y no se reintentarán.',
    retryInDestinationOne: '1 AP fallido ya aparece en "{group}" tras la recarga y no se reintentará.',
    retryInDestinationMany: '{count} AP fallidos ya aparecen en "{group}" tras la recarga y no se reintentarán.',
    retryRemainingOne: '"{action}" solo reintentará el AP restante.',
    retryRemainingMany: '"{action}" solo reintentará los {count} AP restantes.',
    retryDestinationGone: 'No se puede reintentar: el grupo "{group}" ya no está en el controlador.',
    retryDestinationAmbiguous: 'No se puede reintentar: ahora otro grupo tiene el mismo nombre que "{group}".',
    retryNothingLeft: 'No se puede reintentar: no queda ningún AP fallido que reintentar.',
    moveError: 'Error al mover los puntos de acceso',
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
    save: 'Save',
    cancel: 'Cancel',
    settings: 'Settings',
    accessPoints: 'Access points',
    noAccessPoints: 'No access points available',
    connectToSeeAPs: 'Connect to the controller to see access points',
    unassigned: 'Unassigned',
    groupsTitleAp: 'AP groups',
    groupsTitleLegacy: 'WLAN groups (legacy)',
    noGroupsAp: 'No AP groups available',
    noGroupsLegacy: 'No WLAN groups available',
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
    networkCountOne: '1 network',
    networkCountMany: '{count} networks',
    networkCountNone: 'No networks',
    clientCountOne: '1 client',
    clientCountMany: '{count} clients',
    destinationTitle: 'Move selected APs',
    destinationSearch: 'Search groups or networks…',
    destinationSearchLabel: 'Search destination groups or Wi-Fi networks',
    silenceSection: 'Silence',
    noDestinationResults: 'No groups or networks match "{query}"',
    clearSearch: 'Clear search',
    moveNoSelection: 'Select the access points to move',
    moveDestination: 'Destination: {group}',
    alreadyInGroupOne: '1 already in this group',
    alreadyInGroupMany: '{count} already in this group',
    willMoveOne: '1 will move',
    willMoveMany: '{count} will move',
    allAlreadyInGroupOne: 'The selected AP is already in this group',
    allAlreadyInGroupMany: 'All {count} selected APs are already in this group',
    includesHiddenOne: 'Includes 1 AP hidden by filters',
    includesHiddenMany: 'Includes {count} APs hidden by filters',
    networksGained: 'Gains',
    networksLost: 'Loses',
    networksUnchanged: 'Unchanged',
    noneValue: 'None',
    networkPartial: '{name} ({count} of {total})',
    unknownSourcesOne: 'Current networks unknown for 1 AP (no group, or a group the app cannot identify): not included above',
    unknownSourcesMany: 'Current networks unknown for {count} APs (no group, or a group the app cannot identify): not included above',
    moveNone: 'Move APs',
    moveOne: 'Move AP',
    moveMany: 'Move {count} APs',
    destinationAmbiguous: 'Another group has the same name — rename one in Omada to move APs here',
    moveReviewTitle: 'Review the move',
    moveReviewSummaryOne: '"{ap}" will move to "{group}".',
    moveReviewSummaryMany: '{count} APs will move to "{group}".',
    moveFrom: 'From',
    moveTo: 'To',
    apCountOne: '1 AP',
    apCountMany: '{count} APs',
    alreadySkippedOne: '1 is already in this group and will not move',
    alreadySkippedMany: '{count} are already in this group and will not move',
    clientsOnMovingAps: 'Clients connected to these APs',
    clientsMissingOne: '(1 AP does not report its clients)',
    clientsMissingMany: '({count} APs do not report their clients)',
    clientsUnknown: 'Unknown: the controller does not report client counts',
    moveNotAtomic: 'APs are moved one at a time and the operation is not atomic: if one fails, the others still move.',
    overridesUnavailable: 'Per-AP Wi-Fi network overrides cannot be shown: the controller\'s internal API does not report them.',
    moveProgress: 'Moving {done} of {total}…',
    moveResultsTitle: 'Move results',
    moveResultsAllOne: 'The AP was moved to "{group}".',
    moveResultsAllMany: 'All {count} APs were moved to "{group}".',
    moveResultsPartial: 'Moved {moved} of {total} APs to "{group}". The ones that failed stay selected.',
    moveResultsNoneOne: 'The AP could not be moved; it stays selected.',
    moveResultsNoneMany: 'None of the {count} APs could be moved; they stay selected.',
    moveResultOk: 'Moved',
    moveResultFailed: 'Failed',
    moveRejected: 'The controller did not accept the change',
    retryFailed: 'Retry failed',
    retryMissingOne: '1 failed AP is no longer on the controller and will not be retried.',
    retryMissingMany: '{count} failed APs are no longer on the controller and will not be retried.',
    retryInDestinationOne: '1 failed AP already shows "{group}" after the reload and will not be retried.',
    retryInDestinationMany: '{count} failed APs already show "{group}" after the reload and will not be retried.',
    retryRemainingOne: '"{action}" retries only the remaining AP.',
    retryRemainingMany: '"{action}" retries only the remaining {count} APs.',
    retryDestinationGone: 'Retry is not available: the group "{group}" is no longer on the controller.',
    retryDestinationAmbiguous: 'Retry is not available: another group now has the same name as "{group}".',
    retryNothingLeft: 'Retry is not available: no failed AP is left to retry.',
    moveError: 'Error moving the access points',
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
