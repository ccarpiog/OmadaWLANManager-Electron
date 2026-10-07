// ============================================================================
// The es/en string tables of the UI (the `Translations` interface enforces
// key parity between the two languages) and the substitution of a message's
// `{name}` placeholders. DOM-free and state-free, so the unit tests can
// check the texts of both languages in plain Node (e.g. the message of every
// Wi-Fi network error code). The lookup in the active language (t(),
// tFormat(), tGroup()) lives in i18n.ts; applying the strings to the static
// UI in apply-translations.ts.
// ============================================================================

import type { Language } from '../shared/types';

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
  settingsDescription: string;
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
  // Optional management access in the settings modal (Open API Client ID /
  // Client Secret; settings-modal.ts). "Client ID" and "Client Secret" are the
  // controller's own terms, kept in both languages
  managementTitle: string;
  managementHelp: string;
  clientId: string;
  clientSecret: string;
  clientSecretRequiredNewUrl: string;
  clientSecretRequiredNewClientId: string;
  managementSessionOnly: string;
  managementRemove: string;
  managementRemoveConfirm: string;
  managementRemoveAction: string;
  managementRemovalPending: string;
  managementUndoRemoval: string;
  managementSavedSessionOnly: string;
  invalidClientId: string;
  clientIdRequired: string;
  clientSecretRequired: string;
  // "Test management access" (management.ts): the button, the line shown
  // while it runs, and one result per outcome (every check passed, each
  // ManagementReason, and the renderer-side outcomes)
  managementTest: string;
  managementTestRunning: string;
  managementTestOk: string;
  managementTestLegacyController: string;
  managementTestNotConfigured: string;
  managementTestInvalidCredentials: string;
  managementTestTokenFailed: string;
  managementTestSiteNotFound: string;
  managementTestApGroupsMismatch: string;
  managementTestProbeFailed: string;
  managementTestNotConnected: string;
  managementTestUnsaved: string;
  managementTestSuperseded: string;
  managementTestFailed: string;
  // App shell (shell.ts, status.ts): the sidebar views and the header details
  wifiNetworks: string;
  viewNavLabel: string;
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
  // AP groups and Wi-Fi networks views (groups-view.ts, networks-view.ts):
  // searches, results summary, empty/no-results states, detail prompts, the
  // Default badge, counts ("N groups · M APs") and the read-only details
  groupSearch: string;
  groupSearchLabel: string;
  networkSearch: string;
  networkSearchLabel: string;
  searchResultsCount: string;
  noMatchingGroups: string;
  noMatchingNetworks: string;
  connectToSeeNetworks: string;
  noNetworks: string;
  groupDetailsTitle: string;
  networkDetailsTitle: string;
  groupDetailPrompt: string;
  networkDetailPrompt: string;
  badgeDefault: string;
  unnamed: string;
  apCountNone: string;
  apCountUnknown: string;
  // A network's AP count as a lower bound, and the reason (scopeText())
  apCountAtLeastOne: string;
  apCountAtLeastMany: string;
  scopeUnknownApsOne: string;
  scopeUnknownApsMany: string;
  groupCountOne: string;
  groupCountMany: string;
  noApsInGroup: string;
  groupAmbiguousAps: string;
  networkNoAps: string;
  networkUnknownApsOne: string;
  networkUnknownApsMany: string;
  networkManagementOnly: string;
  // AP details pane (ap-details.ts), opened by a click on an AP row
  apDetailsTitle: string;
  apDetailsFor: string;
  closeDetails: string;
  apStatusLabel: string;
  apMacLabel: string;
  apClientsLabel: string;
  clientsNotReported: string;
  apGroupUnlisted: string;
  apGroupAmbiguous: string;
  apNetworksUnknown: string;
  apOverridesUnavailable: string;
  // Cross-navigation (navigation.ts): "Back to <previous item>"
  backTo: string;
  back: string;
  // View states (docs/management-design.md §4.6; content-state.ts,
  // notices.ts): the first-run and disconnected actions, the initial-load
  // error's Retry, the refresh-error notice, and the read-only banner's
  // reasons (one per ReadOnlyReason of view-state.ts)
  configureConnection: string;
  connectToController: string;
  retry: string;
  refreshFailedNotice: string;
  readOnlyManagementNotConfigured: string;
  readOnlyLegacyController: string;
  readOnlyManagementChecking: string;
  readOnlyInvalidCredentials: string;
  readOnlyTokenFailed: string;
  readOnlySiteNotFound: string;
  readOnlyApGroupsMismatch: string;
  readOnlyProbeFailed: string;
  // Single-pane layout (700–799 px): opens the destination picker as a pane
  chooseDestination: string;
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
  // Cloud controller sessions (inbox item I-1b1, src/main/cloud-controller-session.ts):
  // one message per CloudSessionErrorCode a cloud connect, data load or AP move
  // can fail with (cloudSessionError + the code; I-1b2 / I-1c show them)
  cloudSessionErrorVersionTooOld: string;
  cloudSessionErrorVersionUnknown: string;
  cloudSessionErrorNotConnected: string;
  cloudSessionErrorSuperseded: string;
  cloudSessionErrorNoSites: string;
  cloudSessionErrorListIncomplete: string;
  cloudSessionErrorRequestFailed: string;
  cloudSessionErrorMoveRequestFailed: string;
  cloudSessionErrorMoveNotConfirmed: string;
  cloudSessionErrorMoveUnverified: string;
  // AP group management (groups-view.ts, group-dialog.ts, group-flow.ts;
  // todo.md 4.9): the actions, why Delete is unavailable, the per-band
  // capacity and the master list's Capacity warning badge (with which bands
  // are full), "Move access points here" (§4.1), the dialogs with their
  // progress and results, and one message per ApGroupOperationError (plus
  // 'failed', the renderer's own outcome for an unreadable reply)
  newGroup: string;
  renameGroup: string;
  deleteGroup: string;
  moveApsHere: string;
  groupActionsLabel: string;
  groupNotWritable: string;
  deleteBlockedNotEmpty: string;
  deleteBlockedHasNetworks: string;
  deleteBlockedUnknown: string;
  deleteBlockedChecking: string;
  capacityTitle: string;
  capacityHelp: string;
  band2g: string;
  band5g: string;
  band6g: string;
  bandMlo: string;
  capacityFreeOf: string;
  capacityFree: string;
  capacityNotReportedLimit: string;
  capacityNotReported: string;
  capacityLoading: string;
  capacityFailed: string;
  capacityWarningBadge: string;
  capacityWarningDetail: string;
  createGroupTitle: string;
  createGroupMessage: string;
  groupNameLabel: string;
  groupNameHint: string;
  createGroupAction: string;
  renameGroupTitle: string;
  renameGroupMessage: string;
  renameGroupAction: string;
  deleteGroupTitle: string;
  deleteGroupMessage: string;
  deleteGroupAction: string;
  groupCreating: string;
  groupRenaming: string;
  groupDeleting: string;
  groupCreated: string;
  groupRenamed: string;
  groupDeleted: string;
  apGroupErrorNotConnected: string;
  apGroupErrorSuperseded: string;
  apGroupErrorManagementUnavailable: string;
  apGroupErrorNameRequired: string;
  apGroupErrorNameTooLong: string;
  apGroupErrorNameInvalid: string;
  apGroupErrorNameTaken: string;
  apGroupErrorNameUnchanged: string;
  apGroupErrorGroupNotFound: string;
  apGroupErrorGroupIsDefault: string;
  apGroupErrorGroupNotEmpty: string;
  apGroupErrorGroupHasNetworks: string;
  apGroupErrorGroupStateUnknown: string;
  apGroupErrorGroupLimitReached: string;
  apGroupErrorGroupListIncomplete: string;
  apGroupErrorRequestFailed: string;
  apGroupErrorFailed: string;
  // Wi-Fi networks view on the managed (Open API) source (networks-view.ts,
  // managed-networks-view.ts; todo.md 4.10): the scopes ("All access
  // points", an explicit unknown scope, bound groups the list does not
  // have), the enabled state, security mode, bands and passphrase (unknown
  // is stated, never invented; the passphrase only as set / none), the
  // detail's facts and notes, and one message per failure of the managed
  // read (main's codes plus the renderer's own 'invalidReply' and 'failed')
  scopeAllAccessPoints: string;
  scopeUnknown: string;
  scopeUnresolvedGroupsOne: string;
  scopeUnresolvedGroupsMany: string;
  networkEnabled: string;
  networkDisabled: string;
  networkEnabledUnknown: string;
  securityOpen: string;
  securityWpaEnterprise: string;
  securityWpaPersonal: string;
  securityPpskWithoutRadius: string;
  securityPpskWithRadius: string;
  securityUnknown: string;
  bandsUnknown: string;
  passphraseSet: string;
  passphraseNone: string;
  networkValueUnknown: string;
  networkStateLabel: string;
  networkSecurityLabel: string;
  networkBandsLabel: string;
  networkPassphraseLabel: string;
  networkAllAccessPointsNote: string;
  networkUnknownScopeNote: string;
  networkUnresolvedGroupsOne: string;
  networkUnresolvedGroupsMany: string;
  networkNoGroups: string;
  managedNetworksErrorNotConnected: string;
  managedNetworksErrorSuperseded: string;
  managedNetworksErrorManagementUnavailable: string;
  managedNetworksErrorListIncomplete: string;
  managedNetworksErrorRequestFailed: string;
  managedNetworksErrorInvalidReply: string;
  managedNetworksErrorFailed: string;
  // The managed list kept after a failed re-read (stale): {time} of the
  // last good read, {reason} one of the managedNetworksError* texts above
  networksStaleNotice: string;
  // Wi-Fi network editing (networks-view.ts, managed-networks-view.ts,
  // network-dialog.ts, network-flow.ts; todo.md 4.11): the actions, why a
  // network is not editable, the dialogs (create, staged edit with its
  // review and notes, Change password, enable / disable and delete
  // confirmations with the impact summary), their progress and results, and
  // one message per NetworkOperationError (plus the renderer's own
  // 'passphraseMismatch', 'failed' and the freshness refusals — data or
  // list stale, list being read, network changed —, also the detail's note
  // while writes are held back; a 'securityBandConflict' names its field:
  // networkConflictIot / networkConflictOwe)
  newNetwork: string;
  networkActionsLabel: string;
  editNetwork: string;
  changeNetworkPassword: string;
  enableNetwork: string;
  disableNetwork: string;
  deleteNetwork: string;
  networkNotEditable: string;
  networkNotEditableUnknown: string;
  networkToggleUnavailable: string;
  networkNameLabel: string;
  networkNameHint: string;
  networkPassphraseFieldLabel: string;
  networkPassphraseConfirmLabel: string;
  networkPassphraseHint: string;
  networkGroupsLegend: string;
  networkGroupsHint: string;
  networkGroupsNone: string;
  networkEnableAfterLabel: string;
  networkCreateTitle: string;
  networkCreateMessage: string;
  networkCreate6GhzNote: string;
  networkCreateAction: string;
  networkEditTitle: string;
  networkEditMessage: string;
  networkEditPassphraseNote: string;
  networkEditBandsUnknown: string;
  networkReviewAction: string;
  networkReviewTitle: string;
  networkReviewMessage: string;
  networkSaveAction: string;
  networkBackAction: string;
  networkReviewName: string;
  networkReviewChange: string;
  networkReviewPassphraseValue: string;
  networkNoteRename: string;
  networkNoteToOpen: string;
  networkNoteToWpaPersonal: string;
  networkNoteBandsRemoved: string;
  networkNotePmf: string;
  networkPasswordTitle: string;
  networkPasswordMessage: string;
  networkPasswordAction: string;
  networkPasswordReviewTitle: string;
  networkPasswordReviewMessage: string;
  networkEnableTitle: string;
  networkEnableMessage: string;
  networkEnableAction: string;
  networkDisableTitle: string;
  networkDisableMessage: string;
  networkDisableAction: string;
  networkDeleteTitle: string;
  networkDeleteMessage: string;
  networkDeleteAction: string;
  networkImpactScope: string;
  networkImpactGroups: string;
  networkImpactNoGroups: string;
  networkImpactUnresolvedOne: string;
  networkImpactUnresolvedMany: string;
  networkImpactAllNote: string;
  networkImpactUnknownNote: string;
  networkCreating: string;
  networkEnablingCreated: string;
  networkSaving: string;
  networkChangingPassword: string;
  networkEnabling: string;
  networkDisabling: string;
  networkDeleting: string;
  networkCreated: string;
  networkCreatedEnabled: string;
  networkCreatedNoId: string;
  networkCreatedEnableFailed: string;
  networkSaved: string;
  networkPasswordChanged: string;
  networkEnabledDone: string;
  networkDisabledDone: string;
  networkDeleted: string;
  networkErrorNotConnected: string;
  networkErrorSuperseded: string;
  networkErrorManagementUnavailable: string;
  networkErrorNameRequired: string;
  networkErrorNameTooLong: string;
  networkErrorNameInvalid: string;
  networkErrorNameTaken: string;
  networkErrorPassphraseRequired: string;
  networkErrorPassphraseInvalid: string;
  networkErrorPassphraseMismatch: string;
  networkErrorPassphraseNotApplicable: string;
  networkErrorBandsRequired: string;
  networkErrorGroupsRequired: string;
  networkErrorUnsupportedSecurity: string;
  networkErrorNothingToChange: string;
  networkErrorBandLimitReached: string;
  networkErrorSecurityBandConflict: string;
  networkConflictIot: string;
  networkConflictOwe: string;
  networkErrorGroupNotFound: string;
  networkErrorGroupListIncomplete: string;
  networkErrorNetworkStateUnknown: string;
  networkErrorRequestFailed: string;
  networkErrorFailed: string;
  networkErrorDataStale: string;
  networkErrorListStale: string;
  networkErrorDataReading: string;
  networkErrorNetworkChanged: string;
  // "Broadcast on" binding editor (managed-networks-view.ts, binding-dialog.ts,
  // binding-flow.ts, network-bindings.ts; todo.md 4.12): the detail's section
  // (its action, or why it is read-only), the editor (search, group list,
  // selection line, live preview, capacity problems named per group and
  // band — {group} / {bands} / {band} —, notes), the confirmation, the
  // progress and result, and one message per NetworkBindingsError (plus the
  // renderer's own freshness refusals and 'failed')
  bindingTitle: string;
  bindingEditAction: string;
  bindingReadOnlyAllAccessPoints: string;
  bindingReadOnlyUnknown: string;
  bindingMessage: string;
  bindingSearchLabel: string;
  bindingSearchPlaceholder: string;
  bindingGroupsLegend: string;
  bindingNoGroups: string;
  bindingNoResults: string;
  bindingSelectionNone: string;
  bindingSelectionOne: string;
  bindingSelectionMany: string;
  bindingHiddenOne: string;
  bindingHiddenMany: string;
  bindingUnchanged: string;
  bindingBandsUnknownNote: string;
  bindingReviewAction: string;
  bindingReviewTitle: string;
  bindingReviewMessage: string;
  bindingSaveAction: string;
  bindingRowBefore: string;
  bindingRowAfter: string;
  bindingRowAdded: string;
  bindingRowRemoved: string;
  bindingRowKept: string;
  bindingRowNone: string;
  bindingNoteRemoved: string;
  bindingCapacityTitle: string;
  bindingCapacityGroup: string;
  bindingCapacityFull: string;
  bindingCapacityUnknown: string;
  bindingBandMlo: string;
  bindingMloNote: string;
  bindingReading: string;
  bindingSaving: string;
  bindingSaved: string;
  bindingSavedPlain: string;
  bindingErrorNotConnected: string;
  bindingErrorSuperseded: string;
  bindingErrorManagementUnavailable: string;
  bindingErrorGroupsRequired: string;
  bindingErrorNothingToChange: string;
  bindingErrorNetworkListIncomplete: string;
  bindingErrorNetworkNotFound: string;
  bindingErrorScopeAllAccessPoints: string;
  bindingErrorScopeUnknown: string;
  bindingErrorGroupNotFound: string;
  bindingErrorGroupListIncomplete: string;
  bindingErrorNetworkStateUnknown: string;
  bindingErrorCapacityInsufficient: string;
  bindingErrorRequestFailed: string;
  bindingErrorGroupsStale: string;
  bindingErrorGroupsReading: string;
  bindingErrorGroupsChanged: string;
  bindingErrorFailed: string;
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

