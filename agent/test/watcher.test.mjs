import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPayment, watchOrders } from "../src/watcher.mjs";

function fakeStore(orders) {
  const listings = new Map();
  return {
    orders: () => orders,
    updateOrder(id, patch) {
      const o = orders.find((x) => x.id === id);
      Object.assign(o, patch);
      return o;
    },
    updateListing(id, patch) {
      listings.set(id, { ...(listings.get(id) ?? {}), ...patch });
      return listings.get(id);
    },
    listings,
  };
}

test("watcher: matchPayment needs an exact unspent value", () => {
  const utxos = [
    { txid: "aa", vout: 0, value: 1000 },
    { txid: "bb", vout: 1, value: 25000 },
  ];
  assert.equal(matchPayment(utxos, 25000).txid, "bb");
  assert.equal(matchPayment(utxos, 999), null);
  assert.equal(matchPayment(null, 1000), null);
});

test("watcher: paid orders mark the listing and record the outpoint", async () => {
  const orders = [
    { id: "o1", listingId: "l1", expectedSats: 25000, status: "waiting" },
    { id: "o2", listingId: "l2", expectedSats: 999, status: "waiting" },
    { id: "o3", listingId: "l3", expectedSats: 1000, status: "paid" },
  ];
  const store = fakeStore(orders);
  const bsv = { utxos: async () => ({ ok: true, json: { utxos: [{ txid: "cc", vout: 2, value: 25000 }] } }) };
  const res = await watchOrders(store, bsv);
  assert.equal(res.paid, 1);
  assert.equal(res.waiting, 1);
  assert.equal(orders[0].status, "paid");
  assert.equal(orders[0].txid, "cc");
  assert.equal(store.listings.get("l1").status, "paid");
  assert.equal(orders[1].status, "waiting");
  assert.equal(orders[2].status, "paid");
});

test("watcher: wallet errors leave orders untouched", async () => {
  const orders = [{ id: "o1", listingId: "l1", expectedSats: 5, status: "waiting" }];
  const store = fakeStore(orders);
  const res = await watchOrders(store, { utxos: async () => ({ ok: false, error: "daemon unreachable" }) });
  assert.equal(res.paid, 0);
  assert.equal(orders[0].status, "waiting");
  assert.match(res.detail, /unreachable/);
});