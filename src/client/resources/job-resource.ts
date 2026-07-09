import { z } from "zod";

import {
  get1Response,
  getJobResultsResponse,
  getStdErrResponseItem,
  getStdOutResponseItem,
} from "../../generated/schemas/-v2-job/-v2-job.zod";
import type { GetJobComponentsParams } from "../../generated/types/getJobComponentsParams";
import type { Job } from "../../generated/types/job";
import type { JobComponent } from "../../generated/types/jobComponent";
import type { JobResults } from "../../generated/types/jobResults";
import type { JobStdData } from "../../generated/types/jobStdData";

import { BaseResource } from "./base-resource";
import { narrow } from "./narrow";

/** `GET /api/v2/job/{uid}/components`'s item schema (`JobComponent`, with its nested
 * `JobComponentVariable[]`). No UDF/alertContext/enum defect to reconcile — a plain mirror of
 * the generated shape, scoped to this resource file since nothing else in this phase shares it. */
export const jobComponentSchema = z.object({
  uid: z.string().optional(),
  name: z.string().optional(),
  variables: z
    .array(
      z.object({
        name: z.string().optional(),
        value: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * `client.jobs` (R1, R2, design "Public surface"): job reads and job component operations.
 * Every operation this class implements is genuinely tagged `-v2-job` in the committed spec —
 * unlike `alerts`, there is no cross-tag rehoming here.
 */
export class JobResource extends BaseResource {
  /** `GET /api/v2/job/{uid}` — data for one job. */
  async get(uid: string): Promise<Job> {
    const result = await this.httpGet(
      `/api/v2/job/${uid}`,
      get1Response,
      "GET /job/{uid}",
    );
    return narrow<Job>(result);
  }

  /** `GET /api/v2/job/{jobUid}/results/{deviceUid}` — the job's results for one device. */
  async getResults(jobUid: string, deviceUid: string): Promise<JobResults> {
    const result = await this.httpGet(
      `/api/v2/job/${jobUid}/results/${deviceUid}`,
      getJobResultsResponse,
      "GET /job/{jobUid}/results/{deviceUid}",
    );
    return narrow<JobResults>(result);
  }

  /** `GET /api/v2/job/{jobUid}/results/{deviceUid}/stdout` — the job's StdOut for one device. A
   * bare, non-paginated top-level array, so this uses `httpGetArray` rather than `paginate`. */
  async getStdOut(jobUid: string, deviceUid: string): Promise<JobStdData[]> {
    const result = await this.httpGetArray(
      `/api/v2/job/${jobUid}/results/${deviceUid}/stdout`,
      getStdOutResponseItem,
      "GET /job/{jobUid}/results/{deviceUid}/stdout",
    );
    return narrow<JobStdData[]>(result);
  }

  /** `GET /api/v2/job/{jobUid}/results/{deviceUid}/stderr` — the job's StdErr for one device. A
   * bare, non-paginated top-level array, so this uses `httpGetArray` rather than `paginate`. */
  async getStdErr(jobUid: string, deviceUid: string): Promise<JobStdData[]> {
    const result = await this.httpGetArray(
      `/api/v2/job/${jobUid}/results/${deviceUid}/stderr`,
      getStdErrResponseItem,
      "GET /job/{jobUid}/results/{deviceUid}/stderr",
    );
    return narrow<JobStdData[]>(result);
  }

  /** `GET /api/v2/job/{uid}/components` — the job's components, fully paginated. */
  async getComponents(
    uid: string,
    params?: GetJobComponentsParams,
  ): Promise<JobComponent[]> {
    const result = await this.paginate(
      `/api/v2/job/${uid}/components`,
      "jobComponents",
      jobComponentSchema,
      params,
      "GET /job/{uid}/components",
    );
    return narrow<JobComponent[]>(result);
  }
}
