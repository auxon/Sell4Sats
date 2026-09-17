/**
 * Payment watcher: an order is "waiting" until an unspent output at the
 * wallet address matches its expected amount exactly. Exact-value matching
 * is deliberate v1 behaviour (single-address wallet, small catalogue);
 * anything ambiguous stays waiting for a human.
 */

export function matchPayment(utxos, expectedSats) {
  const want = Math.floor(Number(expectedSats) || 0);
  if (!(want > 0) || !Array.isArray(utxos)) return null;
  return utxos.find((u) => Math.floor(Number(u?.value) || 0) === want) ?? null;
}

export async function watchOrders(store, bsv) {
  const waiting = store.orders().filter((o) => o.status === "waiting");
  if (!waiting.length) return { waiting: 0, paid: 0, detail: "no open orders" };
  const res = await bsv.utxos();
  if (!res.ok || !Array.isArray(res.json?.utxos)) {
    return { waiting: waiting.length, paid: 0, detail: res.error || "wallet utxos unavailable" };
  }
  let paid = 0;
  for (const order of waiting) {
    const hit = matchPayment(res.json.utxos, order.expectedSats);
    if (!hit) continue;
    store.updateOrder(order.id, {
      status: "paid",
      txid: hit.txid,
      vout: hit.vout,
      paidAtMs: Date.now(),
    });
    store.updateListing(order.listingId, { status: "paid" });
    paid++;
  }
  return { waiting: waiting.length - paid, paid, detail: paid ? "payment(s) matched" : "nothing yet" };
}