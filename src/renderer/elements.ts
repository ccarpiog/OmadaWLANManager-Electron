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
export const toastContainer = document.getElementById('toastContainer') as HTMLElement;
export const apList = document.getElementById('apList') as HTMLElement;
export const wlanList = document.getElementById('wlanList') as HTMLElement;
export const apFilterInput = document.getElementById('apFilter') as HTMLInputElement;
export const wlanFilterInput = document.getElementById('wlanFilter') as HTMLInputElement;
export const selectionInfo = document.getElementById('selectionInfo') as HTMLElement;
export const applyBtn = document.getElementById('applyBtn') as HTMLButtonElement;

// Panel titles
export const apPanelTitle = document.querySelector('.panel:first-child .panel-title') as HTMLElement;
export const wlanPanelTitle = document.querySelector('.panel:last-child .panel-title') as HTMLElement;

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

// Confirm Modal
export const confirmModal = document.getElementById('confirmModal') as HTMLElement;
export const confirmModalTitle = confirmModal.querySelector('.modal-header h2') as HTMLElement;
export const confirmMessage = document.getElementById('confirmMessage') as HTMLElement;
export const cancelConfirmBtn = document.getElementById('cancelConfirmBtn') as HTMLButtonElement;
export const confirmConfirmBtn = document.getElementById('confirmConfirmBtn') as HTMLButtonElement;

// Site Selection Modal (multi-site controllers)
export const siteModal = document.getElementById('siteModal') as HTMLElement;
export const siteModalTitle = document.getElementById('siteModalHeading') as HTMLElement;
export const siteModalMessage = document.getElementById('siteModalMessage') as HTMLElement;
export const siteListContainer = document.getElementById('siteList') as HTMLElement;
export const cancelSiteBtn = document.getElementById('cancelSiteBtn') as HTMLButtonElement;
