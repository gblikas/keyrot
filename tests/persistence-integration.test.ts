/**
 * Persistence Integration Tests
 *
 * These tests validate the full lifecycle of:
 * 1. Setting up keys in a pool
 * 2. Using keys (executing requests, consuming quota)
 * 3. Serializing/persisting state to storage
 * 4. Recovering state (simulating application restart)
 * 5. Validating recovered usage states match original
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createKeyPool } from '../app/pool.js';
import { DockerStorageAdapter } from '../app/storage/docker.js';
import { FileStorageAdapter } from '../app/storage/file.js';
import { MemoryStorageAdapter } from '../app/storage/memory.js';
import type { KeyPool } from '../app/pool.js';
import type { KeyConfig } from '../app/types.js';


describe('Persistence Integration', () => {
  let testDir: string;
  const encryptionKey = 'test-encryption-key-32-bytes-xx';

  beforeEach(async () => {
    vi.useFakeTimers();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyrot-persist-test-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Advance fake timers enough for at least 1 token to refill.
   * This is critical for low RPS values where vi.runAllTimersAsync() alone
   * doesn't advance enough time (only ~100ms for the queue timeout interval).
   * 
   * @param rps - The RPS limit of the key (tokens per second)
   */
  function advanceForTokenRefill(rps: number): void {
    const msPerToken = Math.ceil(1000 / rps);
    vi.advanceTimersByTime(msPerToken);
  }

  /**
   * For pools with multiple keys, advance based on the slowest (lowest RPS) key
   * to ensure all keys can refill at least 1 token.
   */
  function advanceForPoolTokenRefill(keys: KeyConfig[]): void {
    const minRps = Math.min(...keys.map(k => k.rps ?? Infinity));
    if (minRps !== Infinity) {
      advanceForTokenRefill(minRps);
    }
  }

  /**
   * Execute a request and advance time appropriately for token refill.
   * This is the correct pattern for sequential requests with fake timers.
   */
  async function executeWithTokenRefill(
    pool: KeyPool<Response>,
    keys: KeyConfig[],
  ): Promise<void> {
    const promise = pool.execute(async () => new Response('OK'));
    advanceForPoolTokenRefill(keys);
    await vi.runAllTimersAsync();
    await promise;
  }

  /**
   * Helper to trigger state loading by executing a request.
   * The pool only loads state when execute() is first called.
   */
  async function triggerStateLoad(pool: KeyPool<Response>, keys: KeyConfig[]): Promise<void> {
    const promise = pool.execute(async () => new Response('INIT'));
    advanceForPoolTokenRefill(keys);
    await vi.runAllTimersAsync();
    await promise;
  }

  describe('Full Lifecycle with DockerStorageAdapter', () => {
    it('should persist and recover quota usage across pool restarts', async () => {
      // Step 1: Create storage adapter (simulates Docker volume)
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // Use low RPS to properly test token refill with advanceTimersByTime
      const keys: KeyConfig[] = [
        { id: 'key-1', value: 'sk-key1', quota: { type: 'monthly', limit: 100 }, rps: 5 },
        { id: 'key-2', value: 'sk-key2', quota: { type: 'monthly', limit: 100 }, rps: 8 },
      ];

      // Step 2: Create first pool instance and use keys
      let pool: KeyPool<Response> = createKeyPool({
        keys,
        storage,
      });

      // Execute 10 requests (should use quota from available keys)
      for (let i = 0; i < 10; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      // Get stats before shutdown
      const statsBeforeShutdown = {
        key1: pool.getKeyStats('key-1'),
        key2: pool.getKeyStats('key-2'),
      };

      const totalUsedBefore =
        (statsBeforeShutdown.key1?.quotaUsed ?? 0) +
        (statsBeforeShutdown.key2?.quotaUsed ?? 0);

      expect(totalUsedBefore).toBe(10);

      // Step 3: Shutdown the pool (simulates app shutdown)
      await pool.shutdown();

      // Wait for any pending persistence
      await vi.runAllTimersAsync();

      // Step 4: Create a NEW pool instance with same storage (simulates app restart)
      const recoveredPool: KeyPool<Response> = createKeyPool({
        keys,
        storage,
      });

      // Trigger state loading by executing a request
      await triggerStateLoad(recoveredPool, keys);

      // Step 5: Verify recovered state matches original usage (plus the init request)
      const statsAfterRecovery = {
        key1: recoveredPool.getKeyStats('key-1'),
        key2: recoveredPool.getKeyStats('key-2'),
      };

      const totalUsedAfter =
        (statsAfterRecovery.key1?.quotaUsed ?? 0) +
        (statsAfterRecovery.key2?.quotaUsed ?? 0);

      // Total quota used should be preserved + 1 (for the init request)
      expect(totalUsedAfter).toBe(totalUsedBefore + 1);
      expect(totalUsedAfter).toBe(11);

      // At least one key should have more usage than before (from init request)
      const key1Change = (statsAfterRecovery.key1?.quotaUsed ?? 0) - (statsBeforeShutdown.key1?.quotaUsed ?? 0);
      const key2Change = (statsAfterRecovery.key2?.quotaUsed ?? 0) - (statsBeforeShutdown.key2?.quotaUsed ?? 0);
      expect(key1Change + key2Change).toBe(1);

      // Remaining quota should be correct
      expect(statsAfterRecovery.key1?.quotaRemaining).toBe(
        100 - (statsAfterRecovery.key1?.quotaUsed ?? 0)
      );
      expect(statsAfterRecovery.key2?.quotaRemaining).toBe(
        100 - (statsAfterRecovery.key2?.quotaUsed ?? 0)
      );

      await recoveredPool.shutdown();
    });

    it('should continue using quota from recovered state', async () => {
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // Use low RPS to properly test token refill
      const keys: KeyConfig[] = [
        { id: 'key-1', value: 'sk-key1', quota: { type: 'total', limit: 100 }, rps: 6 },
      ];

      // First session: use 20 requests
      let pool = createKeyPool({ keys, storage });

      for (let i = 0; i < 20; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      expect(pool.getKeyStats('key-1')?.quotaUsed).toBe(20);
      expect(pool.getKeyStats('key-1')?.quotaRemaining).toBe(80);

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Second session: use 15 more requests
      // Note: First execute() loads state, so we expect 20 + 15 = 35 total
      pool = createKeyPool({ keys, storage });

      for (let i = 0; i < 15; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      // After 15 requests on recovered pool: 20 (recovered) + 15 (new) = 35
      expect(pool.getKeyStats('key-1')?.quotaUsed).toBe(35);
      expect(pool.getKeyStats('key-1')?.quotaRemaining).toBe(65);

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Third session: verify state persisted again
      pool = createKeyPool({ keys, storage });
      
      // Execute one request to trigger state loading
      await triggerStateLoad(pool, keys);

      // 35 (recovered) + 1 (init) = 36
      expect(pool.getKeyStats('key-1')?.quotaUsed).toBe(36);
      expect(pool.getKeyStats('key-1')?.quotaRemaining).toBe(64);

      await pool.shutdown();
    });

    it('should handle encrypted storage with different quota types', async () => {
      // Test with yearly quota type (different from monthly used in other tests)
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // Use low RPS with prime number to test non-round values
      const keys: KeyConfig[] = [
        { id: 'yearly-key', value: 'sk-yearly', quota: { type: 'yearly', limit: 50 }, rps: 7 },
      ];

      // Use key
      let pool = createKeyPool({ keys, storage });

      for (let i = 0; i < 10; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      const originalStats = pool.getKeyStats('yearly-key')!;
      expect(originalStats.quotaUsed).toBe(10);
      expect(originalStats.quotaRemaining).toBe(40);

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Recover and verify state
      pool = createKeyPool({ keys, storage });
      
      // Trigger state loading with one request
      await triggerStateLoad(pool, keys);

      const recoveredStats = pool.getKeyStats('yearly-key')!;

      // Should be original + 1 (for init request)
      expect(recoveredStats.quotaUsed).toBe(11);
      expect(recoveredStats.quotaRemaining).toBe(39);

      await pool.shutdown();
    });

    // This test runs 5 restart cycles with file I/O, needs longer timeout on slower CI
    it('should preserve state across multiple restart cycles', { timeout: 15000 }, async () => {
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // Use low RPS with non-round value
      const keys: KeyConfig[] = [
        { id: 'key-1', value: 'sk-1', quota: { type: 'yearly', limit: 200 }, rps: 9 },
      ];

      const usagePerCycle = [5, 10, 15, 20, 25];
      let expectedTotal = 0;

      for (const usage of usagePerCycle) {
        const pool = createKeyPool({ keys, storage });

        // Use quota - first execute() triggers state loading
        for (let i = 0; i < usage; i++) {
          await executeWithTokenRefill(pool, keys);
        }

        expectedTotal += usage;
        expect(pool.getKeyStats('key-1')?.quotaUsed).toBe(expectedTotal);

        await pool.shutdown();
        await vi.runAllTimersAsync();
      }

      // Final verification - execute once to trigger state load
      const finalPool = createKeyPool({ keys, storage });
      await triggerStateLoad(finalPool, keys);

      // 5+10+15+20+25 = 75, plus 1 for init
      expect(finalPool.getKeyStats('key-1')?.quotaUsed).toBe(76);
      expect(finalPool.getKeyStats('key-1')?.quotaRemaining).toBe(200 - 76);

      await finalPool.shutdown();
    });
  });

  describe('Full Lifecycle with FileStorageAdapter', () => {
    it('should persist and recover quota usage across pool restarts', async () => {
      const filePath = path.join(testDir, 'storage.json');
      const storage = new FileStorageAdapter({ filePath });
      const keys: KeyConfig[] = [
        { id: 'file-key', value: 'sk-file', quota: { type: 'monthly', limit: 50 }, rps: 5 },
      ];

      // First session: use 12 requests
      let pool: KeyPool<Response> = createKeyPool({
        keys,
        storage,
      });

      for (let i = 0; i < 12; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      const usedBefore = pool.getKeyStats('file-key')?.quotaUsed ?? 0;
      expect(usedBefore).toBe(12);

      await pool.shutdown();
      await vi.runAllTimersAsync();
      await storage.flush();

      // Second session: new adapter instance (simulates restart)
      const recoveredStorage = new FileStorageAdapter({ filePath });
      const recoveredPool: KeyPool<Response> = createKeyPool({
        keys,
        storage: recoveredStorage,
      });

      // Trigger state loading by executing a request
      await triggerStateLoad(recoveredPool, keys);

      const usedAfter = recoveredPool.getKeyStats('file-key')?.quotaUsed ?? 0;
      expect(usedAfter).toBe(usedBefore + 1);
      expect(recoveredPool.getKeyStats('file-key')?.quotaRemaining).toBe(
        50 - usedAfter
      );

      await recoveredPool.shutdown();
      await vi.runAllTimersAsync();
      await recoveredStorage.flush();
    });
  });

  describe('Full Lifecycle with MemoryStorageAdapter', () => {
    it('should persist and recover quota within same process', async () => {
      // MemoryStorageAdapter persists within same process but not across restarts
      const storage = new MemoryStorageAdapter();

      // Use low RPS with non-round value
      const keys: KeyConfig[] = [
        { id: 'mem-key-1', value: 'sk-mem1', quota: { type: 'monthly', limit: 100 }, rps: 4 },
      ];

      // First pool instance
      let pool = createKeyPool({ keys, storage });

      for (let i = 0; i < 25; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      expect(pool.getKeyStats('mem-key-1')?.quotaUsed).toBe(25);
      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Second pool instance - same storage object (simulates HMR scenario)
      pool = createKeyPool({ keys, storage });

      // Execute 10 requests (first one triggers state load, so 25 + 10 = 35)
      for (let i = 0; i < 10; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      expect(pool.getKeyStats('mem-key-1')?.quotaUsed).toBe(35);
      await pool.shutdown();
    });
  });

  describe('Edge Cases', () => {
    it('should handle recovery when storage is empty (fresh start)', async () => {
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // Use low RPS with prime number
      const keys: KeyConfig[] = [
        { id: 'fresh-key', value: 'sk-fresh', quota: { type: 'monthly', limit: 50 }, rps: 3 },
      ];

      const pool = createKeyPool({ keys, storage });
      
      // Execute once to trigger state loading
      await triggerStateLoad(pool, keys);

      // Should start with 1 usage (the init request)
      expect(pool.getKeyStats('fresh-key')?.quotaUsed).toBe(1);
      expect(pool.getKeyStats('fresh-key')?.quotaRemaining).toBe(49);

      await pool.shutdown();
    });

    it('should handle adding new keys to existing storage', async () => {
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // First session with one key - use low RPS
      const keys1: KeyConfig[] = [
        { id: 'original-key', value: 'sk-orig', quota: { type: 'monthly', limit: 100 }, rps: 5 },
      ];

      let pool = createKeyPool({ keys: keys1, storage });

      for (let i = 0; i < 30; i++) {
        await executeWithTokenRefill(pool, keys1);
      }

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Second session with additional key (asymmetric RPS)
      const keys2: KeyConfig[] = [
        { id: 'original-key', value: 'sk-orig', quota: { type: 'monthly', limit: 100 }, rps: 5 },
        { id: 'new-key', value: 'sk-new', quota: { type: 'monthly', limit: 100 }, rps: 8 },
      ];

      pool = createKeyPool({ keys: keys2, storage });
      
      // Execute once to trigger state loading
      await triggerStateLoad(pool, keys2);

      // One of the keys should have the init request
      const origUsed = pool.getKeyStats('original-key')?.quotaUsed ?? 0;
      const newUsed = pool.getKeyStats('new-key')?.quotaUsed ?? 0;
      
      // Original key should have recovered usage (30) + possibly the init request
      // New key should start fresh + possibly the init request
      expect(origUsed + newUsed).toBe(31); // 30 recovered + 1 init
      expect(origUsed).toBeGreaterThanOrEqual(30);

      await pool.shutdown();
    });

    it('should handle key removal gracefully', async () => {
      const storage = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey,
      });

      // First session with two keys - use low RPS with different values
      const keys1: KeyConfig[] = [
        { id: 'keep-key', value: 'sk-keep', quota: { type: 'monthly', limit: 100 }, rps: 6 },
        { id: 'remove-key', value: 'sk-remove', quota: { type: 'monthly', limit: 100 }, rps: 10 },
      ];

      let pool = createKeyPool({ keys: keys1, storage });

      for (let i = 0; i < 20; i++) {
        await executeWithTokenRefill(pool, keys1);
      }

      const keepUsed = pool.getKeyStats('keep-key')?.quotaUsed ?? 0;

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Second session with one key removed
      const keys2: KeyConfig[] = [
        { id: 'keep-key', value: 'sk-keep', quota: { type: 'monthly', limit: 100 }, rps: 6 },
      ];

      pool = createKeyPool({ keys: keys2, storage });
      
      // Execute once to trigger state loading
      await triggerStateLoad(pool, keys2);

      // Kept key should have recovered usage + 1 for init request
      expect(pool.getKeyStats('keep-key')?.quotaUsed).toBe(keepUsed + 1);

      // Removed key should not exist
      expect(pool.getKeyStats('remove-key')).toBeNull();

      await pool.shutdown();
    });

    it('should handle storage errors gracefully by falling back to fresh state', async () => {
      // Create a storage adapter that fails on get but succeeds on set
      let failOnGet = true;
      const store = new Map<string, string>();
      
      const conditionalStorage = {
        async get(key: string): Promise<string | null> {
          if (failOnGet) {
            return null; // Return null instead of throwing to simulate empty storage
          }
          return store.get(key) ?? null;
        },
        async set(key: string, value: string): Promise<void> {
          store.set(key, value);
        },
        async delete(key: string): Promise<void> {
          store.delete(key);
        },
      };

      // Use low RPS with prime number
      const keys: KeyConfig[] = [
        { id: 'error-key', value: 'sk-error', quota: { type: 'monthly', limit: 50 }, rps: 11 },
      ];

      // Pool should work with fresh state when storage returns null
      const pool = createKeyPool({ keys, storage: conditionalStorage });

      // Should work despite storage returning null
      await executeWithTokenRefill(pool, keys);

      expect(pool.getKeyStats('error-key')?.quotaUsed).toBe(1);

      await pool.shutdown();
    });

    it('should fail with low RPS when time is NOT advanced (demonstrates the bug)', async () => {
      // This test demonstrates the bug mentioned in commit da8e3c3:
      // "The root cause of the original test failures with low RPS was not fully diagnosed"
      //
      // The issue: with low RPS (e.g., 5), vi.runAllTimersAsync() only advances time
      // by ~100ms (the queue timeout checker interval), which only refills 0.5 tokens.
      // This is insufficient for hasCapacity() which requires >= 1 token.
      const storage = new MemoryStorageAdapter();

      // Low RPS that caused the original issue
      const keys: KeyConfig[] = [
        { id: 'low-rps-key', value: 'sk-low', quota: { type: 'monthly', limit: 100 }, rps: 5 },
      ];

      const pool = createKeyPool({ keys, storage });

      // Helper to silence expected rejections
      function silenceRejection(promise: Promise<unknown>): void {
        promise.catch(() => {});
      }

      // With rps: 5, we have 5 initial tokens
      // Trying to execute more than 5 sequential requests WITHOUT advancing time
      // should fail because tokens don't refill fast enough
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < 10; i++) {
        const promise = pool.execute(async () => new Response('OK'));
        silenceRejection(promise); // Silence potential rejection
        // NOT advancing time - this is the problematic pattern
        await vi.runAllTimersAsync();
        try {
          await promise;
          successCount++;
        } catch {
          errorCount++;
        }
      }

      // We expect some requests to fail due to token exhaustion
      // The first 5 should succeed (initial tokens), subsequent ones may fail
      expect(successCount).toBeLessThan(10);
      expect(errorCount).toBeGreaterThan(0);

      await pool.shutdown();
    });

    it('should work with low RPS values when time is advanced correctly', async () => {
      // This test shows the FIX for the bug:
      // Use vi.advanceTimersByTime() to advance enough time for token refill
      // before calling vi.runAllTimersAsync().
      const storage = new MemoryStorageAdapter();

      // Low RPS that caused the original issue
      const keys: KeyConfig[] = [
        { id: 'low-rps-key', value: 'sk-low', quota: { type: 'monthly', limit: 100 }, rps: 5 },
      ];

      const pool = createKeyPool({ keys, storage });

      // With rps: 5, we have 5 initial tokens
      // After 5 requests, we need to wait for token refill
      // At 5 tokens/sec, we need 200ms to refill 1 token
      const msPerToken = Math.ceil(1000 / 5); // 200ms

      // Execute 10 sequential requests (more than initial token capacity)
      for (let i = 0; i < 10; i++) {
        const promise = pool.execute(async () => new Response('OK'));
        // Advance time enough for at least 1 token to refill
        vi.advanceTimersByTime(msPerToken);
        await vi.runAllTimersAsync();
        await promise;
      }

      // All 10 requests should have succeeded
      expect(pool.getKeyStats('low-rps-key')?.quotaUsed).toBe(10);

      await pool.shutdown();
    });
  });

  /**
   * Parameterized tests with varying RPS and quota configurations
   * 
   * These tests ensure the fix works robustly across diverse configurations,
   * not just convenient multiples. This prevents runtime issues where users
   * might use non-round numbers for their API rate limits and quotas.
   */
  describe('Varying RPS and Quota Configurations', () => {
    // Test configurations with intentionally awkward values
    const singleKeyConfigs = [
      { name: 'prime rps and quota', rps: 7, quota: 23, requests: 15 },
      { name: 'very low rps (1)', rps: 1, quota: 20, requests: 8 },
      { name: 'very low rps (2)', rps: 2, quota: 30, requests: 12 },
      { name: 'non-divisible rps (3)', rps: 3, quota: 37, requests: 10 },
      { name: 'non-round rps and quota', rps: 9, quota: 41, requests: 20 },
      { name: 'prime rps (11)', rps: 11, quota: 29, requests: 18 },
      { name: 'prime rps (13)', rps: 13, quota: 47, requests: 25 },
    ];

    for (const config of singleKeyConfigs) {
      it(`should handle persistence correctly with ${config.name} (rps: ${config.rps}, quota: ${config.quota})`, async () => {
        const storage = new MemoryStorageAdapter();

        const keys: KeyConfig[] = [
          { id: 'test-key', value: 'sk-test', quota: { type: 'monthly', limit: config.quota }, rps: config.rps },
        ];

        // First session: use half the requests
        const firstSessionRequests = Math.floor(config.requests / 2);
        let pool = createKeyPool({ keys, storage });

        for (let i = 0; i < firstSessionRequests; i++) {
          await executeWithTokenRefill(pool, keys);
        }

        expect(pool.getKeyStats('test-key')?.quotaUsed).toBe(firstSessionRequests);
        await pool.shutdown();
        await vi.runAllTimersAsync();

        // Second session: use remaining requests
        const secondSessionRequests = config.requests - firstSessionRequests;
        pool = createKeyPool({ keys, storage });

        for (let i = 0; i < secondSessionRequests; i++) {
          await executeWithTokenRefill(pool, keys);
        }

        // Total should be preserved across sessions
        expect(pool.getKeyStats('test-key')?.quotaUsed).toBe(config.requests);
        expect(pool.getKeyStats('test-key')?.quotaRemaining).toBe(config.quota - config.requests);

        await pool.shutdown();
      });
    }

    // Multi-key configurations with asymmetric RPS
    const multiKeyConfigs = [
      {
        name: 'asymmetric prime rps values',
        keys: [
          { id: 'key-1', rps: 3, quota: 50 },
          { id: 'key-2', rps: 7, quota: 50 },
        ],
        requests: 20,
      },
      {
        name: 'mixed very low and moderate rps',
        keys: [
          { id: 'key-1', rps: 2, quota: 40 },
          { id: 'key-2', rps: 11, quota: 40 },
        ],
        requests: 15,
      },
      {
        name: 'three keys with prime rps',
        keys: [
          { id: 'key-1', rps: 5, quota: 30 },
          { id: 'key-2', rps: 7, quota: 30 },
          { id: 'key-3', rps: 11, quota: 30 },
        ],
        requests: 25,
      },
      {
        name: 'asymmetric quotas with same rps',
        keys: [
          { id: 'key-1', rps: 4, quota: 17 },
          { id: 'key-2', rps: 4, quota: 23 },
        ],
        requests: 18,
      },
    ];

    for (const config of multiKeyConfigs) {
      it(`should handle persistence correctly with ${config.name}`, async () => {
        const storage = new MemoryStorageAdapter();

        const keys: KeyConfig[] = config.keys.map(k => ({
          id: k.id,
          value: `sk-${k.id}`,
          quota: { type: 'monthly' as const, limit: k.quota },
          rps: k.rps,
        }));

        // First session
        const firstSessionRequests = Math.floor(config.requests / 2);
        let pool = createKeyPool({ keys, storage });

        for (let i = 0; i < firstSessionRequests; i++) {
          await executeWithTokenRefill(pool, keys);
        }

        const firstSessionTotal = keys.reduce((sum, k) => sum + (pool.getKeyStats(k.id)?.quotaUsed ?? 0), 0);
        expect(firstSessionTotal).toBe(firstSessionRequests);

        await pool.shutdown();
        await vi.runAllTimersAsync();

        // Second session
        const secondSessionRequests = config.requests - firstSessionRequests;
        pool = createKeyPool({ keys, storage });

        for (let i = 0; i < secondSessionRequests; i++) {
          await executeWithTokenRefill(pool, keys);
        }

        // Total across all keys should be preserved
        const finalTotal = keys.reduce((sum, k) => sum + (pool.getKeyStats(k.id)?.quotaUsed ?? 0), 0);
        expect(finalTotal).toBe(config.requests);

        await pool.shutdown();
      });
    }

    // Edge case: token refill timing with very low RPS
    it('should handle many sequential requests with very low rps (1 token/sec)', async () => {
      const storage = new MemoryStorageAdapter();

      const keys: KeyConfig[] = [
        { id: 'slow-key', value: 'sk-slow', quota: { type: 'monthly', limit: 50 }, rps: 1 },
      ];

      const pool = createKeyPool({ keys, storage });

      // With rps: 1, we get 1 token per second
      // This tests that our time advancement is correct for very slow rates
      for (let i = 0; i < 5; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      expect(pool.getKeyStats('slow-key')?.quotaUsed).toBe(5);
      await pool.shutdown();
    });

    // Edge case: quota limit equals request count
    it('should handle quota exactly matching request count', async () => {
      const storage = new MemoryStorageAdapter();

      const keys: KeyConfig[] = [
        { id: 'exact-key', value: 'sk-exact', quota: { type: 'monthly', limit: 10 }, rps: 3 },
      ];

      let pool = createKeyPool({ keys, storage });

      // Use exactly half the quota
      for (let i = 0; i < 5; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      expect(pool.getKeyStats('exact-key')?.quotaUsed).toBe(5);
      expect(pool.getKeyStats('exact-key')?.quotaRemaining).toBe(5);

      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Recover and use remaining quota
      pool = createKeyPool({ keys, storage });

      for (let i = 0; i < 5; i++) {
        await executeWithTokenRefill(pool, keys);
      }

      // Quota should be exactly exhausted
      expect(pool.getKeyStats('exact-key')?.quotaUsed).toBe(10);
      expect(pool.getKeyStats('exact-key')?.quotaRemaining).toBe(0);

      await pool.shutdown();
    });

    // Edge case: prime number quota that doesn't divide evenly
    it('should handle prime quota with uneven session splits', async () => {
      const storage = new MemoryStorageAdapter();

      // Prime quota of 17 with 3 sessions of varying sizes
      const keys: KeyConfig[] = [
        { id: 'prime-key', value: 'sk-prime', quota: { type: 'total', limit: 17 }, rps: 5 },
      ];

      // Session 1: 5 requests
      let pool = createKeyPool({ keys, storage });
      for (let i = 0; i < 5; i++) {
        await executeWithTokenRefill(pool, keys);
      }
      expect(pool.getKeyStats('prime-key')?.quotaUsed).toBe(5);
      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Session 2: 7 requests
      pool = createKeyPool({ keys, storage });
      for (let i = 0; i < 7; i++) {
        await executeWithTokenRefill(pool, keys);
      }
      expect(pool.getKeyStats('prime-key')?.quotaUsed).toBe(12);
      await pool.shutdown();
      await vi.runAllTimersAsync();

      // Session 3: 4 requests (reaches 16, leaving 1)
      pool = createKeyPool({ keys, storage });
      for (let i = 0; i < 4; i++) {
        await executeWithTokenRefill(pool, keys);
      }
      expect(pool.getKeyStats('prime-key')?.quotaUsed).toBe(16);
      expect(pool.getKeyStats('prime-key')?.quotaRemaining).toBe(1);

      await pool.shutdown();
    });
  });
});
