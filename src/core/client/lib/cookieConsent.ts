/**
 * Cookie consent for Google Analytics (Consent Mode v2).
 *
 * index.html sets the Consent Mode default to `denied` before gtag config
 * runs, so GA sends only cookieless pings until the visitor opts in. This
 * module records the visitor's choice in localStorage and fires the
 * `consent update` that unlocks analytics_storage.
 *
 * Components sync via a custom window event (same pattern as tickerPrefs) so
 * the footer "Cookie settings" link can re-open the banner without shared
 * React state.
 */

const STORAGE_KEY = 'agorabench-cookie-consent';
const OPEN_EVENT = 'agorabench:cookie:reopen';

export type ConsentValue = 'granted' | 'denied';

type GtagFn = (...args: unknown[]) => void;

function getGtag(): GtagFn | null {
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === 'function' ? g : null;
}

/** The stored consent choice, or null if the visitor has not chosen yet. */
export function getStoredConsent(): ConsentValue | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

/** True when the banner should be shown (no choice recorded yet). */
export function needsConsentDecision(): boolean {
  return getStoredConsent() === null;
}

/** Push a Consent Mode update for analytics_storage. */
function updateGtagConsent(value: ConsentValue): void {
  getGtag()?.('consent', 'update', { analytics_storage: value });
}

/**
 * Record the visitor's choice, persist it, and update GA consent.
 * Called by the banner's Accept / Decline buttons.
 */
export function setConsent(value: ConsentValue): void {
  localStorage.setItem(STORAGE_KEY, value);
  updateGtagConsent(value);
}

/**
 * On app load, re-apply a previously granted choice so analytics_storage is
 * unlocked for returning visitors. A stored 'denied' needs no action — the
 * Consent Mode default is already 'denied'.
 */
export function applyStoredConsentOnLoad(): void {
  if (getStoredConsent() === 'granted') {
    updateGtagConsent('granted');
  }
}

/**
 * Re-open the consent banner (footer "Cookie settings" link). Clears the
 * stored choice so the banner re-prompts, and notifies any mounted banner.
 */
export function reopenConsentBanner(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/** Subscribe to "re-open banner" requests. Returns a cleanup function. */
export function onReopenBanner(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
