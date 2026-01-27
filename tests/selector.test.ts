import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeySelector } from '../app/selector.js';
import { RateLimiter } from '../app/rate-limiter.js';
import { QuotaTracker } from '../app/quota-tracker.js';
import { CircuitBreaker } from '../app/circuit-breaker.js';
import { MemoryStorageAdapter } from '../app/storage/memory.js';
import type { KeyState, KeyConfig } from '../app/types.js';

function createKeyState(overrides: Partial<KeyConfig> = {}, stateOverrides: Partial<KeyState> = {}): KeyState {
  const config: KeyConfig = {
    id: 'test-key',
    value: 'test-value',
    quota: { type: 'monthly', limit: 1000 },
    rps: 10,
    weight: 1,
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
    tokens: config.rps ?? 10,
    lastTokenRefill: new Date(),
    ...stateOverrides,
  };
}

describe('KeySelector', () => {
  let selector: KeySelector;
  let rateLimiter: RateLimiter;
  let quotaTracker: QuotaTracker;
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = new RateLimiter();
    quotaTracker = new QuotaTracker({
      storage: new MemoryStorageAdapter(),
      warningThreshold: 0.8,
    });
    circuitBreaker = new CircuitBreaker({
      config: { failureThreshold: 3, resetTimeoutMs: 5000 },
    });
    selector = new KeySelector({
      rateLimiter,
      quotaTracker,
      circuitBreaker,
    });
  });

  describe('selectKey', () => {
    it('should return null for empty states array', () => {
      expect(selector.selectKey([])).toBeNull();
    });

    it('should select an available key', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2' }),
      ];

      const selected = selector.selectKey(states);
      expect(selected).not.toBeNull();
      expect(['key-1', 'key-2']).toContain(selected!.config.id);
    });

    it('should skip rate-limited keys', () => {
      const states = [
        createKeyState({ id: 'key-1' }, { tokens: 0, lastTokenRefill: new Date() }),
        createKeyState({ id: 'key-2' }),
      ];

      const selected = selector.selectKey(states);
      expect(selected!.config.id).toBe('key-2');
    });

    it('should skip quota-exhausted keys', () => {
      const states = [
        createKeyState({ id: 'key-1', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }),
        createKeyState({ id: 'key-2' }),
      ];

      const selected = selector.selectKey(states);
      expect(selected!.config.id).toBe('key-2');
    });

    it('should skip circuit-open keys', () => {
      const states = [
        createKeyState({ id: 'key-1' }, { 
          circuitState: 'open', 
          circuitOpenUntil: new Date(Date.now() + 10000) 
        }),
        createKeyState({ id: 'key-2' }),
      ];

      const selected = selector.selectKey(states);
      expect(selected!.config.id).toBe('key-2');
    });

    it('should skip temporarily rate-limited keys', () => {
      const states = [
        createKeyState({ id: 'key-1' }, { 
          rateLimitedUntil: new Date(Date.now() + 30000) 
        }),
        createKeyState({ id: 'key-2' }),
      ];

      const selected = selector.selectKey(states);
      expect(selected!.config.id).toBe('key-2');
    });

    it('should exclude specified key IDs', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2' }),
        createKeyState({ id: 'key-3' }),
      ];

      const excluded = new Set(['key-1', 'key-2']);
      const selected = selector.selectKey(states, excluded);
      expect(selected!.config.id).toBe('key-3');
    });

    it('should return null if all keys are excluded', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2' }),
      ];

      const excluded = new Set(['key-1', 'key-2']);
      expect(selector.selectKey(states, excluded)).toBeNull();
    });

    it('should return null if no keys are available', () => {
      const states = [
        createKeyState({ id: 'key-1', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }),
        createKeyState({ id: 'key-2' }, { 
          circuitState: 'open', 
          circuitOpenUntil: new Date(Date.now() + 10000) 
        }),
      ];

      expect(selector.selectKey(states)).toBeNull();
    });

    it('should use round-robin selection', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2' }),
        createKeyState({ id: 'key-3' }),
      ];

      const selections: string[] = [];
      for (let i = 0; i < 6; i++) {
        const selected = selector.selectKey(states);
        selections.push(selected!.config.id);
      }

      // Should cycle through keys
      expect(selections).toEqual(['key-1', 'key-2', 'key-3', 'key-1', 'key-2', 'key-3']);
    });

    it('should respect weight in selection', () => {
      const states = [
        createKeyState({ id: 'key-1', weight: 2 }),
        createKeyState({ id: 'key-2', weight: 1 }),
      ];

      const counts: Record<string, number> = { 'key-1': 0, 'key-2': 0 };
      for (let i = 0; i < 9; i++) {
        const selected = selector.selectKey(states);
        counts[selected!.config.id]++;
      }

      // key-1 should appear roughly 2x as often as key-2
      expect(counts['key-1']).toBe(6);
      expect(counts['key-2']).toBe(3);
    });
  });

  describe('isKeyAvailable', () => {
    it('should return true for healthy key', () => {
      const state = createKeyState();
      expect(selector.isKeyAvailable(state)).toBe(true);
    });

    it('should return false for rate-limited key', () => {
      const state = createKeyState({}, { tokens: 0, lastTokenRefill: new Date() });
      expect(selector.isKeyAvailable(state)).toBe(false);
    });

    it('should return false for quota-exhausted key', () => {
      const state = createKeyState(
        { quota: { type: 'monthly', limit: 100 } },
        { quotaUsed: 100 }
      );
      expect(selector.isKeyAvailable(state)).toBe(false);
    });

    it('should return false for circuit-open key', () => {
      const state = createKeyState({}, { 
        circuitState: 'open',
        circuitOpenUntil: new Date(Date.now() + 10000),
      });
      expect(selector.isKeyAvailable(state)).toBe(false);
    });
  });

  describe('getAvailableCount', () => {
    it('should count available keys', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }),
        createKeyState({ id: 'key-3' }),
      ];

      expect(selector.getAvailableCount(states)).toBe(2);
    });

    it('should return 0 when no keys available', () => {
      const states = [
        createKeyState({ id: 'key-1', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }),
      ];

      expect(selector.getAvailableCount(states)).toBe(0);
    });
  });

  describe('getAvailabilityBreakdown', () => {
    it('should categorize keys correctly', () => {
      const states = [
        createKeyState({ id: 'key-1' }), // available
        createKeyState({ id: 'key-2' }, { tokens: 0, lastTokenRefill: new Date() }), // rate limited
        createKeyState({ id: 'key-3', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }), // exhausted
        createKeyState({ id: 'key-4' }, { 
          circuitState: 'open',
          circuitOpenUntil: new Date(Date.now() + 10000),
        }), // circuit open
      ];

      const breakdown = selector.getAvailabilityBreakdown(states);
      expect(breakdown.available).toBe(1);
      expect(breakdown.rateLimited).toBe(1);
      expect(breakdown.quotaExhausted).toBe(1);
      expect(breakdown.circuitOpen).toBe(1);
    });
  });

  describe('getNextAvailableTime', () => {
    it('should return shortest wait time', () => {
      const states = [
        createKeyState({ id: 'key-1' }, { 
          circuitState: 'open',
          circuitOpenUntil: new Date(Date.now() + 10000),
        }),
        createKeyState({ id: 'key-2' }, { 
          rateLimitedUntil: new Date(Date.now() + 5000),
        }),
      ];

      const waitTime = selector.getNextAvailableTime(states);
      expect(waitTime).toBeCloseTo(5000, -2);
    });

    it('should return default when no info available', () => {
      const states = [
        createKeyState({ id: 'key-1', quota: { type: 'monthly', limit: 100 } }, { quotaUsed: 100 }),
      ];

      expect(selector.getNextAvailableTime(states)).toBe(60000);
    });
  });

  describe('reset', () => {
    it('should reset round-robin index', () => {
      const states = [
        createKeyState({ id: 'key-1' }),
        createKeyState({ id: 'key-2' }),
      ];

      selector.selectKey(states); // key-1
      selector.selectKey(states); // key-2
      
      selector.reset();
      
      const selected = selector.selectKey(states);
      expect(selected!.config.id).toBe('key-1');
    });
  });
});
