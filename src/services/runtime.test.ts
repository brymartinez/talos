import { expect, test } from "bun:test";
import { assertLocalRequest } from "./runtime";

test("accepts the browser's local origin when Next.js normalizes the internal request URL", () => {
  const request = new Request("http://localhost:5689/api/cards/example/continue", {
    headers: { host: "127.0.0.1:5689", origin: "http://127.0.0.1:5689" },
  });
  expect(() => assertLocalRequest(request)).not.toThrow();
});

test.each(["https://example.com", "http://127.0.0.1:5690", "http://localhost:5689"])(
  "rejects a different browser origin: %s", (origin) => {
    const request = new Request("http://localhost:5689/api/cards/example/continue", {
      headers: { host: "127.0.0.1:5689", origin },
    });
    expect(() => assertLocalRequest(request)).toThrow("Cross-site");
  },
);

test("still rejects a non-local Host header", () => {
  const request = new Request("http://localhost:5689/api/cards/example/continue", {
    headers: { host: "example.com", origin: "http://example.com" },
  });
  expect(() => assertLocalRequest(request)).toThrow("local requests");
});
