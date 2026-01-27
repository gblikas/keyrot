import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createKeyPool, type KeyPool } from '../app/pool.js';
import {
  NoKeysConfiguredError,
  InvalidKeyConfigError,
  AllKeysExhaustedError,
  QueueTimeoutError,
} from '../app/errors.js';
import type { KeyConfig, StorageAdapter } from '../app/types.js';

// Helper to silence unhandled promise rejections in tests
function silenceRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

function createTestKeys(count: number = 3): KeyConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `key-${i + 1}`,
    value: `test-value-${i + 1}`,
    quota: { type: 'monthly' as const, limit: 100 },
    rps: 100, // High RPS to avoid rate limiting in tests
  }));
}

describe('createKeyPool', () => {
  const poolsToCleanup: KeyPool<Response>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Clean up all pools to avoid unhandled rejection warnings
    for (const pool of poolsToCleanup) {
      await pool.shutdown();
    }
    poolsToCleanup.length = 0;
    vi.useRealTimers();
  });

  function trackPool(pool: KeyPool<Response>): KeyPool<Response> {
    poolsToCleanup.push(pool);
    return pool;
  }

  describe('configuration validation', () => {
    it('should throw NoKeysConfiguredError when no keys provided', () => {
      expect(() => createKeyPool({ keys: [] })).toThrow(NoKeysConfiguredError);
    });

    it('should throw InvalidKeyConfigError for missing key id', () => {
      expect(() => createKeyPool({
        keys: [{ id: '', value: 'test', quota: { type: 'unlimited' } }],
      })).toThrow(InvalidKeyConfigError);
    });

    it('should throw InvalidKeyConfigError for missing key value', () => {
      expect(() => createKeyPool({
        keys: [{ id: 'test', value: '', quota: { type: 'unlimited' } }],
      })).toThrow(InvalidKeyConfigError);
    });

    it('should throw InvalidKeyConfigError for invalid RPS', () => {
      expect(() => createKeyPool({
        keys: [{ id: 'test', value: 'test', quota: { type: 'unlimited' }, rps: -1 }],
      })).toThrow(InvalidKeyConfigError);
    });

    it('should throw InvalidKeyConfigError for invalid weight', () => {
      expect(() => createKeyPool({
        keys: [{ id: 'test', value: 'test', quota: { type: 'unlimited' }, weight: 0 }],
      })).toThrow(InvalidKeyConfigError);
    });

    it('should accept valid configuration', () => {
      const pool = createKeyPool({ keys: createTestKeys() });
      expect(pool).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute request with a key', async () => {
      const pool = createKeyPool({ keys: createTestKeys() });
      let usedKey: string | null = null;

      const promise = pool.execute(async (keyValue) => {
        usedKey = keyValue;
        return new Response('OK');
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(usedKey).toMatch(/^test-value-\d+$/);
    });

    it('should rotate keys on rate limit', async () => {
      const usedKeys: string[] = [];
      let callCount = 0;

      const pool = createKeyPool({
        keys: createTestKeys(3),
        isRateLimited: (res) => res.status === 429,
        getRetryAfter: () => 30,
      });

      const promise = pool.execute(async (keyValue) => {
        usedKeys.push(keyValue);
        callCount++;
        // First 2 calls return 429, third succeeds
        return new Response('OK', { status: callCount < 3 ? 429 : 200 });
      });

      await vi.runAllTimersAsync();
      await promise;

      // Should have tried 3 different keys
      expect(usedKeys.length).toBe(3);
      expect(new Set(usedKeys).size).toBe(3); // All different keys
    });

    it('should throw AllKeysExhaustedError when no keys available', async () => {
      const pool = trackPool(createKeyPool({
        keys: createTestKeys(2),
        isRateLimited: () => true, // All return 429
        getRetryAfter: () => 30,
        maxRetries: 2,
      }));

      const promise = pool.execute(async () => {
        return new Response('Too Many Requests', { status: 429 });
      });
      silenceRejection(promise);

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(AllKeysExhaustedError);
    });

    it('should respect maxWaitMs option', async () => {
      const pool = trackPool(createKeyPool({
        keys: createTestKeys(),
        maxQueueSize: 100, // Large queue to allow second request
      }));

      // First request blocks (silence it since it won't complete)
      const blockingPromise = pool.execute(async () => {
        await new Promise(() => {}); // Never resolves
        return new Response('OK');
      });
      silenceRejection(blockingPromise);

      // Second request should timeout while waiting
      const promise = pool.execute(
        async () => new Response('OK'),
        { maxWaitMs: 100 }
      );
      silenceRejection(promise);

      vi.advanceTimersByTime(101);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow(QueueTimeoutError);
    });

    it('should increment quota on success', async () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });

      const promise = pool.execute(async () => new Response('OK'));
      await vi.runAllTimersAsync();
      await promise;

      const stats = pool.getKeyStats('key-1');
      expect(stats?.quotaUsed).toBe(1);
    });

    it('should call onWarning when threshold reached', async () => {
      const onWarning = vi.fn();
      const pool = createKeyPool({
        keys: [{ id: 'key-1', value: 'test', quota: { type: 'monthly', limit: 10 }, rps: 100 }],
        warningThreshold: 0.8,
        onWarning,
      });

      // Make 8 requests to hit 80%
      for (let i = 0; i < 8; i++) {
        const promise = pool.execute(async () => new Response('OK'));
        await vi.runAllTimersAsync();
        await promise;
      }

      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'key-1' }),
        0.8
      );
    });
  });

  describe('getHealth', () => {
    it('should return healthy status when all keys available', () => {
      const pool = createKeyPool({ keys: createTestKeys(3) });
      const health = pool.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.availableKeys).toBe(3);
      expect(health.totalKeys).toBe(3);
    });

    it('should return degraded status when some keys unavailable', async () => {
      const pool = createKeyPool({
        keys: createTestKeys(5), // 5 keys
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
      });

      // Open circuit on 3 keys = 40% available (between 20-50%)
      pool.openCircuit('key-1');
      pool.openCircuit('key-2');
      pool.openCircuit('key-3');

      const health = pool.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.availableKeys).toBe(2);
    });

    it('should return critical status when most keys unavailable', async () => {
      const pool = createKeyPool({
        keys: createTestKeys(10), // 10 keys
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
      });

      // Open circuit on 9 keys = 10% available (< 20%)
      pool.openCircuit('key-1');
      pool.openCircuit('key-2');
      pool.openCircuit('key-3');
      pool.openCircuit('key-4');
      pool.openCircuit('key-5');
      pool.openCircuit('key-6');
      pool.openCircuit('key-7');
      pool.openCircuit('key-8');
      pool.openCircuit('key-9');

      const health = pool.getHealth();

      expect(health.status).toBe('critical');
      expect(health.availableKeys).toBe(1);
    });

    it('should return exhausted status when no keys available', async () => {
      const pool = createKeyPool({
        keys: createTestKeys(2),
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
      });

      pool.openCircuit('key-1');
      pool.openCircuit('key-2');

      const health = pool.getHealth();

      expect(health.status).toBe('exhausted');
      expect(health.availableKeys).toBe(0);
    });

    it('should calculate effective RPS', () => {
      const pool = createKeyPool({
        keys: [
          { id: 'key-1', value: 'test', quota: { type: 'unlimited' }, rps: 10 },
          { id: 'key-2', value: 'test', quota: { type: 'unlimited' }, rps: 20 },
        ],
      });

      const health = pool.getHealth();
      expect(health.effectiveRps).toBe(30);
    });
  });

  describe('getKeyStats', () => {
    it('should return null for unknown key', () => {
      const pool = createKeyPool({ keys: createTestKeys() });
      expect(pool.getKeyStats('unknown')).toBeNull();
    });

    it('should return stats for known key', () => {
      const pool = createKeyPool({ keys: createTestKeys() });
      const stats = pool.getKeyStats('key-1');

      expect(stats).not.toBeNull();
      expect(stats!.id).toBe('key-1');
      expect(stats!.quotaUsed).toBe(0);
      expect(stats!.quotaRemaining).toBe(100);
      expect(stats!.isRateLimited).toBe(false);
      expect(stats!.isCircuitOpen).toBe(false);
    });
  });

  describe('getAllKeyStats', () => {
    it('should return stats for all keys', () => {
      const pool = createKeyPool({ keys: createTestKeys(3) });
      const stats = pool.getAllKeyStats();

      expect(stats).toHaveLength(3);
      expect(stats.map(s => s.id)).toEqual(['key-1', 'key-2', 'key-3']);
    });
  });

  describe('getQueueSize', () => {
    it('should return 0 for empty queue', () => {
      const pool = createKeyPool({ keys: createTestKeys() });
      expect(pool.getQueueSize()).toBe(0);
    });
  });

  describe('addKey', () => {
    it('should add a new key to the pool', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });
      
      pool.addKey({
        id: 'new-key',
        value: 'new-value',
        quota: { type: 'unlimited' },
      });

      expect(pool.getKeyStats('new-key')).not.toBeNull();
      expect(pool.getHealth().totalKeys).toBe(2);
    });

    it('should throw for duplicate key ID', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });

      expect(() => pool.addKey({
        id: 'key-1',
        value: 'duplicate',
        quota: { type: 'unlimited' },
      })).toThrow(InvalidKeyConfigError);
    });
  });

  describe('removeKey', () => {
    it('should remove a key from the pool', () => {
      const pool = createKeyPool({ keys: createTestKeys(2) });
      
      const removed = pool.removeKey('key-1');
      
      expect(removed).toBe(true);
      expect(pool.getKeyStats('key-1')).toBeNull();
      expect(pool.getHealth().totalKeys).toBe(1);
    });

    it('should return false for unknown key', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });
      expect(pool.removeKey('unknown')).toBe(false);
    });
  });

  describe('closeCircuit', () => {
    it('should close circuit for a key', () => {
      const pool = createKeyPool({
        keys: createTestKeys(1),
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
      });

      pool.openCircuit('key-1');
      expect(pool.getKeyStats('key-1')!.isCircuitOpen).toBe(true);

      pool.closeCircuit('key-1');
      expect(pool.getKeyStats('key-1')!.isCircuitOpen).toBe(false);
    });

    it('should return false for unknown key', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });
      expect(pool.closeCircuit('unknown')).toBe(false);
    });
  });

  describe('openCircuit', () => {
    it('should open circuit for a key', () => {
      const pool = createKeyPool({
        keys: createTestKeys(1),
        circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
      });

      pool.openCircuit('key-1');
      expect(pool.getKeyStats('key-1')!.isCircuitOpen).toBe(true);
    });

    it('should return false for unknown key', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });
      expect(pool.openCircuit('unknown')).toBe(false);
    });
  });

  describe('resetQuota', () => {
    it('should reset quota for a key', async () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });

      // Use some quota
      const promise = pool.execute(async () => new Response('OK'));
      await vi.runAllTimersAsync();
      await promise;

      expect(pool.getKeyStats('key-1')!.quotaUsed).toBe(1);

      pool.resetQuota('key-1');
      expect(pool.getKeyStats('key-1')!.quotaUsed).toBe(0);
    });

    it('should return false for unknown key', () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });
      expect(pool.resetQuota('unknown')).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should reject pending requests', async () => {
      const pool = createKeyPool({ keys: createTestKeys(1) });

      // Start a request that won't complete
      const promise = pool.execute(async () => {
        await new Promise(() => {}); // Never resolves
        return new Response('OK');
      });
      silenceRejection(promise);

      // Flush microtasks to allow initPromise to resolve and request to be enqueued
      // Using nextTick to flush microtasks without advancing fake timers
      await new Promise(resolve => process.nextTick(resolve));

      await pool.shutdown();

      await expect(promise).rejects.toThrow('shutting down');
    });
  });
});

