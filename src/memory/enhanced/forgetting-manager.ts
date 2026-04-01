/**
 * ForgettingManager - Soft delete, expiration management, and forgetting audit
 *
 * Pure logic module that operates on EnhancedLTMEntry arrays without I/O.
 */

import type { LTMEntry } from '../ltm.js';

export interface EnhancedLTMEntry extends LTMEntry {
  version: number;
  parentId: string | null;
  rootId: string | null;
  relation: 'creates' | 'updates' | 'extends' | 'derives';
  isLatest: boolean;
  forgotten: boolean;
  forgottenAt?: number;
  forgottenReason?: string;
  expiresAt?: number;
}

export interface ForgottenLogOptions {
  /** Only return entries forgotten after this timestamp */
  since?: number;
  /** Maximum number of entries to return */
  limit?: number;
}

export interface ForgottenLogEntry {
  id: string;
  key: string;
  forgottenAt: number;
  forgottenReason?: string;
}

export class ForgettingManager {
  /**
   * Mark an entry as forgotten (soft delete).
   * Sets forgotten=true, forgottenAt to current time, and optional reason.
   * Returns the updated entry, or null if not found.
   */
  forget(
    id: string,
    entries: EnhancedLTMEntry[],
    reason?: string,
  ): EnhancedLTMEntry | null {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    if (entry.forgotten) {
      // Already forgotten - update reason if provided
      if (reason !== undefined) {
        entry.forgottenReason = reason;
      }
      return entry;
    }

    entry.forgotten = true;
    entry.forgottenAt = Date.now();
    if (reason !== undefined) {
      entry.forgottenReason = reason;
    }

    return entry;
  }

  /**
   * Set an expiration time on an entry.
   * When checkExpired() is called, entries past their expiresAt will be auto-forgotten.
   * Returns the updated entry, or null if not found.
   */
  setExpiration(
    id: string,
    entries: EnhancedLTMEntry[],
    expiresAt: number,
  ): EnhancedLTMEntry | null {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    entry.expiresAt = expiresAt;
    return entry;
  }

  /**
   * Scan entries and mark any expired (non-forgotten) entries as forgotten.
   * An entry is expired if it has an expiresAt value <= current time.
   * Returns the list of entry IDs that were newly marked as forgotten.
   */
  checkExpired(entries: EnhancedLTMEntry[]): string[] {
    const now = Date.now();
    const newlyForgotten: string[] = [];

    for (const entry of entries) {
      if (entry.forgotten) continue;
      if (entry.expiresAt === undefined) continue;
      if (entry.expiresAt > now) continue;

      entry.forgotten = true;
      entry.forgottenAt = now;
      entry.forgottenReason = 'expired';
      newlyForgotten.push(entry.id);
    }

    return newlyForgotten;
  }

  /**
   * Filter entries based on their forgotten status.
   * By default, returns only non-forgotten entries.
   * If includeForgotten is true, returns all entries.
   */
  filterForgotten(
    entries: EnhancedLTMEntry[],
    includeForgotten?: boolean,
  ): EnhancedLTMEntry[] {
    if (includeForgotten) {
      return entries;
    }
    return entries.filter((e) => !e.forgotten);
  }

  /**
   * Query the forgotten log - returns metadata about forgotten entries.
   * Supports filtering by time (since) and limiting results.
   * Results are sorted by forgottenAt descending (most recent first).
   */
  getForgottenLog(
    entries: EnhancedLTMEntry[],
    options?: ForgottenLogOptions,
  ): ForgottenLogEntry[] {
    const since = options?.since ?? 0;
    const limit = options?.limit;

    const forgottenEntries = entries
      .filter((e) => e.forgotten && e.forgottenAt !== undefined)
      .filter((e) => e.forgottenAt! >= since)
      .sort((a, b) => b.forgottenAt! - a.forgottenAt!)
      .map((e) => ({
        id: e.id,
        key: e.key,
        forgottenAt: e.forgottenAt!,
        forgottenReason: e.forgottenReason,
      }));

    if (limit !== undefined && limit >= 0) {
      return forgottenEntries.slice(0, limit);
    }

    return forgottenEntries;
  }

  /**
   * Restore a previously forgotten entry.
   * Sets forgotten=false and clears forgottenAt and forgottenReason.
   * Returns the restored entry, or null if not found.
   */
  restore(
    id: string,
    entries: EnhancedLTMEntry[],
  ): EnhancedLTMEntry | null {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    if (!entry.forgotten) {
      // Not forgotten, nothing to restore
      return entry;
    }

    entry.forgotten = false;
    delete entry.forgottenAt;
    delete entry.forgottenReason;

    return entry;
  }
}
