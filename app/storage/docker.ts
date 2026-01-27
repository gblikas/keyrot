import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageAdapter, StorageAdapterOptions } from './types.js';

/**
 * Encryption algorithm used for data at rest
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Options for creating a Docker storage adapter
 */
export interface DockerStorageAdapterOptions extends StorageAdapterOptions {
  /**
   * Directory path where data will be stored.
   * This should be a Docker volume mount point for persistence.
   * Default: '/data/keyrot' (common Docker volume path)
   */
  dataDir?: string;

  /**
   * Encryption key or passphrase for encrypting data at rest.
   * Required for security. Use a strong, unique key.
   * Can be provided via environment variable KEYROT_ENCRYPTION_KEY.
   */
  encryptionKey?: string;

  /**
   * File extension for stored data files
   * Default: '.enc' (encrypted)
   */
  fileExtension?: string;
}

interface StoredValue {
  value: string;
  expiresAt: number | null;
  createdAt: number;
}

interface EncryptedData {
  iv: string;
  salt: string;
  authTag: string;
  data: string;
  version: number;
}

/**
 * Docker volume-based storage adapter with AES-256-GCM encryption
 *
 * This adapter persists data to the filesystem with encryption at rest,
 * designed to work with Docker volumes for portability and cloud deployment.
 *
 * Features:
 * - AES-256-GCM encryption for data at rest
 * - PBKDF2 key derivation with unique salt per entry
 * - TTL support with automatic expiration
 * - Docker volume compatible
 * - Cloud-ready (works with AWS EFS, Azure Files, GCP Filestore, etc.)
 *
 * Usage with Docker:
 * ```yaml
 * services:
 *   app:
 *     volumes:
 *       - keyrot-data:/data/keyrot
 * volumes:
 *   keyrot-data:
 * ```
 *
 * @example
 * ```typescript
 * const storage = dockerAdapter({
 *   dataDir: '/data/keyrot',
 *   encryptionKey: process.env.KEYROT_ENCRYPTION_KEY,
 * });
 *
 * const pool = createKeyPool({
 *   keys: [...],
 *   storage,
 * });
 * ```
 */
export class DockerStorageAdapter implements StorageAdapter {
  private dataDir: string;
  private encryptionKey: string;
  private prefix: string;
  private fileExtension: string;
  private initialized: boolean = false;

  constructor(options: DockerStorageAdapterOptions = {}) {
    this.dataDir = options.dataDir ?? '/data/keyrot';
    this.prefix = options.prefix ?? 'keyrot:';
    this.fileExtension = options.fileExtension ?? '.enc';

    // Get encryption key from options or environment
    const key = options.encryptionKey ?? process.env.KEYROT_ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        'DockerStorageAdapter requires an encryption key. ' +
          'Provide it via options.encryptionKey or KEYROT_ENCRYPTION_KEY environment variable.'
      );
    }
    this.encryptionKey = key;
  }

  /**
   * Ensure the data directory exists
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize Docker storage directory at ${this.dataDir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Convert a key to a safe filename
   */
  private keyToFilename(key: string): string {
    const fullKey = `${this.prefix}${key}`;
    // Use base64url encoding for safe filenames
    const encoded = Buffer.from(fullKey).toString('base64url');
    return path.join(this.dataDir, `${encoded}${this.fileExtension}`);
  }

  /**
   * Derive an encryption key from the passphrase and salt
   */
  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.encryptionKey,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512'
    );
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private encrypt(plaintext: string): EncryptedData {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const derivedKey = this.deriveKey(salt);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted,
      version: 1,
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private decrypt(encryptedData: EncryptedData): string {
    const salt = Buffer.from(encryptedData.salt, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const derivedKey = this.deriveKey(salt);

    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      derivedKey,
      iv
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Check if a stored value is expired
   */
  private isExpired(stored: StoredValue): boolean {
    if (stored.expiresAt === null) {
      return false;
    }
    return Date.now() > stored.expiresAt;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();

    const filename = this.keyToFilename(key);

    try {
      const fileContent = await fs.readFile(filename, 'utf8');
      const encryptedData: EncryptedData = JSON.parse(fileContent);
      const decrypted = this.decrypt(encryptedData);
      const stored: StoredValue = JSON.parse(decrypted);

      if (this.isExpired(stored)) {
        // Clean up expired file
        await this.delete(key);
        return null;
      }

      return stored.value;
    } catch (error) {
      // File doesn't exist or is corrupted
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      // Log but don't throw for corrupted files - treat as missing
      console.error(`Error reading encrypted storage for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.ensureInitialized();

    const filename = this.keyToFilename(key);
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;

    const stored: StoredValue = {
      value,
      expiresAt,
      createdAt: Date.now(),
    };

    const encryptedData = this.encrypt(JSON.stringify(stored));
    await fs.writeFile(filename, JSON.stringify(encryptedData), 'utf8');
  }

  async delete(key: string): Promise<void> {
    await this.ensureInitialized();

    const filename = this.keyToFilename(key);

    try {
      await fs.unlink(filename);
    } catch (error) {
      // Ignore if file doesn't exist
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

  /**
   * Clear all stored values
   * Useful for testing or resetting state
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    try {
      const files = await fs.readdir(this.dataDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(this.fileExtension))
          .map((f) => fs.unlink(path.join(this.dataDir, f)))
      );
    } catch (error) {
      // Directory might not exist, that's fine
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

  /**
   * Get the number of stored values (excluding expired)
   * Note: This is an expensive operation as it reads all files
   */
  async size(): Promise<number> {
    await this.ensureInitialized();

    try {
      const files = await fs.readdir(this.dataDir);
      const encFiles = files.filter((f) => f.endsWith(this.fileExtension));

      let count = 0;
      for (const file of encFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.dataDir, file),
            'utf8'
          );
          const encryptedData: EncryptedData = JSON.parse(content);
          const decrypted = this.decrypt(encryptedData);
          const stored: StoredValue = JSON.parse(decrypted);

          if (!this.isExpired(stored)) {
            count++;
          } else {
            // Clean up expired file
            await fs.unlink(path.join(this.dataDir, file));
          }
        } catch {
          // Skip corrupted files
        }
      }

      return count;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Get the data directory path
   * Useful for debugging and monitoring
   */
  getDataDir(): string {
    return this.dataDir;
  }
}

/**
 * Create a Docker volume-based storage adapter with encryption
 *
 * This adapter is designed for use with Docker volumes, providing:
 * - Persistent storage across container restarts
 * - AES-256-GCM encryption for data at rest
 * - Cloud-ready (works with AWS EFS, Azure Files, GCP Filestore, etc.)
 *
 * @param options - Configuration options
 * @returns A storage adapter instance
 *
 * @example
 * ```typescript
 * // Basic usage with environment variable for encryption key
 * const storage = dockerAdapter({
 *   dataDir: '/data/keyrot',
 * });
 *
 * // With explicit encryption key
 * const storage = dockerAdapter({
 *   dataDir: '/data/keyrot',
 *   encryptionKey: 'your-32-byte-encryption-key-here',
 * });
 * ```
 */
export function dockerAdapter(
  options: DockerStorageAdapterOptions = {}
): StorageAdapter {
  return new DockerStorageAdapter(options);
}
