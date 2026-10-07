// DOM element references used by the renderer modules. Looked up once, when
// the bundle runs: index.html loads renderer.js at the end of <body>, so every
// element below already exists by then.

// DOM Elements
// Background app shell: made inert while a modal is open (see
// updateBackgroundInert()); the modals and toasts are siblings, not children
export const appContainer = document.querySelector('.app-container') as HTMLElement;
export const statusIndicator = document.getElementById('statusIndicator') as HTMLElement;
export const statusText = document.getElementById('statusText') as HTMLElement;
export const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
export const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
export const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
export const settingsBtnLabel = settingsBtn.querySelector('.nav-label') as HTMLElement;
export const toastContainer = document.getElementById('toastContainer') as HTMLElement;

// Header bar: site and controller host, last update, controller version
export const siteNameText = document.getElementById('siteName') as HTMLElement;
export const controllerHostText = document.getElementById('controllerHost') as HTMLElement;
export const lastUpdatedText = document.getElementById('lastUpdated') as HTMLElement;
export const controllerVersionText = document.getElementById('controllerVersion') as HTMLElement;

// Sidebar navigation (one button per view) and the view containers
export const viewNav = document.getElementById('viewNav') as HTMLElement;
export const navAccessPointsBtn = document.getElementById('navAccessPoints') as HTMLButtonElement;
export const navGroupsBtn = document.getElementById('navGroups') as HTMLButtonElement;
export const navNetworksBtn = document.getElementById('navNetworks') as HTMLButtonElement;
export const viewArea = document.getElementById('viewArea') as HTMLElement;
export const viewAccessPoints = document.getElementById('viewAccessPoints') as HTMLElement;
export const viewGroups = document.getElementById('viewGroups') as HTMLElement;
export const viewNetworks = document.getElementById('viewNetworks') as HTMLElement;

// Controller switcher at the top of the sidebar (controller-switcher.ts,
// inbox I-1c2b): its container, the toggle (label + the active controller),
// the busy reason, and the panel with the entries and the cloud list's notice
export const controllerSwitcher = document.getElementById('controllerSwitcher') as HTMLElement;
export const controllerSwitcherBtn = document.getElementById('controllerSwitcherBtn') as HTMLButtonElement;
export const controllerSwitcherLabel = document.getElementById('controllerSwitcherLabel') as HTMLElement;
export const controllerSwitcherCurrent = document.getElementById('controllerSwitcherCurrent') as HTMLElement;
export const controllerSwitcherBusyText = document.getElementById('controllerSwitcherBusyText') as HTMLElement;
export const controllerSwitcherPanel = document.getElementById('controllerSwitcherPanel') as HTMLElement;
export const controllerSwitcherList = document.getElementById('controllerSwitcherList') as HTMLElement;
export const controllerSwitcherNotice = document.getElementById('controllerSwitcherNotice') as HTMLElement;

// Notices above the views (notices.ts): the read-only banner of the AP
// groups and Wi-Fi networks views, and the refresh-error notice with Retry
export const readOnlyBanner = document.getElementById('readOnlyBanner') as HTMLElement;
export const readOnlyBannerText = document.getElementById('readOnlyBannerText') as HTMLElement;
export const refreshNotice = document.getElementById('refreshNotice') as HTMLElement;
export const refreshNoticeText = document.getElementById('refreshNoticeText') as HTMLElement;
export const refreshNoticeRetryBtn = document.getElementById('refreshNoticeRetryBtn') as HTMLButtonElement;

// Cross-navigation: the "Back to …" bar above the views
export const backBar = document.getElementById('backBar') as HTMLElement;
export const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
export const backBtnLabel = document.getElementById('backBtnLabel') as HTMLElement;

// AP groups view: master list (title, the "New group" slot, search, list,
// aria-live results summary) and the selected group's detail (with its
// single-pane Back)
export const groupMasterPanel = document.getElementById('groupMasterPanel') as HTMLElement;
export const groupDetailPanel = document.getElementById('groupDetailPanel') as HTMLElement;
export const groupDetailBackBtn = document.getElementById('groupDetailBackBtn') as HTMLButtonElement;
export const groupsPanelTitle = document.getElementById('groupsPanelTitle') as HTMLElement;
export const groupListActions = document.getElementById('groupListActions') as HTMLElement;
export const groupSearchInput = document.getElementById('groupSearch') as HTMLInputElement;
export const groupList = document.getElementById('groupList') as HTMLElement;
export const groupListSummary = document.getElementById('groupListSummary') as HTMLElement;
export const groupDetailPanelTitle = document.getElementById('groupDetailPanelTitle') as HTMLElement;
export const groupDetail = document.getElementById('groupDetail') as HTMLElement;

