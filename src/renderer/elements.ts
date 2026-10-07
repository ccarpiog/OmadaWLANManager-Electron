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

// Cross-navigation: the "Back to …" bar above the views
export const backBar = document.getElementById('backBar') as HTMLElement;
export const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
export const backBtnLabel = document.getElementById('backBtnLabel') as HTMLElement;

// AP groups view: master list (title, search, list, aria-live results
// summary) and the selected group's detail
export const groupsPanelTitle = document.getElementById('groupsPanelTitle') as HTMLElement;
export const groupSearchInput = document.getElementById('groupSearch') as HTMLInputElement;
export const groupList = document.getElementById('groupList') as HTMLElement;
export const groupListSummary = document.getElementById('groupListSummary') as HTMLElement;
export const groupDetailPanelTitle = document.getElementById('groupDetailPanelTitle') as HTMLElement;
export const groupDetail = document.getElementById('groupDetail') as HTMLElement;

// Wi-Fi networks view: master list and the selected network's detail
export const networksPanelTitle = document.getElementById('networksPanelTitle') as HTMLElement;
export const networkSearchInput = document.getElementById('networkSearch') as HTMLInputElement;
export const networkList = document.getElementById('networkList') as HTMLElement;
export const networkListSummary = document.getElementById('networkListSummary') as HTMLElement;
export const networkDetailPanelTitle = document.getElementById('networkDetailPanelTitle') as HTMLElement;
export const networkDetail = document.getElementById('networkDetail') as HTMLElement;

// Access points panel: list, filters, selection toolbar and summary
export const apList = document.getElementById('apList') as HTMLElement;
export const apFilterInput = document.getElementById('apFilter') as HTMLInputElement;
export const apStatusFilterSelect = document.getElementById('apStatusFilter') as HTMLSelectElement;
export const apGroupFilterSelect = document.getElementById('apGroupFilter') as HTMLSelectElement;
export const apSelectionToolbar = document.getElementById('apSelectionToolbar') as HTMLElement;
export const selectAllApsBtn = document.getElementById('selectAllApsBtn') as HTMLButtonElement;
export const clearApSelectionBtn = document.getElementById('clearApSelectionBtn') as HTMLButtonElement;
export const apSelectionSummary = document.getElementById('apSelectionSummary') as HTMLElement;

// Destination pane: group search, the radio list, the move preview and the
// move button. The AP details pane takes its place while open
export const destinationPanel = document.getElementById('destinationPanel') as HTMLElement;
export const destinationSearchInput = document.getElementById('destinationSearch') as HTMLInputElement;
export const destinationList = document.getElementById('destinationList') as HTMLElement;
export const moveStatus = document.getElementById('moveStatus') as HTMLElement;
export const movePreview = document.getElementById('movePreview') as HTMLElement;
export const moveBtn = document.getElementById('moveBtn') as HTMLButtonElement;

// AP details pane (Access points view): title, Close, content
export const apDetailsPanel = document.getElementById('apDetailsPanel') as HTMLElement;
export const apDetailsPanelTitle = document.getElementById('apDetailsPanelTitle') as HTMLElement;
export const closeApDetailsBtn = document.getElementById('closeApDetailsBtn') as HTMLButtonElement;
export const apDetailsContent = document.getElementById('apDetailsContent') as HTMLElement;

// Panel titles
export const apPanelTitle = document.getElementById('apPanelTitle') as HTMLElement;
export const destinationPanelTitle = document.getElementById('destinationPanelTitle') as HTMLElement;

// Settings Modal
export const settingsModal = document.getElementById('settingsModal') as HTMLElement;
export const settingsModalTitle = settingsModal.querySelector('.modal-header h2') as HTMLElement;
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
