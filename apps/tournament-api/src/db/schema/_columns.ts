import { text } from 'drizzle-orm/sqlite-core';

/**
 * FD-6 ecosystem columns. Call as a factory (not a frozen const) so each
 * table gets fresh column instances — drizzle treats column objects as
 * per-table identities.
 */
export const ecosystemColumns = () => ({
  tenantId: text('tenant_id').notNull().default('guyan'),
  contextId: text('context_id').notNull(),
});
