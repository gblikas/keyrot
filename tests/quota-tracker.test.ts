import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuotaTracker } from '../app/quota-tracker.js';
import { MemoryStorageAdapter } from '../app/storage/memory.js';
import type { KeyState, KeyConfig } from '../app/types.js';

function createKeyState(overrides: Partial<KeyConfig> = {}): KeyState {
  const config: KeyConfig = {
    id: 'test-key',
    value: 'test-value',
    quota: { type: 'monthly', limit: 1000 },
    ...overrides,
  };

  return {
    config,
    quotaUsed: 0,
    periodStart: new Date(),
    rateLimitedUntil: null,
    circuitState: 'closed',
    circuitOpenUntil: null,
    consecutiveFailures: 0,
    lastUsed: null,
    tokens: 10,
    lastTokenRefill: new Date(),
  };
}

describe('QuotaTracker', () => {
  let quotaTracker: QuotaTracker;
  let storage: MemoryStorageAdapter;
  let onWarning: ReturnType<typeof vi.fn>;
  let onKeyExhausted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryStorageAdapter();
    onWarning = vi.fn();
    onKeyExhausted = vi.fn();
    quotaTracker = new QuotaTracker({
      storage,
      warningThreshold: 0.8,
      onWarning,
      onKeyExhausted,
    });
  });

  describe('hasQuota', () => {
    it('should return true for unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      expect(quotaTracker.hasQuota(state)).toBe(true);
    });

    it('should return true when under limit', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 500;
      expect(quotaTracker.hasQuota(state)).toBe(true);
    });

    it('should return false when at limit', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 1000;
      expect(quotaTracker.hasQuota(state)).toBe(false);
    });

    it('should return false when over limit', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 1001;
      expect(quotaTracker.hasQuota(state)).toBe(false);
    });
  });

  describe('getRemaining', () => {
    it('should return Infinity for unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      expect(quotaTracker.getRemaining(state)).toBe(Infinity);
    });

    it('should return remaining quota', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 300;
      expect(quotaTracker.getRemaining(state)).toBe(700);
    });

    it('should return 0 when exhausted', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 1000;
      expect(quotaTracker.getRemaining(state)).toBe(0);
    });

    it('should return 0 when over limit', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 1500;
      expect(quotaTracker.getRemaining(state)).toBe(0);
    });
  });

  describe('getUsagePercent', () => {
    it('should return 0 for unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      expect(quotaTracker.getUsagePercent(state)).toBe(0);
    });

    it('should return usage percentage', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 250;
      expect(quotaTracker.getUsagePercent(state)).toBe(0.25);
    });

    it('should return 1 when at limit', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 1000;
      expect(quotaTracker.getUsagePercent(state)).toBe(1);
    });
  });

  describe('increment', () => {
    it('should increment quota usage', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      quotaTracker.increment(state, 5);
      expect(state.quotaUsed).toBe(5);
    });

    it('should increment by 1 by default', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      quotaTracker.increment(state);
      expect(state.quotaUsed).toBe(1);
    });

    it('should call onWarning when threshold reached', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 100 } });
      state.quotaUsed = 79;
      
      quotaTracker.increment(state, 1); // 80%
      
      expect(onWarning).toHaveBeenCalledWith(state.config, 0.8);
    });

    it('should only call onWarning once per key', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 100 } });
      state.quotaUsed = 79;
      
      quotaTracker.increment(state, 1); // 80%
      quotaTracker.increment(state, 1); // 81%
      
      expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('should call onKeyExhausted when limit reached', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 100 } });
      state.quotaUsed = 99;
      
      quotaTracker.increment(state, 1);
      
      expect(onKeyExhausted).toHaveBeenCalledWith(state.config);
    });

    it('should not modify unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      quotaTracker.increment(state, 100);
      expect(state.quotaUsed).toBe(0);
    });
  });

  describe('syncFromResponse', () => {
    it('should update quota when API reports more usage', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 100;
      
      // API says only 800 remaining = 200 used
      quotaTracker.syncFromResponse(state, 800);
      
      expect(state.quotaUsed).toBe(200);
    });

    it('should not decrease quota (API is source of truth for increases only)', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 300;
      
      // API says 800 remaining = 200 used (less than our tracking)
      quotaTracker.syncFromResponse(state, 800);
      
      expect(state.quotaUsed).toBe(300); // Unchanged
    });

    it('should not modify unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      quotaTracker.syncFromResponse(state, 500);
      expect(state.quotaUsed).toBe(0);
    });
  });

  describe('period reset', () => {
    it('should reset monthly quota in new month', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 500;
      state.periodStart = new Date('2024-01-15');
      
      // Move to February
      vi.setSystemTime(new Date('2024-02-01'));
      
      // Trigger check via hasQuota
      quotaTracker.hasQuota(state);
      
      expect(state.quotaUsed).toBe(0);
    });

    it('should reset yearly quota in new year', () => {
      const state = createKeyState({ quota: { type: 'yearly', limit: 10000 } });
      state.quotaUsed = 5000;
      state.periodStart = new Date('2024-06-15');
      
      // Move to next year
      vi.setSystemTime(new Date('2025-01-01'));
      
      quotaTracker.hasQuota(state);
      
      expect(state.quotaUsed).toBe(0);
    });

    it('should not reset total quota', () => {
      const state = createKeyState({ quota: { type: 'total', limit: 10000 } });
      state.quotaUsed = 5000;
      state.periodStart = new Date('2024-01-01');
      
      // Move forward several years
      vi.setSystemTime(new Date('2030-01-01'));
      
      quotaTracker.hasQuota(state);
      
      expect(state.quotaUsed).toBe(5000); // Unchanged
    });
  });

  describe('reset', () => {
    it('should reset quota to 0', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      state.quotaUsed = 500;
      
      quotaTracker.reset(state);
      
      expect(state.quotaUsed).toBe(0);
    });

    it('should update period start', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      const oldPeriodStart = state.periodStart;
      
      vi.advanceTimersByTime(1000);
      quotaTracker.reset(state);
      
      expect(state.periodStart.getTime()).toBeGreaterThan(oldPeriodStart.getTime());
    });
  });

  describe('getLimit', () => {
    it('should return limit for limited quota', () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      expect(quotaTracker.getLimit(state)).toBe(1000);
    });

    it('should return Infinity for unlimited quota', () => {
      const state = createKeyState({ quota: { type: 'unlimited' } });
      expect(quotaTracker.getLimit(state)).toBe(Infinity);
    });
  });

  describe('persistence', () => {
    it('should persist state to storage', async () => {
      const state = createKeyState({ quota: { type: 'monthly', limit: 1000 } });
      quotaTracker.increment(state, 100);
      
      // Wait for async persistence
      await vi.runAllTimersAsync();
      
      const stored = await storage.get(`quota:${state.config.id}`);
      expect(stored).not.toBeNull();
      
      const data = JSON.parse(stored!);
      expect(data.quotaUsed).toBe(100);
    });

    it('should load state from storage', async () => {
      const keyId = 'persisted-key';
      const state = createKeyState({ id: keyId, quota: { type: 'monthly', limit: 1000 } });
      
      // Pre-populate storage
      await storage.set(`quota:${keyId}`, JSON.stringify({
        quotaUsed: 250,
        periodStart: new Date().toISOString(),
      }));
      
      await quotaTracker.loadState(state);
      
      expect(state.quotaUsed).toBe(250);
    });
  });
});
