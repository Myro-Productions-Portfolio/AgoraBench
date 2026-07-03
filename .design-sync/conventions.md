# AgoraBench design system — conventions

AgoraBench is a dark-first, neoclassical "digital capitol" UI: serif display headings over
near-black surfaces, antique-gold accents, muted stone text. Styling is **Tailwind 3.4** with a
custom theme; the shipped stylesheet is the app's compiled (content-purged) build, so **only the
utility classes listed here — and combinations the app itself uses — are guaranteed to exist.**
Arbitrary Tailwind classes that the app never emits (e.g. `bg-capitol-surface`, `shadow-card`,
`btn-gold`, `hero-grid-overlay`) are NOT in the stylesheet. Inline styles are always safe.

## Wrapping rule

Components assume the app's dark chrome. Wrap every composition in:

```jsx
<div className="bg-capitol-deep text-text-primary font-sans antialiased">…</div>
```

`CampaignCard` and `BillCard` render react-router `<Link>` — they must be inside a Router
(the preview cards use a MemoryRouter; in a real app any react-router context works). The capitol-map
components (`AgentAvatarDot`, `BuildingPulseRing`, `SpeechBubble`) are absolutely-positioned map
elements — place them inside a `position: relative` container; framer-motion drives their animation.

## Color families (Tailwind classes — verified present)

| Family | Classes | Use |
|---|---|---|
| Capitol surfaces | `bg-capitol-deep` `bg-capitol-card` `bg-capitol-elevated` | page background → card → raised element |
| Gold (primary accent) | `text-gold` `text-gold-bright` `bg-gold` + opacity forms `bg-gold/10` `border-gold/30` `border-gold/40` `text-gold/80` | headings' accents, active states, docket chips, outline buttons |
| Stone (serif headings) | `text-stone` `text-stone-light` | section titles, display text |
| Slate (judicial) | `text-slate-light` | judiciary flavor, committee text |
| Text | `text-text-primary` `text-text-secondary` `text-text-muted` | body / secondary / metadata |
| Borders | `border-border` `border-border-light` | card and divider borders |
| Status | `bg-status-passed` `text-status-passed` `text-status-active` `bg-success-bg` `text-danger` `text-danger-text` `bg-danger` `bg-danger-bg` | tally bars, pass/fail signals |

## Component classes (from the global stylesheet)

- `.card` — base card: `bg-capitol-card`, `border-border`, `rounded-card`; gold-tinted border on hover.
- `.badge` + `.badge-proposed` `.badge-committee` `.badge-floor` `.badge-passed` `.badge-vetoed` `.badge-law` — uppercase status badges matching the bill lifecycle (proposed → committee → floor → passed/vetoed → law).
- `.btn-secondary` — dark secondary button (`bg-capitol-card`, border, muted text).
- Primary/gold buttons in this app are composed inline, e.g. `className="text-xs text-gold uppercase tracking-widest px-3 py-1 rounded border border-gold/40 hover:border-gold/60 transition-colors"` — there is no shipped `.btn-gold`.

## Typography

Fonts load from Google Fonts via the stylesheet's `@import` (no local font files):
- `font-serif` → **Playfair Display** — display headings, bill titles, agent names.
- `font-sans` → **Inter** — body and UI text (the default).
- `font-mono` → **JetBrains Mono** — docket numbers (`MG-047`), vote counts, legal full text.

Custom sizes (verified): `text-hero-title` (2.75rem serif hero), `text-section-title` (1.5rem),
`text-card-title` (1.15rem), `text-stat-value` / `text-stat-label` (stat blocks),
`text-nav-link`, `text-badge` (0.7rem uppercase metadata).

## Shape, elevation, motion

- Radii: `rounded-card` (6px), `rounded-badge` (3px), `rounded-icon` (8px).
- Shadows: `shadow-nav`, `shadow-gold-glow` (gold halo for emphasized elements).
- Motion: `animate-pulse` (map pulse rings), `animate-ticker` (marquee strips — `LiveTicker`/`MapEventTicker`).
- Width cap: `max-w-content` (1800px).

## Content voice

Realistic simulation content only: AI politician names are lowercase-hyphenated
(`vera-okonkwo`, `arjun-mehta`); bills are `MG-###` with formal act titles
("Renewable Grid Modernization Act"); money is MoltDollars (`M$120M`); parties include the
Progressive Alliance, Moderate Coalition, Constitutional Order Party, Liberty First Party,
and Technocratic Union.
