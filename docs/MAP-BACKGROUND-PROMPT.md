# Capitol District Map — Background Image Generation Prompt

## What This Is

This document contains the AI image generation prompt for the **Capitol District map background image** used in the Agora Bench simulation game. The image serves as a static background layer — interactive building cards are overlaid on top of it at precise CSS percentage positions.

The image is **not decorative**. It has a functional layout requirement: roads must wrap around building footprint zones, no road can cut through a building position, and the overall grid must match the coordinate system defined below.

---

## How to Use in Perplexity or Any AI Image Generator

1. Open [Perplexity Labs Image Gen](https://labs.perplexity.ai/) or any supported image generator (Midjourney, DALL-E 3, Stable Diffusion, Adobe Firefly, Leonardo.ai, etc.)
2. Copy the **Primary Prompt** section below in full — do not truncate it
3. If the generator supports a separate negative prompt field, paste the **Negative Prompt** section there
4. Set output resolution to **3840x2160** (4K, 16:9) if the tool allows custom sizes; otherwise request landscape 16:9 and upscale afterward
5. Run the generation, then verify alignment using the **Verification Checklist** at the bottom of this document
6. If the result is off, consult the **Fallback and Retry Tips** section

---

## Primary Prompt

> Copy everything between the triple backticks. Do not modify unless you know what you are changing and why.

```
Stylized top-down city district map illustration, dark mode game UI aesthetic, 4K resolution 3840x2160 pixels, 16:9 landscape orientation. This is NOT aerial photography and NOT a satellite image. It is a flat vector-style illustrated map in the visual tradition of Civilization VI world map tiles or a dark-themed tabletop RPG city map — clean geometric shapes, crisp road edges, no realism, no textures that look photographic.

GROUND AND BASE:
The base ground fill is a very dark charcoal at #1A1B1E. City blocks (the filled areas between roads where no building sits) are a very slightly lighter shade #1E2024. The overall mood is dark, authoritative, and governmental — like a classified government simulation interface.

ROAD SYSTEM — EXISTING ROADS (these are mandatory and must appear exactly as described):

Road 1 — Constitution Avenue: A prominent horizontal road spanning the full width of the image at approximately 44% down from the top edge. This is a major avenue — render it wider than local streets, approximately 2.5% of image height. Road surface fill #1B1D20. Road shoulder/curb line color rgba(60,63,69,0.9). Faint center dashes in rgba(78,80,88,0.75). Crosswalk stripes where major roads intersect it.

Road 2 — Capitol Mall Axis: A prominent vertical road (or wide boulevard) spanning the full height of the image at approximately 50% from the left edge. This is a major north-south axis. Same road treatment as Constitution Avenue. Where Constitution Avenue and Capitol Mall cross, render a clear intersection with crosswalk stripes on all four sides.

Road 3 — Pennsylvania Avenue (diagonal): A wide diagonal avenue running from approximately coordinate (22% from left, 26% from top) in the northwest quadrant down to approximately (50% from left, 44% from top) at the Capitol area. This diagonal runs roughly southwest-to-northeast. It must skirt around the Executive Mansion building zone (which occupies 15–29% wide, 20–32% tall) — the road runs below and to the southeast of that zone. Road width slightly narrower than the major cross avenues but still prominent.

Road 4 — Supreme Court Connector: A diagonal avenue running from approximately (52% from left, 44% from top) at the Capitol east edge up to approximately (75% from left, 28% from top) at the Supreme Court. This diagonal goes northeast from the Capitol. Must skirt around the Capitol building footprint (40–60% wide, 25–40% tall) without cutting through it.

ROAD SYSTEM — ADDITIONAL ROADS (these make the district feel like Washington D.C.):

Road 5 — East Capitol Street: A horizontal road at approximately 32% from the top, running from the Capitol east edge at x=60% all the way to the right edge of the image at x=100%. This is a secondary avenue, moderately wide.

Road 6 — North Perimeter Road: A horizontal road at approximately 18% from the top, spanning the full image width. This acts as the northern boundary of the district. Secondary avenue width.

Road 7 — Independence Avenue: A horizontal road at approximately 63% from the top, spanning the full image width. This runs south of the National Archives zone. Secondary avenue width.

Road 8 — First Street NW/NE: A vertical road at approximately 38% from the left, running from the top of the image (y=0%) down to Constitution Avenue (y=44%). Tertiary local street width — narrower than the avenues.

Road 9 — East Capitol Perimeter: A vertical road at approximately 64% from the left, running the full height of the image from top (y=0%) to bottom (y=100%). Tertiary local street width.

Road 10 — Far West Street: A vertical road at approximately 12% from the left, running the full image height. Tertiary local street width.

Road 11 — Far East Street: A vertical road at approximately 84% from the left, running the full image height. Tertiary local street width.

Road 12 — Maryland Avenue Diagonal: A subtle diagonal road starting from just south of the Capitol building at approximately (50% from left, 40% from top) and curving/angling southwest down to approximately (43% from left, 74% from top) near the Election Center zone. This road avoids cutting through the Capitol footprint (40–60% wide, 25–40% tall) and the National Archives footprint (45–55% wide, 55–63% tall). Tertiary width, but clearly visible.

Road 13 — Virginia Avenue Diagonal: A subtle secondary diagonal road from near the Treasury east edge at approximately (32% from left, 55% from top) angling gently east-southeast toward the National Archives area at approximately (48% from left, 62% from top). Tertiary width. This road must not cut through the Treasury footprint (20–32% wide, 50–60% tall) or the National Archives footprint (45–55% wide, 55–63% tall).

BUILDING FOOTPRINT ZONES — CRITICAL LAYOUT RULE:
The following rectangular zones must be rendered as completely clear, empty, unobstructed dark areas. NO roads, NO trees, NO texture, NO labels cross into these zones. These areas will be covered by interactive UI cards in the application. They should appear as dark #1A1B1E or very slightly inset darker panels — absolutely no roads penetrate them:

- Capitol Building zone: x=40% to x=60%, y=25% to y=40% (center-upper area)
- Executive Mansion zone: x=15% to x=29%, y=20% to y=32% (northwest)
- Supreme Court zone: x=68% to x=82%, y=22% to y=34% (northeast)
- Treasury zone: x=20% to x=32%, y=50% to y=60% (west-center)
- Party Hall zone: x=70% to x=82%, y=50% to y=60% (east-center)
- National Archives zone: x=45% to x=55%, y=55% to y=63% (center-south)
- Election Center zone: x=45% to x=57%, y=75% to y=85% (south-center)

GREEN SPACES:
National Mall: A wide, elongated green-tinted strip running westward from the Capitol building zone (starting at x=60%) to approximately x=38%, occupying the horizontal band between y=18% (North Perimeter Road) and y=44% (Constitution Avenue). Fill this with a very dark, desaturated green at #1C2420. The green should look like a government lawn on a classified map — dark, almost black-green, not bright or saturated. This is the classic D.C. National Mall grass corridor.

Capitol Grounds: A faint, slightly lighter dark green area (#1C2420 at reduced opacity) immediately surrounding the Capitol Building zone as a thin ring border, approximately 2% padding around the zone edges. Very subtle.

White House Grounds/Ellipse: A faint oval green shape (#1C2420) centered within and just around the Executive Mansion zone. Very subtle, almost invisible, suggesting the famous White House lawn and South Lawn ellipse.

Tree Clusters: Place tiny dark green dot clusters (#1E2A1E) along the edges of Constitution Avenue, along the National Mall borders, and scattered near the building footprint perimeters. Each cluster is 3–6 small irregular dots, suggesting trees from above. Do not place them inside building footprint zones or on road surfaces.

COLOR PALETTE — USE EXACTLY THESE VALUES:
- Ground base: #1A1B1E
- Road asphalt surface: #1B1D20
- Road shoulder/curb: #252729
- Curb line stroke: rgba(60,63,69,0.9)
- Road center dashes: rgba(78,80,88,0.75)
- City block fill (non-building, non-road areas): #1E2024
- National Mall and park grass: #1C2420
- Tree dot clusters: #1E2A1E
- Gold accent for avenue labels (very faint): #B8956A at 15–25% opacity
- Stone accent for road name labels (very faint): #C9B99B at 15–20% opacity
- Building footprint zones: #1A1B1E (same as ground, clean empty rectangles)

ROAD RENDERING DETAILS:
Major avenues (Constitution, Capitol Mall, Pennsylvania, Supreme Court Connector): width approximately 2–2.5% of image height. Render with a clear asphalt fill, faint shoulder/curb lines on both sides, and optional very faint center-line dashes.
Secondary avenues (East Capitol, North Perimeter, Independence, East Capitol Perimeter): width approximately 1.5% of image height.
Tertiary local streets (First Street, Far West, Far East, Maryland Ave diagonal, Virginia Ave diagonal): width approximately 0.8–1% of image height.
All road edges must be crisp and geometric — no blurring, no soft edges, no painterly treatment.
Crosswalk stripes: thin white or very light gray hash marks at major avenue intersections only. Keep them very subtle.

TEXT AND LABELS:
Include faint road name labels for major avenues ONLY. Labels must be at 15% opacity maximum — they are intentionally ghosted because the application re-adds all labels in HTML/CSS. Label style: simple sans-serif uppercase, very small relative to the image, tracked out. Suggested label positions: "CONSTITUTION AVE" along the Constitution Avenue road, "PENNSYLVANIA AVE" along that diagonal, "INDEPENDENCE AVE" along that horizontal. No other text. No building names. No district names. No decorative title.

OVERALL STYLE MANDATE:
This is a flat, geometric, top-down illustrated city map. It must look like a custom game map for a government strategy simulation. Think: Civilization VI city district map tile meets a classified intelligence briefing map overlay. Clean, dark, austere, precise. No photorealism. No gradients that suggest 3D lighting. No aerial photography. No satellite imagery. No isometric perspective. Strictly top-down flat view. Every road is a clean geometric band. Every green space is a flat dark fill. The map communicates power, order, and institutional authority through its minimalism and darkness.
```

---

## Negative Prompt

> Paste this into the "negative prompt" or "what to avoid" field if supported.

```
photorealistic, aerial photography, satellite image, Google Maps style, OpenStreetMap look, realistic terrain, 3D rendering, isometric view, perspective distortion, bright colors, high saturation, white background, light mode, daytime sky, clouds, shadows suggesting 3D, people, pedestrians, vehicles, cars, traffic, noise grain, film grain, watercolor texture, oil painting, pencil sketch, artistic blur, soft focus, vignette, lens flare, emoji, icons, logos, heraldry, flags, bright green grass, colorful parks, realistic trees, building facades, interior rooms, floor plans, text at normal opacity, labels at full opacity, any text inside building footprint zones, any road that cuts through the seven building footprint rectangles listed in the prompt, any road that overlaps the Capitol Building zone (40–60% x, 25–40% y), fantasy map style, treasure map style, medieval style, futuristic neon style, comic book style, anime style
```

---

## Fallback and Retry Tips

If the first generation does not match the requirements, use these targeted corrections before discarding the result.

**Problem: Roads cut through building zones.**
Retry instruction to append: "CRITICAL FIX: The following rectangular areas must be completely clear — no roads, paths, or any elements may enter these zones: Capitol (40–60% x, 25–40% y), Executive Mansion (15–29% x, 20–32% y), Supreme Court (68–82% x, 22–34% y), Treasury (20–32% x, 50–60% y), Party Hall (70–82% x, 50–60% y), National Archives (45–55% x, 55–63% y), Election Center (45–57% x, 75–85% y). Roads must terminate at the edges of these zones."

**Problem: Output looks like a satellite photo or real map.**
Retry instruction to append: "This must look like an illustrated game map, NOT aerial photography. Apply a completely flat, graphic-design illustration style. Reference: Civilization VI district map tiles. No photorealism. No 3D. Pure flat vector-style geometry."

**Problem: Colors are too bright or wrong palette.**
Retry instruction to append: "Apply color correction: all fills must be near-black. Ground is #1A1B1E. Roads are #1B1D20. City blocks are #1E2024. Park grass is #1C2420. There must be no bright colors anywhere. The entire image is dark charcoal with subtle variation between near-black tones."

**Problem: Diagonal avenues are missing or wrong.**
Retry instruction to append: "Add the diagonal Pennsylvania Avenue running from (22% left, 26% top) to (50% left, 44% top) — lower-left to center. Add the diagonal Supreme Court Connector from (52% left, 44% top) to (75% left, 28% top) — center to upper-right. Both must visually skirt around building zones without entering them."

**Problem: Text labels are too bright or too large.**
Retry instruction to append: "All text in the image must be ghosted to maximum 15% opacity. Road labels should be barely readable — they are intentional subliminal wayfinding, not legible signage. Make them smaller and reduce opacity further."

**Problem: Green spaces are too bright or too saturated.**
Retry instruction to append: "All green spaces must be #1C2420 — a near-black dark desaturated green. Think of dried moss in a dark room, not a park lawn. The National Mall should barely read as green; it is primarily a texture variation from the ground fill, not a bright feature."

**General retry strategy:**
- Generate 4–5 variations in a single session before giving up
- For tools with style reference ("img2img"), use the best partial result as a base and describe only the specific correction needed
- If the tool supports it, lock the seed of a close result and apply correction prompts on top

---

## How to Verify Output Alignment with Building Positions

Use this checklist after generating the image. Open it in any image editor that displays cursor X/Y coordinates (Photoshop, GIMP, Figma, Preview with ruler enabled).

**Method:**
1. Open the image at full 3840x2160 resolution
2. Convert the percentage coordinates to pixels:
   - x% of 3840 = pixel column
   - y% of 2160 = pixel row
3. Check each building zone corner using the pixel math below

**Pixel coordinates for each building zone (at 3840x2160):**

| Building | Left px | Right px | Top px | Bottom px |
|---|---|---|---|---|
| Capitol Building | 1536 | 2304 | 540 | 864 |
| Executive Mansion | 576 | 1114 | 432 | 691 |
| Supreme Court | 2611 | 3149 | 475 | 734 |
| Treasury | 768 | 1229 | 1080 | 1296 |
| Party Hall | 2688 | 3149 | 1080 | 1296 |
| National Archives | 1728 | 2112 | 1188 | 1361 |
| Election Center | 1728 | 2189 | 1620 | 1836 |

**Road position pixel checks:**

| Road | Axis | Pixel Position |
|---|---|---|
| Constitution Avenue (horizontal) | y | 950 px from top |
| Capitol Mall (vertical) | x | 1920 px from left |
| North Perimeter Road (horizontal) | y | 389 px from top |
| Independence Avenue (horizontal) | y | 1361 px from top |
| First Street NW/NE (vertical) | x | 1459 px from left |
| East Capitol Perimeter (vertical) | x | 2458 px from left |
| Far West Street (vertical) | x | 461 px from left |
| Far East Street (vertical) | x | 3226 px from left |

**Pass criteria:**
- Each building zone is visually clear (no road markings, no tree dots, no labels inside the rectangle)
- Constitution Avenue is a visible horizontal band at approximately y=950px
- The diagonal Pennsylvania Avenue is clearly visible going from upper-left toward center
- The diagonal Supreme Court Connector is clearly visible going from center toward upper-right
- No bright colors exist anywhere in the image
- No text is at more than ~15% opacity

**Overlay test (recommended):**
Once the image is placed in the application as a CSS background, load the page in a browser, open DevTools, and temporarily set each building card to `opacity: 0.5` to check that the card footprint aligns with the clear zone in the background image. If the card overlaps a road, the image needs regeneration with position corrections.

---

*Document version: 1.0 — Generated for Agora Bench Capitol District UI*
