import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { expect, test } from "vitest";

import { DeviceSchema } from "../schemas";
import { validate } from "../validation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const device = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/device.json"), "utf-8"),
);

test("device fixture validates against schema", () => {
  const parsed = validate(DeviceSchema, device, "strict");
  expect(parsed).toEqual(device);
});
