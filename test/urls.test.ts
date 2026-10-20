import { test } from "node:test";
import assert from "node:assert/strict";
import { webAddresses } from "../src/core/urls.ts";

test("web addresses are found in text, without the sentence around them", () => {
  assert.deepEqual(
    webAddresses("See https://example.com. Also (http://a.org/x?y=1), and https://example.com again!"),
    ["https://example.com", "http://a.org/x?y=1"],
  );
  assert.deepEqual(webAddresses("https://en.wikipedia.org/wiki/Mind_map_(disambiguation)"), [
    "https://en.wikipedia.org/wiki/Mind_map_(disambiguation)",
  ]);
  assert.deepEqual(webAddresses("no addresses, and not file:///etc or javascript:alert(1)"), []);
});
