// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/components/update-checker/upstreamRelease.test.ts
import assert from "node:assert";
import { upstreamReleaseUrl } from "./upstreamRelease";

assert.equal(
  upstreamReleaseUrl("0.9.6"),
  "https://github.com/cjpais/Handy/releases/tag/v0.9.6",
);

assert.equal(
  upstreamReleaseUrl("v0.9.6"),
  "https://github.com/cjpais/Handy/releases/tag/v0.9.6",
);

console.log("upstreamRelease: all assertions passed");
