function stub(id, label, note) {
  return {
    id,
    label,
    async publish() {
      return { status: "not_configured", detail: note };
    },
  };
}

export const externalChannels = [
  stub("ebay", "eBay", "needs eBay OAuth credentials (SELL4SATS_EBAY_*)"),
  stub("facebook", "Facebook Marketplace", "needs a Meta app + page token (SELL4SATS_FB_*)"),
  stub("x", "X / Twitter", "needs an X API app (SELL4SATS_X_*)"),
];