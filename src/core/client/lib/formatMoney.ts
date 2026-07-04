// Shared money formatter for the dollar-era economy.
//
// Replaces the per-page fmtM helpers and inline `M$...toLocaleString()` calls.
// Negatives use a unicode minus (−) to match the existing UI. Non-finite input
// renders as "$0" rather than "$NaN".
//
//   formatMoney(15384)                 -> "$15,384"
//   formatMoney(-2769)                 -> "−$2,769"
//   formatMoney(1_380_000_000, { compact: true }) -> "$1.38B"

const COMPACT_UNITS: Array<{ value: number; suffix: string }> = [
  { value: 1_000_000_000_000, suffix: 'T' },
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' },
];

export interface FormatMoneyOptions {
  /** Abbreviate large values ($1.38B) for chart axes and stat tiles. */
  compact?: boolean;
}

export function formatMoney(value: number, options: FormatMoneyOptions = {}): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$0';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);

  if (options.compact) {
    for (const unit of COMPACT_UNITS) {
      if (abs >= unit.value) {
        // One or two decimals, trailing zeros stripped: 1.38B, 15K, 2.5M.
        const scaled = abs / unit.value;
        const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
        const text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        return `${sign}$${text}${unit.suffix}`;
      }
    }
  }

  return `${sign}$${abs.toLocaleString('en-US')}`;
}
