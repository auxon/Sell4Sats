export function buildWebhookPayload(listing, photoBase64) {
  return {
    source: "sell4sats",
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      priceSats: listing.priceSats,
      tags: listing.tags,
      photoSha256: listing.photoSha256,
      photoMime: listing.photoMime,
      createdAtMs: listing.createdAtMs,
    },
    photoBase64: photoBase64 ?? null,
  };
}

export const webhookChannel = {
  id: "webhook",
  label: "Webhook / x402 channel",
  async publish(listing, ctx) {
    const url = ctx.env.SELL4SATS_WEBHOOK_URL;
    if (!url) return { status: "skipped", detail: "set SELL4SATS_WEBHOOK_URL to enable" };
    const res = await ctx.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ctx.env.SELL4SATS_WEBHOOK_TOKEN ? { authorization: `Bearer ${ctx.env.SELL4SATS_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(buildWebhookPayload(listing, ctx.photoBase64)),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { status: "failed", detail: `webhook ${res.status}: ${detail}` };
    }
    const body = await res.json().catch(() => ({}));
    return { status: "published", url: typeof body?.url === "string" ? body.url : undefined, detail: "posted to webhook" };
  },
};