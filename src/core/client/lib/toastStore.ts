/* ── Toast Store ──────────────────────────────────────────────────────────
   Module-level singleton — no React context required.
   Any module can call toast() and the ToastContainer will pick it up.
─────────────────────────────────────────────────────────────────────────── */

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
  duration: number; // ms before auto-dismiss
}

type Listener = (toasts: Toast[]) => void;

let _toasts: Toast[] = [];
const _listeners = new Set<Listener>();
const MAX_TOASTS = 5;
let _seq = 0;

function notify() {
  _listeners.forEach((fn) => fn([..._toasts]));
}

export function toast(
  title: string,
  options?: { body?: string; type?: ToastType; duration?: number },
): string {
  const id = `toast-${++_seq}`;
  const item: Toast = {
    id,
    type: options?.type ?? 'info',
    title,
    body: options?.body,
    duration: options?.duration ?? 5000,
  };

  // Cap at MAX_TOASTS — drop the oldest
  _toasts = [..._toasts.slice(-(MAX_TOASTS - 1)), item];
  notify();

  if (item.duration > 0) {
    setTimeout(() => dismiss(id), item.duration);
  }

  return id;
}

export function dismiss(id: string): void {
  _toasts = _toasts.filter((t) => t.id !== id);
  notify();
}

export function subscribeToasts(fn: Listener): () => void {
  _listeners.add(fn);
  fn([..._toasts]); // immediately emit current state
  return () => _listeners.delete(fn);
}
