import { describe, it, expect } from 'vitest';
import { isScannerProbePath } from '@core/server/lib/scannerProbeGuard';

describe('isScannerProbePath', () => {
  it('matches .php paths', () => {
    expect(isScannerProbePath('/goods.php')).toBe(true);
    expect(isScannerProbePath('/foo/bar.php')).toBe(true);
    expect(isScannerProbePath('/.well-known/x.php')).toBe(true);
  });

  it('matches /wp- and /wordpress prefixes', () => {
    expect(isScannerProbePath('/wp-includes/foo.js')).toBe(true);
    expect(isScannerProbePath('/wp-admin/')).toBe(true);
    expect(isScannerProbePath('/wp-login.php')).toBe(true);
    expect(isScannerProbePath('/wordpress/wp-login')).toBe(true);
  });

  it('matches /.env exactly', () => {
    expect(isScannerProbePath('/.env')).toBe(true);
  });

  it('ignores query strings and hashes when matching', () => {
    expect(isScannerProbePath('/goods.php?id=1')).toBe(true);
    expect(isScannerProbePath('/wp-admin/?page=1')).toBe(true);
  });

  it('does not match legitimate SPA routes', () => {
    expect(isScannerProbePath('/world')).toBe(false);
    expect(isScannerProbePath('/divergence')).toBe(false);
    expect(isScannerProbePath('/agents/42')).toBe(false);
    expect(isScannerProbePath('/')).toBe(false);
  });

  it('does not match api/mcp/ws paths', () => {
    expect(isScannerProbePath('/api/health')).toBe(false);
    expect(isScannerProbePath('/mcp')).toBe(false);
    expect(isScannerProbePath('/ws')).toBe(false);
  });

  it('does not match .env-like paths outside the exact literal', () => {
    expect(isScannerProbePath('/.envrc')).toBe(false);
    expect(isScannerProbePath('/config/.env')).toBe(false);
  });

  it('does not match unrelated paths containing "php" or "wp" mid-string', () => {
    expect(isScannerProbePath('/php-tutorial')).toBe(false);
    expect(isScannerProbePath('/growth')).toBe(false);
    expect(isScannerProbePath('/swap')).toBe(false);
  });

  it('handles non-string/empty input defensively', () => {
    // @ts-expect-error deliberate bad input
    expect(isScannerProbePath(undefined)).toBe(false);
    // @ts-expect-error deliberate bad input
    expect(isScannerProbePath(null)).toBe(false);
    expect(isScannerProbePath('')).toBe(false);
  });
});
