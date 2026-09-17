import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../src/store.mjs";

test("store: listings and orders persist across reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s4s-store-"));
  try {
    const s = openStore(dir);
    const listing = s.addListing({ title: "Chair", priceSats: 1000 });
    assert.match(listing.id, /^[0-9a-f-]{36}$/);
    const order = s.addOrder({ listingId: listing.id, expectedSats: 1000 });
    s.updateOrder(order.id, { status: "paid", txid: "ab".repeat(32) });
    s.updateListing(listing.id, { status: "paid" });

    const again = openStore(dir);
    assert.equal(again.listings().length, 1);
    assert.equal(again.getListing(listing.id).title, "Chair");
    assert.equal(again.orders()[0].status, "paid");
    assert.equal(again.getListing(listing.id).status, "paid");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store: corrupt file starts fresh instead of throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s4s-corrupt-"));
  try {
    fs.writeFileSync(path.join(dir, "store.json"), "{not json");
    const s = openStore(dir);
    assert.deepEqual(s.listings(), []);
    assert.deepEqual(s.orders(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});