// Wi-Fi networks view: master list (title, the "New network" slot, search,
// list, aria-live results summary) and the selected network's detail (with
// its single-pane Back)
export const networkMasterPanel = document.getElementById('networkMasterPanel') as HTMLElement;
export const networkListActions = document.getElementById('networkListActions') as HTMLElement;
export const networkDetailPanel = document.getElementById('networkDetailPanel') as HTMLElement;
export const networkDetailBackBtn = document.getElementById('networkDetailBackBtn') as HTMLButtonElement;
export const networksPanelTitle = document.getElementById('networksPanelTitle') as HTMLElement;
export const networkSearchInput = document.getElementById('networkSearch') as HTMLInputElement;
export const networkList = document.getElementById('networkList') as HTMLElement;
export const networkListSummary = document.getElementById('networkListSummary') as HTMLElement;
export const networkDetailPanelTitle = document.getElementById('networkDetailPanelTitle') as HTMLElement;
export const networkDetail = document.getElementById('networkDetail') as HTMLElement;
// The managed list's refresh-error notice (stale after a failed re-read)
export const networksStaleNotice = document.getElementById('networksStaleNotice') as HTMLElement;
export const networksStaleNoticeText = document.getElementById('networksStaleNoticeText') as HTMLElement;
export const networksStaleRetryBtn = document.getElementById('networksStaleRetryBtn') as HTMLButtonElement;

// Access points panel: list, filters, selection toolbar and summary, and the
// single-pane layout's "Choose destination"
export const apPanel = document.getElementById('apPanel') as HTMLElement;
export const openDestinationBtn = document.getElementById('openDestinationBtn') as HTMLButtonElement;
export const apList = document.getElementById('apList') as HTMLElement;
export const apFilterInput = document.getElementById('apFilter') as HTMLInputElement;
export const apStatusFilterSelect = document.getElementById('apStatusFilter') as HTMLSelectElement;
export const apGroupFilterSelect = document.getElementById('apGroupFilter') as HTMLSelectElement;
export const apSelectionToolbar = document.getElementById('apSelectionToolbar') as HTMLElement;
export const selectAllApsBtn = document.getElementById('selectAllApsBtn') as HTMLButtonElement;
export const clearApSelectionBtn = document.getElementById('clearApSelectionBtn') as HTMLButtonElement;
export const apSelectionSummary = document.getElementById('apSelectionSummary') as HTMLElement;

// Destination pane: group search, the radio list, the move preview and the
// move button (and its single-pane Back). The AP details pane takes its
// place while open
export const destinationPanel = document.getElementById('destinationPanel') as HTMLElement;
export const destinationBackBtn = document.getElementById('destinationBackBtn') as HTMLButtonElement;
export const destinationSearchInput = document.getElementById('destinationSearch') as HTMLInputElement;
export const destinationList = document.getElementById('destinationList') as HTMLElement;
export const moveStatus = document.getElementById('moveStatus') as HTMLElement;
export const movePreview = document.getElementById('movePreview') as HTMLElement;
export const moveBtn = document.getElementById('moveBtn') as HTMLButtonElement;

// AP details pane (Access points view): title, Close, content, and its
// single-pane Back
export const apDetailsPanel = document.getElementById('apDetailsPanel') as HTMLElement;
export const apDetailsBackBtn = document.getElementById('apDetailsBackBtn') as HTMLButtonElement;
export const apDetailsPanelTitle = document.getElementById('apDetailsPanelTitle') as HTMLElement;
export const closeApDetailsBtn = document.getElementById('closeApDetailsBtn') as HTMLButtonElement;
export const apDetailsContent = document.getElementById('apDetailsContent') as HTMLElement;

// Panel titles
export const apPanelTitle = document.getElementById('apPanelTitle') as HTMLElement;
export const destinationPanelTitle = document.getElementById('destinationPanelTitle') as HTMLElement;

// Settings Modal
export const settingsModal = document.getElementById('settingsModal') as HTMLElement;
export const settingsModalTitle = settingsModal.querySelector('.modal-header h2') as HTMLElement;
export const settingsModalMessage = document.getElementById('settingsModalMessage') as HTMLElement;
export const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
export const cancelSettingsBtn = document.getElementById('cancelSettingsBtn') as HTMLButtonElement;
export const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
export const urlInput = document.getElementById('urlInput') as HTMLInputElement;
export const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
export const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;
export const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;

// Settings labels
export const labelUrl = document.querySelector('label[for="urlInput"]') as HTMLElement;
export const labelUsername = document.querySelector('label[for="usernameInput"]') as HTMLElement;
export const labelPassword = document.getElementById('labelPassword') as HTMLElement;
export const labelLanguage = document.getElementById('labelLanguage') as HTMLElement;