describe('Pool Integration', () => {
  const integrationPools: KeyPool<Response>[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    for (const pool of integrationPools) {
      await pool.shutdown();
    }
    integrationPools.length = 0;
    vi.useRealTimers();
  });

  it('should handle concurrent requests with rate limiting', async () => {
    const requestsPerKey: Record<string, number> = {};
    
    const pool = createKeyPool({
      keys: [
        { id: 'key-1', value: 'val-1', quota: { type: 'unlimited' }, rps: 5 },
        { id: 'key-2', value: 'val-2', quota: { type: 'unlimited' }, rps: 5 },
      ],
    });
    integrationPools.push(pool);

    const promises = Array.from({ length: 10 }, () =>
      pool.execute(async (keyValue) => {
        requestsPerKey[keyValue] = (requestsPerKey[keyValue] || 0) + 1;
        return new Response('OK');
      })
    );

    await vi.runAllTimersAsync();
    await Promise.all(promises);

    // Both keys should have been used
    expect(Object.keys(requestsPerKey).length).toBe(2);
    expect(requestsPerKey['val-1']).toBe(5);
    expect(requestsPerKey['val-2']).toBe(5);
  });

  it('should recover after circuit breaker timeout', async () => {
    const pool = createKeyPool({
      keys: createTestKeys(1),
      circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1000 },
      isError: (res) => res.status >= 500,
    });
    integrationPools.push(pool);

    // Trigger circuit open
    const failPromise = pool.execute(async () => new Response('Error', { status: 500 }));
    silenceRejection(failPromise);
    
    await vi.runAllTimersAsync();
    
    try {
      await failPromise;
    } catch {
      // Expected
    }

    expect(pool.getHealth().status).toBe('exhausted');

    // Advance past circuit timeout
    vi.advanceTimersByTime(1001);

    // Should be half-open now, can try again
    const health = pool.getHealth();
    expect(health.status).not.toBe('exhausted');
  });

  it('should handle quota sync from response headers', async () => {
    const pool = createKeyPool({
      keys: [{ id: 'key-1', value: 'test', quota: { type: 'monthly', limit: 1000 } }],
      getQuotaRemaining: (res) => {
        const header = res.headers.get('x-ratelimit-remaining');
        return header ? parseInt(header, 10) : null;
      },
    });
    integrationPools.push(pool);

    const promise = pool.execute(async () => {
      return new Response('OK', {
        headers: { 'x-ratelimit-remaining': '800' },
      });
    });

    await vi.runAllTimersAsync();
    await promise;

    // Should sync: 1000 - 800 = 200 used
    const stats = pool.getKeyStats('key-1');
    expect(stats!.quotaUsed).toBe(200);
  });

  it('should load persisted state before executing requests', async () => {
    // Create a storage adapter with pre-existing quota data
    const store = new Map<string, string>();
    const existingQuotaUsed = 50;
    store.set('keyrot:quota:key-1', JSON.stringify({
      quotaUsed: existingQuotaUsed,
      periodStart: new Date().toISOString(),
    }));

    const storage: StorageAdapter = {
      async get(key: string) {
        return store.get(`keyrot:${key}`) ?? null;
      },
      async set(key: string, value: string) {
        store.set(`keyrot:${key}`, value);
      },
      async delete(key: string) {
        store.delete(`keyrot:${key}`);
      },
    };

    // Create pool with storage containing existing quota data
    const pool = createKeyPool({
      keys: [{ id: 'key-1', value: 'test', quota: { type: 'monthly', limit: 100 }, rps: 100 }],
      storage,
    });
    integrationPools.push(pool);

    // Immediately call execute - this should await state loading first
    const promise = pool.execute(async () => new Response('OK'));
    await vi.runAllTimersAsync();
    await promise;

    // The quota should be existingQuotaUsed + 1 (the request we just made)
    // NOT 1 (which would happen if state wasn't loaded before executing)
    const stats = pool.getKeyStats('key-1');
    expect(stats!.quotaUsed).toBe(existingQuotaUsed + 1);
  });
});
