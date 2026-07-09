import { z } from "zod";

import { resetApiKeysResponse } from "../../generated/schemas/-v2-user/-v2-user.zod";
import type { AuthUser } from "../../generated/types/authUser";
import type { AuthUserKey } from "../../generated/types/authUserKey";
import type { GetUsersParams } from "../../generated/types/getUsersParams";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";

/**
 * `GET /api/v2/account/users`'s item schema (`AuthUser`). No UDF/alertContext/enum defect to
 * reconcile — a plain mirror of the generated shape (no enum field: `status` is a real spec
 * `string`, not an enum). `created`/`lastAccess` are epoch-ms integers per the Phase 2 patch step
 * (`patch-spec.mjs`'s `TIMESTAMP_FIELDS.AuthUser`), already reflected here as `z.number()`.
 *
 * @internal Exported only so `tests/generated/schema-mirror-pin.ts` can pin it against `AuthUser`
 * — not resource API. The `src/index.ts` barrel must never `export *` from this module.
 */
export const authUserSchema = z.object({
  lastName: z.string().optional(),
  firstName: z.string().optional(),
  username: z.string().optional(),
  email: z.string().optional(),
  telephone: z.string().optional(),
  status: z.string().optional(),
  created: z.number().optional(),
  lastAccess: z.number().optional(),
  disabled: z.boolean().optional(),
});

/**
 * `client.users` (R1, R2, design "Public surface", plan Phase 8 Step 3: "user reads, resetKeys
 * (user-reset-keys)"): the account's authentication-user records and the authenticated user's own
 * API-key reset.
 *
 * **`list()` houses `GET /api/v2/account/users`** despite its `-v2-account` tag in the committed
 * spec — deliberately deferred here from Phase 7 (`AccountResource`'s own doc: "its natural
 * conceptual home is the resource named for the entity it returns, not the tag Datto's spec
 * happens to group it under"), the same concept-over-path grouping `AlertResource` applies to
 * every alert read regardless of its tag.
 */
export class UserResource extends BaseResource {
  /** `GET /api/v2/account/users` — every authentication user in the account, fully paginated. */
  async list(params?: GetUsersParams): Promise<AuthUser[]> {
    const result = await this.paginate(
      "/api/v2/account/users",
      "users",
      authUserSchema,
      params,
      "GET /account/users",
    );
    return narrow<AuthUser[]>(result);
  }

  /** `POST /api/v2/user/resetApiKeys` (`user-reset-keys`): resets the authenticated user's API
   * access and secret keys. Bodiless write — the new keys come back in the response, not in an
   * echoed request body. */
  async resetKeys(): Promise<AuthUserKey> {
    const result = await this.httpPost(
      "/api/v2/user/resetApiKeys",
      resetApiKeysResponse,
      "POST /user/resetApiKeys",
      "user-reset-keys",
    );
    return narrow<AuthUserKey>(result);
  }
}
