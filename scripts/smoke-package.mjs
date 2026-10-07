/** Verify the tarball consumers receive, without API traffic or registry installs. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const temporary = mkdtempSync(path.join(tmpdir(), "datto-sdk-smoke-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      {
        cwd: root,
        encoding: "utf8",
      },
    ),
  );
  execFileSync("tar", [
    "-xzf",
    path.join(temporary, packed[0].filename),
    "-C",
    temporary,
  ]);
  const modules = path.join(temporary, "node_modules");
  mkdirSync(modules);
  symlinkSync(
    path.join(temporary, "package"),
    path.join(modules, "datto-rmm-api-client"),
    "dir",
  );
  // Reuse the clean install's dependencies; the smoke itself needs no network.
  const manifest = JSON.parse(
    readFileSync(path.join(temporary, "package", "package.json"), "utf8"),
  );
  for (const name of Object.keys(manifest.dependencies)) {
    symlinkSync(
      path.join(root, "node_modules", name),
      path.join(modules, name),
      "dir",
    );
  }
  symlinkSync(
    path.join(root, "node_modules", "@types"),
    path.join(modules, "@types"),
    "dir",
  );
  writeFileSync(
    path.join(temporary, "consumer.mjs"),
    `
import assert from 'node:assert/strict';
import { createDattoRmmClient, DattoRmmClient, DattoValidationError, DattoApiError, BaseError } from 'datto-rmm-api-client';
import metadata from 'datto-rmm-api-client/package.json' with { type: 'json' };
const client = createDattoRmmClient({apiUrl:'https://example.invalid',apiKey:'fixture',apiSecret:'fixture'});
assert.ok(client instanceof DattoRmmClient);
for (const name of ['account','sites','devices','alerts','jobs','audit','filters','users','activityLogs','system']) assert.ok(client[name]);
assert.equal(typeof client.account.devices, 'function');
assert.throws(() => createDattoRmmClient({}), DattoValidationError);
assert.ok(DattoApiError.prototype instanceof BaseError);
assert.equal(metadata.version, ${JSON.stringify(manifest.version)});
`,
  );
  execFileSync(process.execPath, [path.join(temporary, "consumer.mjs")], {
    stdio: "inherit",
    timeout: 15_000,
  });
  writeFileSync(
    path.join(temporary, "consumer.mts"),
    `
import {createDattoRmmClient, type DattoRmmClientConfig, type Device} from 'datto-rmm-api-client';
const config: DattoRmmClientConfig = {apiUrl:'https://example.invalid',apiKey:'fixture',apiSecret:'fixture'};
const client = createDattoRmmClient(config);
const devices: Promise<Device[]> = client.account.devices();
void devices;
`,
  );
  writeFileSync(
    path.join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        types: ["node"],
      },
      files: ["consumer.mts"],
    }),
  );
  execFileSync(
    path.join(root, "node_modules", ".bin", "tsc"),
    ["-p", path.join(temporary, "tsconfig.json")],
    { stdio: "inherit", timeout: 30_000 },
  );
  assert.equal(manifest.main, "dist/index.js");
  assert.equal(manifest.types, "dist/index.d.ts");
  console.log(
    "Packed SDK ESM, package metadata, and consumer declarations passed.",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
