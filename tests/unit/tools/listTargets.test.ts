import test from "node:test";
import assert from "node:assert/strict";
import { buildListTargetsHandler } from "../../../src/tools/listTargets.js";
import { createMockRuntime, readTextContent } from "./helpers.js";

test("list_targets returns configured targets and default target", async () => {
  const handler = buildListTargetsHandler(
    createMockRuntime({
      config: {
        defaultTarget: "analytics",
        targets: [
          {
            name: "analytics",
            description: "Reporting database",
            host: "analytics.local",
            user: "report",
            password: "secret",
            defaultDatabase: "Warehouse",
            port: 1444
          }
        ]
      }
    })
  );

  const response = await handler();
  assert.deepEqual(readTextContent(response), {
    defaultTarget: "analytics",
    targets: [
      {
        name: "analytics",
        description: "Reporting database",
        host: "analytics.local",
        defaultDatabase: "Warehouse",
        port: 1444
      }
    ]
  });
});
