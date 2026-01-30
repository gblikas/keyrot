import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageAdapter, StorageAdapterOptions } from './types.js';

interface StoredValue {
  value: string;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface StoredEntry extends StoredValue {
  key: string;
}

interface FileStorageSnapshot {
  version: 1;
  updatedAt: number;
  entries: StoredEntry[];
}

/**
 * Options for creating a file storage adapter
 */
export interface FileStorageAdapterOptions extends StorageAdapterOptions {
  /**
   * Path to the JSON storage file.
   * Default: <cwd>/.keyrot/storage.json
   */
  filePath?: string;
}

const DEFAULT_STORAGE_DIR = '.keyrot';
const DEFAULT_STORAGE_FILE = 'storage.json';

/**
 * File-based storage adapter
 *
 * Persists data as a versioned JSON file with an entries array:
 * {
 *   version: 1,
 *   updatedAt: 1710000000000,
 *   entries: [
 *     { key, value, expiresAt, createdAt, updatedAt }
 *   ]
 * }
 *
 * This format is easy to import into a database if needed.
 */
export class FileStorageAdapter implements StorageAdapter {
  private store: Map<string, StoredValue> = new Map();
  private prefix: string;
  private filePath: string;
  private initialized: boolean = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: FileStorageAdapterOptions = {}) {
    this.prefix = options.prefix ?? 'keyrot:';
    const defaultPath = path.join(
      process.cwd(),
      DEFAULT_STORAGE_DIR,
      DEFAULT_STORAGE_FILE
    );
    this.filePath = path.resolve(options.filePath ?? defaultPath);
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

  private isSnapshot(value: unknown): value is FileStorageSnapshot {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const snapshot = value as Record<string, unknown>;
    return snapshot.version === 1 && Array.isArray(snapshot.entries);
  }

  private isEntry(value: unknown): value is StoredEntry {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const entry = value as Record<string, unknown>;
    const expiresAt = entry.expiresAt;
    return (
      typeof entry.key === 'string' &&
      typeof entry.value === 'string' &&
      (expiresAt === null || typeof expiresAt === 'number') &&
      typeof entry.createdAt === 'number' &&
      typeof entry.updatedAt === 'number'
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.loadFromDisk();
    this.initialized = true;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!this.isSnapshot(parsed)) {
        throw new Error('Invalid storage file format');
      }

      for (const entry of parsed.entries) {
        if (!this.isEntry(entry)) {
          continue;
        }

        const stored: StoredValue = {
          value: entry.value,
          expiresAt: entry.expiresAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };

        if (!this.isExpired(stored)) {
          this.store.set(entry.key, stored);
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      console.error('Error reading file storage:', error);
    }
  }

  private async writeSnapshot(): Promise<void> {
    if (this.store.size === 0) {
      await this.removeFile();
      return;
    }

    const snapshot: FileStorageSnapshot = {
      version: 1,
      updatedAt: Date.now(),
      entries: Array.from(this.store.entries()).map(([key, stored]) => ({
        key,
        value: stored.value,
        expiresAt: stored.expiresAt,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })),
    };

    const payload = JSON.stringify(snapshot, null, 2);
    const tempPath = `${this.filePath}.tmp`;

    await fs.writeFile(tempPath, payload, 'utf8');
    await this.replaceFile(tempPath, this.filePath);
  }

  private async replaceFile(tempPath: string, targetPath: string): Promise<void> {
    try {
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        ((error as NodeJS.ErrnoException).code === 'EEXIST' ||
          (error as NodeJS.ErrnoException).code === 'EPERM')
      ) {
        await fs.rm(targetPath, { force: true });
        await fs.rename(tempPath, targetPath);
        return;
      }
      throw error;
    }
  }

  private async removeFile(): Promise<void> {
    try {
      await fs.rm(this.filePath, { force: true });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
  }

  private queueWrite(): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.writeSnapshot());
    return this.writeChain;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();
    const fullKey = this.getKey(key);
    const stored = this.store.get(fullKey);

    if (!stored) {
      return null;
    }

    if (this.isExpired(stored)) {
      this.store.delete(fullKey);
      await this.queueWrite();
      return null;
    }

    return stored.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.ensureInitialized();
    const fullKey = this.getKey(key);
    const now = Date.now();
    const expiresAt = ttl ? now + ttl * 1000 : null;
    const existing = this.store.get(fullKey);

    this.store.set(fullKey, {
      value,
      expiresAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await this.queueWrite();
  }

  async delete(key: string): Promise<void> {
    await this.ensureInitialized();
    const fullKey = this.getKey(key);

    if (!this.store.has(fullKey)) {
      return;
    }

    this.store.delete(fullKey);
    await this.queueWrite();
  }

  /**
   * Clear all stored values
   * Useful for testing or resetting state
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.store.clear();
    await this.queueWrite();
  }

  /**
   * Get the number of stored values (excluding expired)
   */
  async size(): Promise<number> {
    await this.ensureInitialized();
    let changed = false;

    for (const [key, stored] of this.store.entries()) {
      if (this.isExpired(stored)) {
        this.store.delete(key);
        changed = true;
      }
    }

    if (changed) {
      await this.queueWrite();
    }

    return this.store.size;
  }

  /**
   * Get the configured file path
   */
  getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Create a file-based storage adapter
 */
export function fileAdapter(
  options: FileStorageAdapterOptions = {}
): StorageAdapter {
  return new FileStorageAdapter(options);
}
