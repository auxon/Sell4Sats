import { execFile } from "node:child_process";

/**
 * Thin bridge to the bsvOS wallet CLI. Every spend goes through walletd
 * policy (origin "sell4sats"), so the human approves limits once with
 * `bsv allow sell4sats <cap>`; the agent never touches keys.
 */
export function createBsv(opts = {}) {
  const bin = opts.bin ?? process.env.SELL4SATS_BSV_BIN ?? "bsv";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const run = (args) =>
    new Promise((resolve) => {
      execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const text = String(stdout ?? "").trim();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* non-JSON output (errors, help) */
        }
        const error = err ? String(stderr || err.message).trim().slice(0, 300) : json?.error?.message ?? null;
        resolve({ ok: !err && !json?.error, json, text, error });
      });
    });

  return {
    run,
    status: () => run(["status"]),
    utxos: () => run(["utxos"]),
    twetchPost: (text, origin = "sell4sats") => run(["twetch", "post", text, "--origin", origin]),
    x402Pay: (url, extra = []) => run(["x402", "pay", url, ...extra]),
  };
}