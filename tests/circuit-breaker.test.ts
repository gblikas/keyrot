import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../app/circuit-breaker.js';
import type { KeyState, KeyConfig, CircuitBreakerConfig } from '../app/types.js';

function createKeyState(overrides: Partial<KeyConfig> = {}): KeyState {
  const config: KeyConfig = {
    id: 'test-key',
    value: 'test-value',
    quota: { type: 'unlimited' },
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

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let onKeyCircuitOpen: ReturnType<typeof vi.fn>;
  const config: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetTimeoutMs: 5000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    onKeyCircuitOpen = vi.fn();
    circuitBreaker = new CircuitBreaker({
      config,
      onKeyCircuitOpen,
    });
  });

  describe('isAvailable', () => {
    it('should return true when circuit is closed', () => {
      const state = createKeyState();
      state.circuitState = 'closed';
      expect(circuitBreaker.isAvailable(state)).toBe(true);
    });

    it('should return false when circuit is open', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 10000);
      expect(circuitBreaker.isAvailable(state)).toBe(false);
    });

    it('should return true when circuit is half-open', () => {
      const state = createKeyState();
      state.circuitState = 'half-open';
      expect(circuitBreaker.isAvailable(state)).toBe(true);
    });

    it('should transition from open to half-open after timeout', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 5000);

      // Still open
      expect(circuitBreaker.isAvailable(state)).toBe(false);

      // Advance past timeout
      vi.advanceTimersByTime(5001);

      // Now should be half-open
      expect(circuitBreaker.isAvailable(state)).toBe(true);
      expect(state.circuitState).toBe('half-open');
    });
  });

  describe('recordSuccess', () => {
    it('should reset consecutive failures', () => {
      const state = createKeyState();
      state.consecutiveFailures = 2;

      circuitBreaker.recordSuccess(state);

      expect(state.consecutiveFailures).toBe(0);
    });

    it('should transition from half-open to closed on success', () => {
      const state = createKeyState();
      state.circuitState = 'half-open';

      circuitBreaker.recordSuccess(state);

      expect(state.circuitState).toBe('closed');
      expect(state.circuitOpenUntil).toBeNull();
    });

    it('should keep circuit closed on success', () => {
      const state = createKeyState();
      state.circuitState = 'closed';

      circuitBreaker.recordSuccess(state);

      expect(state.circuitState).toBe('closed');
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutive failures', () => {
      const state = createKeyState();
      state.consecutiveFailures = 1;

      circuitBreaker.recordFailure(state);

      expect(state.consecutiveFailures).toBe(2);
    });

    it('should open circuit after reaching threshold', () => {
      const state = createKeyState();
      state.consecutiveFailures = 2; // One below threshold

      circuitBreaker.recordFailure(state);

      expect(state.circuitState).toBe('open');
      expect(state.circuitOpenUntil).not.toBeNull();
      expect(onKeyCircuitOpen).toHaveBeenCalledWith(state.config);
    });

    it('should not call callback when already open', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 10000);
      state.consecutiveFailures = 5;

      circuitBreaker.recordFailure(state);

      expect(onKeyCircuitOpen).not.toHaveBeenCalled();
    });

    it('should set circuitOpenUntil to resetTimeoutMs in future', () => {
      const state = createKeyState();
      state.consecutiveFailures = 2;
      const now = Date.now();

      circuitBreaker.recordFailure(state);

      expect(state.circuitOpenUntil!.getTime()).toBe(now + config.resetTimeoutMs);
    });
  });

  describe('getTimeUntilReset', () => {
    it('should return 0 when circuit is closed', () => {
      const state = createKeyState();
      state.circuitState = 'closed';
      expect(circuitBreaker.getTimeUntilReset(state)).toBe(0);
    });

    it('should return remaining time when circuit is open', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 3000);

      expect(circuitBreaker.getTimeUntilReset(state)).toBeCloseTo(3000, -2);
    });

    it('should return 0 when circuit has expired', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() - 1000);

      expect(circuitBreaker.getTimeUntilReset(state)).toBe(0);
    });
  });

  describe('getState', () => {
    it('should return current circuit state', () => {
      const state = createKeyState();
      state.circuitState = 'closed';
      expect(circuitBreaker.getState(state)).toBe('closed');

      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 10000);
      expect(circuitBreaker.getState(state)).toBe('open');
    });

    it('should trigger transition check', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() - 1000); // Already expired

      expect(circuitBreaker.getState(state)).toBe('half-open');
    });
  });

  describe('forceClose', () => {
    it('should close the circuit', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 10000);
      state.consecutiveFailures = 5;

      circuitBreaker.forceClose(state);

      expect(state.circuitState).toBe('closed');
      expect(state.circuitOpenUntil).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('forceOpen', () => {
    it('should open the circuit', () => {
      const state = createKeyState();
      state.circuitState = 'closed';

      circuitBreaker.forceOpen(state);

      expect(state.circuitState).toBe('open');
      expect(state.circuitOpenUntil).not.toBeNull();
      expect(onKeyCircuitOpen).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset all circuit state', () => {
      const state = createKeyState();
      state.circuitState = 'open';
      state.circuitOpenUntil = new Date(Date.now() + 10000);
      state.consecutiveFailures = 5;

      circuitBreaker.reset(state);

      expect(state.circuitState).toBe('closed');
      expect(state.circuitOpenUntil).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
    });
  });
});