export const translations: Record<Language, Translations> = {
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
    settingsDescription: 'La conexión con el controlador, el idioma y el acceso de gestión opcional. No se guarda nada hasta que pulses Guardar.',
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
    managementTitle: 'Acceso de gestión (opcional)',
    managementHelp: 'Permite gestionar los grupos de AP y las redes Wi-Fi. Crea una aplicación de Open API en los ajustes del controlador, en modo de credenciales de cliente, y copia aquí su Client ID y su Client Secret.',
    clientId: 'Client ID',
    clientSecret: 'Client Secret',
    clientSecretRequiredNewUrl: '(obligatorio para la nueva URL)',
    clientSecretRequiredNewClientId: '(obligatorio para el nuevo Client ID)',
    managementSessionOnly: 'Este equipo no puede guardar el Client Secret de forma segura: solo se conserva hasta que cierres la aplicación y tendrás que volver a introducirlo la próxima vez.',
    managementRemove: 'Quitar el acceso de gestión',
    managementRemoveConfirm: '¿Quitar el acceso de gestión? Al guardar se borrarán el Client ID y el Client Secret.',
    managementRemoveAction: 'Quitar',
    managementRemovalPending: 'El acceso de gestión se quitará al guardar.',
    managementUndoRemoval: 'Mantener el acceso de gestión',
    managementSavedSessionOnly: 'El Client Secret solo se conserva durante esta sesión.',
    invalidClientId: 'El Client ID solo puede tener letras, números, puntos, guiones y guiones bajos (hasta 128 caracteres).',
    clientIdRequired: 'Introduce el Client ID. Para desactivar el acceso de gestión, usa "Quitar el acceso de gestión".',
    clientSecretRequired: 'Introduce el Client Secret: es obligatorio con un Client ID nuevo o con otra URL del controlador.',
    managementTest: 'Probar el acceso de gestión',
    managementTestRunning: 'Probando el acceso de gestión…',
    managementTestOk: 'El acceso de gestión funciona: se superaron todas las comprobaciones.',
    managementTestLegacyController: 'Este controlador es anterior a Omada Controller 6.3: no admite la gestión (mover AP sí funciona).',
    managementTestNotConfigured: 'No hay un Client ID y un Client Secret guardados.',
    managementTestInvalidCredentials: 'El controlador rechazó el Client ID o el Client Secret.',
    managementTestTokenFailed: 'No se pudo obtener un token de acceso de Open API (sin respuesta o con una respuesta inesperada). Comprueba que Open API está activado en el controlador.',
    managementTestSiteNotFound: 'La aplicación de Open API no ve el sitio conectado. Revisa a qué sitios tiene acceso en el controlador.',
    managementTestApGroupsMismatch: 'Open API muestra grupos de AP distintos de los del controlador, así que la gestión queda desactivada.',
    managementTestProbeFailed: 'Open API no devolvió los sitios o los grupos de AP (sin respuesta o con un error).',
    managementTestNotConnected: 'Conéctate primero al controlador: la prueba usa la conexión actual.',
    managementTestUnsaved: 'Guarda primero los cambios: la prueba usa los ajustes guardados.',
    managementTestSuperseded: 'La conexión cambió durante la prueba. Vuelve a intentarlo.',
    managementTestFailed: 'No se pudo completar la prueba.',
    wifiNetworks: 'Redes Wi-Fi',
    viewNavLabel: 'Vistas',
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
    groupSearch: 'Buscar grupos o redes…',
    groupSearchLabel: 'Buscar grupos por nombre o por red Wi-Fi',
    networkSearch: 'Buscar redes o grupos…',
    networkSearchLabel: 'Buscar redes Wi-Fi por nombre o por grupo',
    searchResultsCount: 'Se muestran {shown} de {total}',
    noMatchingGroups: 'Ningún grupo ni red coincide con "{query}"',
    noMatchingNetworks: 'Ninguna red ni grupo coincide con "{query}"',
    connectToSeeNetworks: 'Conecta al controlador para ver las redes Wi-Fi',
    noNetworks: 'No hay redes Wi-Fi disponibles',
    groupDetailsTitle: 'Detalles del grupo',
    networkDetailsTitle: 'Detalles de la red',
    groupDetailPrompt: 'Selecciona un grupo para ver sus puntos de acceso y sus redes Wi-Fi',
    networkDetailPrompt: 'Selecciona una red para ver los grupos y los puntos de acceso que la emiten',
    badgeDefault: 'Predeterminado',
    unnamed: '(sin nombre)',
    apCountNone: 'Sin AP',
    apCountUnknown: 'Nº de AP desconocido',
    apCountAtLeastOne: 'al menos 1 AP',
    apCountAtLeastMany: 'al menos {count} AP',
    scopeUnknownApsOne: 'no se puede identificar el grupo de 1 AP',
    scopeUnknownApsMany: 'no se puede identificar el grupo de {count} AP',
    groupCountOne: '1 grupo',
    groupCountMany: '{count} grupos',
    noApsInGroup: 'Ningún punto de acceso está en este grupo',
    groupAmbiguousAps: 'Otro grupo tiene el mismo nombre: la aplicación no puede saber qué puntos de acceso están en este (los AP solo informan del nombre de su grupo).',
    networkNoAps: 'Ningún punto de acceso está en los grupos que la emiten',
    networkUnknownApsOne: 'No se incluye 1 punto de acceso que puede emitirla: la aplicación no puede identificar su grupo (sin grupo, con un grupo que no está en la lista o con un nombre que comparten varios grupos).',
    networkUnknownApsMany: 'No se incluyen {count} puntos de acceso que pueden emitirla: la aplicación no puede identificar su grupo (sin grupo, con un grupo que no está en la lista o con un nombre que comparten varios grupos).',
    networkManagementOnly: 'No se muestran la seguridad, las bandas ni si la red está activada: requieren acceso de gestión.',
    apDetailsTitle: 'Detalles del AP',
    apDetailsFor: 'Detalles de {ap}',
    closeDetails: 'Cerrar detalles',
    apStatusLabel: 'Estado',
    apMacLabel: 'MAC',
    apClientsLabel: 'Clientes',
    clientsNotReported: 'El controlador no informa de ellos',
    apGroupUnlisted: '{group} (no está en la lista de grupos)',
    apGroupAmbiguous: '{group} (otro grupo tiene el mismo nombre)',
    apNetworksUnknown: 'Sus redes Wi-Fi son desconocidas: la aplicación no puede identificar su grupo.',
    apOverridesUnavailable: 'Estas son las redes de su grupo. Las redes personalizadas de este AP no se muestran (la aplicación aún no las lee): si tiene alguna en Omada, lo que emite realmente puede ser distinto.',
    backTo: 'Volver a {target}',
    back: 'Volver',
    configureConnection: 'Configurar la conexión',
    connectToController: 'Conectar al controlador',
    retry: 'Reintentar',
    refreshFailedNotice: 'No se pudieron actualizar los datos. Se muestran los de las {time}.',
    readOnlyManagementNotConfigured: 'No hay credenciales de Open API configuradas — puedes consultar los datos. Añádelas en Ajustes → Acceso de gestión.',
    readOnlyLegacyController: 'Controlador heredado — puedes mover AP; editar grupos y redes requiere Omada Controller 6.3 o posterior.',
    readOnlyManagementChecking: 'Comprobando el acceso de gestión — mientras tanto puedes consultar los datos.',
    readOnlyInvalidCredentials: 'El controlador rechazó el Client ID o el Client Secret de Open API — puedes consultar los datos. Revísalos en Ajustes → Acceso de gestión.',
    readOnlyTokenFailed: 'No se pudo obtener un token de Open API del controlador — puedes consultar los datos. Usa "Probar el acceso de gestión" en Ajustes → Acceso de gestión.',
    readOnlySiteNotFound: 'La aplicación de Open API no ve este sitio — puedes consultar los datos. Revisa a qué sitios tiene acceso en el controlador.',
    readOnlyApGroupsMismatch: 'Open API muestra grupos de AP distintos de los del controlador, así que la gestión está desactivada — puedes consultar los datos.',
    readOnlyProbeFailed: 'Open API no respondió a las comprobaciones — puedes consultar los datos. Usa "Probar el acceso de gestión" en Ajustes → Acceso de gestión.',
    chooseDestination: 'Elegir destino',
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
    cloudSessionErrorVersionTooOld: 'Este controlador tiene una versión anterior a Omada 6.3; la aplicación necesita la 6.3 o posterior.',
    cloudSessionErrorVersionUnknown: 'El controlador no indica una versión válida de Omada; la aplicación necesita la 6.3 o posterior.',
    cloudSessionErrorNotConnected: 'No hay conexión con el controlador en la nube. Conecta y vuelve a intentarlo.',
    cloudSessionErrorSuperseded: 'La conexión cambió antes de que respondiera el controlador en la nube. Actualiza los datos para ver si se aplicó el cambio.',
    cloudSessionErrorNoSites: 'El controlador no muestra ningún sitio a esta credencial de la nube de TP-Link.',
    cloudSessionErrorListIncomplete: 'No se pudo leer la lista completa del controlador; se ha descartado para no mostrar datos incompletos.',
    cloudSessionErrorRequestFailed: 'El controlador no pudo completar la solicitud a través de la nube de TP-Link.',
    cloudSessionErrorMoveRequestFailed: 'El controlador rechazó el cambio de grupo, o no se pudo enviar.',
    cloudSessionErrorMoveNotConfirmed: 'El controlador aceptó el cambio, pero al volver a leer la lista el AP sigue en otro grupo.',
    cloudSessionErrorMoveUnverified: 'El controlador aceptó el cambio, pero no se pudo comprobar que el AP esté en el grupo de destino.',
    newGroup: 'Nuevo grupo',
    renameGroup: 'Cambiar nombre',
    deleteGroup: 'Eliminar',
    moveApsHere: 'Mover puntos de acceso aquí',
    groupActionsLabel: 'Acciones del grupo',
    groupNotWritable: 'El identificador de este grupo tiene un formato inesperado: la aplicación no puede cambiarle el nombre ni eliminarlo.',
    deleteBlockedNotEmpty: 'Para eliminarlo, mueve antes sus puntos de acceso a otro grupo.',
    deleteBlockedHasNetworks: 'Para eliminarlo, desvincula antes sus redes Wi-Fi.',
    deleteBlockedUnknown: 'No se puede eliminar: el controlador no informa con claridad de sus puntos de acceso o de sus redes.',
    deleteBlockedChecking: 'Comprobando si se puede eliminar…',
    capacityTitle: 'Capacidad por banda',
    capacityHelp: 'Cuántas redes Wi-Fi más puede emitir este grupo en cada banda.',
    band2g: '2,4 GHz',
    band5g: '5 GHz',
    band6g: '6 GHz',
    bandMlo: 'MLO',
    capacityFreeOf: '{remaining} libres de {limit}',
    capacityFree: '{remaining} libres',
    capacityNotReportedLimit: 'No informado (límite: {limit})',
    capacityNotReported: 'No informado',
    capacityLoading: 'Leyendo la capacidad…',
    capacityFailed: 'No se pudo leer la capacidad. {reason}',
    capacityWarningBadge: 'Aviso de capacidad',
    capacityWarningDetail: 'Sin espacio para más redes Wi-Fi en {bands}',
    createGroupTitle: 'Nuevo grupo de AP',
    createGroupMessage: 'El grupo se crea vacío, sin puntos de acceso ni redes Wi-Fi. Después puedes mover puntos de acceso a él.',
    groupNameLabel: 'Nombre del grupo',
    groupNameHint: 'De 1 a 128 caracteres, distinto del nombre de cualquier otro grupo (sin distinguir mayúsculas).',
    createGroupAction: 'Crear grupo',
    renameGroupTitle: 'Cambiar el nombre del grupo',
    renameGroupMessage: 'Nombre actual: "{name}". Sus puntos de acceso y sus redes Wi-Fi no cambian.',
    renameGroupAction: 'Cambiar nombre',
    deleteGroupTitle: 'Eliminar el grupo',
    deleteGroupMessage: '¿Eliminar el grupo de AP "{name}"? No tiene puntos de acceso ni redes Wi-Fi. No se puede deshacer.',
    deleteGroupAction: 'Eliminar grupo',
    groupCreating: 'Creando el grupo…',
    groupRenaming: 'Cambiando el nombre del grupo…',
    groupDeleting: 'Eliminando el grupo…',
    groupCreated: 'Se creó el grupo "{name}".',
    groupRenamed: 'El grupo se llama ahora "{name}".',
    groupDeleted: 'Se eliminó el grupo "{name}".',
    apGroupErrorNotConnected: 'No hay conexión con el controlador. Conecta y vuelve a intentarlo.',
    apGroupErrorSuperseded: 'La conexión cambió antes de que respondiera el controlador. Actualiza los datos para ver si se aplicó el cambio.',
    apGroupErrorManagementUnavailable: 'El acceso de gestión no está activo en esta conexión, así que no se pueden cambiar los grupos. Revisa Ajustes → Acceso de gestión.',
    apGroupErrorNameRequired: 'Escribe un nombre para el grupo.',
    apGroupErrorNameTooLong: 'El nombre puede tener como máximo 128 caracteres.',
    apGroupErrorNameInvalid: 'El nombre contiene caracteres no permitidos (caracteres de control o de dirección del texto).',
    apGroupErrorNameTaken: 'Otro grupo de AP ya tiene este nombre (sin distinguir mayúsculas).',
    apGroupErrorNameUnchanged: 'El grupo ya tiene este nombre.',
    apGroupErrorGroupNotFound: 'El grupo ya no está en el controlador. Actualiza los datos.',
    apGroupErrorGroupIsDefault: 'El grupo predeterminado no se puede eliminar.',
    apGroupErrorGroupNotEmpty: 'El controlador indica que este grupo tiene puntos de acceso: muévelos antes a otro grupo.',
    apGroupErrorGroupHasNetworks: 'El controlador indica que este grupo tiene redes Wi-Fi vinculadas: desvincúlalas antes.',
    apGroupErrorGroupStateUnknown: 'El controlador no informa con claridad de los puntos de acceso o las redes de este grupo, así que no se elimina.',
    apGroupErrorGroupLimitReached: 'Se alcanzó el límite de grupos de AP del controlador.',
    apGroupErrorGroupListIncomplete: 'No se pudo leer completa la lista de grupos de AP del controlador, así que no se hizo ningún cambio.',
    apGroupErrorRequestFailed: 'El controlador no pudo completar la solicitud.',
    apGroupErrorFailed: 'No se pudo completar la solicitud.',
    scopeAllAccessPoints: 'Todos los puntos de acceso',
    scopeUnknown: 'Alcance desconocido',
    scopeUnresolvedGroupsOne: '1 grupo vinculado no está en la lista de grupos',
    scopeUnresolvedGroupsMany: '{count} grupos vinculados no están en la lista de grupos',
    networkEnabled: 'Activada',
    networkDisabled: 'Desactivada',
    networkEnabledUnknown: 'Estado desconocido',
    securityOpen: 'Abierta',
    securityWpaEnterprise: 'WPA-Enterprise',
    securityWpaPersonal: 'WPA-Personal',
    securityPpskWithoutRadius: 'PPSK sin RADIUS',
    securityPpskWithRadius: 'PPSK con RADIUS',
    securityUnknown: 'Seguridad desconocida',
    bandsUnknown: 'Bandas desconocidas',
    passphraseSet: 'Configurada',
    passphraseNone: 'Ninguna',
    networkValueUnknown: 'Se desconoce',
    networkStateLabel: 'Estado',
    networkSecurityLabel: 'Seguridad',
    networkBandsLabel: 'Bandas',
    networkPassphraseLabel: 'Contraseña',
    networkAllAccessPointsNote: 'Se emite en todos los puntos de acceso del sitio, también en los que se añadan más adelante.',
    networkUnknownScopeNote: 'El controlador no indica con claridad dónde se emite esta red, así que no se muestran sus grupos ni sus puntos de acceso.',
    networkUnresolvedGroupsOne: 'Está vinculada a 1 grupo que no está en la lista de grupos: sus puntos de acceso no se pueden contar.',
    networkUnresolvedGroupsMany: 'Está vinculada a {count} grupos que no están en la lista de grupos: sus puntos de acceso no se pueden contar.',
    networkNoGroups: 'No está vinculada a ningún grupo: ningún punto de acceso la emite.',
    managedNetworksErrorNotConnected: 'No hay conexión con el controlador: no se pueden leer las redes Wi-Fi.',
    managedNetworksErrorSuperseded: 'La conexión cambió mientras se leían las redes Wi-Fi.',
    managedNetworksErrorManagementUnavailable: 'El acceso de gestión no está activo en esta conexión: no se pueden leer las redes Wi-Fi.',
    managedNetworksErrorListIncomplete: 'No se pudo leer la lista completa de redes Wi-Fi (o tiene más de las que la aplicación lee de una vez): no se muestra una lista parcial.',
    managedNetworksErrorRequestFailed: 'El controlador no pudo enviar las redes Wi-Fi.',
    managedNetworksErrorInvalidReply: 'La respuesta sobre las redes Wi-Fi no es válida: no se muestra nada de ella.',
    managedNetworksErrorFailed: 'No se pudieron leer las redes Wi-Fi.',
    networksStaleNotice: 'No se pudieron actualizar las redes Wi-Fi. Se muestra la lista de las {time}. {reason}',
    newNetwork: 'Nueva red',
    networkActionsLabel: 'Acciones de la red',
    editNetwork: 'Editar',
    changeNetworkPassword: 'Cambiar contraseña',
    enableNetwork: 'Activar',
    disableNetwork: 'Desactivar',
    deleteNetwork: 'Eliminar',
    networkNotEditable: 'La aplicación solo edita redes abiertas y WPA-Personal, así que aquí no se pueden cambiar los ajustes ni la contraseña de esta red {security}: hazlo en el controlador. Sí se puede activar, desactivar o eliminar.',
    networkNotEditableUnknown: 'El controlador no indica con claridad la seguridad de esta red y la aplicación solo edita redes abiertas y WPA-Personal, así que aquí no se pueden cambiar sus ajustes ni su contraseña. Sí se puede eliminar.',
    networkToggleUnavailable: 'El controlador no indica si esta red está activada, así que no se ofrece activarla ni desactivarla.',
    networkNameLabel: 'Nombre de la red (SSID)',
    networkNameHint: 'De 1 a 32 bytes (las letras con tilde y los emoji ocupan más de uno), sin caracteres de control.',
    networkPassphraseFieldLabel: 'Contraseña de la red',
    networkPassphraseConfirmLabel: 'Repite la contraseña',
    networkPassphraseHint: 'De 8 a 63 caracteres ASCII imprimibles (letras sin tilde, números, espacios y símbolos); se usa tal como la escribes.',
    networkGroupsLegend: 'Grupos de AP que la emiten',
    networkGroupsHint: 'Elige al menos un grupo.',
    networkGroupsNone: 'No hay ningún grupo de AP al que vincularla.',
    networkEnableAfterLabel: 'Activar después de crearla',
    networkCreateTitle: 'Nueva red Wi-Fi',
    networkCreateMessage: 'La red se crea desactivada (no se emite hasta que la actives) en los grupos de AP que elijas. Solo se pueden crear redes abiertas o WPA-Personal.',
    networkCreate6GhzNote: 'Una red abierta no se puede crear con 6 GHz: esa banda exige OWE (Enhanced Open), que no se puede configurar al crearla. Créala sin 6 GHz y añade 6 GHz después con Editar.',
    networkCreateAction: 'Crear red',
    networkEditTitle: 'Editar la red Wi-Fi',
    networkEditMessage: 'Cambia los ajustes básicos de "{name}". No se envía nada hasta que revises los cambios y los guardes.',
    networkEditPassphraseNote: 'Para guardar una red WPA-Personal hay que escribir su contraseña: la aplicación nunca lee la contraseña actual del controlador, así que cada guardado envía la que escribas aquí (la misma de ahora u otra nueva).',
    networkEditBandsUnknown: 'El controlador no indica las bandas de esta red: marca las que quieras usar, o déjalas todas sin marcar para no cambiarlas.',
    networkReviewAction: 'Revisar los cambios',
    networkReviewTitle: 'Revisar los cambios',
    networkReviewMessage: 'Al guardar, "{name}" cambiará así:',
    networkSaveAction: 'Guardar cambios',
    networkBackAction: 'Atrás',
    networkReviewName: 'Nombre',
    networkReviewChange: '{from} → {to}',
    networkReviewPassphraseValue: 'La que has escrito (no se muestra)',
    networkNoteRename: 'Los dispositivos que guardaron la red con su nombre anterior tendrán que conectarse al nuevo nombre.',
    networkNoteToOpen: 'Cualquiera que esté al alcance podrá conectarse sin contraseña.',
    networkNoteToWpaPersonal: 'Los dispositivos tendrán que conectarse con la contraseña que has escrito.',
    networkNoteBandsRemoved: 'Se desconectarán los clientes conectados en las bandas que quitas.',
    networkNotePmf: 'Si la PMF (protección de tramas de gestión) de esta red está en "Obligatoria", al guardar con esta seguridad y estas bandas puede pasar a "Compatible". Compruébalo después en el controlador.',
    networkPasswordTitle: 'Cambiar la contraseña',
    networkPasswordMessage: 'Escribe la nueva contraseña de "{name}". Los dispositivos tendrán que usarla para conectarse de nuevo. La contraseña actual nunca se muestra.',
    networkPasswordAction: 'Cambiar contraseña',
    networkPasswordReviewTitle: 'Confirmar el cambio de contraseña',
    networkPasswordReviewMessage: '¿Cambiar la contraseña de "{name}"? Los dispositivos tendrán que usar la nueva para conectarse de nuevo, en todo su alcance:',
    networkEnableTitle: 'Activar la red',
    networkEnableMessage: '¿Activar "{name}"? Empezará a emitirse en su alcance:',
    networkEnableAction: 'Activar red',
    networkDisableTitle: 'Desactivar la red',
    networkDisableMessage: '¿Desactivar "{name}"? Dejará de emitirse y se desconectarán sus clientes en todo su alcance:',
    networkDisableAction: 'Desactivar red',
    networkDeleteTitle: 'Eliminar la red',
    networkDeleteMessage: '¿Eliminar la red Wi-Fi "{name}"? Dejará de emitirse y se desconectarán sus clientes en todo su alcance. No se puede deshacer.',
    networkDeleteAction: 'Eliminar red',
    networkImpactScope: 'Alcance',
    networkImpactGroups: 'Grupos de AP',
    networkImpactNoGroups: 'Ninguno',
    networkImpactUnresolvedOne: '1 grupo que no está en la lista',
    networkImpactUnresolvedMany: '{count} grupos que no están en la lista',
    networkImpactAllNote: 'Incluye los puntos de acceso que se añadan más adelante.',
    networkImpactUnknownNote: 'El controlador no indica con claridad dónde se emite: puede afectar a cualquier punto de acceso del sitio.',
    networkCreating: 'Creando la red…',
    networkEnablingCreated: 'Activando la red creada…',
    networkSaving: 'Guardando los cambios…',
    networkChangingPassword: 'Cambiando la contraseña…',
    networkEnabling: 'Activando la red…',
    networkDisabling: 'Desactivando la red…',
    networkDeleting: 'Eliminando la red…',
    networkCreated: 'Se creó la red "{name}" (desactivada).',
    networkCreatedEnabled: 'Se creó y se activó la red "{name}".',
    networkCreatedNoId: 'Se creó la red "{name}", pero sigue desactivada: el controlador no indicó cuál es la red nueva, así que no se pudo activar. Actívala desde sus detalles.',
    networkCreatedEnableFailed: 'Se creó la red "{name}", pero sigue desactivada: no se pudo activar. {reason}',
    networkSaved: 'Se guardaron los cambios de "{name}".',
    networkPasswordChanged: 'Se cambió la contraseña de "{name}".',
    networkEnabledDone: 'Se activó la red "{name}".',
    networkDisabledDone: 'Se desactivó la red "{name}".',
    networkDeleted: 'Se eliminó la red "{name}".',
    networkErrorNotConnected: 'No hay conexión con el controlador. Conecta y vuelve a intentarlo.',
    networkErrorSuperseded: 'La conexión cambió antes de que respondiera el controlador. Actualiza los datos para ver si se aplicó el cambio.',
    networkErrorManagementUnavailable: 'El acceso de gestión no está activo en esta conexión, así que no se pueden cambiar las redes Wi-Fi. Revisa Ajustes → Acceso de gestión.',
    networkErrorNameRequired: 'Escribe un nombre para la red.',
    networkErrorNameTooLong: 'El nombre puede ocupar como máximo 32 bytes (las letras con tilde y los emoji ocupan más de uno).',
    networkErrorNameInvalid: 'El nombre contiene caracteres no permitidos (caracteres de control o de dirección del texto).',
    networkErrorNameTaken: 'El controlador ya tiene una red con este nombre (o es el nombre de la red de emergencia).',
    networkErrorPassphraseRequired: 'Escribe la contraseña de la red.',
    networkErrorPassphraseInvalid: 'La contraseña debe tener de 8 a 63 caracteres ASCII imprimibles (letras sin tilde, números, espacios y símbolos).',
    networkErrorPassphraseMismatch: 'Las dos contraseñas no coinciden.',
    networkErrorPassphraseNotApplicable: 'Una red abierta no lleva contraseña.',
    networkErrorBandsRequired: 'Elige al menos una banda.',
    networkErrorGroupsRequired: 'Elige al menos un grupo de AP.',
    networkErrorUnsupportedSecurity: 'La aplicación solo crea y edita redes abiertas y WPA-Personal, y el controlador indica otro tipo de seguridad.',
    networkErrorNothingToChange: 'No hay nada que guardar: cambia el nombre, la seguridad o las bandas (para cambiar solo la contraseña, usa Cambiar contraseña).',
    networkErrorBandLimitReached: 'Una de las bandas elegidas ya tiene el número máximo de redes Wi-Fi del controlador.',
    networkErrorSecurityBandConflict: 'Esta combinación de seguridad y bandas choca con un ajuste de la red que la aplicación no cambia.',
    networkConflictIot: 'Esta combinación de seguridad y bandas choca con la conectividad IoT mejorada de la red, que solo funciona en 2,4 GHz y sin WPA3 y que la aplicación no cambia: desactívala en el controlador o deja fuera 5 GHz y 6 GHz.',
    networkConflictOwe: 'Esta combinación choca con OWE (Enhanced Open): una red abierta con 6 GHz lo necesita y no se puede activar al crearla. Créala sin 6 GHz y añade 6 GHz después con Editar.',
    networkErrorGroupNotFound: 'Uno de los grupos de AP elegidos ya no está en el controlador. Actualiza los datos.',
    networkErrorGroupListIncomplete: 'No se pudo leer completa la lista de grupos de AP del controlador, así que no se hizo ningún cambio.',
    networkErrorNetworkStateUnknown: 'El controlador no informa con claridad de todos los ajustes de esta red, así que no se puede guardar sin riesgo de cambiar alguno: no se envió nada.',
    networkErrorRequestFailed: 'El controlador no pudo completar la solicitud.',
    networkErrorFailed: 'No se pudo completar la solicitud.',
    networkErrorDataStale: 'Los datos en pantalla no están al día (falló su última actualización): no se puede cambiar ninguna red Wi-Fi hasta que se actualicen.',
    networkErrorListStale: 'La lista de redes Wi-Fi no está al día (falló su última lectura): no se puede cambiar ninguna red hasta que se vuelva a leer (Reintentar).',
    networkErrorDataReading: 'Se están leyendo de nuevo las redes Wi-Fi: espera a que termine para cambiar una red.',
    networkErrorNetworkChanged: 'La red ha cambiado en el controlador (o ya no está) desde que se mostró: revisa sus datos actualizados y vuelve a intentarlo. No se envió nada.',
    bindingTitle: 'Se emite en',
    bindingEditAction: 'Cambiar grupos de AP',
    bindingReadOnlyAllAccessPoints: 'La aplicación no cambia dónde se emite una red que llega a todos los puntos de acceso (nunca la convierte en una lista de grupos de AP): para limitarla a algunos grupos, hazlo en el controlador.',
    bindingReadOnlyUnknown: 'Como no se sabe con claridad dónde se emite, aquí no se pueden cambiar sus grupos de AP.',
    bindingMessage: 'Elige los grupos de AP que emiten "{name}". No se envía nada hasta que revises el cambio y lo confirmes.',
    bindingSearchLabel: 'Buscar grupos de AP',
    bindingSearchPlaceholder: 'Buscar grupos de AP…',
    bindingGroupsLegend: 'Grupos de AP',
    bindingNoGroups: 'No hay ningún grupo de AP al que vincularla.',
    bindingNoResults: 'Ningún grupo de AP coincide con "{query}".',
    bindingSelectionNone: 'Ningún grupo elegido',
    bindingSelectionOne: '1 grupo elegido',
    bindingSelectionMany: '{count} grupos elegidos',
    bindingHiddenOne: '1 oculto por la búsqueda',
    bindingHiddenMany: '{count} ocultos por la búsqueda',
    bindingUnchanged: 'Todavía no hay ningún cambio: marca o desmarca grupos para cambiar dónde se emite.',
    bindingBandsUnknownNote: 'El controlador no indica las bandas de esta red, así que no se puede comprobar si los grupos que añades tienen hueco: solo se pueden quitar grupos.',
    bindingReviewAction: 'Revisar el cambio',
    bindingReviewTitle: 'Revisar el cambio',
    bindingReviewMessage: 'Al guardar, "{name}" se emitirá así:',
    bindingSaveAction: 'Guardar grupos de AP',
    bindingRowBefore: 'Ahora',
    bindingRowAfter: 'Después',
    bindingRowAdded: 'Se añaden',
    bindingRowRemoved: 'Se quitan',
    bindingRowKept: 'Se mantienen',
    bindingRowNone: 'Ninguno',
    bindingNoteRemoved: 'Los puntos de acceso de los grupos que se quitan dejarán de emitir esta red, y sus clientes conectados a ellos se desconectarán.',
    bindingCapacityTitle: 'Sin hueco confirmado para esta red:',
    bindingCapacityGroup: '{group} — {bands}',
    bindingCapacityFull: '{band}: sin hueco',
    bindingCapacityUnknown: '{band}: no informado',
    bindingBandMlo: 'MLO',
    bindingMloNote: 'Esta red usa MLO y el controlador no informa del hueco MLO de los grupos, así que la aplicación aún no le puede añadir grupos (sí quitarlos).',
    bindingReading: 'Leyendo de nuevo los datos actuales…',
    bindingSaving: 'Guardando los grupos de AP…',
    bindingSaved: 'La red "{name}" se emite ahora en {scope}.',
    bindingSavedPlain: 'Se guardaron los grupos de AP de "{name}".',
    bindingErrorNotConnected: 'No hay conexión con el controlador. Conecta y vuelve a intentarlo.',
    bindingErrorSuperseded: 'La conexión cambió antes de que respondiera el controlador. Actualiza los datos para ver si se aplicó el cambio.',
    bindingErrorManagementUnavailable: 'El acceso de gestión no está activo en esta conexión, así que no se puede cambiar dónde se emiten las redes Wi-Fi. Revisa Ajustes → Acceso de gestión.',
    bindingErrorGroupsRequired: 'Elige al menos un grupo de AP. Para que la red deje de emitirse, desactívala.',
    bindingErrorNothingToChange: 'No hay nada que guardar: la red ya se emite exactamente en estos grupos de AP.',
    bindingErrorNetworkListIncomplete: 'No se pudo leer completa la lista de redes Wi-Fi del controlador (o tiene más de las que la aplicación lee de una vez), así que no se puede comprobar esta red: no se envió nada.',
    bindingErrorNetworkNotFound: 'El controlador ya no tiene esta red. Actualiza los datos.',
    bindingErrorScopeAllAccessPoints: 'El controlador indica que esta red se emite en todos los puntos de acceso: la aplicación no cambia ese ajuste (nunca lo convierte en una lista de grupos). No se envió nada.',
    bindingErrorScopeUnknown: 'El controlador no indica con claridad dónde se emite esta red, así que no se puede cambiar sin riesgo: no se envió nada.',
    bindingErrorGroupNotFound: 'Uno de los grupos de AP elegidos ya no está en el controlador. Actualiza los datos.',
    bindingErrorGroupListIncomplete: 'No se pudo leer completa la lista de grupos de AP del controlador, así que no se hizo ningún cambio.',
    bindingErrorNetworkStateUnknown: 'El controlador no indica con claridad las bandas de esta red o si usa MLO, así que no se puede comprobar si los grupos que añades tienen hueco: no se envió nada. Quitar grupos sí es posible.',
    bindingErrorCapacityInsufficient: 'No todos los grupos de AP que añades tienen hueco para esta red: los grupos y bandas de abajo están llenos o no informan de su capacidad (la aplicación nunca supone que hay hueco). No se envió nada.',
    bindingErrorRequestFailed: 'El controlador no pudo completar la solicitud.',
    bindingErrorGroupsStale: 'La lista de grupos de AP no está al día (falló su última lectura), así que no se conoce su capacidad: no se puede cambiar dónde se emite una red hasta que se vuelva a leer (Actualizar).',
    bindingErrorGroupsReading: 'Se está leyendo la lista de grupos de AP: espera a que termine para cambiar dónde se emite una red.',
    bindingErrorGroupsChanged: 'Los grupos de AP han cambiado en el controlador desde que se mostraron: revisa la lista actualizada y vuelve a intentarlo. No se envió nada.',
    bindingErrorFailed: 'No se pudo completar la solicitud.',
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
    settingsDescription: 'The controller connection, the language and the optional management access. Nothing is saved until you press Save.',
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
    managementTitle: 'Management access (optional)',
    managementHelp: 'Lets the app manage AP groups and Wi-Fi networks. Create an Open API application in the controller\'s settings, in client credentials mode, and copy its Client ID and Client Secret here.',
    clientId: 'Client ID',
    clientSecret: 'Client Secret',
    clientSecretRequiredNewUrl: '(required for the new URL)',
    clientSecretRequiredNewClientId: '(required for the new Client ID)',
    managementSessionOnly: 'This computer cannot store the Client Secret securely: it is kept only until you quit the app, and you will need to enter it again next time.',
    managementRemove: 'Remove management access',
    managementRemoveConfirm: 'Remove management access? The Client ID and the Client Secret are deleted when you save.',
    managementRemoveAction: 'Remove',
    managementRemovalPending: 'Management access will be removed when you save.',
    managementUndoRemoval: 'Keep management access',
    managementSavedSessionOnly: 'The Client Secret is kept for this session only.',
    invalidClientId: 'The Client ID can only contain letters, digits, dots, hyphens and underscores (up to 128 characters).',
    clientIdRequired: 'Enter the Client ID. To turn off management access, use "Remove management access".',
    clientSecretRequired: 'Enter the Client Secret: it is required for a new Client ID or a different controller URL.',
    managementTest: 'Test management access',
    managementTestRunning: 'Testing management access…',
    managementTestOk: 'Management access works: every check passed.',
    managementTestLegacyController: 'This controller is older than Omada Controller 6.3: management is not available (moving APs works).',
    managementTestNotConfigured: 'No Client ID and Client Secret are saved.',
    managementTestInvalidCredentials: 'The controller rejected the Client ID or the Client Secret.',
    managementTestTokenFailed: 'Could not get an Open API access token (no answer, or an unexpected one). Check that the Open API is enabled in the controller.',
    managementTestSiteNotFound: 'The Open API application cannot see the connected site. Check which sites it can access in the controller.',
    managementTestApGroupsMismatch: 'The Open API shows different AP groups than the controller, so management stays off.',
    managementTestProbeFailed: 'The Open API did not return the sites or the AP groups (no answer, or an error).',
    managementTestNotConnected: 'Connect to the controller first: the test uses the current connection.',
    managementTestUnsaved: 'Save your changes first: the test uses the saved settings.',
    managementTestSuperseded: 'The connection changed during the test. Try again.',
    managementTestFailed: 'The test could not be completed.',
    wifiNetworks: 'Wi-Fi networks',
    viewNavLabel: 'Views',
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
    groupSearch: 'Search groups or networks…',
    groupSearchLabel: 'Search groups by name or Wi-Fi network',
    networkSearch: 'Search networks or groups…',
    networkSearchLabel: 'Search Wi-Fi networks by name or group',
    searchResultsCount: 'Showing {shown} of {total}',
    noMatchingGroups: 'No groups or networks match "{query}"',
    noMatchingNetworks: 'No networks or groups match "{query}"',
    connectToSeeNetworks: 'Connect to the controller to see Wi-Fi networks',
    noNetworks: 'No Wi-Fi networks available',
    groupDetailsTitle: 'Group details',
    networkDetailsTitle: 'Network details',
    groupDetailPrompt: 'Select a group to see its access points and Wi-Fi networks',
    networkDetailPrompt: 'Select a network to see the groups and access points that broadcast it',
    badgeDefault: 'Default',
    unnamed: '(no name)',
    apCountNone: 'No APs',
    apCountUnknown: 'AP count unknown',
    apCountAtLeastOne: 'at least 1 AP',
    apCountAtLeastMany: 'at least {count} APs',
    scopeUnknownApsOne: '1 AP\'s group cannot be identified',
    scopeUnknownApsMany: '{count} APs\' groups cannot be identified',
    groupCountOne: '1 group',
    groupCountMany: '{count} groups',
    noApsInGroup: 'No access points are in this group',
    groupAmbiguousAps: 'Another group has the same name: the app cannot tell which access points are in this one (access points report only their group\'s name).',
    networkNoAps: 'No access points are in the groups that broadcast it',
    networkUnknownApsOne: 'Not included: 1 access point that may broadcast it, whose group the app cannot identify (no group, a group not in the list, or a name several groups share).',
    networkUnknownApsMany: 'Not included: {count} access points that may broadcast it, whose group the app cannot identify (no group, a group not in the list, or a name several groups share).',
    networkManagementOnly: 'Security, bands and whether the network is enabled are not shown: they need management access.',
    apDetailsTitle: 'AP details',
    apDetailsFor: 'Details of {ap}',
    closeDetails: 'Close details',
    apStatusLabel: 'Status',
    apMacLabel: 'MAC',
    apClientsLabel: 'Clients',
    clientsNotReported: 'Not reported by the controller',
    apGroupUnlisted: '{group} (not in the group list)',
    apGroupAmbiguous: '{group} (another group has the same name)',
    apNetworksUnknown: 'Its Wi-Fi networks are unknown: the app cannot identify its group.',
    apOverridesUnavailable: 'These are its group\'s networks. Per-AP Wi-Fi network overrides are not shown (the app does not read them yet): if this AP has any in Omada, what it actually broadcasts may differ.',
    backTo: 'Back to {target}',
    back: 'Back',
    configureConnection: 'Configure connection',
    connectToController: 'Connect to controller',
    retry: 'Retry',
    refreshFailedNotice: 'Couldn\'t refresh the data. Showing the data from {time}.',
    readOnlyManagementNotConfigured: 'Open API credentials are not configured — viewing is available. Add them in Settings → Management access.',
    readOnlyLegacyController: 'Legacy controller — moving APs is available; editing groups and networks requires Omada Controller 6.3 or later.',
    readOnlyManagementChecking: 'Checking management access — viewing is available meanwhile.',
    readOnlyInvalidCredentials: 'The controller rejected the Open API Client ID or Client Secret — viewing is available. Check them in Settings → Management access.',
    readOnlyTokenFailed: 'Could not get an Open API access token from the controller — viewing is available. Use "Test management access" in Settings → Management access.',
    readOnlySiteNotFound: 'The Open API application cannot see this site — viewing is available. Check which sites it can access in the controller.',
    readOnlyApGroupsMismatch: 'The Open API shows different AP groups than the controller, so management is off — viewing is available.',
    readOnlyProbeFailed: 'The Open API did not answer the checks — viewing is available. Use "Test management access" in Settings → Management access.',
    chooseDestination: 'Choose destination',
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
    cloudSessionErrorVersionTooOld: 'This controller runs a version older than Omada 6.3; the app needs 6.3 or later.',
    cloudSessionErrorVersionUnknown: 'The controller does not report a valid Omada version; the app needs 6.3 or later.',
    cloudSessionErrorNotConnected: 'Not connected to the cloud controller. Connect and try again.',
    cloudSessionErrorSuperseded: 'The connection changed before the cloud controller answered. Refresh the data to see whether the change was made.',
    cloudSessionErrorNoSites: 'The controller shows no site to this TP-Link cloud credential.',
    cloudSessionErrorListIncomplete: 'The controller\'s list could not be read completely; it was discarded rather than shown incomplete.',
    cloudSessionErrorRequestFailed: 'The controller could not complete the request through the TP-Link cloud.',
    cloudSessionErrorMoveRequestFailed: 'The controller refused the group change, or it could not be sent.',
    cloudSessionErrorMoveNotConfirmed: 'The controller accepted the change, but a re-read still shows the AP in another group.',
    cloudSessionErrorMoveUnverified: 'The controller accepted the change, but whether the AP is in the destination group could not be checked.',
    newGroup: 'New group',
    renameGroup: 'Rename',
    deleteGroup: 'Delete',
    moveApsHere: 'Move access points here',
    groupActionsLabel: 'Group actions',
    groupNotWritable: 'This group\'s id has an unexpected format, so the app cannot rename or delete it.',
    deleteBlockedNotEmpty: 'To delete it, first move its access points to another group.',
    deleteBlockedHasNetworks: 'To delete it, first unlink its Wi-Fi networks.',
    deleteBlockedUnknown: 'It cannot be deleted: the controller does not clearly report its access points or networks.',
    deleteBlockedChecking: 'Checking whether it can be deleted…',
    capacityTitle: 'Per-band capacity',
    capacityHelp: 'How many more Wi-Fi networks this group can broadcast on each band.',
    band2g: '2.4 GHz',
    band5g: '5 GHz',
    band6g: '6 GHz',
    bandMlo: 'MLO',
    capacityFreeOf: '{remaining} of {limit} free',
    capacityFree: '{remaining} free',
    capacityNotReportedLimit: 'Not reported (limit: {limit})',
    capacityNotReported: 'Not reported',
    capacityLoading: 'Reading the capacity…',
    capacityFailed: 'Could not read the capacity. {reason}',
    capacityWarningBadge: 'Capacity warning',
    capacityWarningDetail: 'No room for more Wi-Fi networks on {bands}',
    createGroupTitle: 'New AP group',
    createGroupMessage: 'The group is created empty, with no access points or Wi-Fi networks. You can then move access points into it.',
    groupNameLabel: 'Group name',
    groupNameHint: '1 to 128 characters, different from every other group\'s name (ignoring case).',
    createGroupAction: 'Create group',
    renameGroupTitle: 'Rename the group',
    renameGroupMessage: 'Current name: "{name}". Its access points and Wi-Fi networks stay as they are.',
    renameGroupAction: 'Rename',
    deleteGroupTitle: 'Delete the group',
    deleteGroupMessage: 'Delete the AP group "{name}"? It has no access points and no Wi-Fi networks. This cannot be undone.',
    deleteGroupAction: 'Delete group',
    groupCreating: 'Creating the group…',
    groupRenaming: 'Renaming the group…',
    groupDeleting: 'Deleting the group…',
    groupCreated: 'Group "{name}" created.',
    groupRenamed: 'The group is now called "{name}".',
    groupDeleted: 'Group "{name}" deleted.',
    apGroupErrorNotConnected: 'Not connected to the controller. Connect and try again.',
    apGroupErrorSuperseded: 'The connection changed before the controller answered. Refresh the data to see whether the change was made.',
    apGroupErrorManagementUnavailable: 'Management access is not active for this connection, so groups cannot be changed. Check Settings → Management access.',
    apGroupErrorNameRequired: 'Enter a name for the group.',
    apGroupErrorNameTooLong: 'The name can have at most 128 characters.',
    apGroupErrorNameInvalid: 'The name contains characters that are not allowed (control or text-direction characters).',
    apGroupErrorNameTaken: 'Another AP group already has this name (ignoring case).',
    apGroupErrorNameUnchanged: 'The group already has this name.',
    apGroupErrorGroupNotFound: 'The group is no longer on the controller. Refresh the data.',
    apGroupErrorGroupIsDefault: 'The default group cannot be deleted.',
    apGroupErrorGroupNotEmpty: 'The controller reports access points in this group: move them to another group first.',
    apGroupErrorGroupHasNetworks: 'The controller reports Wi-Fi networks bound to this group: unlink them first.',
    apGroupErrorGroupStateUnknown: 'The controller does not clearly report this group\'s access points or networks, so it is not deleted.',
    apGroupErrorGroupLimitReached: 'The controller\'s AP group limit has been reached.',
    apGroupErrorGroupListIncomplete: 'The controller\'s AP group list could not be read completely, so nothing was changed.',
    apGroupErrorRequestFailed: 'The controller could not complete the request.',
    apGroupErrorFailed: 'The request could not be completed.',
    scopeAllAccessPoints: 'All access points',
    scopeUnknown: 'Unknown scope',
    scopeUnresolvedGroupsOne: '1 bound group is not in the group list',
    scopeUnresolvedGroupsMany: '{count} bound groups are not in the group list',
    networkEnabled: 'Enabled',
    networkDisabled: 'Disabled',
    networkEnabledUnknown: 'State unknown',
    securityOpen: 'Open',
    securityWpaEnterprise: 'WPA-Enterprise',
    securityWpaPersonal: 'WPA-Personal',
    securityPpskWithoutRadius: 'PPSK without RADIUS',
    securityPpskWithRadius: 'PPSK with RADIUS',
    securityUnknown: 'Security unknown',
    bandsUnknown: 'Bands unknown',
    passphraseSet: 'Set',
    passphraseNone: 'None',
    networkValueUnknown: 'Unknown',
    networkStateLabel: 'State',
    networkSecurityLabel: 'Security',
    networkBandsLabel: 'Bands',
    networkPassphraseLabel: 'Password',
    networkAllAccessPointsNote: 'Broadcast on every access point of the site, including those added later.',
    networkUnknownScopeNote: 'The controller does not report clearly where this network is broadcast, so its AP groups and access points are not shown.',
    networkUnresolvedGroupsOne: 'It is bound to 1 group that is not in the group list: its access points cannot be counted.',
    networkUnresolvedGroupsMany: 'It is bound to {count} groups that are not in the group list: their access points cannot be counted.',
    networkNoGroups: 'It is not bound to any AP group: no access point broadcasts it.',
    managedNetworksErrorNotConnected: 'Not connected to the controller: the Wi-Fi networks cannot be read.',
    managedNetworksErrorSuperseded: 'The connection changed while the Wi-Fi networks were being read.',
    managedNetworksErrorManagementUnavailable: 'Management access is not active for this connection: the Wi-Fi networks cannot be read.',
    managedNetworksErrorListIncomplete: 'The complete list of Wi-Fi networks could not be read (or it has more than the app reads at once): a partial list is not shown.',
    managedNetworksErrorRequestFailed: 'The controller could not send the Wi-Fi networks.',
    managedNetworksErrorInvalidReply: 'The answer about the Wi-Fi networks is not valid: none of it is shown.',
    managedNetworksErrorFailed: 'The Wi-Fi networks could not be read.',
    networksStaleNotice: 'Couldn\'t refresh the Wi-Fi networks. Showing the list from {time}. {reason}',
    newNetwork: 'New network',
    networkActionsLabel: 'Network actions',
    editNetwork: 'Edit',
    changeNetworkPassword: 'Change password',
    enableNetwork: 'Enable',
    disableNetwork: 'Disable',
    deleteNetwork: 'Delete',
    networkNotEditable: 'The app edits only Open and WPA-Personal networks, so the settings and the password of this {security} network can\'t be changed here: use the controller. It can still be enabled, disabled or deleted.',
    networkNotEditableUnknown: 'The controller does not report this network\'s security clearly and the app edits only Open and WPA-Personal networks, so its settings and its password can\'t be changed here. It can still be deleted.',
    networkToggleUnavailable: 'The controller does not report whether this network is enabled, so Enable / Disable is not offered.',
    networkNameLabel: 'Network name (SSID)',
    networkNameHint: '1 to 32 bytes (accented letters and emoji take more than one), no control characters.',
    networkPassphraseFieldLabel: 'Network password',
    networkPassphraseConfirmLabel: 'Type the password again',
    networkPassphraseHint: '8 to 63 printable ASCII characters (unaccented letters, digits, spaces and symbols); used exactly as typed.',
    networkGroupsLegend: 'AP groups that broadcast it',
    networkGroupsHint: 'Pick at least one group.',
    networkGroupsNone: 'There is no AP group to bind it to.',
    networkEnableAfterLabel: 'Enable after creating',
    networkCreateTitle: 'New Wi-Fi network',
    networkCreateMessage: 'The network is created disabled (it is not broadcast until you enable it) on the AP groups you pick. Only Open and WPA-Personal networks can be created.',
    networkCreate6GhzNote: 'An open network can\'t be created with 6 GHz: that band requires OWE (Enhanced Open), which can\'t be set when creating it. Create it without 6 GHz, then add 6 GHz with Edit.',
    networkCreateAction: 'Create network',
    networkEditTitle: 'Edit the Wi-Fi network',
    networkEditMessage: 'Change the basic settings of "{name}". Nothing is sent until you review the changes and save them.',
    networkEditPassphraseNote: 'Saving a WPA-Personal network needs its password: the app never reads the current password from the controller, so every save sends the one you type here (the current one or a new one).',
    networkEditBandsUnknown: 'The controller does not report this network\'s bands: tick the ones to use, or leave them all unticked to keep them as they are.',
    networkReviewAction: 'Review changes',
    networkReviewTitle: 'Review the changes',
    networkReviewMessage: 'Saving changes "{name}" as follows:',
    networkSaveAction: 'Save changes',
    networkBackAction: 'Back',
    networkReviewName: 'Name',
    networkReviewChange: '{from} → {to}',
    networkReviewPassphraseValue: 'The one you typed (not shown)',
    networkNoteRename: 'Devices that saved the network under its old name will have to join the new name.',
    networkNoteToOpen: 'Anyone in range will be able to join without a password.',
    networkNoteToWpaPersonal: 'Devices will have to join with the password you typed.',
    networkNoteBandsRemoved: 'Clients connected on the bands you remove will be disconnected.',
    networkNotePmf: 'If this network\'s PMF (Protected Management Frames) is set to "Mandatory", saving with this security and these bands may lower it to "Capable". Check it in the controller afterwards.',
    networkPasswordTitle: 'Change the password',
    networkPasswordMessage: 'Type the new password of "{name}". Devices will need it to join again. The current password is never shown.',
    networkPasswordAction: 'Change password',
    networkPasswordReviewTitle: 'Confirm the password change',
    networkPasswordReviewMessage: 'Change the password of "{name}"? Devices will need the new one to join again, on its whole scope:',
    networkEnableTitle: 'Enable the network',
    networkEnableMessage: 'Enable "{name}"? It will start broadcasting on its scope:',
    networkEnableAction: 'Enable network',
    networkDisableTitle: 'Disable the network',
    networkDisableMessage: 'Disable "{name}"? It will stop broadcasting, and its clients will be disconnected on its whole scope:',
    networkDisableAction: 'Disable network',
    networkDeleteTitle: 'Delete the network',
    networkDeleteMessage: 'Delete the Wi-Fi network "{name}"? It will stop broadcasting and its clients will be disconnected on its whole scope. This cannot be undone.',
    networkDeleteAction: 'Delete network',
    networkImpactScope: 'Scope',
    networkImpactGroups: 'AP groups',
    networkImpactNoGroups: 'None',
    networkImpactUnresolvedOne: '1 group not in the group list',
    networkImpactUnresolvedMany: '{count} groups not in the group list',
    networkImpactAllNote: 'This includes the access points added later.',
    networkImpactUnknownNote: 'The controller does not report clearly where it is broadcast: it may affect any access point of the site.',
    networkCreating: 'Creating the network…',
    networkEnablingCreated: 'Enabling the new network…',
    networkSaving: 'Saving the changes…',
    networkChangingPassword: 'Changing the password…',
    networkEnabling: 'Enabling the network…',
    networkDisabling: 'Disabling the network…',
    networkDeleting: 'Deleting the network…',
    networkCreated: 'Network "{name}" created (disabled).',
    networkCreatedEnabled: 'Network "{name}" created and enabled.',
    networkCreatedNoId: 'Network "{name}" was created but is still disabled: the controller did not say which network is the new one, so it could not be enabled. Enable it from its details.',
    networkCreatedEnableFailed: 'Network "{name}" was created but is still disabled: it could not be enabled. {reason}',
    networkSaved: 'Changes to "{name}" saved.',
    networkPasswordChanged: 'The password of "{name}" was changed.',
    networkEnabledDone: 'Network "{name}" enabled.',
    networkDisabledDone: 'Network "{name}" disabled.',
    networkDeleted: 'Network "{name}" deleted.',
    networkErrorNotConnected: 'Not connected to the controller. Connect and try again.',
    networkErrorSuperseded: 'The connection changed before the controller answered. Refresh to see whether the change was applied.',
    networkErrorManagementUnavailable: 'Management access is not active for this connection, so Wi-Fi networks cannot be changed. Check Settings → Management access.',
    networkErrorNameRequired: 'Type a name for the network.',
    networkErrorNameTooLong: 'The name can take at most 32 bytes (accented letters and emoji take more than one).',
    networkErrorNameInvalid: 'The name contains characters that are not allowed (control or text-direction characters).',
    networkErrorNameTaken: 'The controller already has a network with this name (or it is the emergency network\'s name).',
    networkErrorPassphraseRequired: 'Type the network password.',
    networkErrorPassphraseInvalid: 'The password must have 8 to 63 printable ASCII characters (unaccented letters, digits, spaces and symbols).',
    networkErrorPassphraseMismatch: 'The two passwords do not match.',
    networkErrorPassphraseNotApplicable: 'An open network has no password.',
    networkErrorBandsRequired: 'Pick at least one band.',
    networkErrorGroupsRequired: 'Pick at least one AP group.',
    networkErrorUnsupportedSecurity: 'The app only creates and edits Open and WPA-Personal networks, and the controller reports another security mode.',
    networkErrorNothingToChange: 'Nothing to save: change the name, the security or the bands (to change only the password, use Change password).',
    networkErrorBandLimitReached: 'One of the chosen bands already has the controller\'s maximum number of Wi-Fi networks.',
    networkErrorSecurityBandConflict: 'This combination of security and bands conflicts with a setting of the network that the app does not change.',
    networkConflictIot: 'This combination of security and bands conflicts with the network\'s Enhanced IoT Connectivity, which works only on 2.4 GHz without WPA3 and which the app does not change: turn it off in the controller, or leave out 5 GHz and 6 GHz.',
    networkConflictOwe: 'This combination conflicts with OWE (Enhanced Open): an open network with 6 GHz needs it, and it can\'t be turned on when creating the network. Create it without 6 GHz, then add 6 GHz with Edit.',
    networkErrorGroupNotFound: 'One of the chosen AP groups is no longer on the controller. Refresh the data.',
    networkErrorGroupListIncomplete: 'The controller\'s AP-group list could not be read completely, so nothing was changed.',
    networkErrorNetworkStateUnknown: 'The controller does not report all of this network\'s settings clearly, so it can\'t be saved without risking a change to one of them: nothing was sent.',
    networkErrorRequestFailed: 'The controller could not complete the request.',
    networkErrorFailed: 'The request could not be completed.',
    networkErrorDataStale: 'The data on screen is not up to date (its last refresh failed): no Wi-Fi network can be changed until it is refreshed.',
    networkErrorListStale: 'The Wi-Fi network list is not up to date (its last read failed): no network can be changed until it is read again (Retry).',
    networkErrorDataReading: 'The Wi-Fi networks are being read again: wait for it to finish to change a network.',
    networkErrorNetworkChanged: 'The network changed on the controller (or is gone) since it was shown: check its updated details and try again. Nothing was sent.',
    bindingTitle: 'Broadcast on',
    bindingEditAction: 'Change AP groups',
    bindingReadOnlyAllAccessPoints: 'The app does not change where a network on all access points is broadcast (it never turns it into a list of AP groups): to limit it to some groups, use the controller.',
    bindingReadOnlyUnknown: 'As where it is broadcast is not clear, its AP groups can\'t be changed here.',
    bindingMessage: 'Choose the AP groups that broadcast "{name}". Nothing is sent until you review the change and confirm it.',
    bindingSearchLabel: 'Search AP groups',
    bindingSearchPlaceholder: 'Search AP groups…',
    bindingGroupsLegend: 'AP groups',
    bindingNoGroups: 'There is no AP group to bind it to.',
    bindingNoResults: 'No AP group matches "{query}".',
    bindingSelectionNone: 'No group selected',
    bindingSelectionOne: '1 group selected',
    bindingSelectionMany: '{count} groups selected',
    bindingHiddenOne: '1 hidden by the search',
    bindingHiddenMany: '{count} hidden by the search',
    bindingUnchanged: 'No change yet: tick or untick groups to change where it is broadcast.',
    bindingBandsUnknownNote: 'The controller does not report this network\'s bands, so whether the groups you add have room can\'t be checked: groups can only be removed.',
    bindingReviewAction: 'Review the change',
    bindingReviewTitle: 'Review the change',
    bindingReviewMessage: 'Saving changes where "{name}" is broadcast as follows:',
    bindingSaveAction: 'Save AP groups',
    bindingRowBefore: 'Now',
    bindingRowAfter: 'After',
    bindingRowAdded: 'Added',
    bindingRowRemoved: 'Removed',
    bindingRowKept: 'Kept',
    bindingRowNone: 'None',
    bindingNoteRemoved: 'The access points of the removed groups will stop broadcasting this network, and its clients connected to them will be disconnected.',
    bindingCapacityTitle: 'No confirmed room for this network:',
    bindingCapacityGroup: '{group} — {bands}',
    bindingCapacityFull: '{band}: full',
    bindingCapacityUnknown: '{band}: not reported',
    bindingBandMlo: 'MLO',
    bindingMloNote: 'This network uses MLO and the controller does not report the groups\' MLO room, so the app can\'t add groups to it yet (removing them still works).',
    bindingReading: 'Reading the current data again…',
    bindingSaving: 'Saving the AP groups…',
    bindingSaved: 'Network "{name}" is now broadcast on {scope}.',
    bindingSavedPlain: 'The AP groups of "{name}" were saved.',
    bindingErrorNotConnected: 'Not connected to the controller. Connect and try again.',
    bindingErrorSuperseded: 'The connection changed before the controller answered. Refresh to see whether the change was applied.',
    bindingErrorManagementUnavailable: 'Management access is not active on this connection, so where Wi-Fi networks are broadcast can\'t be changed. Check Settings → Management access.',
    bindingErrorGroupsRequired: 'Pick at least one AP group. To stop broadcasting the network, disable it.',
    bindingErrorNothingToChange: 'Nothing to save: the network is already broadcast on exactly these AP groups.',
    bindingErrorNetworkListIncomplete: 'The controller\'s Wi-Fi network list could not be read completely (or it has more networks than the app reads at once), so this network can\'t be checked: nothing was sent.',
    bindingErrorNetworkNotFound: 'The controller no longer has this network. Refresh the data.',
    bindingErrorScopeAllAccessPoints: 'The controller reports that this network is broadcast on all access points: the app does not change that setting (it never turns it into a list of groups). Nothing was sent.',
    bindingErrorScopeUnknown: 'The controller does not report clearly where this network is broadcast, so it can\'t be changed safely: nothing was sent.',
    bindingErrorGroupNotFound: 'One of the chosen AP groups is no longer on the controller. Refresh the data.',
    bindingErrorGroupListIncomplete: 'The controller\'s AP group list could not be read completely, so nothing was changed.',
    bindingErrorNetworkStateUnknown: 'The controller does not report this network\'s bands or its MLO state clearly, so whether the groups you add have room can\'t be checked: nothing was sent. Removing groups still works.',
    bindingErrorCapacityInsufficient: 'Not every AP group you add has room for this network: the groups and bands below are full or do not report their capacity (the app never assumes there is room). Nothing was sent.',
    bindingErrorRequestFailed: 'The controller could not complete the request.',
    bindingErrorGroupsStale: 'The AP group list is not up to date (its last read failed), so its capacity is unknown: where a network is broadcast can\'t be changed until it is read again (Refresh).',
    bindingErrorGroupsReading: 'The AP group list is being read: wait for it to finish to change where a network is broadcast.',
    bindingErrorGroupsChanged: 'The AP groups changed on the controller since they were shown: check the updated list and try again. Nothing was sent.',
    bindingErrorFailed: 'The request could not be completed.',
    statusApConnected: 'Connected',
    statusApPending: 'Adopting',
    statusApHeartbeatMissed: 'Heartbeat missed',
    statusApIsolated: 'Isolated',
    statusApDisconnected: 'Disconnected',
    statusApUnknown: 'Unknown status',
  },
};

/**
 * Substitutes the `{name}` placeholders of a message (the first occurrence
 * of each) with the given values. A replacer function inserts each value
 * verbatim: as a plain replacement string, `$&`/`$'`-style sequences in
 * controller-supplied names (groups, APs, sites, networks) would be expanded.
 * @param {string} template - The message with its placeholders.
 * @param {Record<string, string>} vars - Placeholder names mapped to values.
 * @returns {string} The formatted message.
 */
export function formatMessage(template: string, vars: Record<string, string>): string {
  let text = template;
  for (const [varName, value] of Object.entries(vars)) {
    text = text.replace(`{${varName}}`, () => value);
  }
  return text;
}
