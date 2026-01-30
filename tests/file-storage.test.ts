import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileStorageAdapter, fileAdapter } from '../app/storage/file.js';

describe('FileStorageAdapter', () => {
  let testDir: string;
  let filePath: string;
  let adapter: FileStorageAdapter;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyrot-file-test-'));
    filePath = path.join(testDir, 'storage.json');
    adapter = new FileStorageAdapter({ filePath });
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should set and get a value', async () => {
    await adapter.set('key1', 'value1');
    expect(await adapter.get('key1')).toBe('value1');
  });

  it('should persist across reloads', async () => {
    await adapter.set('key1', 'value1');

    const reloaded = new FileStorageAdapter({ filePath });
    expect(await reloaded.get('key1')).toBe('value1');
  });

  it('should store data in an importable JSON format', async () => {
    await adapter.set('key1', 'value1', 60);

    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      version: number;
      updatedAt: number;
      entries: Array<Record<string, unknown>>;
    };

    expect(parsed.version).toBe(1);
    expect(typeof parsed.updatedAt).toBe('number');
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries).toHaveLength(1);

    const entry = parsed.entries[0];
    expect(entry.key).toBe('keyrot:key1');
    expect(entry.value).toBe('value1');
    expect(typeof entry.createdAt).toBe('number');
    expect(typeof entry.updatedAt).toBe('number');
    expect(typeof entry.expiresAt).toBe('number');
  });

  it('should expire values after TTL', async () => {
    vi.useFakeTimers();
    await adapter.set('expiring', 'value', 1);

    expect(await adapter.get('expiring')).toBe('value');

    vi.advanceTimersByTime(1100);

    expect(await adapter.get('expiring')).toBeNull();
  });

  it('should keep data separate by prefix', async () => {
    const adapterOne = new FileStorageAdapter({ filePath, prefix: 'app1:' });
    await adapterOne.set('key', 'value1');

    const adapterTwo = new FileStorageAdapter({ filePath, prefix: 'app2:' });
    await adapterTwo.set('key', 'value2');

    const reloadedOne = new FileStorageAdapter({ filePath, prefix: 'app1:' });
    const reloadedTwo = new FileStorageAdapter({ filePath, prefix: 'app2:' });

    expect(await reloadedOne.get('key')).toBe('value1');
    expect(await reloadedTwo.get('key')).toBe('value2');
  });
});

describe('fileAdapter', () => {
  it('should create a FileStorageAdapter instance', () => {
    const storage = fileAdapter({ filePath: '/tmp/keyrot-test.json' });
    expect(storage).toBeInstanceOf(FileStorageAdapter);
  });
});
