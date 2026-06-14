/**
 * Inbox + Scheduler database migration runner.
 *
 * Community Edition is SQLite-only; the original MySQL-specific migration
 * has been removed along with the MySQL backend. This runner is kept as a
 * no-op compatibility shim for callers.
 */
export async function runInboxSchedulerMigration(): Promise<void> {
  // MySQL backend (Pro-only) removed; no SQLite inbox/scheduler migration required.
}
