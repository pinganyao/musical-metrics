/**
 * Deterministic RNG matching Postgres public.mm_sha256_byte(seed, tag).
 * Used for server-verified game sessions (challenge_seed per session).
 */
(() => {
  const enc = new TextEncoder();

  async function sha256Byte(seed, tag) {
    const msg = `${String(seed)}:${String(tag)}`;
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(msg));
    return new Uint8Array(buf)[0];
  }

  async function rngMod(seed, tag, mod) {
    return (await sha256Byte(seed, tag)) % mod;
  }

  /** Uniform integer in [min, max] inclusive — matches SQL: min + (byte % (max-min+1)) for small ranges */
  async function rngRange(seed, tag, min, max) {
    const span = max - min + 1;
    return min + (await rngMod(seed, tag, span));
  }

  /** Bernoulli p=0.5 — matches SQL: (byte & 1) = 0 */
  async function rngBool(seed, tag) {
    return (await sha256Byte(seed, tag)) % 2 === 0;
  }

  window.MMVerifiedRng = { sha256Byte, rngMod, rngRange, rngBool };
})();
