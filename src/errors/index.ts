import { DattoApiError } from "./datto-api-error";
import { DattoValidationError } from "./datto-validation-error";

export { BaseError } from "./base-error";
export {
  DattoApiError,
  type DattoApiErrorCode,
  type DattoApiErrorOptions,
} from "./datto-api-error";
export {
  DattoValidationError,
  type DattoValidationStage,
  type DattoValidationErrorOptions,
} from "./datto-validation-error";

/** Type guard for {@link DattoApiError}, useful in a `catch` block. */
export function isDattoApiError(e: unknown): e is DattoApiError {
  return e instanceof DattoApiError;
}

/** Type guard for {@link DattoValidationError}, useful in a `catch` block. */
export function isDattoValidationError(e: unknown): e is DattoValidationError {
  return e instanceof DattoValidationError;
}
