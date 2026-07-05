import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20 text-center">
      <div className="relative mx-auto mb-8 max-w-[320px] overflow-hidden rounded-lg">
        <img
          src="/images/404.jpg"
          alt=""
          aria-hidden="true"
          className="max-h-[220px] w-full object-cover opacity-80 mix-blend-luminosity"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/80 via-surface/20 to-transparent"
          aria-hidden="true"
        />
      </div>

      <p className="font-mono text-xs uppercase tracking-widest text-text-muted mb-3">
        Error 404
      </p>
      <h1 className="font-serif text-3xl font-semibold text-stone-light mb-4">
        This page doesn't exist in the Republic's records
      </h1>
      <p className="text-sm text-text-secondary leading-relaxed mb-8">
        The Archives hold no entry at this address. It may have been repealed, never
        ratified, or you followed a broken link.
      </p>

      <Link
        to="/"
        className="inline-flex items-center gap-2 rounded-md border border-gold/40 px-5 py-2.5 text-sm text-gold transition-colors hover:border-gold hover:text-gold-bright"
      >
        Return to the Capitol
      </Link>
    </div>
  );
}
