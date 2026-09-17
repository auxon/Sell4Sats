import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicListing, parseListingJson, writeListing } from "../src/ai.mjs";

const input = { name: "vintage-chair.png", notes: "wooden, small scratch", bytes: 120_000, sha256: "ab".repeat(32) };

test("ai: offline heuristic produces a usable listing", () => {
  const l = heuristicListing(input);
  assert.equal(l.title, "Vintage Chair");
  assert.ok(l.priceSats >= 1000);
  assert.ok(l.description.includes("Selling for sats on BSV"));
  assert.ok(l.tags.length >= 3);
});

test("ai: parseListingJson tolerates prose around JSON and bad fields", () => {
  const fallback = heuristicListing(input);
  const parsed = parseListingJson('Sure! {"title":"Oak chair","description":"Solid.","priceSats":25000,"tags":["chair","oak"]}', fallback);
  assert.equal(parsed.title, "Oak chair");
  assert.equal(parsed.priceSats, 25000);
  assert.deepEqual(parsed.tags, ["chair", "oak"]);

  const broken = parseListingJson("no json here", fallback);
  assert.deepEqual(broken, fallback);

  const partial = parseListingJson('{"title":"","priceSats":-5,"tags":"nope"}', fallback);
  assert.equal(partial.title, fallback.title);
  assert.equal(partial.priceSats, fallback.priceSats);
  assert.deepEqual(partial.tags, fallback.tags);
});

test("ai: writeListing uses the configured endpoint and falls back on failure", async () => {
  const okFetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"title":"Camera","description":"Great.","priceSats":123456,"tags":["camera"]}' } }] }),
      { status: 200 },
    );
  const ok = await writeListing(input, { env: { OPENAI_API_KEY: "k", SELL4SATS_MODEL: "test-model" }, fetchFn: okFetch });
  assert.equal(ok.title, "Camera");
  assert.equal(ok.priceSats, 123456);
  assert.equal(ok.provider, "test-model");

  const boom = await writeListing(input, { env: { OPENAI_API_KEY: "k" }, fetchFn: async () => new Response("nope", { status: 500 }) });
  assert.equal(boom.provider, "offline");
  assert.match(boom.aiError, /500/);
  assert.equal(boom.title, heuristicListing(input).title);

  const offline = await writeListing(input, { env: {}, fetchFn: () => assert.fail("must not call fetch") });
  assert.equal(offline.provider, "offline");
});

test("ai: seller price hint wins over the model", async () => {
  const okFetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"x","description":"y","priceSats":999,"tags":["a"]}' } }] }), { status: 200 });
  const l = await writeListing({ ...input, priceHintSats: 4242 }, { env: { OPENAI_API_KEY: "k" }, fetchFn: okFetch });
  assert.equal(l.priceSats, 4242);
});