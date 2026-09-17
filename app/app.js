let state = null;
let photo = null; // { base64, mime, name }
let selected = new Set();

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} -> ${res.status}`);
  return data;
}

function fmtBsv(sats) {
  const n = Number(sats) || 0;
  return `${(n / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BSV`;
}

function renderChips() {
  const chips = $("state-chips");
  chips.textContent = "";
  const add = (text, cls = "info") => {
    const el = document.createElement("span");
    el.className = `chip ${cls}`;
    el.textContent = text;
    chips.append(el);
  };
  if (state?.address) add(`${state.address.slice(0, 10)}…`);
  add(`AI: ${state?.ai?.provider ?? "?"}`);
  if (state?.walletLocked) add("wallet locked — run bsv unlock", "warn");
}

function renderChannels() {
  const box = $("channels");
  box.textContent = "";
  for (const c of state?.channels ?? []) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `chip ${selected.has(c.id) ? "on" : ""}`;
    el.textContent = c.label;
    el.addEventListener("click", () => {
      if (selected.has(c.id)) selected.delete(c.id);
      else selected.add(c.id);
      renderChannels();
    });
    box.append(el);
  }
}

function renderResult(listing, order) {
  const box = $("result");
  box.textContent = "";
  box.classList.remove("hidden");
  const h = document.createElement("h2");
  h.textContent = listing.title;
  const desc = document.createElement("p");
  desc.textContent = listing.description;
  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = `Asking ${fmtBsv(listing.priceSats)} (${listing.priceSats} sats) · AI: ${listing.aiProvider} · photo ${listing.photoSha256.slice(0, 12)}…`;
  box.append(h, desc, meta);

  for (const [id, r] of Object.entries(listing.channels ?? {})) {
    const row = document.createElement("div");
    row.className = "channel-result";
    const name = document.createElement("b");
    name.textContent = id;
    const badge = document.createElement("span");
    badge.className = `badge ${r.status}`;
    badge.textContent = r.status;
    row.append(name, badge);
    if (r.url) {
      const a = document.createElement("a");
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "open";
      row.append(a);
    }
    const detail = document.createElement("span");
    detail.className = "muted";
    detail.textContent = r.detail ?? "";
    row.append(detail);
    box.append(row);
  }

  if (order) {
    const o = document.createElement("p");
    o.className = "muted";
    o.textContent =
      order.status === "paid"
        ? `PAID — ${order.expectedSats} sats received (${order.txid?.slice(0, 12)}…)`
        : `Waiting for ${order.expectedSats} sats${order.address ? ` to ${order.address}` : ""} — the agent checks every 30s.`;
    box.append(o);
  }
}

function renderListings() {
  const box = $("listings");
  box.textContent = "";
  const orders = new Map((state?.orders ?? []).map((o) => [o.listingId, o]));
  for (const l of state?.listings ?? []) {
    const el = document.createElement("article");
    el.className = "listing";
    const img = document.createElement("img");
    img.src = `/api/listings/${l.id}/photo`;
    img.alt = l.title;
    const body = document.createElement("div");
    const title = document.createElement("div");
    title.innerHTML = "";
    title.textContent = l.title;
    title.style.fontWeight = "700";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${l.aiProvider} · ${new Date(l.createdAtMs).toLocaleString()}`;
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = `${fmtBsv(l.priceSats)} · ${l.status}${orders.get(l.id) ? ` · payment ${orders.get(l.id).status}` : ""}`;
    const badges = document.createElement("div");
    badges.className = "chips";
    for (const [id, r] of Object.entries(l.channels ?? {})) {
      const b = document.createElement("span");
      b.className = `badge ${r.status}`;
      b.textContent = id;
      if (r.url) {
        b.style.cursor = "pointer";
        b.addEventListener("click", () => window.open(r.url, "_blank"));
      }
      badges.append(b);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const retry = document.createElement("button");
    retry.textContent = "Retry channels";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      try {
        await api("POST", `/api/listings/${l.id}/publish`, {});
        await refresh();
      } finally {
        retry.disabled = false;
      }
    });
    const sold = document.createElement("button");
    sold.textContent = "Mark sold";
    sold.addEventListener("click", async () => {
      await api("POST", `/api/listings/${l.id}/sold`, {});
      await refresh();
    });
    actions.append(retry, sold);
    body.append(title, meta, price, badges, actions);
    el.append(img, body);
    box.append(el);
  }
}

// Downscale + re-encode so the photo fits in an on-chain OP_RETURN output
// without paying for camera-sized originals. Targets <= ~180 KB JPEG.
const PHOTO_STEPS = [
  [1024, 0.82],
  [768, 0.78],
  [640, 0.72],
  [512, 0.65],
];
const PHOTO_TARGET_BYTES = 180_000;

function encodeAt(img, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.split(",")[1] ?? "";
  return { base64, bytes: Math.floor((base64.length * 3) / 4) };
}

async function preparePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("could not read that image"));
      i.src = url;
    });
    let last = null;
    for (const [maxDim, quality] of PHOTO_STEPS) {
      last = encodeAt(img, maxDim, quality);
      if (last.bytes <= PHOTO_TARGET_BYTES) break;
    }
    return { ...last, mime: "image/jpeg", name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pickFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    $("compose-status").className = "status err";
    $("compose-status").textContent = "PNG, JPEG, WebP or GIF only";
    return;
  }
  $("compose-status").className = "status";
  $("compose-status").textContent = "preparing photo…";
  photo = await preparePhoto(file);
  const img = $("preview");
  img.src = `data:${photo.mime};base64,${photo.base64}`;
  img.classList.remove("hidden");
  $("drop-hint").classList.add("hidden");
  $("compose-status").textContent = `photo ready (${Math.round(photo.bytes / 1024)} KB, embedded on-chain)`;
}

$("drop").addEventListener("click", () => $("photo").click());
$("photo").addEventListener("change", (e) => pickFile(e.target.files?.[0]));
$("drop").addEventListener("dragover", (e) => {
  e.preventDefault();
  $("drop").classList.add("over");
});
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", (e) => {
  e.preventDefault();
  $("drop").classList.remove("over");
  pickFile(e.dataTransfer?.files?.[0]);
});

$("sell-btn").addEventListener("click", async () => {
  const status = $("compose-status");
  if (!photo) {
    status.className = "status err";
    status.textContent = "add a photo first";
    return;
  }
  $("sell-btn").disabled = true;
  status.className = "status";
  status.textContent = "writing the listing and publishing…";
  try {
    const res = await api("POST", "/api/listings", {
      photoBase64: photo.base64,
      mime: photo.mime,
      name: photo.name,
      notes: $("notes").value,
      priceHintSats: Number($("price").value) || undefined,
      channels: [...selected],
    });
    status.className = "status ok";
    status.textContent = "listed";
    renderResult(res.listing, res.order);
    await refresh();
  } catch (e) {
    status.className = "status err";
    status.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    $("sell-btn").disabled = false;
  }
});

$("watch-btn").addEventListener("click", async () => {
  await api("POST", "/api/watch", {});
  await refresh();
});

async function refresh() {
  state = await api("GET", "/api/state");
  renderChips();
  renderChannels();
  renderListings();
}

refresh().catch((e) => {
  $("compose-status").className = "status err";
  $("compose-status").textContent = e instanceof Error ? e.message : String(e);
});
setInterval(() => refresh().catch(() => {}), 20_000);