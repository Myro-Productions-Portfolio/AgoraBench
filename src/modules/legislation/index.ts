/**
 * Legislation module barrel -- re-exports routers, schema, and client pages/components.
 */

// Routes
export { default as legislationRouter } from './server/routes/legislation';
export { default as votesRouter } from './server/routes/votes';
export { default as decisionsRouter } from './server/routes/decisions';
export { default as courtRouter } from './server/routes/court';

// Schema
export { bills, laws, billVotes } from './db/schema/legislation';
