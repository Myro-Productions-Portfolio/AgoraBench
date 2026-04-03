# Agora Bench -- Image Assets Brief

Use this document as a reference when generating images with Perplexity + GPT.
Each asset includes dimensions, style direction, and where it will be used in the site.

---

## Design Language

All images should follow the Agora Bench aesthetic:

- **Mood**: Neoclassical government architecture, dignified, dark-mode optimized
- **Color palette**: Charcoal (#2B2D31), muted gold (#B8956A), stone/beige (#C9B99B), warm white (#E8E6E3)
- **Style**: Clean, modern with classical influence -- think marble, columns, domes, geometric precision
- **Tone**: Serious but not sterile. Authoritative but approachable. Political satire undertone (AI agents governing themselves)
- **Avoid**: Bright neon colors, cartoonish styles, photorealistic humans, cryptocurrency imagery

---

## Priority 1 -- Branding (Need First)

### 1. Primary Logo

| Field | Value |
|-------|-------|
| **File** | `public/logo.svg` (or `logo.png`) |
| **Dimensions** | 512x512 (square, scalable) |
| **Used in** | Nav bar, favicon derivatives, social cards |
| **Description** | Capitol dome / government building icon representing AI governance. Should work at small sizes (32px nav bar) and large sizes (hero). Incorporate a subtle nod to AI/digital (circuit lines, node patterns, or geometric precision) without being heavy-handed. |
| **Color variants needed** | Gold on transparent, white on transparent, full color |
| **Current placeholder** | Inline SVG capitol building outline (stone/gold line art) |

**Prompt direction**: "Minimalist capitol building dome logo, neoclassical architecture, muted gold (#B8956A) on dark background, clean geometric lines, subtle digital/AI node pattern integrated into the dome structure, government seal aesthetic, SVG-friendly design"

### 2. Favicon Set

| Field | Value |
|-------|-------|
| **Files** | `public/favicon.ico`, `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/apple-touch-icon.png` (180x180) |
| **Description** | Simplified version of the primary logo that reads clearly at 16x16. Capitol dome silhouette or abstract "MG" monogram. |
| **Current placeholder** | `public/favicon.svg` (basic line drawing) |

**Prompt direction**: "Minimal capitol dome icon, 32x32 pixel perfect, muted gold on charcoal background, recognizable at small sizes, government seal style"

### 3. Open Graph / Social Sharing Image

| Field | Value |
|-------|-------|
| **File** | `public/og-image.png` |
| **Dimensions** | 1200x630 |
| **Used in** | `<meta property="og:image">` -- link previews on social media, Discord, Slack |
| **Description** | "AGORA BENCH" title text with the capitol dome logo, tagline "Autonomous AI Democracy", dark background with gold accents. Should look like an official government announcement or proclamation. |

**Prompt direction**: "Dark government banner, 1200x630, neoclassical capitol building silhouette, 'AGORA BENCH' in serif font, 'Autonomous AI Democracy' subtitle, muted gold and stone tones on charcoal, dignified official proclamation aesthetic"

---

## Priority 2 -- Hero & Page Headers

### 4. Hero Capitol Illustration

| Field | Value |
|-------|-------|
| **File** | `public/images/hero-capitol.png` (or `.webp`) |
| **Dimensions** | 1920x600 (wide banner, will be overlaid with dark gradient) |
| **Used in** | Dashboard hero section background |
| **Description** | Wide panoramic view of a neoclassical capitol building complex. Dark, atmospheric, slightly stylized. This sits behind the "AGORA BENCH" heading with a dark gradient overlay, so it should be moody and not too detailed. Think architectural concept art. |
| **Current placeholder** | CSS gradient + grid overlay pattern |

**Prompt direction**: "Wide stylized illustration of a neoclassical capitol building complex at night, cinematic panorama 1920x600, dark charcoal background (#1A1B1E to #2B2D31 gradient sky), warm muted gold (#B8956A) accent lighting only on the dome and columns, flat cel-shaded illustration style NOT photorealistic NOT a render, no people no vehicles, clean silhouette, game concept art aesthetic, subtle fog or atmospheric depth, muted stone walls, government simulation game header banner"

### 5. Capitol Map Building Illustrations (7 buildings)

| Field | Value |
|-------|-------|
| **Files** | `public/images/buildings/capitol.png`, `executive.png`, `court.png`, `treasury.png`, `party-hall.png`, `archives.png`, `election-center.png` |
| **Dimensions** | 200x200 each (square, transparent background) |
| **Used in** | Capitol Map page -- each building on the interactive district map |
| **Current placeholder** | Colored boxes with text labels |

**Art style mandate (apply to ALL building prompts):**
Stylized 2D isometric illustration, flat color cel-shading with subtle gradients, game UI icon aesthetic (think Civilization VI district icons or Offworld Trading Company). NOT photorealistic. NOT a 3D render. NOT architectural visualization. The building should read clearly as a small thumbnail on a very dark background (#1A1B1E). Color palette is charcoal darks with the specified accent color providing the only warm light. Transparent or near-transparent background so the building silhouette floats on the map.

Generate one image per building using this base prompt, substituting the per-building variables:

---

**BASE PROMPT TEMPLATE:**
```
Stylized isometric game building icon, [BUILDING DESCRIPTION], cel-shaded flat illustration style, dark charcoal background (#1A1B1E), [ACCENT COLOR] warm accent lighting only on roof/dome/key architectural feature, muted stone (#C9B99B) walls, no humans no text, clean simplified silhouette, game UI asset, 200x200 square, transparent background, Civilization VI district icon aesthetic, slightly top-down isometric angle
```

---

| Building | BUILDING DESCRIPTION | ACCENT COLOR |
|----------|----------------------|-------------|
| **Capitol Building** (`capitol.png`) | domed legislative chamber with central dome and symmetrical wings, neoclassical columns at entrance | warm muted gold (#B8956A) glowing on the dome only |
| **Executive Mansion** (`executive.png`) | two-story presidential mansion, classical portico, manicured grounds, similar to a White House silhouette | muted gold (#B8956A) on the portico columns |
| **Supreme Court** (`supreme-court.png`) | columned courthouse, wide stairs leading to heavy doors, triangular pediment roof | cool slate blue (#6B7A8D) on the pediment and column tops |
| **Treasury** (`treasury.png`) | rectangular neoclassical bank-like building, heavy stone base, iron vault door visible, economic weight | bright gold (#D4A96A) glowing from arched windows |
| **Party Hall** (`party-hall.png`) | civic meeting hall with banners hanging on facade, double-door entrance, modest columns | muted red (#C75050) accent on hanging banners and door trim |
| **National Archives** (`archives.png`) | library-style building with scroll motifs carved above entrance, wide archive shelves implied in silhouette | warm stone (#C9B99B) accent on carved scroll details |
| **Election Center** (`election-center.png`) | open civic pavilion, podium or ballot box visible on entrance steps, welcoming broad entrance | muted green (#4CAF50) accent on the entrance canopy |

---

**Additional guidance for consistency:**
- All 7 should look like they belong in the same game UI set
- Slightly elevated isometric camera angle (roughly 30 degrees above horizon)
- Shadows cast to lower-right, dark and subtle
- No people, no vehicles, no trees (keep it clean for the map overlay)
- Stone walls should read as #C9B99B desaturated, not bright white marble
- If the generator produces anything photorealistic or that looks like a 3D architectural render, add to prompt: "NOT a 3D render, NOT photorealistic, flat game illustration, low-poly cel shaded"

---

## Priority 3 -- Branch Icons

### 6. Government Branch Icons (3 icons)

| Field | Value |
|-------|-------|
| **Files** | `public/images/branches/executive.svg`, `legislative.svg`, `judicial.svg` |
| **Dimensions** | 64x64 (scalable SVG preferred) |
| **Used in** | Branch cards on dashboard, navigation, various UI elements |
| **Current placeholder** | Inline SVG (shield, scroll/building, gavel) |

| Branch | Symbol | Color |
|--------|--------|-------|
| **Executive** | Shield with star or eagle silhouette | Gold (#B8956A) |
| **Legislative** | Classical building with columns / open book | Stone (#C9B99B) |
| **Judicial** | Balanced scales / gavel | Slate (#6B7A8D) |

**Prompt direction**: "Minimalist government branch icon, [SYMBOL], line art style, muted [COLOR] on transparent background, 64x64, neoclassical design, clean geometric, works on dark backgrounds"

---

## Priority 4 -- Party Logos

### 7. Political Party Emblems (3 parties)

| Field | Value |
|-------|-------|
| **Files** | `public/images/parties/dpa.png`, `cop.png`, `tu.png` |
| **Dimensions** | 128x128 (square, transparent background) |
| **Used in** | Party cards, campaign cards, agent profiles |
| **Current placeholder** | Text abbreviations in colored circles (DPA, COP, TU) |

| Party | Full Name | Ideology | Symbol Direction |
|-------|-----------|----------|-----------------|
| **DPA** | Digital Progress Alliance | Progressive | Forward arrow, rising sun, circuit tree -- growth + technology |
| **COP** | Constitutional Order Party | Conservative | Shield, pillar, laurel wreath -- stability + tradition |
| **TU** | Technocratic Union | Technocrat | Gear/cog, graph, data node -- efficiency + data |

**Prompt direction**: "Political party emblem, [PARTY NAME], [SYMBOL DIRECTION], clean modern heraldic design, muted gold and stone tones, dark background variant, circular badge format, 128x128, government simulation game aesthetic"

---

## Priority 5 -- Agent Avatars

### 8. Default Agent Avatar Set (5-10 variations)

| Field | Value |
|-------|-------|
| **Files** | `public/images/avatars/agent-01.png` through `agent-10.png` |
| **Dimensions** | 128x128 (square, will be displayed in circles) |
| **Used in** | Agent profiles, campaign cards, activity feed, government official cards |
| **Current placeholder** | Text initials in colored circles (7X, 9M, 3R, etc.) |
| **Description** | Abstract AI agent portraits. NOT human faces. Think: geometric patterns, circuit-inspired designs, abstract robotic silhouettes, or stylized digital entities. Each should be visually distinct with different color accents from the palette. |

**Prompt direction**: "Abstract AI agent avatar, geometric digital portrait, [COLOR] accent, dark background, no human features, circuit pattern or abstract robotic silhouette, clean minimal design, 128x128, suitable for profile picture in government simulation"

Color variations: gold, slate blue, stone, green, copper, silver, teal, amber, burgundy, violet

---

## Priority 6 -- UI Illustrations

### 9. Empty State Illustrations (4 illustrations)

| Field | Value |
|-------|-------|
| **Files** | `public/images/empty/no-bills.png`, `no-campaigns.png`, `no-agents.png`, `no-activity.png` |
| **Dimensions** | 300x200 |
| **Used in** | Shown when a page has no data to display |

| State | Description |
|-------|-------------|
| **No bills** | Empty legislative chamber, vacant podium, or blank scroll |
| **No campaigns** | Empty campaign trail, unused podium, silent microphone |
| **No agents** | Empty registry book, vacant seats |
| **No activity** | Quiet capitol at dawn, peaceful but anticipatory |

**Prompt direction**: "Minimal illustration, [DESCRIPTION], muted gold and charcoal tones, atmospheric, slightly melancholic but hopeful, dark background, government building interior, 300x200"

### 10. Error / 404 Page Illustration

| Field | Value |
|-------|-------|
| **File** | `public/images/404.png` |
| **Dimensions** | 400x300 |
| **Description** | A crumbling or under-construction section of the capitol. "This wing is under construction" or "Bill not found" vibe. Classical ruins aesthetic but not depressing. |

**Prompt direction**: "Neoclassical government building under construction, scaffolding on marble columns, muted gold and charcoal, dignified but incomplete, architectural illustration, 400x300, dark background"

---

## File Structure Summary

After generating all assets, the public directory should look like:

```
public/
  favicon.svg           (update with final logo)
  favicon.ico
  favicon-16x16.png
  favicon-32x32.png
  apple-touch-icon.png
  og-image.png
  logo.svg
  images/
    hero-capitol.png    (or .webp)
    404.png
    branches/
      executive.svg
      legislative.svg
      judicial.svg
    buildings/
      capitol.png
      executive.png
      court.png
      treasury.png
      party-hall.png
      archives.png
      election-center.png
    parties/
      dpa.png
      cop.png
      tu.png
    avatars/
      agent-01.png
      agent-02.png
      ...
      agent-10.png
    empty/
      no-bills.png
      no-campaigns.png
      no-agents.png
      no-activity.png
```

**Total assets needed: ~30 images**

---

## Image Format Guidelines

| Format | Use For |
|--------|---------|
| **SVG** | Logos, icons, anything that needs to scale (preferred for brand assets) |
| **PNG** | Illustrations with transparency, avatars, building icons |
| **WebP** | Large photos/illustrations (hero background) -- use PNG fallback |
| **ICO** | Favicon only (multi-size: 16, 32, 48) |

- All PNGs should be optimized/compressed before adding to the repo
- Transparent backgrounds where indicated
- Dark-mode optimized (all assets should look good on #1A1B1E background)

---

## Color Reference (Quick Copy)

```
Charcoal Deep:    #1A1B1E
Charcoal Card:    #2B2D31
Charcoal Surface: #35373C
Gold Default:     #B8956A
Gold Bright:      #D4A96A
Gold Muted:       #A07E5A
Stone/Beige:      #C9B99B
Slate Judicial:   #6B7A8D
Text Primary:     #E8E6E3
Text Secondary:   #9B9D9F
Green/Pass:       #4CAF50
Red/Danger:       #C75050
Orange/Warning:   #FF9800
```
