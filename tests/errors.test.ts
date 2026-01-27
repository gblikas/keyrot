import { describe, it, expect } from 'vitest';
import {
  KeyrotError,
  QueueTimeoutError,
  AllKeysExhaustedError,
  QueueFullError,
  InvalidKeyConfigError,
  NoKeysConfiguredError,
} from '../app/errors.js';

describe('Errors', () => {
  describe('KeyrotError', () => {
    it('should be an instance of Error', () => {
      const error = new KeyrotError('test message');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new KeyrotError('test');
      expect(error.name).toBe('KeyrotError');
    });

    it('should have correct message', () => {
      const error = new KeyrotError('test message');
      expect(error.message).toBe('test message');
    });
  });

  describe('QueueTimeoutError', () => {
    it('should be an instance of KeyrotError', () => {
      const error = new QueueTimeoutError({
        retryAfterMs: 1000,
        waitedMs: 5000,
        queueSize: 10,
      });
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new QueueTimeoutError({
        retryAfterMs: 1000,
        waitedMs: 5000,
        queueSize: 10,
      });
      expect(error.name).toBe('QueueTimeoutError');
    });

    it('should expose properties', () => {
      const error = new QueueTimeoutError({
        retryAfterMs: 1000,
        waitedMs: 5000,
        queueSize: 10,
      });
      expect(error.retryAfterMs).toBe(1000);
      expect(error.waitedMs).toBe(5000);
      expect(error.queueSize).toBe(10);
    });

    it('should have descriptive message', () => {
      const error = new QueueTimeoutError({
        retryAfterMs: 1000,
        waitedMs: 5000,
        queueSize: 10,
      });
      expect(error.message).toContain('5000ms');
      expect(error.message).toContain('1000ms');
    });
  });

  describe('AllKeysExhaustedError', () => {
    it('should be an instance of KeyrotError', () => {
      const error = new AllKeysExhaustedError({
        retryAfterMs: 60000,
        exhaustedKeys: 2,
        circuitOpenKeys: 1,
        rateLimitedKeys: 1,
        totalKeys: 4,
      });
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new AllKeysExhaustedError({
        retryAfterMs: 60000,
        exhaustedKeys: 2,
        circuitOpenKeys: 1,
        rateLimitedKeys: 1,
        totalKeys: 4,
      });
      expect(error.name).toBe('AllKeysExhaustedError');
    });

    it('should expose properties', () => {
      const error = new AllKeysExhaustedError({
        retryAfterMs: 60000,
        exhaustedKeys: 2,
        circuitOpenKeys: 1,
        rateLimitedKeys: 1,
        totalKeys: 4,
      });
      expect(error.retryAfterMs).toBe(60000);
      expect(error.exhaustedKeys).toBe(2);
      expect(error.circuitOpenKeys).toBe(1);
      expect(error.rateLimitedKeys).toBe(1);
      expect(error.totalKeys).toBe(4);
    });

    it('should have descriptive message', () => {
      const error = new AllKeysExhaustedError({
        retryAfterMs: 60000,
        exhaustedKeys: 2,
        circuitOpenKeys: 1,
        rateLimitedKeys: 1,
        totalKeys: 4,
      });
      expect(error.message).toContain('4 keys');
      expect(error.message).toContain('Exhausted: 2');
      expect(error.message).toContain('Circuit open: 1');
      expect(error.message).toContain('Rate limited: 1');
    });
  });

  describe('QueueFullError', () => {
    it('should be an instance of KeyrotError', () => {
      const error = new QueueFullError({
        queueSize: 100,
        maxQueueSize: 100,
        retryAfterMs: 5000,
      });
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new QueueFullError({
        queueSize: 100,
        maxQueueSize: 100,
        retryAfterMs: 5000,
      });
      expect(error.name).toBe('QueueFullError');
    });

    it('should expose properties', () => {
      const error = new QueueFullError({
        queueSize: 100,
        maxQueueSize: 100,
        retryAfterMs: 5000,
      });
      expect(error.queueSize).toBe(100);
      expect(error.maxQueueSize).toBe(100);
      expect(error.retryAfterMs).toBe(5000);
    });

    it('should have descriptive message', () => {
      const error = new QueueFullError({
        queueSize: 100,
        maxQueueSize: 100,
        retryAfterMs: 5000,
      });
      expect(error.message).toContain('100/100');
    });
  });

  describe('InvalidKeyConfigError', () => {
    it('should be an instance of KeyrotError', () => {
      const error = new InvalidKeyConfigError('test-key', 'Invalid value');
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new InvalidKeyConfigError('test-key', 'Invalid value');
      expect(error.name).toBe('InvalidKeyConfigError');
    });

    it('should expose keyId', () => {
      const error = new InvalidKeyConfigError('test-key', 'Invalid value');
      expect(error.keyId).toBe('test-key');
    });

    it('should have descriptive message', () => {
      const error = new InvalidKeyConfigError('test-key', 'RPS must be positive');
      expect(error.message).toContain('test-key');
      expect(error.message).toContain('RPS must be positive');
    });
  });

  describe('NoKeysConfiguredError', () => {
    it('should be an instance of KeyrotError', () => {
      const error = new NoKeysConfiguredError();
      expect(error).toBeInstanceOf(KeyrotError);
    });

    it('should have correct name', () => {
      const error = new NoKeysConfiguredError();
      expect(error.name).toBe('NoKeysConfiguredError');
    });

    it('should have descriptive message', () => {
      const error = new NoKeysConfiguredError();
      expect(error.message).toContain('No keys configured');
    });
  });
});
