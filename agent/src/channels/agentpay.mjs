export function buildAskPayload(listing) {
  return {
    kind: "sell4sats-listing",
    title: listing.title,
    description: listing.description,
    amountSats: listing.priceSats,
    ref: listing.id,
    photoSha256: listing.photoSha256,
    tags: listing.tags,
  };
}

export const agentpayChannel = {
  id: "agentpay",
  label: "BSVBounties / agentpay",
  async publish(listing, ctx) {
    const key = ctx.env.AGENTPAY_KEY;
    if (!key) return { status: "skipped", detail: "set AGENTPAY_KEY (agp_…) to enable" };
    const url = ctx.env.AGENTPAY_LISTING_URL || "https://entangleit.com/api/agentpay/asks";
    const res = await ctx.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(buildAskPayload(listing)),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { status: "failed", detail: `agentpay ${res.status}: ${detail}` };
    }
    const body = await res.json().catch(() => ({}));
    return { status: "published", ref: body?.id ? String(body.id) : undefined, url: body?.url, detail: "ask created" };
  },
};