import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  needsConsentDecision,
  setConsent,
  applyStoredConsentOnLoad,
  onReopenBanner,
} from '../lib/cookieConsent';

/**
 * Bottom cookie-consent banner. Shown when no choice is recorded in
 * localStorage (or after the footer "Cookie settings" link re-opens it).
 * Mounted at the App root so it also covers the standalone /observe route.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const acceptRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Re-apply a previously granted choice so returning visitors keep analytics.
    applyStoredConsentOnLoad();
    if (needsConsentDecision()) setVisible(true);
    // Footer "Cookie settings" re-opens the banner.
    return onReopenBanner(() => setVisible(true));
  }, []);

  // Move focus into the banner when it appears (accessibility).
  useEffect(() => {
    if (visible) acceptRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  function accept() {
    setConsent('granted');
    setVisible(false);
  }

  function decline() {
    setConsent('denied');
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-heading"
      className="fixed bottom-0 inset-x-0 z-[60] border-t border-border shadow-nav"
      style={{ background: 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)' }}
    >
      <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 text-sm text-text-secondary leading-relaxed">
          <p id="cookie-consent-heading">
            We use analytics cookies (Google Analytics) to understand how visitors use the
            simulation. Nothing is set until you accept.{' '}
            <Link to="/privacy" className="text-gold hover:text-gold-bright underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={decline}
            className="text-xs uppercase tracking-widest px-4 py-2 rounded border border-border/60 text-text-secondary hover:text-text-primary hover:border-border transition-colors"
          >
            Decline
          </button>
          <button
            ref={acceptRef}
            onClick={accept}
            className="text-xs uppercase tracking-widest px-4 py-2 rounded border border-gold/50 text-gold hover:text-gold-bright hover:border-gold/70 bg-gold/[0.06] transition-colors"
          >
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
