import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { players } from './players.js';
import { ecosystemColumns } from './_columns.js';

/**
 * OAuth identity bindings per Fork 2b.
 *
 * Each row binds one (tenant, provider, provider_sub) to exactly one
 * player. The composite UNIQUE index is (tenant_id, provider, provider_sub)
 * — tenant_id leftmost so tenant-scoped admin queries (future) hit the
 * index even when provider is not filtered.
 *
 * Query patterns this index supports (locked in for downstream stories):
 *   Primary (T1-6b OAuth callback):
 *     WHERE tenant_id = ? AND provider = ? AND provider_sub = ?
 *   Reverse (session/profile lookups):
 *     WHERE player_id = ?  — uses the separate player_id index.
 *
 * Do NOT reorder the composite to (provider, provider_sub, tenant_id) —
 * the tenant-first ordering is load-bearing for FD-6 multi-tenant
 * correctness + the future admin-listing query shape.
 */
export const oauthIdentities = sqliteTable(
  'oauth_identities',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().$type<'google' | 'apple'>(),
    providerSub: text('provider_sub').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    tenantProviderSubUniq: uniqueIndex('uniq_oauth_identities_tenant_provider_sub').on(
      t.tenantId,
      t.provider,
      t.providerSub,
    ),
    playerIdx: index('idx_oauth_identities_player_id').on(t.playerId),
  }),
);

export type OauthIdentity = typeof oauthIdentities.$inferSelect;
