import { describe, it, expect, beforeEach } from 'vitest';
import { ForgettingManager, type EnhancedLTMEntry } from '../../../src/memory/enhanced/forgetting-manager.js';

function makeEntry(overrides: Partial<EnhancedLTMEntry> = {}): EnhancedLTMEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    key: 'test-key',
    value: 'test-value',
    tags: [],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
    version: 1,
    parentId: null,
    rootId: null,
    relation: 'creates',
    isLatest: true,
    forgotten: false,
    ...overrides,
  };
}

describe('ForgettingManager', () => {
  let manager: ForgettingManager;
  let entries: EnhancedLTMEntry[];

  beforeEach(() => {
    manager = new ForgettingManager();
    entries = [
      makeEntry({ id: 'e1', key: 'alpha' }),
      makeEntry({ id: 'e2', key: 'beta' }),
      makeEntry({ id: 'e3', key: 'gamma' }),
    ];
  });

  describe('forget()', () => {
    it('should mark an entry as forgotten', () => {
      const result = manager.forget('e1', entries, 'no longer needed');
      expect(result).not.toBeNull();
      expect(result!.forgotten).toBe(true);
      expect(result!.forgottenAt).toBeTypeOf('number');
      expect(result!.forgottenReason).toBe('no longer needed');
    });

    it('should return null for non-existent entry', () => {
      const result = manager.forget('nonexistent', entries);
      expect(result).toBeNull();
    });

    it('should work without a reason', () => {
      const result = manager.forget('e1', entries);
      expect(result).not.toBeNull();
      expect(result!.forgotten).toBe(true);
      expect(result!.forgottenAt).toBeTypeOf('number');
      expect(result!.forgottenReason).toBeUndefined();
    });

    it('should update reason on already-forgotten entry', () => {
      manager.forget('e1', entries, 'reason-1');
      const result = manager.forget('e1', entries, 'reason-2');
      expect(result).not.toBeNull();
      expect(result!.forgotten).toBe(true);
      expect(result!.forgottenReason).toBe('reason-2');
    });

    it('should mutate the entry in the original array', () => {
      manager.forget('e1', entries);
      const entry = entries.find((e) => e.id === 'e1')!;
      expect(entry.forgotten).toBe(true);
    });
  });

  describe('setExpiration()', () => {
    it('should set expiresAt on an entry', () => {
      const future = Date.now() + 60_000;
      const result = manager.setExpiration('e1', entries, future);
      expect(result).not.toBeNull();
      expect(result!.expiresAt).toBe(future);
    });

    it('should return null for non-existent entry', () => {
      const result = manager.setExpiration('nonexistent', entries, Date.now());
      expect(result).toBeNull();
    });

    it('should allow overwriting expiresAt', () => {
      manager.setExpiration('e1', entries, 1000);
      const result = manager.setExpiration('e1', entries, 2000);
      expect(result!.expiresAt).toBe(2000);
    });
  });

  describe('checkExpired()', () => {
    it('should mark expired entries as forgotten', () => {
      const past = Date.now() - 1000;
      manager.setExpiration('e1', entries, past);
      manager.setExpiration('e2', entries, past);

      const forgottenIds = manager.checkExpired(entries);
      expect(forgottenIds).toHaveLength(2);
      expect(forgottenIds).toContain('e1');
      expect(forgottenIds).toContain('e2');

      const e1 = entries.find((e) => e.id === 'e1')!;
      expect(e1.forgotten).toBe(true);
      expect(e1.forgottenReason).toBe('expired');
    });

    it('should not mark future entries as expired', () => {
      const future = Date.now() + 60_000;
      manager.setExpiration('e1', entries, future);

      const forgottenIds = manager.checkExpired(entries);
      expect(forgottenIds).toHaveLength(0);

      const e1 = entries.find((e) => e.id === 'e1')!;
      expect(e1.forgotten).toBe(false);
    });

    it('should skip already-forgotten entries', () => {
      const past = Date.now() - 1000;
      manager.setExpiration('e1', entries, past);
      manager.forget('e1', entries, 'manual');

      const forgottenIds = manager.checkExpired(entries);
      expect(forgottenIds).toHaveLength(0);
      // Reason should stay as 'manual', not overwritten to 'expired'
      const e1 = entries.find((e) => e.id === 'e1')!;
      expect(e1.forgottenReason).toBe('manual');
    });

    it('should skip entries without expiresAt', () => {
      const forgottenIds = manager.checkExpired(entries);
      expect(forgottenIds).toHaveLength(0);
    });

    it('should handle exact boundary (expiresAt === now)', () => {
      // expiresAt equal to now should be treated as expired (<=)
      const now = Date.now();
      entries[0].expiresAt = now - 1; // definitely past
      const forgottenIds = manager.checkExpired(entries);
      expect(forgottenIds).toHaveLength(1);
    });
  });

  describe('filterForgotten()', () => {
    it('should exclude forgotten entries by default', () => {
      manager.forget('e1', entries);
      manager.forget('e3', entries);

      const result = manager.filterForgotten(entries);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('e2');
    });

    it('should include all entries when includeForgotten is true', () => {
      manager.forget('e1', entries);

      const result = manager.filterForgotten(entries, true);
      expect(result).toHaveLength(3);
    });

    it('should return all entries when none are forgotten', () => {
      const result = manager.filterForgotten(entries);
      expect(result).toHaveLength(3);
    });

    it('should return empty array when all are forgotten', () => {
      manager.forget('e1', entries);
      manager.forget('e2', entries);
      manager.forget('e3', entries);

      const result = manager.filterForgotten(entries);
      expect(result).toHaveLength(0);
    });

    it('should return empty when given empty array', () => {
      const result = manager.filterForgotten([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('getForgottenLog()', () => {
    it('should return log of forgotten entries sorted by forgottenAt descending', () => {
      manager.forget('e1', entries, 'old');
      // Ensure different timestamps
      const e2 = entries.find((e) => e.id === 'e2')!;
      e2.forgotten = true;
      e2.forgottenAt = Date.now() + 100;
      e2.forgottenReason = 'newer';

      const log = manager.getForgottenLog(entries);
      expect(log).toHaveLength(2);
      // Most recent first
      expect(log[0].id).toBe('e2');
      expect(log[1].id).toBe('e1');
    });

    it('should filter by since option', () => {
      const e1 = entries.find((e) => e.id === 'e1')!;
      e1.forgotten = true;
      e1.forgottenAt = 1000;
      e1.forgottenReason = 'old';

      const e2 = entries.find((e) => e.id === 'e2')!;
      e2.forgotten = true;
      e2.forgottenAt = 5000;
      e2.forgottenReason = 'new';

      const log = manager.getForgottenLog(entries, { since: 3000 });
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe('e2');
    });

    it('should respect limit option', () => {
      manager.forget('e1', entries);
      manager.forget('e2', entries);
      manager.forget('e3', entries);

      const log = manager.getForgottenLog(entries, { limit: 2 });
      expect(log).toHaveLength(2);
    });

    it('should return empty log when no entries are forgotten', () => {
      const log = manager.getForgottenLog(entries);
      expect(log).toHaveLength(0);
    });

    it('should combine since and limit', () => {
      const e1 = entries.find((e) => e.id === 'e1')!;
      e1.forgotten = true;
      e1.forgottenAt = 1000;

      const e2 = entries.find((e) => e.id === 'e2')!;
      e2.forgotten = true;
      e2.forgottenAt = 2000;

      const e3 = entries.find((e) => e.id === 'e3')!;
      e3.forgotten = true;
      e3.forgottenAt = 3000;

      const log = manager.getForgottenLog(entries, { since: 1500, limit: 1 });
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe('e3'); // most recent first
    });

    it('should include forgottenReason in log entries', () => {
      manager.forget('e1', entries, 'test-reason');
      const log = manager.getForgottenLog(entries);
      expect(log[0].forgottenReason).toBe('test-reason');
    });

    it('should include key in log entries', () => {
      manager.forget('e1', entries);
      const log = manager.getForgottenLog(entries);
      expect(log[0].key).toBe('alpha');
    });
  });

  describe('restore()', () => {
    it('should restore a forgotten entry', () => {
      manager.forget('e1', entries, 'some reason');
      const result = manager.restore('e1', entries);

      expect(result).not.toBeNull();
      expect(result!.forgotten).toBe(false);
      expect(result!.forgottenAt).toBeUndefined();
      expect(result!.forgottenReason).toBeUndefined();
    });

    it('should return null for non-existent entry', () => {
      const result = manager.restore('nonexistent', entries);
      expect(result).toBeNull();
    });

    it('should return the entry unchanged if not forgotten', () => {
      const result = manager.restore('e1', entries);
      expect(result).not.toBeNull();
      expect(result!.forgotten).toBe(false);
    });

    it('should allow re-forgetting after restore', () => {
      manager.forget('e1', entries, 'first');
      manager.restore('e1', entries);
      const result = manager.forget('e1', entries, 'second');

      expect(result!.forgotten).toBe(true);
      expect(result!.forgottenReason).toBe('second');
    });

    it('should mutate the entry in the original array', () => {
      manager.forget('e1', entries);
      manager.restore('e1', entries);

      const entry = entries.find((e) => e.id === 'e1')!;
      expect(entry.forgotten).toBe(false);
      expect(entry.forgottenAt).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle forget + filter workflow', () => {
      manager.forget('e1', entries, 'outdated');

      const active = manager.filterForgotten(entries);
      expect(active).toHaveLength(2);

      const all = manager.filterForgotten(entries, true);
      expect(all).toHaveLength(3);
    });

    it('should handle expiration + check + filter workflow', () => {
      const past = Date.now() - 1000;
      manager.setExpiration('e1', entries, past);
      manager.setExpiration('e2', entries, Date.now() + 60_000);

      manager.checkExpired(entries);

      const active = manager.filterForgotten(entries);
      expect(active).toHaveLength(2);
      expect(active.map((e) => e.id)).toContain('e2');
      expect(active.map((e) => e.id)).toContain('e3');
    });

    it('should handle forget + restore + log workflow', () => {
      manager.forget('e1', entries, 'temp');
      manager.restore('e1', entries);

      // After restore, should not appear in forgotten log
      const log = manager.getForgottenLog(entries);
      expect(log).toHaveLength(0);

      // Should appear in active filter
      const active = manager.filterForgotten(entries);
      expect(active).toHaveLength(3);
    });

    it('should handle empty entries array', () => {
      expect(manager.forget('x', [])).toBeNull();
      expect(manager.setExpiration('x', [], 1000)).toBeNull();
      expect(manager.checkExpired([])).toHaveLength(0);
      expect(manager.filterForgotten([])).toHaveLength(0);
      expect(manager.getForgottenLog([])).toHaveLength(0);
      expect(manager.restore('x', [])).toBeNull();
    });
  });
});
