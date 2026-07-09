import { z } from "zod";

import { BaseError } from "./base-error";

/** Indicates whether validation failed on an outgoing request or an incoming response. */
export type DattoValidationStage = "request" | "response";

/** Additional context captured when validation fails. */
export interface DattoValidationErrorOptions {
  /** The wire payload that failed validation, for debugging. */
  readonly payload?: unknown;
  /** A human label for the call site (e.g. `'GET /device/{uid}'`). */
  readonly context?: string;
}

/**
 * Validation error wrapping a Zod v4 error with a request/response stage. Provides a
 * pretty-printed message and a structured error tree for programmatic handling.
 */
export class DattoValidationError extends BaseError {
  /** The underlying Zod validation error. */
  public readonly zodError: z.ZodError;
  /** Whether validation failed on an outgoing request or an incoming response. */
  public readonly stage: DattoValidationStage;
  /** Human-readable, pretty-printed error message. */
  public readonly prettyMessage: string;
  /** The wire payload that failed validation, if supplied. */
  public readonly payload: unknown;
  /** A human label for the call site, if supplied. */
  public readonly context: string | undefined;

  constructor(
    zodError: z.ZodError,
    stage: DattoValidationStage,
    opts?: DattoValidationErrorOptions,
  ) {
    const prettyMessage = z.prettifyError(zodError);
    super(`Validation failed for ${stage}: ${prettyMessage}`);
    this.name = "DattoValidationError";
    this.zodError = zodError;
    this.stage = stage;
    this.prettyMessage = prettyMessage;
    this.payload = opts?.payload;
    this.context = opts?.context;
  }

  /**
   * Returns a structured error tree for programmatic error handling.
   */
  getErrorTree(): ReturnType<typeof z.treeifyError> {
    return z.treeifyError(this.zodError);
  }
}
