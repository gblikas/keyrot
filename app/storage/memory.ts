import type { StorageAdapter, StorageAdapterOptions } from './types.js';

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

/**
 * In-memory storage adapter
 * 
 * Note: State is lost on process restart. Use Redis or file-based
 * adapters for production persistence.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, StoredValue> = new Map();
  private prefix: string;

  constructor(options: StorageAdapterOptions = {}) {
    this.prefix = options.prefix ?? 'keyrot:';
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private isExpired(stored: StoredValue): boolean {
    if (stored.expiresAt === null) {
      return false;
    }
    return Date.now() > stored.expiresAt;
  }

  async get(key: string): Promise<string | null> {
    const fullKey = this.getKey(key);
    const stored = this.store.get(fullKey);

    if (!stored) {
      return null;
    }

    if (this.isExpired(stored)) {
      this.store.delete(fullKey);
      return null;
    }

    return stored.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const fullKey = this.getKey(key);
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;

    this.store.set(fullKey, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.getKey(key);
    this.store.delete(fullKey);
  }

  /**
   * Clear all stored values (useful for testing)
   */
  async clear(): Promise<void> {
    this.store.clear();
  }

  /**
   * Get the number of stored values (useful for testing)
   */
  get size(): number {
    // Clean up expired entries first
    for (const [key, stored] of this.store.entries()) {
      if (this.isExpired(stored)) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }
}

/**
 * Create an in-memory storage adapter
 */
export function memoryAdapter(options: StorageAdapterOptions = {}): StorageAdapter {
  return new MemoryStorageAdapter(options);
}
