import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DockerStorageAdapter, dockerAdapter } from '../app/storage/docker.js';

describe('DockerStorageAdapter', () => {
  let testDir: string;
  let adapter: DockerStorageAdapter;
  const testKey = 'test-encryption-key-32-bytes-xx';

  beforeEach(async () => {
    // Create a temp directory for each test
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyrot-test-'));
    adapter = new DockerStorageAdapter({
      dataDir: testDir,
      encryptionKey: testKey,
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should throw if no encryption key is provided', () => {
      // Clear any environment variable
      const originalEnv = process.env.KEYROT_ENCRYPTION_KEY;
      delete process.env.KEYROT_ENCRYPTION_KEY;

      try {
        expect(() => new DockerStorageAdapter({ dataDir: testDir })).toThrow(
          'requires an encryption key'
        );
      } finally {
        if (originalEnv) {
          process.env.KEYROT_ENCRYPTION_KEY = originalEnv;
        }
      }
    });

    it('should use encryption key from environment variable', () => {
      const originalEnv = process.env.KEYROT_ENCRYPTION_KEY;
      process.env.KEYROT_ENCRYPTION_KEY = 'env-key-12345678901234567890';

      try {
        const envAdapter = new DockerStorageAdapter({ dataDir: testDir });
        expect(envAdapter).toBeInstanceOf(DockerStorageAdapter);
      } finally {
        if (originalEnv) {
          process.env.KEYROT_ENCRYPTION_KEY = originalEnv;
        } else {
          delete process.env.KEYROT_ENCRYPTION_KEY;
        }
      }
    });

    it('should prefer options encryption key over environment variable', async () => {
      const originalEnv = process.env.KEYROT_ENCRYPTION_KEY;
      process.env.KEYROT_ENCRYPTION_KEY = 'wrong-key-1234567890123456';

      try {
        const optionsAdapter = new DockerStorageAdapter({
          dataDir: testDir,
          encryptionKey: testKey,
        });

        await optionsAdapter.set('test', 'value');
        const result = await optionsAdapter.get('test');
        expect(result).toBe('value');

        // Create another adapter with same options key - should work
        const sameKeyAdapter = new DockerStorageAdapter({
          dataDir: testDir,
          encryptionKey: testKey,
        });
        const result2 = await sameKeyAdapter.get('test');
        expect(result2).toBe('value');
      } finally {
        if (originalEnv) {
          process.env.KEYROT_ENCRYPTION_KEY = originalEnv;
        } else {
          delete process.env.KEYROT_ENCRYPTION_KEY;
        }
      }
    });
  });

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      await adapter.set('key1', 'value1');
      const result = await adapter.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should overwrite existing value', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key1', 'value2');
      const result = await adapter.get('key1');
      expect(result).toBe('value2');
    });

    it('should delete a value', async () => {
      await adapter.set('key1', 'value1');
      await adapter.delete('key1');
      const result = await adapter.get('key1');
      expect(result).toBeNull();
    });

    it('should handle deleting non-existent key gracefully', async () => {
      await expect(adapter.delete('nonexistent')).resolves.not.toThrow();
    });

    it('should handle JSON values', async () => {
      const jsonValue = JSON.stringify({ foo: 'bar', num: 123, arr: [1, 2, 3] });
      await adapter.set('json-key', jsonValue);
      const result = await adapter.get('json-key');
      expect(result).toBe(jsonValue);
      expect(JSON.parse(result!)).toEqual({ foo: 'bar', num: 123, arr: [1, 2, 3] });
    });

    it('should handle special characters in values', async () => {
      const specialValue = 'Hello "world"!\n\tSpecial: 🎉 < > & \' "';
      await adapter.set('special', specialValue);
      const result = await adapter.get('special');
      expect(result).toBe(specialValue);
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'user:123:quota/monthly';
      await adapter.set(specialKey, 'value');
      const result = await adapter.get(specialKey);
      expect(result).toBe('value');
    });
  });

  describe('TTL support', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire values after TTL', async () => {
      await adapter.set('expiring', 'value', 10); // 10 seconds TTL

      // Value should exist initially
      let result = await adapter.get('expiring');
      expect(result).toBe('value');

      // Advance time past TTL
      vi.advanceTimersByTime(11000);

      // Value should be expired
      result = await adapter.get('expiring');
      expect(result).toBeNull();
    });

    it('should not expire values without TTL', async () => {
      await adapter.set('permanent', 'value');

      // Advance time significantly
      vi.advanceTimersByTime(1000 * 60 * 60 * 24); // 24 hours

      const result = await adapter.get('permanent');
      expect(result).toBe('value');
    });

    it('should clean up expired files on get', async () => {
      await adapter.set('expiring', 'value', 1);

      vi.advanceTimersByTime(2000);

      await adapter.get('expiring');

      // File should be deleted
      const files = await fs.readdir(testDir);
      expect(files.filter((f) => f.endsWith('.enc'))).toHaveLength(0);
    });
  });

  describe('encryption', () => {
    it('should store data encrypted on disk', async () => {
      await adapter.set('secret', 'sensitive-data');

      // Read raw file content
      const files = await fs.readdir(testDir);
      const encFile = files.find((f) => f.endsWith('.enc'));
      expect(encFile).toBeDefined();

      const content = await fs.readFile(path.join(testDir, encFile!), 'utf8');

      // Should be valid JSON with encryption fields
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('iv');
      expect(parsed).toHaveProperty('salt');
      expect(parsed).toHaveProperty('authTag');
      expect(parsed).toHaveProperty('data');
      expect(parsed).toHaveProperty('version');

      // Raw data should not contain the plaintext
      expect(content).not.toContain('sensitive-data');
    });

    it('should fail to decrypt with wrong key', async () => {
      await adapter.set('secret', 'sensitive-data');

      // Create new adapter with different key
      const wrongKeyAdapter = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey: 'wrong-key-32-bytes-xxxxxxxxxx',
      });

      // Should return null (treats as corrupted)
      const result = await wrongKeyAdapter.get('secret');
      expect(result).toBeNull();
    });

    it('should use unique salt for each entry', async () => {
      await adapter.set('key1', 'same-value');
      await adapter.set('key2', 'same-value');

      const files = await fs.readdir(testDir);
      const encFiles = files.filter((f) => f.endsWith('.enc'));
      expect(encFiles).toHaveLength(2);

      const contents = await Promise.all(
        encFiles.map((f) => fs.readFile(path.join(testDir, f), 'utf8'))
      );

      const parsed = contents.map((c) => JSON.parse(c));

      // Salts should be different
      expect(parsed[0].salt).not.toBe(parsed[1].salt);

      // IVs should be different
      expect(parsed[0].iv).not.toBe(parsed[1].iv);

      // Encrypted data should be different
      expect(parsed[0].data).not.toBe(parsed[1].data);
    });
  });

  describe('clear', () => {
    it('should clear all values', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');
      await adapter.set('key3', 'value3');

      await adapter.clear();

      expect(await adapter.get('key1')).toBeNull();
      expect(await adapter.get('key2')).toBeNull();
      expect(await adapter.get('key3')).toBeNull();
    });

    it('should only clear files with the correct extension', async () => {
      await adapter.set('key1', 'value1');

      // Create a non-encrypted file
      await fs.writeFile(path.join(testDir, 'other.txt'), 'test');

      await adapter.clear();

      // Other file should still exist
      const files = await fs.readdir(testDir);
      expect(files).toContain('other.txt');
    });
  });

  describe('size', () => {
    it('should return the count of stored values', async () => {
      expect(await adapter.size()).toBe(0);

      await adapter.set('key1', 'value1');
      expect(await adapter.size()).toBe(1);

      await adapter.set('key2', 'value2');
      expect(await adapter.size()).toBe(2);

      await adapter.delete('key1');
      expect(await adapter.size()).toBe(1);
    });

    it('should exclude expired values from count', async () => {
      vi.useFakeTimers();

      await adapter.set('permanent', 'value');
      await adapter.set('expiring', 'value', 1);

      expect(await adapter.size()).toBe(2);

      vi.advanceTimersByTime(2000);

      expect(await adapter.size()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('prefix support', () => {
    it('should use custom prefix', async () => {
      const prefixedAdapter = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey: testKey,
        prefix: 'custom:',
      });

      await prefixedAdapter.set('key1', 'value1');

      // Different prefix should not see the value
      const otherPrefixAdapter = new DockerStorageAdapter({
        dataDir: testDir,
        encryptionKey: testKey,
        prefix: 'other:',
      });

      expect(await otherPrefixAdapter.get('key1')).toBeNull();
    });
  });

  describe('directory handling', () => {
    it('should create data directory if it does not exist', async () => {
      const newDir = path.join(testDir, 'nested', 'deep', 'dir');
      const nestedAdapter = new DockerStorageAdapter({
        dataDir: newDir,
        encryptionKey: testKey,
      });

      await nestedAdapter.set('key', 'value');

      const result = await nestedAdapter.get('key');
      expect(result).toBe('value');
    });

    it('should expose data directory via getDataDir', () => {
      expect(adapter.getDataDir()).toBe(testDir);
    });
  });

  describe('error handling', () => {
    it('should handle corrupted files gracefully', async () => {
      await adapter.set('key1', 'value1');

      // Corrupt the file
      const files = await fs.readdir(testDir);
      const encFile = files.find((f) => f.endsWith('.enc'));
      await fs.writeFile(path.join(testDir, encFile!), 'not valid json');

      // Should return null instead of throwing
      const result = await adapter.get('key1');
      expect(result).toBeNull();
    });

    it('should handle invalid encrypted data gracefully', async () => {
      await adapter.set('key1', 'value1');

      // Write invalid encrypted structure
      const files = await fs.readdir(testDir);
      const encFile = files.find((f) => f.endsWith('.enc'));
      await fs.writeFile(
        path.join(testDir, encFile!),
        JSON.stringify({ iv: 'bad', salt: 'bad', authTag: 'bad', data: 'bad', version: 1 })
      );

      // Should return null instead of throwing
      const result = await adapter.get('key1');
      expect(result).toBeNull();
    });
  });

  describe('dockerAdapter factory function', () => {
    it('should create a DockerStorageAdapter instance', () => {
      const storage = dockerAdapter({
        dataDir: testDir,
        encryptionKey: testKey,
      });

      expect(storage).toBeInstanceOf(DockerStorageAdapter);
    });

    it('should implement StorageAdapter interface', async () => {
      const storage = dockerAdapter({
        dataDir: testDir,
        encryptionKey: testKey,
      });

      // Should have required methods
      expect(typeof storage.get).toBe('function');
      expect(typeof storage.set).toBe('function');
      expect(typeof storage.delete).toBe('function');

      // Should work
      await storage.set('key', 'value');
      expect(await storage.get('key')).toBe('value');
      await storage.delete('key');
      expect(await storage.get('key')).toBeNull();
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent writes', async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        adapter.set(`key${i}`, `value${i}`)
      );

      await Promise.all(writes);

      for (let i = 0; i < 10; i++) {
        expect(await adapter.get(`key${i}`)).toBe(`value${i}`);
      }
    });

    it('should handle concurrent reads and writes', async () => {
      await adapter.set('shared', 'initial');

      const operations = [
        adapter.get('shared'),
        adapter.set('shared', 'updated1'),
        adapter.get('shared'),
        adapter.set('shared', 'updated2'),
        adapter.get('shared'),
      ];

      await Promise.all(operations);

      // Final value should be one of the updates
      const final = await adapter.get('shared');
      expect(['updated1', 'updated2']).toContain(final);
    });
  });
});
