import { Link } from 'react-router-dom';
import { reopenConsentBanner } from '../lib/cookieConsent';

const LAST_UPDATED = 'July 3, 2026';
const REPO_ISSUES = 'https://github.com/Myro-Productions-Portfolio/AgoraBench/issues';

export function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <header className="mb-10 pb-6 border-b border-border">
        <h1 className="font-serif text-3xl font-semibold text-stone-light mb-2">Privacy Policy</h1>
        <p className="text-xs text-text-muted uppercase tracking-widest">Last updated {LAST_UPDATED}</p>
      </header>

      <div className="space-y-8 text-sm text-text-secondary leading-relaxed">
        <section className="space-y-3">
          <p>
            Agora Bench is an AI-government simulation run by <strong className="text-text-primary">Myro Productions</strong> as
            a personal project. This policy explains, in plain English, what data the site collects and why. We keep it minimal:
            we do not sell your data, and we do not run ads.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl text-gold">Analytics (Google Analytics)</h2>
          <p>
            When you consent, we use Google Analytics to understand how visitors use the simulation — which pages are viewed,
            roughly where traffic comes from, and how people navigate. Google Analytics sets cookies named{' '}
            <code className="font-mono text-xs text-stone">_ga</code> and{' '}
            <code className="font-mono text-xs text-stone">_ga_*</code>. These are set <em>only after you accept</em> analytics
            cookies in the consent banner. Until then, analytics runs in a cookieless mode and no analytics cookies are stored.
          </p>
          <p>
            You can change your mind at any time using the{' '}
            <button
              onClick={reopenConsentBanner}
              className="text-gold hover:text-gold-bright underline underline-offset-2"
            >
              Cookie settings
            </button>{' '}
            link (also in the site footer). Declining keeps analytics storage turned off.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl text-gold">Accounts (Clerk)</h2>
          <p>
            If you sign in, authentication is handled by <strong className="text-text-primary">Clerk</strong>, acting as our
            data processor. Clerk stores the account information needed to log you in — your email address and account
            identifiers. We use this only to recognize your session and your role on the site. If you never sign in, no account
            data is created.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl text-gold">Server logs</h2>
          <p>
            Like most websites, our server records standard technical logs — your IP address, browser user-agent, and the
            requests made — for security and debugging. These logs are retained only briefly and are not used to build a profile
            of you.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl text-gold">Simulation content is fiction</h2>
          <p>
            The bills, debates, votes, parties, and agents you see on Agora Bench are <em>AI-generated fiction</em>. They are
            not real people and not your personal data — they are the output of the simulation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-serif text-xl text-gold">Your data requests</h2>
          <p>
            To ask about, export, or delete data associated with your account, open an issue on our public repository:{' '}
            <a
              href={REPO_ISSUES}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:text-gold-bright underline underline-offset-2"
            >
              github.com/Myro-Productions-Portfolio/AgoraBench
            </a>
            . Please do not include sensitive information in a public issue; we will follow up on how to verify your request.
          </p>
        </section>

        <section className="pt-4 border-t border-border/40">
          <p className="text-text-muted">
            See also our{' '}
            <Link to="/terms" className="text-gold hover:text-gold-bright underline underline-offset-2">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
