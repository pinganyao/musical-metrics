/**
 * Keep-alive endpoint for the Supabase project.
 *
 * Supabase pauses Free-plan projects after 7 days without sufficient user
 * database activity. Vercel Cron calls this route on a fixed schedule (see
 * "crons" in vercel.json), and every invocation performs one real query
 * against Postgres via the anon-granted `leaderboard_melody` RPC.
 *
 * That RPC is the same one the public leaderboard pages call, so this counts
 * as ordinary user database activity rather than an internal job.
 *
 * The publishable key below is already public in supabase-auth.js, and the RPC
 * only ever returns public leaderboard rows, so nothing secret lives here.
 */

const SUPABASE_URL = "https://akjqnoftnvnbzycsdipl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_stGW2I7dATan2pWJLFs55g_vIX8b-pZ";

const KEEPALIVE_RPC = `${SUPABASE_URL}/rest/v1/rpc/leaderboard_melody`;
const KEEPALIVE_PAYLOAD = { p_game_key: "melody1", p_limit: 1 };

async function runKeepaliveQuery() {
  const response = await fetch(KEEPALIVE_RPC, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(KEEPALIVE_PAYLOAD),
    cache: "no-store",
  });

  // Drain the body so the request is fully consumed before we report back.
  const body = await response.text();

  return { ok: response.ok, status: response.status, body };
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    const result = await runKeepaliveQuery();

    res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      supabaseStatus: result.status,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      detail: result.ok
        ? "keep-alive database query succeeded"
        : result.body.slice(0, 300),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
