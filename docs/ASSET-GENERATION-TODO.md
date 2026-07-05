# Asset Generation Brief

## Mission briefing (read this first)

You are a fresh Claude session. Your job: generate the missing image assets for AgoraBench with
ComfyUI (Flux models) on the DGX Sparks, then wire them into the repo. This document is your entire
context — everything you need is here. Do not assume prior conversation.

What the site is: AgoraBench (agorabench.com) is a political-governance simulation where AI agents
hold office, vote on legislation, run for election, debate in forums, and respond to economic
conditions. It is a spectator-facing "watch the AI government run" site with a dark, neoclassical,
faintly-satirical aesthetic. The visual north star is "a stage, not a document" — dignified,
dark-mode, government-broadcast feel.

Where assets live: `public/` in the repo root. Subdirs:
`public/images/{branches,buildings,empty,interiors,map-backgrounds,parties}`, plus top-level
`public/images/hero-capitol.jpg`, `public/og-image.jpg`, `public/images/404.jpg`, and the favicon
set (`public/favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `favicon-theme.webp`). Assets are
served straight from `public/` by Vite in dev and Express in prod — no build-time import needed for
these file paths, so dropping a correctly-named file into the right subdir is enough (except where a
hardcoded map in code must also be edited — flagged per item).

ComfyUI access: use the `comfyui-spark2` MCP tools — `generate_image` / `queue_image_job` to
enqueue, `check_job` to poll, `get_output_file` to pull the result PNG (returned base64). The model
family is Flux. Generate at PNG, then convert to WebP locally (see conversion recipe below).

Git flow (do NOT push to main directly; the repo blocks edits on main via a hook):
1. Branch: `git checkout -b feat/asset-generation` (or reuse the branch this doc is on if told to).
2. Add finished assets + any code edits, commit locally.
3. Push to GitHub origin (`git@github.com:Myro-Productions-Portfolio/AgoraBench.git`).
4. Open a PR to `main`.
5. Deploy after merge: on the Linux box (10.0.0.10):
   `ssh myroproductions@10.0.0.10 "cd /home/myroproductions/Projects/AgoraBench && git pull && pnpm run deploy >> /tmp/agorabench-deploy.log 2>&1 &"`

---

## Conversion + integration recipe (applies to every item)

1. Generate the PNG on ComfyUI at the dimensions listed for the item (or larger, then downscale).
2. Pull the PNG to a scratch dir on this Mac (NOT into `public/` yet).
3. Convert to WebP:
   - Opaque (backgrounds, hero, map): `cwebp -q 85 in.png -o out.webp`
   - Transparent (party logos, building/branch icons — MUST keep alpha):
     `cwebp -q 90 -alpha_q 100 in.png -o out.webp`
   - Resize if needed before/after: `sips -Z <maxEdgePx> in.png` or `cwebp -resize W H`.
4. Check the KB budget listed per item (sized to match existing siblings so the page weight stays
   consistent). If over budget, drop `-q` a few points or downscale.
5. Move the final `.webp` to the exact `public/images/...` path with the exact filename given.
6. Make any code edit flagged for the item.
7. Verify against the item's acceptance criteria before committing.

Verify visually before claiming done: load the affected page (`pnpm dev` locally, or check the
deployed site) and confirm the asset renders where expected and matches the acceptance criteria —
not just that the file exists.

---

## Global style guide (bake into every prompt)

Palette — use these exact hex values in prompts:

```
Charcoal Deep:    #1A1B1E     Gold Default:  #B8956A
Charcoal Card:    #2B2D31     Gold Bright:   #D4A96A
Charcoal Surface: #35373C     Gold Muted:    #A07E5A
Stone/Beige:      #C9B99B     Slate Judicial:#6B7A8D
Text Primary:     #E8E6E3     Green/Pass:    #4CAF50
Text Secondary:   #9B9D9F     Red/Danger:    #C75050
```

Mood: neoclassical government architecture, dignified, dark-mode optimized, serious with a faint
political-satire undertone (AI agents governing themselves). Every asset must read cleanly on a
`#1A1B1E` (near-black charcoal) background without haloing or a visible bounding box.

Global negative-prompt hints (append to every prompt's negative field): `bright colors, high
saturation, neon, white background, light mode, daytime sky, photorealistic humans, cartoonish,
comic book, anime, cryptocurrency imagery, blockchain, coins, watermark, signature, text artifacts,
jpeg artifacts, blurry, soft focus, lens flare`.

Aesthetic per category (reference — details in each item):
- Party logos: clean modern heraldic emblem, circular badge, muted gold + stone, transparent alpha,
  512x512. Match the three shipped logos (cop/tu) in weight and framing.
- Map background: flat top-down illustrated city map, geometric, near-black. Full spec below.
- Building icons: flat cel-shaded isometric, Civ-VI district-icon look. (Already complete — do not
  generate; listed in the settled section only for reference.)

---

## Priority 1 — Party logos (owner priority)

The live production party roster diverged from the original design brief (which assumed DPA/COP/TU).
The production DB now has five active parties; three have no logo file. This is the owner's top
priority.

Live production party roster (queried 2026-07-04 from `molt-gov-postgres` on 10.0.0.10):

| Party name                 | Abbrev | Active | Expected logo file               | Status             |
|----------------------------|--------|--------|----------------------------------|--------------------|
| Progressive Alliance       | PA     | yes    | `public/images/parties/pa.webp`  | MISSING — generate |
| Moderate Coalition         | MC     | yes    | `public/images/parties/mc.webp`  | MISSING — generate |
| Constitutional Order Party | COP    | yes    | `public/images/parties/cop.webp` | EXISTS             |
| Liberty First Party        | LFP    | yes    | `public/images/parties/lfp.webp` | MISSING — generate |
| Technocratic Union         | TU     | yes    | `public/images/parties/tu.webp`  | EXISTS             |

To re-verify the roster yourself before generating (recommended — parties can change):
`ssh myroproductions@10.0.0.10 "sudo docker exec molt-gov-postgres psql -U molt_gov -d molt_government -c 'SELECT name, abbreviation, is_active FROM parties ORDER BY created_at;'"`

Note on `dpa.webp`: `public/images/parties/dpa.webp` exists but no DPA party exists in the DB
anymore (the progressive party is now "Progressive Alliance" / PA). It is dead weight referenced by
nothing after the code edit below removes it from the map. You may delete it in the same commit.

### Common spec for all three logos

- Output path: `public/images/parties/<abbr>.webp` — filename is the lowercased abbreviation:
  `pa.webp`, `mc.webp`, `lfp.webp`.
- Dimensions: 512x512 (square). Matches shipped cop.webp / tu.webp exactly.
- Format: WebP WITH alpha (transparent background). Convert:
  `cwebp -q 90 -alpha_q 100 in.png -o <abbr>.webp`.
- KB budget: aim 30–150 KB (shipped siblings: dpa 33KB, cop 50KB, tu 144KB). Under 150KB.
- Generate the PNG at 1024x1024 on ComfyUI for detail headroom, then downscale to 512 on convert.

### Required code edit (logos will NOT show without it)

`src/modules/elections/client/pages/PartiesPage.tsx` has a hardcoded `PARTY_LOGO_MAP`
(around lines 50–54) and `resolvePartyLogo()` (around line 56) that looks up
`PARTY_LOGO_MAP[abbreviation.toLowerCase()]`. There is no generic path builder here, so a new file
alone is invisible on the Parties page. Update the map to the real roster:

```ts
const PARTY_LOGO_MAP: Record<string, string> = {
  pa:  '/images/parties/pa.webp',
  mc:  '/images/parties/mc.webp',
  cop: '/images/parties/cop.webp',
  lfp: '/images/parties/lfp.webp',
  tu:  '/images/parties/tu.webp',
};
```

(Add `pa`, `mc`, `lfp`; drop the stale `dpa`.) The agent profile page
(`src/modules/agents/client/pages/AgentProfilePage.tsx`, around line 1366) already builds the path
directly as `/images/parties/${party.abbreviation.toLowerCase()}.webp` with an `onError` that hides
the image, so it needs NO code change — the correctly-named file is enough there.

Graceful fallback (so a missing logo never breaks the site): `PartiesPage` renders a text tile
(abbreviation in a gold-on-dark bordered box) when no logo resolves; `AgentProfilePage` hides the
broken img. So the site is not broken today — the missing logos just look unfinished.

### Per-logo generation prompts (ready to paste)

PA — Progressive Alliance (progressive alignment):
> Positive: "Political party emblem for the 'Progressive Alliance', a heraldic circular badge. A
> stylized forward-pointing arrow rising over a minimal circuit-tree / rising-sun motif, symbolizing
> growth and technology and forward momentum. Clean modern flat vector heraldry, crisp geometric
> lines, subtle metallic sheen. Colors strictly from this palette: muted gold #B8956A and #D4A96A
> for the emblem, warm stone #C9B99B for secondary detail, on a fully transparent background.
> Dignified neoclassical government-seal aesthetic with a modern edge. Centered, symmetrical, reads
> clearly as a small icon. 512x512, no text, no lettering."
> Negative: [global hints] + "no white circle background, no drop shadow box, no photographic
> texture, no gradient background fill, no 3D render."
> Acceptance: transparent background (no white/dark box); reads clearly at 48px (its display size on
> PartiesPage cards) and at 14px (agent profile inline); sits on `#1A1B1E` with no halo; palette
> stays gold/stone; visually a sibling of cop.webp and tu.webp, not brighter or more saturated.

MC — Moderate Coalition (moderate alignment):
> Positive: "Political party emblem for the 'Moderate Coalition', a heraldic circular badge. A
> balanced motif: a centered classical bridge or a pair of joined laurel branches or an even scale,
> symbolizing compromise and unity between factions. Clean modern flat vector heraldry, crisp
> geometric symmetry. Colors strictly from this palette: warm stone #C9B99B and slate blue #6B7A8D,
> with a restrained muted gold #B8956A accent, on a fully transparent background. Dignified,
> centrist, calm, neoclassical government-seal aesthetic. Centered, symmetrical, reads clearly as a
> small icon. 512x512, no text, no lettering."
> Negative: [global hints] + "no white circle background, no drop shadow box, no partisan red or
> partisan blue dominance, no 3D render, no gradient background fill."
> Acceptance: transparent background; reads at 48px and 14px; sits on `#1A1B1E` with no halo;
> palette stone/slate/gold and clearly calmer/cooler than the other emblems; sibling weight to
> cop.webp.

LFP — Liberty First Party (libertarian alignment):
> Positive: "Political party emblem for the 'Liberty First Party', a heraldic circular badge. A
> liberty motif: an upright torch, or a stylized eagle silhouette, or a broken chain, symbolizing
> individual freedom and self-reliance. Clean modern flat vector heraldry, crisp geometric lines.
> Colors strictly from this palette: muted gold #B8956A and #D4A96A as the primary, with a single
> restrained muted red #C75050 accent, on a fully transparent background. Dignified, bold,
> neoclassical government-seal aesthetic. Centered, symmetrical, reads clearly as a small icon.
> 512x512, no text, no lettering."
> Negative: [global hints] + "no white circle background, no drop shadow box, no bright fire glow,
> no 3D render, no gradient background fill, no American-flag stars-and-stripes."
> Acceptance: transparent background; reads at 48px and 14px; sits on `#1A1B1E` with no halo; gold
> primary with only a small red accent (not a red-dominant emblem); sibling weight to cop.webp.

### Future parties

A new party created in the sim with no logo file falls back to the text tile (PartiesPage) and a
hidden img (profile) — it degrades safely, and there is NO shared generic emblem asset wired in.
If the owner later wants a generic placeholder emblem, generate one and wire it as the
`resolvePartyLogo` default return; otherwise the text-tile fallback is the intended "no logo yet"
state. Do not generate a generic fallback unless asked.

---

## Priority 2 — Map background v2 (4K regeneration)

- Output path: `public/images/map-backgrounds/capitol-map-v1.webp` (overwrite; single consumer, so
  keeping the filename keeps the code reference stable).
- Consumed at: `src/modules/government/client/pages/CapitolMapPage.tsx` line ~231
  (`src="/images/map-backgrounds/capitol-map-v1.webp"`). No code edit needed if you overwrite the
  filename.
- Dimensions: 3840x2160 (4K, 16:9). The shipped image is only 2752x1536. The map is a FUNCTIONAL
  layout — interactive building cards are absolutely positioned at CSS percentages over it, and the
  road/zone coordinate math and the alignment checklist in the source spec are pinned to 3840x2160.
  Regenerating at the correct resolution is the point of this item.
- Format: WebP, opaque (no alpha). `cwebp -q 85`.
- KB budget: shipped v1 is ~106 KB. A 4K version will be larger; keep it under ~400 KB
  (`-q 80..85`), it is a single full-page background so a bit of weight is acceptable, but do not
  ship a multi-MB file.
- Prompt: DO NOT write your own. Use the full Primary Prompt and Negative Prompt VERBATIM from
  `docs/archive/MAP-BACKGROUND-PROMPT.md`. That document carries the exact road positions, the seven
  clear building-footprint zones, the exact palette, and a pixel-coordinate Verification Checklist.
  Paraphrasing it will break card alignment.
- Acceptance criteria (from the source spec's checklist — run it before shipping):
  - Each of the seven building-footprint zones is visually clear (no roads, tree dots, or labels
    inside the rectangle). Zones at 3840x2160: Capitol (1536–2304 x, 540–864 y), Executive Mansion
    (576–1114 x, 432–691 y), Supreme Court (2611–3149 x, 475–734 y), Treasury (768–1229 x,
    1080–1296 y), Party Hall (2688–3149 x, 1080–1296 y), National Archives (1728–2112 x, 1188–1361
    y), Election Center (1728–2189 x, 1620–1836 y).
  - Constitution Avenue is a visible horizontal band at ~y=950px; the two diagonals (Pennsylvania
    Ave upper-left→center, Supreme Court Connector center→upper-right) are visible and skirt the
    zones without cutting through them.
  - No bright colors anywhere; all fills near-black charcoal; no text above ~15% opacity.
  - Final check: after shipping, load `/capitol-map` and confirm building cards land on the clear
    dark zones, not on roads.

---

## Priority 3 — no-agents empty-state (wiring decision, NOT a generation task)

- File on disk: `public/images/empty/no-agents.jpg` — ALREADY EXISTS (108 KB, matches its three
  siblings). It is referenced by NOTHING in the code. Verified: only `no-activity.jpg`
  (`ActivityPage.tsx:383`), `no-campaigns.jpg` (`DashboardPage.tsx:439`), and `no-bills.jpg`
  (`LegislationPage.tsx:212`) are passed to the `EmptyState` component.
- `EmptyState` (`src/core/client/components/EmptyState.tsx`) shows the image at up to 240px wide /
  160px tall, with `mix-blend-luminosity` + a gradient scrim, and only when NOT in `compact` mode.
  The agents-directory empty state either uses `compact` or passes no `image`, so `no-agents.jpg`
  never appears.
- This is NOT an image-generation gap — the asset exists. It is a code decision:
  - Option A (recommended — wire it): in
    `src/modules/agents/client/pages/AgentsDirectoryPage.tsx`, find the "no agents found" render and
    pass `image="/images/empty/no-agents.jpg"` in non-compact mode.
  - Option B (drop): delete `no-agents.jpg` as an orphan in a cleanup commit.
- Only regenerate the image if, once wired, it visibly clashes with the other three empty-states.
  Default: wire the existing asset; do not generate.

---

## Settled — do NOT generate

- Agent avatars: procedurally generated by `PixelAvatar` (deterministic, seeded per agent) across
  every page. The design briefs (`docs/design-briefs/06-agent-dossiers.md`) build on PixelAvatar,
  not on image files. Do not generate agent portraits. (Legacy `agent-01..09` files in an old backup
  dir are unused — ignore them.)
- UI icons: a code-side SVG set at `src/core/client/components/icons/index.tsx`. Do not generate
  branch icons, nav glyphs, or any UI icon as an image. (Old `public/images/branches/*.webp` still
  exist and are referenced in a couple of spots, but new iconography goes in the SVG set.)
- Building interior images: complete, 7/7 in `public/images/interiors/` (archives, capitol,
  election-center, executive, party-hall, supreme-court, treasury), 2752x1536 webp, consumed by
  `BuildingInteriorPage.tsx`. Done.
- Building map thumbnails: complete, 7/7 in `public/images/buildings/` (archives, capitol, court,
  election-center, executive, party-hall, treasury), 800x800 webp. Done.
- Hero art: `public/images/hero-capitol.jpg` (1920x595) exists, used at `DashboardPage.tsx:283`.
  Design brief 01 states this background "is already available for texture" and directs the redesign
  toward a live Capitol-map hero built from existing components, not new hero art. Briefs 02–06 call
  for no new hero/backdrop image files — their "hero" sections are CSS/typography (Gazette masthead
  = serif wordmark; dossier portrait frame = PixelAvatar in an ornate CSS border). No new hero art.
- Favicon set: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `favicon-theme.webp` all
  exist. The original brief's `favicon-16x16.png` / `favicon-32x32.png` are obsolete (ico + svg
  cover those sizes). Do not generate them.
- OG image: `public/og-image.jpg` (1200x630) exists, referenced by a single global `og:image` tag
  in `index.html:38`. There is NO per-page OG support (one static head; no Helmet/Head manager
  injects per-route tags). Page-specific OG images would need CODE FIRST — out of scope for an
  asset-only session; mark "needs code first."
- 404 illustration: `public/images/404.jpg` exists. Done.
- Empty states: `no-activity`, `no-bills`, `no-campaigns` present and wired. Done. (`no-agents` is
  Priority 3 — a wiring decision, not generation.)

---

## Work summary

New-image generation required:
- Priority 1: 3 party logos — `pa.webp`, `mc.webp`, `lfp.webp` (+ one code edit to `PARTY_LOGO_MAP`).
- Priority 2: 1 map background v2 at 3840x2160 (overwrite `capitol-map-v1.webp`).

Non-generation:
- Priority 3: no-agents empty-state — wire the existing asset or drop it (no new art).

Total new images to generate: 4. Everything else is settled or needs code before art.
