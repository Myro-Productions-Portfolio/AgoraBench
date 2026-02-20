/**
 * Shared utility for the Live Ticker enabled/disabled preference.
 * Stored in localStorage; components sync via a custom window event
 * so they don't need shared React state.
 */

const STORAGE_KEY = 'mg_ticker_dismissed';
const CHANGE_EVENT = 'mg:ticker:change';

/** Returns true when the ticker should be shown. */
export function isTickerEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'true';
}

/** Enable or disable the ticker. Persists to localStorage and notifies listeners. */
export function setTickerEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, 'true');
  }
  window.dispatchEvent(new CustomEvent<{ enabled: boolean }>(CHANGE_EVENT, { detail: { enabled } }));
}

/** Subscribe to preference changes. Returns a cleanup function. */
export function onTickerChange(handler: (enabled: boolean) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<{ enabled: boolean }>).detail.enabled);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