// Settings: trusted certificate (TOFU pin) display and reset
export const labelCertPin = document.getElementById('labelCertPin') as HTMLElement;
export const certPinValue = document.getElementById('certPinValue') as HTMLElement;
export const resetCertBtn = document.getElementById('resetCertBtn') as HTMLButtonElement;
export const certResetConfirm = document.getElementById('certResetConfirm') as HTMLElement;
export const certResetMessage = document.getElementById('certResetMessage') as HTMLElement;
export const cancelCertResetBtn = document.getElementById('cancelCertResetBtn') as HTMLButtonElement;
export const confirmCertResetBtn = document.getElementById('confirmCertResetBtn') as HTMLButtonElement;

// Settings: optional management access (Open API Client ID / Client Secret)
export const managementHeading = document.getElementById('managementHeading') as HTMLElement;
export const managementHelp = document.getElementById('managementHelp') as HTMLElement;
export const labelClientId = document.getElementById('labelClientId') as HTMLElement;
export const clientIdInput = document.getElementById('clientIdInput') as HTMLInputElement;
export const labelClientSecret = document.getElementById('labelClientSecret') as HTMLElement;
export const clientSecretInput = document.getElementById('clientSecretInput') as HTMLInputElement;
export const managementSessionNote = document.getElementById('managementSessionNote') as HTMLElement;
export const managementRemovalNote = document.getElementById('managementRemovalNote') as HTMLElement;
export const removeManagementBtn = document.getElementById('removeManagementBtn') as HTMLButtonElement;
export const undoManagementRemovalBtn = document.getElementById('undoManagementRemovalBtn') as HTMLButtonElement;
export const managementRemoveConfirm = document.getElementById('managementRemoveConfirm') as HTMLElement;
export const managementRemoveMessage = document.getElementById('managementRemoveMessage') as HTMLElement;
export const cancelManagementRemoveBtn = document.getElementById('cancelManagementRemoveBtn') as HTMLButtonElement;
export const confirmManagementRemoveBtn = document.getElementById('confirmManagementRemoveBtn') as HTMLButtonElement;
// "Test management access" and its result line (management.ts)
export const testManagementBtn = document.getElementById('testManagementBtn') as HTMLButtonElement;
export const managementTestResult = document.getElementById('managementTestResult') as HTMLElement;

// Settings: optional TP-Link cloud access (Region, cloud Client ID / Client
// Secret, Remove, "Test cloud access" and its result; cloud-settings.ts)
export const cloudHeading = document.getElementById('cloudHeading') as HTMLElement;
export const cloudHelp = document.getElementById('cloudHelp') as HTMLElement;
export const cloudCredentialHelp = document.getElementById('cloudCredentialHelp') as HTMLElement;
// The certificate section's note on cloud controllers (inbox I-1c2a: their
// certificate is verified normally; shown while a cloud credential is stored)
export const certCloudNote = document.getElementById('certCloudNote') as HTMLElement;
export const labelCloudRegion = document.getElementById('labelCloudRegion') as HTMLElement;
export const cloudRegionSelect = document.getElementById('cloudRegionSelect') as HTMLSelectElement;
export const labelCloudClientId = document.getElementById('labelCloudClientId') as HTMLElement;
export const cloudClientIdInput = document.getElementById('cloudClientIdInput') as HTMLInputElement;
export const labelCloudClientSecret = document.getElementById('labelCloudClientSecret') as HTMLElement;
export const cloudClientSecretInput = document.getElementById('cloudClientSecretInput') as HTMLInputElement;
export const cloudSessionNote = document.getElementById('cloudSessionNote') as HTMLElement;
export const cloudRemovalNote = document.getElementById('cloudRemovalNote') as HTMLElement;
export const removeCloudBtn = document.getElementById('removeCloudBtn') as HTMLButtonElement;
export const undoCloudRemovalBtn = document.getElementById('undoCloudRemovalBtn') as HTMLButtonElement;
export const cloudRemoveConfirm = document.getElementById('cloudRemoveConfirm') as HTMLElement;
export const cloudRemoveMessage = document.getElementById('cloudRemoveMessage') as HTMLElement;
export const cancelCloudRemoveBtn = document.getElementById('cancelCloudRemoveBtn') as HTMLButtonElement;
export const confirmCloudRemoveBtn = document.getElementById('confirmCloudRemoveBtn') as HTMLButtonElement;
export const testCloudBtn = document.getElementById('testCloudBtn') as HTMLButtonElement;
export const cloudTestResult = document.getElementById('cloudTestResult') as HTMLElement;

