# micropolis-tiles.png — attribution

Tile artwork from micropolisJS (Micropolis / EA lineage), licensed GPL-3.0
with additional terms.

- Upstream: https://github.com/graememcc/micropolisJS
- Pinned commit: `f13a1624d111d235e804bd80f48ba7c9f66a8e0f` (path `images/tiles.png`)
- sha256: `a4ca7eeb025e3ad2fb5238d84202de143ec692dccf831d4d058d305e8332cd79`
- Geometry: 512×512 px, 16×16 px tiles, 32 per row, row-major — tile id `i`
  is at `((i % 32) * 16, floor(i / 32) * 16)`.

Full license texts: `src/modules/city/engine/micropolis/LICENSE`,
`src/modules/city/engine/micropolis/COPYING`,
`src/modules/city/engine/micropolis/MicropolisPublicNameLicense.md`.

This is a static art asset served to the browser with attribution. It is not
linked code and does not change the GPL posture documented in
`src/modules/city/engine/PROVENANCE.md` (engine code never enters the client
bundle).
