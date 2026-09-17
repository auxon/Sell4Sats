import { twetchChannel } from "./twetch.mjs";
import { webhookChannel } from "./webhook.mjs";
import { agentpayChannel } from "./agentpay.mjs";
import { externalChannels } from "./external.mjs";

export const CHANNELS = [twetchChannel, webhookChannel, agentpayChannel, ...externalChannels];

export const DEFAULT_CHANNELS = ["twetch", "webhook", "agentpay"];

export function channelById(id) {
  return CHANNELS.find((c) => c.id === id) ?? null;
}

export function channelCatalogue() {
  return CHANNELS.map((c) => ({ id: c.id, label: c.label }));
}

/** Publish to the requested channels; never throws — per-channel results. */
export async function publishToChannels(listing, ids, ctx) {
  const results = {};
  for (const id of ids) {
    const channel = channelById(id);
    if (!channel) {
      results[id] = { status: "unknown_channel", detail: `no channel named ${id}` };
      continue;
    }
    try {
      results[id] = await channel.publish(listing, ctx);
    } catch (e) {
      results[id] = { status: "failed", detail: e instanceof Error ? e.message : String(e) };
    }
  }
  return results;
}