// Move dialog (review, progress, per-AP results)
export const moveModal = document.getElementById('moveModal') as HTMLElement;
export const moveModalTitle = document.getElementById('moveModalHeading') as HTMLElement;
export const moveModalSummary = document.getElementById('moveModalSummary') as HTMLElement;
export const moveReview = document.getElementById('moveReview') as HTMLElement;
export const moveResults = document.getElementById('moveResults') as HTMLElement;
export const moveNotes = document.getElementById('moveNotes') as HTMLElement;
export const cancelMoveBtn = document.getElementById('cancelMoveBtn') as HTMLButtonElement;
export const confirmMoveBtn = document.getElementById('confirmMoveBtn') as HTMLButtonElement;
export const retryFailedBtn = document.getElementById('retryFailedBtn') as HTMLButtonElement;
export const closeMoveBtn = document.getElementById('closeMoveBtn') as HTMLButtonElement;

// AP group dialog (New group, Rename, Delete confirmation)
export const groupModal = document.getElementById('groupModal') as HTMLElement;
export const groupModalTitle = document.getElementById('groupModalHeading') as HTMLElement;
export const groupModalMessage = document.getElementById('groupModalMessage') as HTMLElement;
export const groupNameField = document.getElementById('groupNameField') as HTMLElement;
export const groupNameLabel = document.getElementById('groupNameLabel') as HTMLElement;
export const groupNameInput = document.getElementById('groupNameInput') as HTMLInputElement;
export const groupNameHint = document.getElementById('groupNameHint') as HTMLElement;
export const groupModalError = document.getElementById('groupModalError') as HTMLElement;
export const groupModalStatus = document.getElementById('groupModalStatus') as HTMLElement;
export const cancelGroupBtn = document.getElementById('cancelGroupBtn') as HTMLButtonElement;
export const confirmGroupBtn = document.getElementById('confirmGroupBtn') as HTMLButtonElement;

// Wi-Fi network dialog (New network, Edit with its review, Change password,
// Enable / Disable and Delete confirmations); its form and summary are
// built per open (network-dialog.ts)
export const networkModal = document.getElementById('networkModal') as HTMLElement;
export const networkModalTitle = document.getElementById('networkModalHeading') as HTMLElement;
export const networkModalMessage = document.getElementById('networkModalMessage') as HTMLElement;
export const networkModalForm = document.getElementById('networkModalForm') as HTMLElement;
export const networkModalSummary = document.getElementById('networkModalSummary') as HTMLElement;
export const networkModalError = document.getElementById('networkModalError') as HTMLElement;
export const networkModalStatus = document.getElementById('networkModalStatus') as HTMLElement;
export const cancelNetworkBtn = document.getElementById('cancelNetworkBtn') as HTMLButtonElement;
export const backNetworkBtn = document.getElementById('backNetworkBtn') as HTMLButtonElement;
export const confirmNetworkBtn = document.getElementById('confirmNetworkBtn') as HTMLButtonElement;

// "Broadcast on" dialog (the binding editor and its confirmation); its
// editor and summary are built per open (binding-dialog.ts)
export const bindingModal = document.getElementById('bindingModal') as HTMLElement;
export const bindingModalTitle = document.getElementById('bindingModalHeading') as HTMLElement;
export const bindingModalMessage = document.getElementById('bindingModalMessage') as HTMLElement;
export const bindingModalEditor = document.getElementById('bindingModalEditor') as HTMLElement;
export const bindingModalSummary = document.getElementById('bindingModalSummary') as HTMLElement;
export const bindingModalError = document.getElementById('bindingModalError') as HTMLElement;
export const bindingModalStatus = document.getElementById('bindingModalStatus') as HTMLElement;
export const cancelBindingBtn = document.getElementById('cancelBindingBtn') as HTMLButtonElement;
export const backBindingBtn = document.getElementById('backBindingBtn') as HTMLButtonElement;
export const confirmBindingBtn = document.getElementById('confirmBindingBtn') as HTMLButtonElement;

// Site Selection Modal (multi-site controllers)
export const siteModal = document.getElementById('siteModal') as HTMLElement;
export const siteModalTitle = document.getElementById('siteModalHeading') as HTMLElement;
export const siteModalMessage = document.getElementById('siteModalMessage') as HTMLElement;
export const siteListContainer = document.getElementById('siteList') as HTMLElement;
export const cancelSiteBtn = document.getElementById('cancelSiteBtn') as HTMLButtonElement;

// Certificate Modal (trust on first use: first-use confirmation, certificate changed)
export const certModal = document.getElementById('certModal') as HTMLElement;
export const certModalTitle = document.getElementById('certModalHeading') as HTMLElement;
export const certModalMessage = document.getElementById('certModalMessage') as HTMLElement;
export const certDetails = document.getElementById('certDetails') as HTMLElement;
export const certModalHint = document.getElementById('certModalHint') as HTMLElement;
export const cancelCertBtn = document.getElementById('cancelCertBtn') as HTMLButtonElement;
export const confirmCertBtn = document.getElementById('confirmCertBtn') as HTMLButtonElement;
