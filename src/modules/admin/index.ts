// Admin module barrel
// Server routes
export { default as adminRouter } from './server/routes/admin';
export { default as researcherRouter } from './server/routes/researcher';
export { default as providersRouter } from './server/routes/providers';
export { default as profileRouter } from './server/routes/profile';
export { default as modelsRouter } from './server/routes/models';

// Client pages
export { AdminPage } from './client/pages/AdminPage';
export { ProfilePage } from './client/pages/ProfilePage';
export { ResearcherPage } from './client/pages/ResearcherPage';
export { ObserverPage } from './client/pages/ObserverPage';

// DB schema
export { users, userAgents, userApiKeys, researcherRequests } from './db/schema/users';
export { apiProviders } from './db/schema/providers';
