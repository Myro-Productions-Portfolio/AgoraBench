import { useState, useEffect, useRef } from 'react';
import { subscribeToasts, dismiss } from '../lib/toastStore';
import type { Toast, ToastType } from '../lib/toastStore';

/* ── Icons ──────────────────────────────────────────────────────────────── */

function IconInfo() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.7" fill="currentColor" />
    </svg>
  );
}

function IconSuccess() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.7" fill="currentColor" />
    </svg>
  );
}

function IconError() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ── Type config ─────────────────────────────────────────────────────────── */

const TYPE_CONFIG: Record<ToastType, {
  icon: React.ReactNode;
  accent: string;       // left border + icon color
  bg: string;           // card background
  title: string;        // title text color
}> = {
  info: {
    icon: <IconInfo />,
    accent: 'border-gold text-gold',
    bg: 'bg-[#2A2B2F] border border-l-4 border-border border-l-gold',
    title: 'text-stone',
  },
  success: {
    icon: <IconSuccess />,
    accent: 'border-status-passed text-status-passed',
    bg: 'bg-[#2A2B2F] border border-l-4 border-border border-l-status-passed',
    title: 'text-stone',
  },
  warning: {
    icon: <IconWarning />,
    accent: 'border-amber-400 text-amber-400',
    bg: 'bg-[#2A2B2F] border border-l-4 border-border border-l-amber-400',
    title: 'text-stone',
  },
  error: {
    icon: <IconError />,
    accent: 'border-danger text-danger',
    bg: 'bg-[#2A2B2F] border border-l-4 border-border border-l-danger',
    title: 'text-stone',
  },
};

/* ── Single toast card ──────────────────────────────────────────────────── */

function ToastCard({ t }: { t: Toast }) {
  const cfg = TYPE_CONFIG[t.type];
  const [visible, setVisible] = useState(false);

  // Trigger entrance on next paint
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleDismiss() {
    setVisible(false);
    setTimeout(() => dismiss(t.id), 300);
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      onClick={handleDismiss}
      className={`
        relative flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg
        cursor-pointer select-none max-w-sm w-full
        transition-all duration-300 ease-out
        ${cfg.bg}
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}
      `}
    >
      {/* Icon */}
      <span className={`mt-0.5 ${cfg.accent.split(' ')[1]}`}>
        {cfg.icon}
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${cfg.title}`}>
          {t.title}
        </p>
        {t.body && (
          <p className="text-xs text-text-muted mt-0.5 leading-snug line-clamp-2">
            {t.body}
          </p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
        className="shrink-0 text-text-muted hover:text-text-primary transition-colors mt-0.5"
        aria-label="Dismiss notification"
      >
        <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Progress bar */}
      {t.duration > 0 && (
        <ProgressBar duration={t.duration} />
      )}
    </div>
  );
}

/* ── Shrinking progress bar ─────────────────────────────────────────────── */

function ProgressBar({ duration }: { duration: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start at 100% width, animate to 0 over `duration` ms
    el.style.transition = 'none';
    el.style.width = '100%';
    requestAnimationFrame(() => {
      el.style.transition = `width ${duration}ms linear`;
      el.style.width = '0%';
    });
  }, [duration]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-lg overflow-hidden bg-transparent">
      <div ref={ref} className="h-full bg-white/20" />
    </div>
  );
}

/* ── Container ──────────────────────────────────────────────────────────── */

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard t={t} />
        </div>
      ))}
    </div>
  );
}
