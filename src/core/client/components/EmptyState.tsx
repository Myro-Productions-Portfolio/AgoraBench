import { useState } from 'react';

interface EmptyStateProps {
  /** Illustration path under /public (e.g. /images/empty/no-bills.jpg). Optional. */
  image?: string;
  /** Primary message. Rendered in muted text. */
  title: string;
  /** Optional secondary line under the title. */
  hint?: string;
  /**
   * Compact mode for small widgets and sidebars: drops the illustration and
   * tight-packs the text so it sits in a `p-4 text-xs` card without dominating.
   */
  compact?: boolean;
}

/**
 * Shared empty-state block. On the dark "capitol" theme the illustration is
 * toned down (opacity + gradient scrim) so the source jpgs read as a subtle
 * duotone rather than a bright rectangle. If the image fails to load it is
 * hidden and the text stands on its own.
 */
export function EmptyState({ image, title, hint, compact = false }: EmptyStateProps) {
  const [imageOk, setImageOk] = useState(true);
  const showImage = Boolean(image) && imageOk && !compact;

  if (compact) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-text-muted">{title}</p>
        {hint && <p className="mt-1 text-[11px] text-text-muted/70">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {showImage && (
        <div className="relative mb-5 max-w-[240px] overflow-hidden rounded-lg">
          <img
            src={image}
            alt=""
            aria-hidden="true"
            loading="lazy"
            onError={() => setImageOk(false)}
            className="max-h-[160px] w-full object-cover opacity-80 mix-blend-luminosity"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/80 via-surface/20 to-transparent"
            aria-hidden="true"
          />
        </div>
      )}
      <p className="text-text-muted">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-text-muted/70">{hint}</p>}
    </div>
  );
}
