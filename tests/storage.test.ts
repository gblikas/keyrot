import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStorageAdapter, memoryAdapter } from '../app/storage/memory.js';

describe('MemoryStorageAdapter', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryStorageAdapter();
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      expect(await storage.get('nonexistent')).toBeNull();
    });

    it('should return stored value', async () => {
      await storage.set('key', 'value');
      expect(await storage.get('key')).toBe('value');
    });

    it('should return null for expired value', async () => {
      await storage.set('key', 'value', 1); // 1 second TTL
      
      vi.advanceTimersByTime(1001);
      
      expect(await storage.get('key')).toBeNull();
    });

    it('should return value before TTL expires', async () => {
      await storage.set('key', 'value', 10); // 10 second TTL
      
      vi.advanceTimersByTime(9000);
      
      expect(await storage.get('key')).toBe('value');
    });
  });

  describe('set', () => {
    it('should store value', async () => {
      await storage.set('key', 'value');
      expect(await storage.get('key')).toBe('value');
    });

    it('should overwrite existing value', async () => {
      await storage.set('key', 'value1');
      await storage.set('key', 'value2');
      expect(await storage.get('key')).toBe('value2');
    });

    it('should handle TTL', async () => {
      await storage.set('key', 'value', 5);
      
      expect(await storage.get('key')).toBe('value');
      
      vi.advanceTimersByTime(5001);
      
      expect(await storage.get('key')).toBeNull();
    });

    it('should store without TTL', async () => {
      await storage.set('key', 'value');
      
      vi.advanceTimersByTime(1000000);
      
      expect(await storage.get('key')).toBe('value');
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      await storage.set('key', 'value');
      await storage.delete('key');
      expect(await storage.get('key')).toBeNull();
    });

    it('should not throw for non-existent key', async () => {
      await expect(storage.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all values', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');
      
      await storage.clear();
      
      expect(await storage.get('key1')).toBeNull();
      expect(await storage.get('key2')).toBeNull();
    });
  });

  describe('size', () => {
    it('should return 0 for empty storage', () => {
      expect(storage.size).toBe(0);
    });

    it('should return correct count', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');
      expect(storage.size).toBe(2);
    });

    it('should not count expired values', async () => {
      await storage.set('key1', 'value1', 1);
      await storage.set('key2', 'value2');
      
      vi.advanceTimersByTime(1001);
      
      expect(storage.size).toBe(1);
    });
  });

  describe('prefix', () => {
    it('should use default prefix', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.set('key', 'value');
      
      // Internal check - the prefix is applied
      expect(await adapter.get('key')).toBe('value');
    });

    it('should use custom prefix', async () => {
      const adapter1 = new MemoryStorageAdapter({ prefix: 'app1:' });
      const adapter2 = new MemoryStorageAdapter({ prefix: 'app2:' });
      
      await adapter1.set('key', 'value1');
      await adapter2.set('key', 'value2');
      
      expect(await adapter1.get('key')).toBe('value1');
      expect(await adapter2.get('key')).toBe('value2');
    });
  });
});

describe('memoryAdapter', () => {
  it('should create a MemoryStorageAdapter', () => {
    const adapter = memoryAdapter();
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('should pass options to adapter', async () => {
    const adapter = memoryAdapter({ prefix: 'custom:' });
    await adapter.set('key', 'value');
    expect(await adapter.get('key')).toBe('value');
  });
});
