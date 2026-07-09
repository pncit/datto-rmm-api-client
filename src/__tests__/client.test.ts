import { expect, test } from "vitest";

import { createDattoRmmClient } from "../client";

// This is a basic test to instantiate the client

test("create client", () => {
  const client = createDattoRmmClient({
    apiUrl: "https://example.com",
    apiKey: "key",
    apiSecret: "secret",
  });
  expect(client).toBeTruthy();
});
