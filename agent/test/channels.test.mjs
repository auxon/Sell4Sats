import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPostText, twetchChannel } from "../src/channels/twetch.mjs";
import { buildWebhookPayload, webhookChannel } from "../src/channels/webhook.mjs";
import { agentpayChannel, buildAskPayload } from "../src/channels/agentpay.mjs";
import { channelById, channelCatalogue, publishToChannels } from "../src/channels/index.mjs";

const listing = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Vintage Chair",
  description: "Solid oak, small scratch.",
  priceSats: 25000,
  tags: ["chair", "oak"],
  photoSha256: "ab".repeat(32),
  photoMime: "image/png",
  createdAtMs: 1,
};

test("channels: twetch post text stays inside the 2000-byte wallet limit", () => {
  const text = buildPostText(listing);
  assert.ok(text.includes("Vintage Chair"));
  assert.ok(text.includes("Price: 25000 sats"));
  assert.ok(Buffer.byteLength(text, "utf8") <= 1900);
  const huge = buildPostText({ ...listing, description: "x".repeat(5000) });
  assert.ok(Buffer.byteLength(huge, "utf8") <= 1900);
});

test("channels: twetch publishes via the wallet and reports failures", async () => {
  const okCtx = { bsv: { twetchPost: async () => ({ ok: true, json: { txid: "cd".repeat(32), submitted: true } }) } };
  const good = await twetchChannel.publish(listing, okCtx);
  assert.equal(good.status, "published");
  assert.equal(good.url, `https://twetch.com/t/${"cd".repeat(32)}`);

  const badCtx = { bsv: { twetchPost: async () => ({ ok: false, error: "POLICY_DENY: denied: first-run approval required" }) } };
  const bad = await twetchChannel.publish(listing, badCtx);
  assert.equal(bad.status, "failed");
  assert.match(bad.detail, /POLICY_DENY/);
});

test("channels: webhook skips without a URL and posts the full payload with one", async () => {
  const skipped = await webhookChannel.publish(listing, { env: {}, fetchFn: () => assert.fail("no fetch when unset") });
  assert.equal(skipped.status, "skipped");

  let seen = null;
  const fetchFn = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ url: "https://market.example/item/1" }), { status: 200 });
  };
  const published = await webhookChannel.publish(listing, { env: { SELL4SATS_WEBHOOK_URL: "https://market.example/hook" }, fetchFn, photoBase64: "AAAA" });
  assert.equal(published.status, "published");
  assert.equal(published.url, "https://market.example/item/1");
  assert.equal(seen.body.listing.photoSha256, "ab".repeat(32));
  assert.equal(seen.body.photoBase64, "AAAA");

  const failed = await webhookChannel.publish(listing, { env: { SELL4SATS_WEBHOOK_URL: "https://x" }, fetchFn: async () => new Response("boom", { status: 502 }) });
  assert.equal(failed.status, "failed");
  assert.match(failed.detail, /502/);
});

test("channels: agentpay requires a key; payload is an ask", async () => {
  const skipped = await agentpayChannel.publish(listing, { env: {}, fetchFn: () => assert.fail("no fetch without key") });
  assert.equal(skipped.status, "skipped");
  assert.equal(buildAskPayload(listing).amountSats, 25000);

  let auth = null;
  const published = await agentpayChannel.publish(listing, {
    env: { AGENTPAY_KEY: "agp_test" },
    fetchFn: async (_url, init) => {
      auth = init.headers.authorization;
      return new Response(JSON.stringify({ id: 42 }), { status: 200 });
    },
  });
  assert.equal(published.status, "published");
  assert.equal(published.ref, "42");
  assert.equal(auth, "Bearer agp_test");
});

test("channels: external stubs and the registry behave", async () => {
  const ebay = channelById("ebay");
  const r = await ebay.publish(listing, {});
  assert.equal(r.status, "not_configured");
  assert.ok(channelCatalogue().some((c) => c.id === "twetch"));
  const results = await publishToChannels(listing, ["nope", "ebay"], { env: {}, fetchFn: fetch });
  assert.equal(results.nope.status, "unknown_channel");
  assert.equal(results.ebay.status, "not_configured");
});