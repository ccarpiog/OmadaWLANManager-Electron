// ============================================================================
// Internationalization: the lookup helpers in the active language (t(),
// tFormat(), translate(), tGroup()) over the es/en string tables of
// i18n-strings.ts, whose `Translations` interface enforces key parity
// between the two languages. Applying the strings to the static UI lives in
// apply-translations.ts.
// ============================================================================

import type { GroupModel, Language } from '../shared/types';
import { formatMessage, translations, type Translations } from './i18n-strings';
import { state } from './state';

export type { Translations } from './i18n-strings';

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
 * placeholders (first occurrence of each) with the given values
 * (formatMessage(): each value is inserted verbatim).
 * @param {keyof Translations} key - The translation key.
 * @param {Record<string, string>} vars - Placeholder names mapped to values.
 * @returns {string} The localized, formatted string.
 */
export function tFormat(key: keyof Translations, vars: Record<string, string>): string {
  return formatMessage(translations[state.currentLanguage][key], vars);
}

/**
 * Looks up a UI string in the active language, with its placeholders
 * substituted when values are given: the translator the pure text builders
 * take (e.g. network-editing.ts), so the unit tests can run them over either
 * language table.
 * @param {keyof Translations} key - The translation key.
 * @param {Record<string, string>} [vars] - Placeholder names mapped to values.
 * @returns {string} The localized string.
 */
export function translate(key: keyof Translations, vars?: Record<string, string>): string {
  return vars === undefined ? t(key) : tFormat(key, vars);
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
