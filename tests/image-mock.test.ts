import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { imageDimensions } from "../lib/images/media";
import { MockImageBackend } from "../lib/images/mock";

process.env.IMAGE_BACKEND = "mock";
process.env.IMAGE_MOCK_DELAY_MS = "1";

describe("backend simulado", () => {
  it("produce un PNG válido sin GPU", async () => {
    const backend = new MockImageBackend();
    let promptId = "";
    const output = await backend.generate(
      {
        jobId: "job-1",
        prompt: "un gato",
        width: 320,
        height: 240,
        steps: 4,
        seed: 42,
      },
      {
        onPromptId: async (id) => {
          promptId = id;
        },
      },
    );

    assert.equal(promptId, "mock-job-1");
    assert.equal(output.mimeType, "image/png");
    assert.equal(imageDimensions(output.buffer, "image/png")?.width, 320);
    assert.equal(imageDimensions(output.buffer, "image/png")?.height, 240);
  });

  it("responde a health y cancelación", async () => {
    const backend = new MockImageBackend();
    assert.equal((await backend.health()).ok, true);
    assert.deepEqual(await backend.cancel("p1"), {
      deleted: true,
      interrupted: false,
    });
  });
});
