# Sell4Sats

One photo → an AI-written listing → an agent that sells it for sats.

Sell4Sats is a bsvOS app: a local agent (Node, no dependencies) plus a
sandboxed runner app. You drop a photo, the agent writes the listing with
an OpenAI-compatible model (or a deterministic offline fallback), publishes
it to your selling channels, and watches the wallet for payment. Every
spend goes through bsvOS wallet policy — the agent never touches keys.

```
 photo ──▶ AI listing ──▶ channels ──▶ orders
              │             │            │
              │             ├─ twetch post (on-chain B://+MAP)
              │             ├─ BSVBounties / agentpay ask
              │             ├─ generic webhook / x402 channel
              │             └─ eBay / Facebook / X (stubs)
              │
              └─ sha256 + local photo store (data/photos/)
```

## Quick start

```bash
cd ~/Sell4Sats
npm test          # 14 tests, no network, no wallet
npm start         # agent on https://127.0.0.2:8790
```

Open `https://127.0.0.2:8790/` (or install it as a bsvOS app below).

First publish will be **denied by wallet policy** — approve a cap once
(photos are embedded on-chain, so allow enough for the network fee):

```bash
bsv allow sell4sats 500000
```

## Configuration

Environment variables (see `packaging/sell4sats.env.example`):

| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | enables AI listings (any OpenAI-compatible endpoint) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | e.g. local ollama |
| `SELL4SATS_MODEL` | `gpt-4o-mini` | model name |
| `SELL4SATS_WEBHOOK_URL` | — | generic channel: POSTs `{listing, photoBase64}` |
| `SELL4SATS_WEBHOOK_TOKEN` | — | bearer for the webhook channel |
| `AGENTPAY_KEY` | — | BSVBounties/agentpay ask creation (`agp_…`) |
| `AGENTPAY_LISTING_URL` | `https://entangleit.com/api/agentpay/asks` | ask endpoint |
| `SELL4SATS_HOST` / `SELL4SATS_PORT` | `127.0.0.2` / `8790` | loopback origin |
| `SELL4SATS_DATA` | `./data` | store, photos, cert |
| `SELL4SATS_BSV_BIN` | `bsv` | wallet CLI path |

Without `OPENAI_API_KEY` the offline heuristic still produces a usable
listing (title from the filename, description, a size-based price guess),
so the pipeline always works.

## Install as a bsvOS app

The daemon treats all of `127.0.0.0/8` as loopback (cert-trusting), so
`127.0.0.2` gives this app its own origin without colliding with other
local apps:

```bash
# walletd must be running
bsv app install 127.0.0.2 --manifest-file ~/Sell4Sats/app/manifest.json
bsv app open 127.0.0.2
```

Run the agent as a user service so the app works after login:

```bash
mkdir -p ~/.config/systemd/user
cp ~/Sell4Sats/packaging/sell4sats.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sell4sats
```

Put secrets in `~/.config/sell4sats.env` (mode 600).

## HTTP API (local only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state` | wallet address, channels, AI provider, listings, orders |
| POST | `/api/listings` | `{photoBase64, mime, notes?, priceHintSats?, channels?}` |
| POST | `/api/listings/:id/publish` | retry channels |
| GET | `/api/listings/:id/photo` | the stored photo |
| POST | `/api/listings/:id/sold` | mark sold manually |
| POST | `/api/watch` | run the payment watcher now |

## Payment watching

Each listing with a price opens an order: `waiting → paid → sold`. Every
30s (and on demand) the watcher asks `bsv utxos` and matches an **exact**
unspent amount to the order. Exact matching is deliberate v1 behaviour for
the single-address wallet: anything ambiguous stays waiting for a human,
never auto-credits.

## Limits / roadmap

- The Twetch channel embeds the photo itself: the listing transaction
  carries Twetch's exact B:// media output (`OP_0 OP_RETURN <B prefix>
  <bytes> <mime>`) alongside the text post. Photos are downscaled and
  re-encoded in the app (<= ~180 KB JPEG) so the network fee stays small;
  approve a cap that covers it (`bsv allow sell4sats 500000`).
- eBay/Facebook/X adapters are stubs until OAuth credentials exist.
- No fiat checkout; sales settle in BSV to the wallet address.
- AI inference is plain API calls; the x402-paid inference path is wired
  (`bsv x402 pay`) but not used by default.
