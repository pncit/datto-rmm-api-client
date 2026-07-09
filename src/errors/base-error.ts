/**
 * Base class for custom error types that properly extends Error in TypeScript.
 * Handles prototype chain setup and stack trace capture.
 */
export abstract class BaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);

    // V8-specific API for cleaner stack traces; not available in all environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
