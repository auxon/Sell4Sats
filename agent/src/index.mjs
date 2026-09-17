/**
 * Sell4Sats agent: local service that turns a photo into a listing and
 * sells it across channels. Serves the bsvOS runner app from the same
 * loopback origin (https://127.0.0.2:8790 by default) and talks to the
 * bsvOS wallet CLI for every spend (policy-gated, origin "sell4sats").
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import { writeListing } from "./ai.mjs";
import { createBsv } from "./bsv.mjs";
import { channelCatalogue, DEFAULT_CHANNELS, publishToChannels } from "./channels/index.mjs";
import { watchOrders } from "./watcher.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../../app");
const HOST = process.env.SELL4SATS_HOST || "127.0.0.2";
const PORT = Number(process.env.SELL4SATS_PORT || 8790);
const DATA_DIR = process.env.SELL4SATS_DATA || path.resolve(HERE, "../../data");
const MAX_PHOTO_BYTES = Number(process.env.SELL4SATS_MAX_PHOTO || 8 * 1024 * 1024);
const PHOTO_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

const store = openStore(DATA_DIR);
const bsv = createBsv();
const photoDir = path.join(DATA_DIR, "photos");
fs.mkdirSync(photoDir, { recursive: true });

function certPaths() {
  const dir = path.join(DATA_DIR, "cert");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", key, "-out", cert, "-days", "825", "-nodes",
        "-subj", `/CN=${HOST}`,
        "-addext", `subjectAltName=IP:${HOST}`,
      ],
      { stdio: "ignore" },
    );
  }
  return { key, cert };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PHOTO_BYTES * 2) throw Object.assign(new Error("body too large"), { code: "TOO_LARGE" });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

function serveApp(res, urlPath) {
  const file = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.normalize(path.join(APP_DIR, file));
  if (!full.startsWith(APP_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(full)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

function createListingRow(input, listing, photo) {
  const row = store.addListing({
    title: listing.title,
    description: listing.description,
    priceSats: listing.priceSats,
    tags: listing.tags,
    aiProvider: listing.provider,
    aiError: listing.aiError ?? null,
    notes: input.notes ?? "",
    photoSha256: photo.sha256,
    photoMime: photo.mime,
    photoBytes: photo.bytes,
    photoFile: photo.file,
    channels: {},
    status: "listed",
  });
  return row;
}

async function publishListing(row, ids, photoBase64) {
  const results = await publishToChannels(row, ids, {
    bsv,
    env: process.env,
    fetchFn: fetch,
    photoBase64,
    photoPath: row.photoFile ? path.join(photoDir, row.photoFile) : undefined,
  });
  const anyPublished = Object.values(results).some((r) => r.status === "published");
  const patch = { channels: { ...(row.channels ?? {}), ...results } };
  if (anyPublished) patch.status = "listed";
  const updated = store.updateListing(row.id, patch);
  const existing = store.orders().find((o) => o.listingId === row.id);
  if (anyPublished && row.priceSats > 0 && !existing) {
    const wallet = await bsv.utxos();
    const address = wallet.json?.address ?? null;
    store.addOrder({ listingId: row.id, expectedSats: row.priceSats, address, status: "waiting" });
  }
  return updated;
}

const { key: keyFile, cert: certFile } = certPaths();
const server = https.createServer(
  { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
  async (req, res) => {
  const url = new URL(req.url ?? "/", `https://${HOST}:${PORT}`);
  const p = url.pathname;
  try {
    if (req.method === "GET" && !p.startsWith("/api/")) return serveApp(res, p);

    if (req.method === "GET" && p === "/api/state") {
      const [status, wallet] = await Promise.all([bsv.status(), bsv.utxos()]);
      return sendJson(res, 200, {
        address: wallet.json?.address ?? null,
        walletLocked: status.json?.locked ?? null,
        channels: channelCatalogue(),
        defaultChannels: DEFAULT_CHANNELS,
        ai: {
          provider: process.env.OPENAI_API_KEY ? process.env.SELL4SATS_MODEL || "gpt-4o-mini" : "offline heuristic",
          configured: Boolean(process.env.OPENAI_API_KEY),
        },
        webhookConfigured: Boolean(process.env.SELL4SATS_WEBHOOK_URL),
        agentpayConfigured: Boolean(process.env.AGENTPAY_KEY),
        listings: store.listings(),
        orders: store.orders(),
      });
    }

    if (req.method === "POST" && p === "/api/listings") {
      const body = await readJsonBody(req);
      const mime = String(body.mime || "").toLowerCase();
      const ext = PHOTO_MIME[mime];
      if (!ext) return sendJson(res, 400, { error: "photo must be png, jpeg, webp or gif" });
      if (typeof body.photoBase64 !== "string" || !body.photoBase64) return sendJson(res, 400, { error: "photoBase64 required" });
      const bytes = Buffer.from(body.photoBase64, "base64");
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
        return sendJson(res, 400, { error: `photo must be 1..${MAX_PHOTO_BYTES} bytes` });
      }
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const priceHintSats = Number.isFinite(Number(body.priceHintSats)) && Number(body.priceHintSats) > 0
        ? Math.floor(Number(body.priceHintSats))
        : undefined;
      const listing = await writeListing(
        {
          notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : "",
          name: typeof body.name === "string" ? body.name.slice(0, 120) : "photo",
          mime,
          bytes: bytes.length,
          sha256,
          priceHintSats,
          photoBase64: body.photoBase64,
        },
        { env: process.env },
      );
      const file = `${sha256.slice(0, 16)}-${Date.now().toString(36)}.${ext}`;
      fs.writeFileSync(path.join(photoDir, file), bytes);
      const row = createListingRow({ notes: body.notes }, listing, { sha256, mime, bytes: bytes.length, file });
      const ids = Array.isArray(body.channels) && body.channels.length ? body.channels.map(String) : DEFAULT_CHANNELS;
      const updated = await publishListing(row, ids, body.photoBase64);
      const order = store.orders().find((o) => o.listingId === row.id) ?? null;
      return sendJson(res, 200, { listing: updated, order });
    }

    const publishMatch = /^\/api\/listings\/([^/]+)\/publish$/.exec(p);
    if (req.method === "POST" && publishMatch) {
      const row = store.getListing(publishMatch[1]);
      if (!row) return sendJson(res, 404, { error: "unknown listing" });
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.channels) && body.channels.length ? body.channels.map(String) : DEFAULT_CHANNELS;
      const photoPath = path.join(photoDir, row.photoFile);
      const photoBase64 = fs.existsSync(photoPath) ? fs.readFileSync(photoPath).toString("base64") : null;
      const updated = await publishListing(row, ids, photoBase64);
      const order = store.orders().find((o) => o.listingId === row.id) ?? null;
      return sendJson(res, 200, { listing: updated, order });
    }

    const soldMatch = /^\/api\/listings\/([^/]+)\/sold$/.exec(p);
    if (req.method === "POST" && soldMatch) {
      const row = store.getListing(soldMatch[1]);
      if (!row) return sendJson(res, 404, { error: "unknown listing" });
      store.updateListing(row.id, { status: "sold" });
      for (const o of store.orders().filter((x) => x.listingId === row.id && x.status !== "paid")) {
        store.updateOrder(o.id, { status: "sold" });
      }
      return sendJson(res, 200, { listing: store.getListing(row.id), orders: store.orders() });
    }

    const photoMatch = /^\/api\/listings\/([^/]+)\/photo$/.exec(p);
    if (req.method === "GET" && photoMatch) {
      const row = store.getListing(photoMatch[1]);
      if (!row) return sendJson(res, 404, { error: "unknown listing" });
      const file = path.join(photoDir, row.photoFile);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: "photo missing" });
      res.writeHead(200, { "content-type": row.photoMime, "cache-control": "no-store" });
      res.end(fs.readFileSync(file));
      return;
    }

    if (req.method === "POST" && p === "/api/watch") {
      const result = await watchOrders(store, bsv);
      return sendJson(res, 200, { watcher: result, orders: store.orders() });
    }

    if (req.method === "GET" && p === "/api/listings") {
      return sendJson(res, 200, { listings: store.listings(), orders: store.orders() });
    }

    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    const code = e?.code === "TOO_LARGE" ? 413 : 500;
    sendJson(res, code, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sell4Sats agent on https://${HOST}:${PORT} (data: ${DATA_DIR})`);
  console.log(`Wallet origin for policy: sell4sats — approve with: bsv allow sell4sats <cap>`);
});

const watcherTimer = setInterval(() => {
  watchOrders(store, bsv).catch(() => {});
}, 30_000);
watcherTimer.unref?.();