import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "store.json");
  let state = { listings: [], orders: [] };
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") state = parsed;
    } catch {
      /* start fresh on a corrupt store */
    }
  }
  state.listings ??= [];
  state.orders ??= [];

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  };

  return {
    state,
    save,
    listings: () => state.listings,
    orders: () => state.orders,
    getListing: (id) => state.listings.find((l) => l.id === id) ?? null,
    addListing(listing) {
      const row = {
        id: crypto.randomUUID(),
        createdAtMs: Date.now(),
        status: "listed",
        ...listing,
      };
      state.listings.unshift(row);
      save();
      return row;
    },
    updateListing(id, patch) {
      const row = state.listings.find((l) => l.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAtMs: Date.now() });
      save();
      return row;
    },
    addOrder(order) {
      const row = { id: crypto.randomUUID(), createdAtMs: Date.now(), status: "waiting", ...order };
      state.orders.unshift(row);
      save();
      return row;
    },
    updateOrder(id, patch) {
      const row = state.orders.find((o) => o.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAtMs: Date.now() });
      save();
      return row;
    },
  };
}