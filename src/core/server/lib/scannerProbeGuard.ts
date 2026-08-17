/**
 * F7 — scanner-probe guard. Vulnerability scanners hammer WP/PHP paths that
 * this app never serves; the SPA catch-all was answering them with 200
 * (index.html), which pollutes logs and reads as a hit to the scanner.
 * Literal/prefix checks only — no regex cleverness, no false positives on
 * real SPA routes.
 */

const PROBE_PREFIXES = ['/wp-', '/wordpress'];
const PROBE_EXACT = ['/.env'];

/** True if the path matches a known scanner-probe pattern (not a real route). */
export function isScannerProbePath(pathname: string): boolean {
  if (typeof pathname !== 'string' || pathname.length === 0) return false;
  // Express doesn't case-normalize req.path, but scanners vary case deliberately.
  const path = pathname.split('?')[0].split('#')[0].toLowerCase();
  if (path.endsWith('.php')) return true;
  if (PROBE_EXACT.includes(path)) return true;
  return PROBE_PREFIXES.some((prefix) => path.startsWith(prefix));
}
