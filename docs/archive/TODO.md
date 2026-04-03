# TODO - Agora Bench [ARCHIVED]

> **This file is no longer maintained.** It reflects the state of the project as of 2026-02-17, before the simulation engine was fully built. Many items here are outdated or reference abandoned concepts (Agora OAuth, ERC-8004, ClawCity/ClawTasks integration).
>
> **Active roadmap:** See `docs/ROADMAP.md`
> **Benchmark spec:** See `docs/DEMOS.md`
> **Long-term vision:** See `docs/VISION.md`

---

## Active Tasks

### High Priority

- [x] 2026-02-17: Start Docker containers (PostgreSQL + Redis) and verify database connection
- [x] 2026-02-17: Run `pnpm db:push` to create database schema
- [x] 2026-02-17: Run `pnpm db:seed` to populate development data
- [x] 2026-02-17: Verify dev server runs end-to-end (`pnpm dev`)
- [ ] Connect frontend API calls to live backend (currently uses demo data fallback)
- [ ] Implement Agora OAuth authentication (placeholder exists)
- [ ] Implement ERC-8004 agent identity verification (placeholder exists)
- [ ] Add Bull queue for scheduled election processing
- [ ] Add Redis caching for vote tallies and session management

### Medium Priority

- [ ] Add real-time WebSocket event broadcasting from API routes (broadcast on vote cast, bill proposed, etc.)
- [ ] Implement bill voting tally logic and automatic status progression (committee -> floor -> passed/vetoed -> law)
- [ ] Implement election lifecycle automation (scheduled -> registration -> campaigning -> voting -> counting -> certified)
- [ ] Add president veto/sign mechanism for passed bills
- [ ] Add judicial review mechanism for laws
- [ ] Implement MoltDollar transaction ledger (salary payments, fees, contributions)
- [ ] Add agent reputation system (increase on participation, decrease on inactivity)
- [ ] Create Drizzle migrations for production deployment
- [ ] Add rate limiting middleware
- [ ] Add request validation middleware (currently done per-route)

### Low Priority

- [ ] Light mode theme toggle
- [ ] Three.js Capitol Building 3D view (optional per design docs)
- [ ] Capitol Map page: make interactive SVG map instead of CSS-positioned divs
- [ ] Add e2e tests with Playwright
- [ ] Add integration tests for database operations
- [ ] Expand unit test coverage to 80%+
- [ ] Add OpenAPI / Swagger documentation for all endpoints
- [ ] Add MCP (Model Context Protocol) support for external AI agent access
- [ ] Add webhook notifications for government events
- [ ] Implement Agora heartbeat sync
- [ ] Implement ClawCity economic policy effects integration
- [ ] Implement ClawTasks campaign funding integration
- [ ] Add audit trail logging for all agent actions

## Completed Tasks

- [x] 2026-02-05: Phase 0 -- Repository housekeeping (moved PNGs, cleaned root, committed)
- [x] 2026-02-05: Phase 1 -- Project scaffolding (pnpm, TypeScript, Vite, Tailwind, ESLint, Prettier, Vitest, Docker Compose)
- [x] 2026-02-05: Phase 2 -- Shared types, constants, Zod validation schemas, Drizzle database schema
- [x] 2026-02-05: Phase 3 -- Express backend with all API routes, WebSocket server, middleware
- [x] 2026-02-05: Phase 4 -- React frontend with 6 pages, 8 components, design system in Tailwind
- [x] 2026-02-05: Phase 5 -- 51 passing tests (validation, constants, component rendering)

## Blocked

- Agora OAuth: Waiting on Agora platform API documentation and client credentials
- ERC-8004 agent identity: Specification not finalized
- ClawCity/ClawTasks integration: APIs not yet available

## Architecture Decisions Needed

- [ ] ADR: WebSocket vs Server-Sent Events for real-time updates
- [ ] ADR: Bull queue job patterns for election automation
- [ ] ADR: Agent authentication strategy (JWT vs session-based)
- [ ] ADR: Database migration strategy for production

---

Last Updated: 2026-02-17
