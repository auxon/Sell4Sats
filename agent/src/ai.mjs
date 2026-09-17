/**
 * Listing writer. Uses any OpenAI-compatible chat endpoint when
 * OPENAI_API_KEY is set (vision if the model supports it), and falls back
 * to a deterministic offline heuristic otherwise — the app always works.
 */

const SYSTEM_PROMPT =
  "You write classified marketplace listings from a photo and seller notes. " +
  'Reply with JSON only: {"title": string (<=80 chars), "description": string (2-4 sentences), ' +
  '"priceSats": integer (fair used-goods price in satoshis, 1 BSV = 100,000,000 sats), ' +
  '"tags": string[] (3-6 short tags)}.';

export function heuristicListing(input) {
  const raw = String(input.name || input.notes || "item")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title =
    raw
      .split(" ")
      .slice(0, 8)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ") || "For sale";
  const bytes = Math.max(0, Number(input.bytes) || 0);
  const hint = Math.floor(Number(input.priceHintSats) || 0);
  const priceSats = hint > 0 ? hint : Math.max(1000, Math.min(5_000_000, Math.round((bytes / 100) * 1000)));
  return {
    title,
    description: `${title}. Selling for sats on BSV.`,
    priceSats,
    tags: ["forsale", "bsv", "marketplace"],
  };
}

export function parseListingJson(text, fallback) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).trim());
  } catch {
    const start = String(text).indexOf("{");
    const end = String(text).lastIndexOf("}");
    if (start < 0 || end <= start) return fallback;
    try {
      parsed = JSON.parse(String(text).slice(start, end + 1));
    } catch {
      return fallback;
    }
  }
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 80) : fallback.title;
  const description =
    typeof parsed.description === "string" && parsed.description.trim()
      ? parsed.description.trim().slice(0, 2000)
      : fallback.description;
  const price = Math.floor(Number(parsed.priceSats));
  const priceSats = Number.isFinite(price) && price > 0 ? Math.min(price, 2_100_000_000_000_000) : fallback.priceSats;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().slice(0, 24)).slice(0, 6)
    : fallback.tags;
  return { title, description, priceSats, tags: tags.length ? tags : fallback.tags };
}

export async function writeListing(input, { env = process.env, fetchFn = fetch } = {}) {
  const fallback = heuristicListing(input);
  if (!env.OPENAI_API_KEY) return { ...fallback, provider: "offline" };
  try {
    const model = env.SELL4SATS_MODEL || "gpt-4o-mini";
    const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const content = [
      {
        type: "text",
        text: [
          input.notes ? `Seller notes: ${input.notes}` : "No seller notes.",
          input.priceHintSats ? `Seller's asking price: ${input.priceHintSats} sats.` : "No asking price given; suggest one.",
          `Photo file: ${input.name || "photo"}.`,
        ].join("\n"),
      },
    ];
    if (input.photoBase64) {
      content.push({ type: "image_url", image_url: { url: `data:${input.mime || "image/jpeg"};base64,${input.photoBase64}` } });
    }
    const res = await fetchFn(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ai endpoint ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseListingJson(text, fallback);
    if (input.priceHintSats) parsed.priceSats = input.priceHintSats;
    return { ...parsed, provider: model };
  } catch (e) {
    return { ...fallback, provider: "offline", aiError: e instanceof Error ? e.message : String(e) };
  }
}