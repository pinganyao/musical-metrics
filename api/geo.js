/**
 * Returns ISO 3166-1 alpha-2 country from hosting edge headers (e.g. Vercel, Cloudflare).
 * Used when saving scores so leaderboard rows can show a flag emoji per player.
 */
export default function handler(req, res) {
  const raw =
    req.headers["x-vercel-ip-country"] ||
    req.headers["cf-ipcountry"] ||
    "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const country =
    trimmed.length === 2 && /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : null;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.status(200).json({ country });
}
