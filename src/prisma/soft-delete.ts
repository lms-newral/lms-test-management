/**
 * Soft-delete helpers for the question bank.
 *
 * Question rows are referenced by Answer rows, so a hard delete corrupts the
 * historical results of every test that ever used the question. Everything in
 * the bank is therefore retired by stamping `deletedAt`, never removed.
 *
 * WHY THIS IS A HELPER AND NOT A GLOBAL FILTER
 * --------------------------------------------
 * `PrismaService` is a plain `PrismaClient` with no middleware or client
 * extension registered — `tenant.middleware.ts` exports helpers that nothing
 * currently imports, and tenant scoping is applied by hand in each service.
 *
 * Registering a global query interceptor would silently change the behaviour of
 * every existing query against a live database, which is not a change that
 * belongs in the same step as adding tables. Until that is done deliberately and
 * on its own, new bank code calls these helpers explicitly.
 */

/** Models carrying a `deletedAt` column, added by the question-bank migrations. */
export const SOFT_DELETE_MODELS: readonly string[] = [
  'Question',
  'Taxonomy',
  'QuestionTypeDef',
  'QuestionFieldDef',
  'QuestionGroup',
  'QuestionSolution',
  'TestBlueprint',
];

export function isSoftDeleteModel(modelName: string): boolean {
  return SOFT_DELETE_MODELS.includes(modelName);
}

/**
 * Spread into a `where` clause to hide retired rows:
 *
 *   where: { tenantId, ...notDeleted() }
 */
export function notDeleted(): { deletedAt: null } {
  return { deletedAt: null };
}

/**
 * Spread into an `update` to retire a row.
 *
 * `deletedById` is recorded so the bank's audit trail can answer who retired a
 * question, which matters when one disappears from a blueprint mid-term.
 */
export function markDeleted(userId?: string): {
  deletedAt: Date;
  deletedById: string | null;
} {
  return { deletedAt: new Date(), deletedById: userId ?? null };
}

/**
 * Spread into an `update` to restore a row.
 *
 * Note that the taxonomy uniqueness indexes are partial on `deletedAt IS NULL`,
 * so a restore can collide with a name created since the delete. Callers should
 * handle the unique violation rather than assume a restore always succeeds.
 */
export function markRestored(): { deletedAt: null; deletedById: null } {
  return { deletedAt: null, deletedById: null };
}
