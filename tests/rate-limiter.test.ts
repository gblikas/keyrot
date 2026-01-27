import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../app/rate-limiter.js';
import type { KeyState, KeyConfig } from '../app/types.js';

function createKeyState(overrides: Partial<KeyConfig> = {}): KeyState {
  const config: KeyConfig = {
    id: 'test-key',
    value: 'test-value',
    quota: { type: 'unlimited' },
    rps: 10,
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
    tokens: config.rps ?? 0,
    lastTokenRefill: new Date(),
  };
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
    vi.useFakeTimers();
  });

  describe('hasCapacity', () => {
    it('should return true when no RPS limit is configured', () => {
      const state = createKeyState({ rps: undefined });
      expect(rateLimiter.hasCapacity(state)).toBe(true);
    });

    it('should return true when tokens are available', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 10;
      expect(rateLimiter.hasCapacity(state)).toBe(true);
    });

    it('should return false when no tokens are available', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 0;
      state.lastTokenRefill = new Date();
      expect(rateLimiter.hasCapacity(state)).toBe(false);
    });

    it('should account for token refill over time', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 0;
      state.lastTokenRefill = new Date();
      
      // Advance time by 100ms (should refill 1 token at 10 RPS)
      vi.advanceTimersByTime(100);
      
      expect(rateLimiter.hasCapacity(state)).toBe(true);
    });
  });

  describe('tryConsume', () => {
    it('should return true and not modify state when no RPS limit', () => {
      const state = createKeyState({ rps: undefined });
      expect(rateLimiter.tryConsume(state)).toBe(true);
    });

    it('should consume a token when available', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 5;
      
      expect(rateLimiter.tryConsume(state)).toBe(true);
      expect(state.tokens).toBeLessThan(5);
    });

    it('should return false when no tokens available', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 0;
      state.lastTokenRefill = new Date();
      
      expect(rateLimiter.tryConsume(state)).toBe(false);
    });

    it('should refill tokens before consuming', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 0;
      state.lastTokenRefill = new Date();
      
      // Advance time by 500ms (should refill 5 tokens at 10 RPS)
      vi.advanceTimersByTime(500);
      
      expect(rateLimiter.tryConsume(state)).toBe(true);
    });
  });

  describe('getAvailableTokens', () => {
    it('should return Infinity when no RPS limit', () => {
      const state = createKeyState({ rps: undefined });
      expect(rateLimiter.getAvailableTokens(state)).toBe(Infinity);
    });

    it('should return current tokens plus refill', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 5;
      state.lastTokenRefill = new Date();
      
      // Advance 200ms = 2 more tokens
      vi.advanceTimersByTime(200);
      
      expect(rateLimiter.getAvailableTokens(state)).toBeCloseTo(7, 1);
    });

    it('should cap tokens at RPS limit', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 8;
      state.lastTokenRefill = new Date();
      
      // Advance 1 second = would add 10 tokens, but capped at 10
      vi.advanceTimersByTime(1000);
      
      expect(rateLimiter.getAvailableTokens(state)).toBe(10);
    });
  });

  describe('getCurrentRps', () => {
    it('should return 0 when no RPS limit', () => {
      const state = createKeyState({ rps: undefined });
      expect(rateLimiter.getCurrentRps(state)).toBe(0);
    });

    it('should return consumed tokens as current RPS', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 7; // 3 consumed
      state.lastTokenRefill = new Date();
      
      expect(rateLimiter.getCurrentRps(state)).toBeCloseTo(3, 1);
    });
  });

  describe('getTimeUntilAvailable', () => {
    it('should return 0 when no RPS limit', () => {
      const state = createKeyState({ rps: undefined });
      expect(rateLimiter.getTimeUntilAvailable(state)).toBe(0);
    });

    it('should return 0 when tokens are available', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 5;
      expect(rateLimiter.getTimeUntilAvailable(state)).toBe(0);
    });

    it('should return time until next token', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 0;
      state.lastTokenRefill = new Date();
      
      // At 10 RPS, need 100ms for 1 token
      expect(rateLimiter.getTimeUntilAvailable(state)).toBe(100);
    });
  });

  describe('reset', () => {
    it('should reset tokens to full capacity', () => {
      const state = createKeyState({ rps: 10 });
      state.tokens = 2;
      
      rateLimiter.reset(state);
      
      expect(state.tokens).toBe(10);
    });

    it('should update lastTokenRefill', () => {
      const state = createKeyState({ rps: 10 });
      const oldRefill = state.lastTokenRefill;
      
      vi.advanceTimersByTime(1000);
      rateLimiter.reset(state);
      
      expect(state.lastTokenRefill.getTime()).toBeGreaterThan(oldRefill.getTime());
    });
  });
});
