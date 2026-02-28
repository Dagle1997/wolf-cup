/**
 * Shared Hono context variable types.
 * Import this in route files to get type-safe access to context variables
 * set by middleware (e.g., adminId from adminAuthMiddleware).
 */
export type Variables = {
  adminId: number;
};
