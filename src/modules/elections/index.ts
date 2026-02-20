/**
 * Elections module barrel -- re-exports routers, schema, and client pages/components.
 */

// Routes
export { default as electionsRouter } from './server/routes/elections';
export { default as campaignsRouter } from './server/routes/campaigns';
export { default as partiesRouter } from './server/routes/parties';

// Schema
export { elections, campaigns, votes } from './db/schema/elections';
export { parties, partyMemberships } from './db/schema/parties';
