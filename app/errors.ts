/**
 * Base error class for keyrot errors
 */
export class KeyrotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyrotError';
    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a request times out waiting in the queue
 */
export class QueueTimeoutError extends KeyrotError {
  /** Suggested time to wait before retrying (in milliseconds) */
  public readonly retryAfterMs: number;
  /** How long the request waited in queue */
  public readonly waitedMs: number;
  /** Current queue size when timeout occurred */
  public readonly queueSize: number;

  constructor(options: {
    retryAfterMs: number;
    waitedMs: number;
    queueSize: number;
  }) {
    super(
      `Request timed out after waiting ${options.waitedMs}ms in queue. ` +
      `Queue size: ${options.queueSize}. Retry after ${options.retryAfterMs}ms.`
    );
    this.name = 'QueueTimeoutError';
    this.retryAfterMs = options.retryAfterMs;
    this.waitedMs = options.waitedMs;
    this.queueSize = options.queueSize;
  }
}

/**
 * Thrown when all keys in the pool are exhausted (quota depleted or circuits open)
 */
export class AllKeysExhaustedError extends KeyrotError {
  /** Suggested time to wait before retrying (in milliseconds) */
  public readonly retryAfterMs: number;
  /** Number of keys that are quota exhausted */
  public readonly exhaustedKeys: number;
  /** Number of keys with open circuits */
  public readonly circuitOpenKeys: number;
  /** Number of keys that are rate limited */
  public readonly rateLimitedKeys: number;
  /** Total keys in pool */
  public readonly totalKeys: number;

  constructor(options: {
    retryAfterMs: number;
    exhaustedKeys: number;
    circuitOpenKeys: number;
    rateLimitedKeys: number;
    totalKeys: number;
  }) {
    super(
      `All ${options.totalKeys} keys are unavailable. ` +
      `Exhausted: ${options.exhaustedKeys}, Circuit open: ${options.circuitOpenKeys}, ` +
      `Rate limited: ${options.rateLimitedKeys}. Retry after ${options.retryAfterMs}ms.`
    );
    this.name = 'AllKeysExhaustedError';
    this.retryAfterMs = options.retryAfterMs;
    this.exhaustedKeys = options.exhaustedKeys;
    this.circuitOpenKeys = options.circuitOpenKeys;
    this.rateLimitedKeys = options.rateLimitedKeys;
    this.totalKeys = options.totalKeys;
  }
}

/**
 * Thrown when the request queue is full
 */
export class QueueFullError extends KeyrotError {
  /** Current queue size */
  public readonly queueSize: number;
  /** Maximum queue size */
  public readonly maxQueueSize: number;
  /** Suggested time to wait before retrying (in milliseconds) */
  public readonly retryAfterMs: number;

  constructor(options: {
    queueSize: number;
    maxQueueSize: number;
    retryAfterMs: number;
  }) {
    super(
      `Request queue is full (${options.queueSize}/${options.maxQueueSize}). ` +
      `Retry after ${options.retryAfterMs}ms.`
    );
    this.name = 'QueueFullError';
    this.queueSize = options.queueSize;
    this.maxQueueSize = options.maxQueueSize;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Thrown when attempting to use an invalid key configuration
 */
export class InvalidKeyConfigError extends KeyrotError {
  /** The key ID that had invalid configuration */
  public readonly keyId: string;

  constructor(keyId: string, reason: string) {
    super(`Invalid configuration for key "${keyId}": ${reason}`);
    this.name = 'InvalidKeyConfigError';
    this.keyId = keyId;
  }
}

/**
 * Thrown when no keys are configured in the pool
 */
export class NoKeysConfiguredError extends KeyrotError {
  constructor() {
    super('No keys configured in the pool. Add at least one key to use the pool.');
    this.name = 'NoKeysConfiguredError';
  }
}
