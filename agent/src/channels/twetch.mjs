export function buildPostText(listing) {
  const lines = [
    listing.title,
    "",
    listing.description,
    "",
    `Price: ${listing.priceSats} sats`,
    `Photo sha256: ${listing.photoSha256}`,
    `Ref: ${listing.id}`,
  ];
  let text = lines.join("\n");
  while (Buffer.byteLength(text, "utf8") > 1900 && text.length > 0) text = text.slice(0, -1);
  return text;
}

export const twetchChannel = {
  id: "twetch",
  label: "Twetch post (on-chain)",
  async publish(listing, ctx) {
    const res = await ctx.bsv.twetchPost(buildPostText(listing), "sell4sats", ctx.photoPath ?? undefined);
    const txid = res.json?.txid;
    if (!res.ok || typeof txid !== "string") {
      return { status: "failed", detail: res.error || res.text?.slice(0, 200) || "no txid" };
    }
    return {
      status: "published",
      ref: txid,
      url: `https://twetch.com/t/${txid}`,
      detail: res.json?.submitted ? "indexed by Twetch" : res.json?.submitDetail || "on-chain",
    };
  },
};