(() => {
  const markAuthUiReady = () => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove("mm-auth-pending");
    document.documentElement.classList.add("mm-auth-ready");
  };

  const SUPABASE_URL = "https://akjqnoftnvnbzycsdipl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_stGW2I7dATan2pWJLFs55g_vIX8b-pZ";
  const REMEMBER_ME_KEY = "mm_remember_me";
  const SUPABASE_AUTH_STORAGE_KEY = "sb-akjqnoftnvnbzycsdipl-auth-token";
  const PENDING_SCORES_KEY = "mm_pending_scores_v1";
  const LAST_SIGNED_OUT_SCORE_KEY = "mm_last_signed_out_score_v1";

  const state = {
    client: null,
    session: null,
    profile: null,
    initialized: false,
    initPromise: null,
    statusTimer: null,
    authMenuOutsideListenerBound: false,
    logoutClickDelegationBound: false,
    logoutInFlight: null,
    pendingFlushInFlight: false,
    pendingFlushBound: false,
    activeGameSessions: {}
  };

  const GAME_NAMES = {
    melody1: "Melody I",
    melody2: "Melody II",
    melody3: "Melody III",
    interval1: "Interval I",
    interval2: "Interval II",
    harmony1: "Harmony I",
    harmony2: "Harmony II",
    harmony3: "Harmony III",
    tempo1: "Tempo I",
    tempo2: "Tempo II",
    pitch1: "Pitch I",
    rhythm1: "Rhythm I"
  };
  const GAME_MAX_SCORES = {
    melody1: 1000,
    melody2: 1000,
    melody3: 1000,
    interval1: 10,
    interval2: 10,
    harmony1: 10,
    harmony2: 10,
    harmony3: 10,
    tempo1: 100,
    tempo2: 100,
    pitch1: 100,
    rhythm1: 100
  };

  const loadSupabaseLib = () =>
    new Promise((resolve, reject) => {
      if (window.supabase && typeof window.supabase.createClient === "function") {
        resolve();
        return;
      }

      const existing = document.querySelector('script[data-mm-supabase-lib="true"]');
      if (existing) {
        if (window.supabase && typeof window.supabase.createClient === "function") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Supabase library failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.defer = true;
      script.dataset.mmSupabaseLib = "true";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error("Supabase library failed to load.")), { once: true });
      document.head.appendChild(script);
    });

  const ensureStatusBar = () => {
    let bar = document.getElementById("mm-status-bar");
    if (bar) return bar;

    const container =
      document.querySelector(".main-content") ||
      document.querySelector(".dashboard-main") ||
      document.querySelector(".about-main") ||
      document.body;

    bar = document.createElement("div");
    bar.id = "mm-status-bar";
    bar.style.display = "none";
    bar.style.margin = "10px auto 16px";
    bar.style.maxWidth = "900px";
    bar.style.padding = "10px 14px";
    bar.style.borderRadius = "10px";
    bar.style.fontSize = "14px";
    bar.style.lineHeight = "1.45";
    bar.style.border = "1px solid rgba(255,255,255,0.2)";
    bar.style.background = "rgba(255,255,255,0.06)";
    bar.style.color = "#fff";

    if (container.firstChild) {
      container.insertBefore(bar, container.firstChild);
    } else {
      container.appendChild(bar);
    }

    return bar;
  };

  const showStatus = (message, type = "info") => {
    const inlineStatus = document.getElementById("mm-inline-status");
    const bar = ensureStatusBar();
    const styles = {
      info: {
        background: "rgba(74, 121, 255, 0.18)",
        border: "1px solid rgba(110, 151, 255, 0.55)"
      },
      success: {
        background: "rgba(255, 208, 66, 0.18)",
        border: "1px solid rgba(255, 219, 96, 0.58)"
      },
      error: {
        background: "rgba(74, 121, 255, 0.14)",
        border: "1px solid rgba(255, 208, 66, 0.62)"
      }
    };

    if (inlineStatus) {
      inlineStatus.textContent = message;
      inlineStatus.style.display = "block";
      inlineStatus.style.background = (styles[type] || styles.info).background;
      inlineStatus.style.border = (styles[type] || styles.info).border;
      inlineStatus.style.color = "#fff";
    } else {
      bar.textContent = message;
      bar.style.display = "block";
      bar.style.background = (styles[type] || styles.info).background;
      bar.style.border = (styles[type] || styles.info).border;
    }

    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.statusTimer = window.setTimeout(() => {
      if (inlineStatus) {
        inlineStatus.style.display = "none";
      } else {
        bar.style.display = "none";
      }
    }, 3500);
  };

  const normalizeUsername = (value) => (value || "").trim();

  const isValidUsername = (username) => /^[a-zA-Z0-9_]{3,24}$/.test(username);

  const isRememberMeEnabled = () => {
    const stored = window.localStorage.getItem(REMEMBER_ME_KEY);
    if (stored === null) return true;
    return stored === "true";
  };

  const getPreferredAuthStorage = () =>
    isRememberMeEnabled() ? window.localStorage : window.sessionStorage;

  const setRememberMe = (enabled) => {
    window.localStorage.setItem(REMEMBER_ME_KEY, enabled ? "true" : "false");
  };

  const withTimeout = (promise, timeoutMs, timeoutMessage) =>
    new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error(timeoutMessage || "Request timed out."));
      }, timeoutMs);
      Promise.resolve(promise)
        .then((value) => {
          window.clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((err) => {
          window.clearTimeout(timeoutId);
          reject(err);
        });
    });

  const callRpcWithRetry = async (rpcCallFactory, attempts = 2, timeoutMs = 6000, timeoutMessage = "Request timed out.") => {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await withTimeout(rpcCallFactory(), timeoutMs, timeoutMessage);
        if (!result?.error) {
          return { ok: true, data: result?.data ?? null };
        }
        lastError = result.error;
      } catch (err) {
        lastError = err;
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    return { ok: false, error: lastError };
  };

  const readPendingScores = () => {
    try {
      const raw = window.localStorage.getItem(PENDING_SCORES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  };

  const writePendingScores = (items) => {
    try {
      const next = Array.isArray(items) ? items.slice(-50) : [];
      window.localStorage.setItem(PENDING_SCORES_KEY, JSON.stringify(next));
    } catch (_) {
      /* noop */
    }
  };

  const readLastSignedOutScore = () => {
    try {
      const raw = window.localStorage.getItem(LAST_SIGNED_OUT_SCORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  };

  const writeLastSignedOutScore = (payload) => {
    try {
      if (!payload) {
        window.localStorage.removeItem(LAST_SIGNED_OUT_SCORE_KEY);
        return;
      }
      window.localStorage.setItem(LAST_SIGNED_OUT_SCORE_KEY, JSON.stringify(payload));
    } catch (_) {
      /* noop */
    }
  };

  const queuePendingScore = (payload) => {
    if (!payload || !payload.game_key) return;
    const existing = readPendingScores();
    const fingerprint = [
      payload.game_key,
      String(payload.score),
      String(payload.score_label || ""),
      String(payload.created_at || "")
    ].join("|");
    const next = existing.filter((item) => item?.fingerprint !== fingerprint);
    next.push({ ...payload, fingerprint });
    writePendingScores(next);
  };

  const persistDisplayScore = async (payload, options = {}) => {
    if (!state.client) {
      return { saved: false, error: new Error("Client unavailable.") };
    }
    const rpcResult = await callRpcWithRetry(
      () =>
        state.client.rpc("submit_game_score_display", {
          p_game_key: payload.game_key,
          p_score: payload.score,
          p_score_label: payload.score_label,
          p_country_code: payload.country_code || null
        }),
      3,
      6000,
      "submit_game_score_display timed out."
    );
    if (!rpcResult.ok) {
      return { saved: false, error: rpcResult.error };
    }
    if (!options.silentSuccessToast) {
      showStatus("Score saved.", "success");
    }
    return { saved: true };
  };

  const flushPendingScores = async (options = {}) => {
    if (state.pendingFlushInFlight) return;
    if (!state.client || !state.session?.user) return;
    const queued = readPendingScores();
    if (!queued.length) return;
    state.pendingFlushInFlight = true;
    const failed = [];
    let recovered = 0;
    try {
      for (const payload of queued) {
        const result = await persistDisplayScore(payload, { silentSuccessToast: true });
        if (result.saved) {
          recovered += 1;
        } else {
          failed.push(payload);
        }
      }
      writePendingScores(failed);
      if (recovered > 0 && !options.silent) {
        showStatus(`Recovered ${recovered} pending score${recovered === 1 ? "" : "s"}.`, "success");
      }
    } finally {
      state.pendingFlushInFlight = false;
    }
  };

  const flushLastSignedOutScore = async (options = {}) => {
    if (!state.client || !state.session?.user) return;
    const payload = readLastSignedOutScore();
    if (!payload) return;
    const result = await persistDisplayScore(payload, { silentSuccessToast: true });
    if (!result.saved) return;
    writeLastSignedOutScore(null);
    if (!options.silent) {
      showStatus("Saved your last signed-out result.", "success");
    }
  };

  const bindPendingFlushEvents = () => {
    if (state.pendingFlushBound) return;
    state.pendingFlushBound = true;
    window.addEventListener("online", () => {
      void flushPendingScores({ silent: true });
    });
    window.addEventListener("focus", () => {
      void flushPendingScores({ silent: true });
    });
  };

  const normalizeGameKey = (value) => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    const withoutQuery = trimmed.split("?")[0].split("#")[0];
    const segments = withoutQuery.split("/").filter(Boolean);
    const last = segments.length ? segments[segments.length - 1] : withoutQuery;
    return last.replace(/\.html$/i, "");
  };

  const authDesktopLoggedOutMarkup = () => `
    <a href="/login" id="mm-auth-link" class="mm-nav-login-btn">Log in</a>
  `;

  const authDesktopLoggedInMarkup = (usernameOrEmail) => `
    <div id="mm-auth-dropdown" style="position:relative;display:inline-flex;align-items:center;">
      <button type="button" id="mm-auth-menu-trigger" class="nav-link mm-user-link" aria-label="Account menu" aria-expanded="false" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;line-height:1;border:0;background:none;cursor:pointer;">
        <i data-lucide="user" class="action-icon" style="display:block;"></i>
        <span style="font-size:14px;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${usernameOrEmail}</span>
      </button>
      <div id="mm-auth-menu" style="display:none;position:absolute;top:calc(100% + 10px);right:0;min-width:180px;background:rgba(10,12,20,0.98);border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:8px;z-index:9999;box-shadow:0 14px 36px rgba(0,0,0,0.35);">
        <div style="padding:8px 10px;color:rgba(255,255,255,0.72);font-size:12px;word-break:break-word;">${usernameOrEmail}</div>
        <button type="button" id="mm-auth-profile-button" style="width:100%;text-align:left;border:0;background:none;color:#fff;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;">Profile</button>
        <button type="button" id="mm-auth-settings-button" style="width:100%;text-align:left;border:0;background:none;color:#fff;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;">Settings</button>
        <a href="/signout" id="mm-auth-signout-button" style="display:block;width:100%;text-align:left;border:0;background:none;color:#fff;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;text-decoration:none;">Sign out</a>
      </div>
    </div>
  `;

  const clearStoredAuthTokens = () => {
    const clearFromStorage = (storageObj) => {
      if (!storageObj) return;
      try {
        storageObj.removeItem(SUPABASE_AUTH_STORAGE_KEY);
        const toDelete = [];
        for (let i = 0; i < storageObj.length; i += 1) {
          const key = storageObj.key(i);
          if (!key) continue;
          if (/^sb-.*-auth-token$/.test(key)) {
            toDelete.push(key);
          }
        }
        toDelete.forEach((key) => storageObj.removeItem(key));
      } catch (_) {
        /* noop */
      }
    };
    clearFromStorage(window.localStorage);
    clearFromStorage(window.sessionStorage);
  };

  const performLogout = async (options = {}) => {
    const redirectTo = typeof options.redirectTo === "string" && options.redirectTo ? options.redirectTo : null;
    if (state.logoutInFlight) return state.logoutInFlight;

    state.logoutInFlight = (async () => {
      await init();
      if (state.client) {
        const { error } = await state.client.auth.signOut();
        if (error) {
          showStatus(error.message, "error");
        }
      }

      clearStoredAuthTokens();
      state.session = null;
      state.profile = null;
      ensureAuthNav();
      updateAuthUi();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mm-auth-changed"));
      }

      if (redirectTo) {
        window.location.assign(redirectTo);
      } else {
        window.location.reload();
      }

      return { ok: true };
    })();

    try {
      return await state.logoutInFlight;
    } finally {
      state.logoutInFlight = null;
    }
  };

  const bindLogoutClickDelegation = () => {
    if (state.logoutClickDelegationBound) return;
    state.logoutClickDelegationBound = true;
    document.addEventListener(
      "click",
      async (event) => {
        const t = event.target;
        if (!(t instanceof Element)) return;
        const signOutEl = t.closest(
          "#mm-auth-signout-button, #mm-auth-logout-button-mobile, #dashboard-sign-out"
        );
        if (!signOutEl) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById("mm-auth-menu");
        const trigger = document.getElementById("mm-auth-menu-trigger");
        if (menu) menu.style.display = "none";
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        window.location.assign("/signout");
      },
      true
    );
  };

  /** Label shown next to the avatar; prefers DB profile, then signup metadata, then email. */
  const navDisplayName = () => {
    const email = state.session?.user?.email || null;
    const fromProfile = state.profile?.username || null;
    const metaRaw = normalizeUsername(state.session?.user?.user_metadata?.username || "");
    const fromMeta = isValidUsername(metaRaw) ? metaRaw : null;
    return fromProfile || fromMeta || email || "User";
  };

  const ensureAuthNav = () => {
    const nav = document.querySelector(".nav");
    if (nav && !document.getElementById("mm-auth-slot")) {
      const slot = document.createElement("div");
      slot.id = "mm-auth-slot";
      slot.style.display = "contents";
      nav.appendChild(slot);
    }

    const mobileMenuLinks = document.querySelector(".mobile-menu-links");
    if (mobileMenuLinks && !document.getElementById("mm-auth-slot-mobile")) {
      const slot = document.createElement("div");
      slot.id = "mm-auth-slot-mobile";
      slot.style.display = "contents";
      mobileMenuLinks.appendChild(slot);
    }
  };

  const updateAuthUi = () => {
    const desktopSlot = document.getElementById("mm-auth-slot");
    const mobileSlot = document.getElementById("mm-auth-slot-mobile");
    if (!desktopSlot && !mobileSlot) return;

    const displayName = navDisplayName();

    if (state.session?.user?.email) {
      if (desktopSlot) {
        desktopSlot.innerHTML = authDesktopLoggedInMarkup(displayName);
        const trigger = document.getElementById("mm-auth-menu-trigger");
        const menu = document.getElementById("mm-auth-menu");
        const profileBtn = document.getElementById("mm-auth-profile-button");
        const settingsBtn = document.getElementById("mm-auth-settings-button");

        const closeMenu = () => {
          if (!menu || !trigger) return;
          menu.style.display = "none";
          trigger.setAttribute("aria-expanded", "false");
        };

        trigger?.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!menu || !trigger) return;
          const isOpen = menu.style.display === "block";
          menu.style.display = isOpen ? "none" : "block";
          trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
        });

        profileBtn?.addEventListener("click", () => {
          closeMenu();
          showStatus("Profile page is coming soon.", "info");
        });

        settingsBtn?.addEventListener("click", () => {
          closeMenu();
          showStatus("Settings page is coming soon.", "info");
        });

        if (!state.authMenuOutsideListenerBound) {
          document.addEventListener("click", (event) => {
            const root = document.getElementById("mm-auth-dropdown");
            const menuEl = document.getElementById("mm-auth-menu");
            const triggerEl = document.getElementById("mm-auth-menu-trigger");
            if (!root || !menuEl || !triggerEl) return;
            if (!root.contains(event.target)) {
              menuEl.style.display = "none";
              triggerEl.setAttribute("aria-expanded", "false");
            }
          });
          state.authMenuOutsideListenerBound = true;
        }
      }
      if (mobileSlot) {
        mobileSlot.innerHTML = [
          '<button type="button" id="mm-auth-profile-button-mobile" class="mobile-menu-link" style="border:0;background:none;cursor:pointer;text-align:left;">PROFILE</button>',
          '<button type="button" id="mm-auth-settings-button-mobile" class="mobile-menu-link" style="border:0;background:none;cursor:pointer;text-align:left;">SETTINGS</button>',
          '<a href="/signout" id="mm-auth-logout-button-mobile" class="mobile-menu-link" style="border:0;background:none;cursor:pointer;text-align:left;">SIGN OUT</a>'
        ].join("");
        document.getElementById("mm-auth-profile-button-mobile")?.addEventListener("click", () => {
          showStatus("Profile page is coming soon.", "info");
        });
        document.getElementById("mm-auth-settings-button-mobile")?.addEventListener("click", () => {
          showStatus("Settings page is coming soon.", "info");
        });
      }
      if (window.lucide?.createIcons) window.lucide.createIcons();
      return;
    }

    if (desktopSlot) {
      desktopSlot.innerHTML = authDesktopLoggedOutMarkup();
    }
    if (mobileSlot) {
      mobileSlot.innerHTML = '<a href="/login" class="mobile-menu-link">LOG IN</a>';
    }
    if (window.lucide?.createIcons) window.lucide.createIcons();
  };

  const ensureProfileForSession = async () => {
    if (!state.client || !state.session?.user) {
      state.profile = null;
      return;
    }

    const uid = state.session.user.id;
    if (state.profile && state.profile.user_id !== uid) {
      state.profile = null;
    }

    const { data, error } = await state.client
      .from("profiles")
      .select("user_id, username")
      .eq("user_id", uid)
      .maybeSingle();

    if (error) {
      // TOKEN_REFRESHED and other events refetch often; a transient error must not
      // clear profile or the nav falls back to email until the next successful fetch.
      if (state.profile?.user_id === uid) {
        return;
      }
      showStatus(`Could not load profile: ${error.message}`, "error");
      state.profile = null;
      return;
    }

    if (data) {
      state.profile = data;
      return;
    }

    const fallbackUsername = normalizeUsername(state.session.user.user_metadata?.username || "");
    if (!isValidUsername(fallbackUsername)) {
      state.profile = null;
      return;
    }

    const { data: insertedProfile, error: insertError } = await state.client
      .from("profiles")
      .insert({
        user_id: state.session.user.id,
        username: fallbackUsername
      })
      .select("user_id, username")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        showStatus("Your stored username is no longer available. Please contact support.", "error");
      } else {
        showStatus(`Could not create profile: ${insertError.message}`, "error");
      }
      state.profile = null;
      return;
    }

    state.profile = insertedProfile;
  };

  /** Sets profiles.country_code from Vercel/edge headers when visiting the site (backfill if missing). */
  const syncCountryFromEdge = async () => {
    if (!state.client || !state.session?.user) return;
    try {
      const geoRes = await fetch("/api/geo");
      if (!geoRes.ok) return;
      const geo = await geoRes.json();
      const raw = geo && geo.country;
      if (typeof raw !== "string" || !/^[A-Za-z]{2}$/.test(raw.trim())) return;
      const code = raw.trim().toUpperCase();
      const { error } = await state.client
        .from("profiles")
        .update({ country_code: code })
        .eq("user_id", state.session.user.id);
      if (!error && state.profile) {
        state.profile = { ...state.profile, country_code: code };
      }
      if (!error && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mm-country-synced"));
      }
    } catch (_) {
      /* optional */
    }
  };

  const init = async () => {
    if (state.initialized) return;
    if (state.initPromise) {
      await state.initPromise;
      return;
    }

    state.initPromise = (async () => {
      try {
        await loadSupabaseLib();

        if (!window.supabase || typeof window.supabase.createClient !== "function") {
          showStatus("Supabase SDK is unavailable.", "error");
          ensureAuthNav();
          updateAuthUi();
          return;
        }

        state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storage: getPreferredAuthStorage(),
            // Skip navigator.locks (Web Locks API). Default cross-tab locks can race with
            // concurrent getSession / refresh / onAuthStateChange and emit AbortError:
            // "Lock broken by another request with the 'steal' option." In-tab serialization
            // via gotrue's internal queue is enough for this site.
            lock: async (_name, _acquireTimeout, fn) => fn()
          }
        });
        const sessionResult = await state.client.auth.getSession();
        state.session = sessionResult.data.session;
        await ensureProfileForSession();
        void syncCountryFromEdge();

        ensureAuthNav();
        updateAuthUi();
        bindPendingFlushEvents();
        void flushPendingScores({ silent: true });
        void flushLastSignedOutScore({ silent: true });

        state.client.auth.onAuthStateChange(async (_event, session) => {
          state.session = session;
          await ensureProfileForSession();
          void syncCountryFromEdge();
          ensureAuthNav();
          updateAuthUi();
          if (session?.user) {
            void flushPendingScores({ silent: true });
            void flushLastSignedOutScore({ silent: false });
          }
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("mm-auth-changed"));
          }
        });

        state.initialized = true;
      } catch (_err) {
        ensureAuthNav();
        updateAuthUi();
      } finally {
        markAuthUiReady();
      }
    })();

    try {
      await state.initPromise;
    } finally {
      state.initPromise = null;
    }
  };

  const normalizeLoginFailure = (error) => {
    const raw = (error && error.message) || String(error || "");
    const looksLikeBadCredentials =
      /invalid login credentials/i.test(raw) ||
      /invalid email or password/i.test(raw) ||
      raw.toLowerCase().includes("invalid credentials");
    if (looksLikeBadCredentials) {
      return {
        message: "Invalid email or password",
        fieldErrors: { email: "", password: "" }
      };
    }
    return { message: raw || "Could not sign in.", fieldErrors: {} };
  };

  const normalizeSignUpFailure = (error) => {
    const raw = (error && error.message) || String(error || "");
    const lower = raw.toLowerCase();
    if (
      lower.includes("profiles_username") ||
      lower.includes("profiles_username_key") ||
      (lower.includes("duplicate key") && lower.includes("username")) ||
      (lower.includes("unique constraint") && lower.includes("username"))
    ) {
      return {
        message: "This username is already taken.",
        fieldErrors: { username: "This username is already taken." }
      };
    }
    if (
      lower.includes("already registered") ||
      lower.includes("user already") ||
      lower.includes("email") && lower.includes("already")
    ) {
      return {
        message: "An account with this email already exists.",
        fieldErrors: { email: "An account with this email already exists." }
      };
    }
    return { message: raw || "Signup failed.", fieldErrors: {} };
  };

  const loginWithPassword = async (email, password) => {
    await init();
    if (!state.client) return { ok: false, error: "Client unavailable.", fieldErrors: {} };
    if (!email || !password) {
      const fieldErrors = {};
      if (!email) fieldErrors.email = "Email is required.";
      if (!password) fieldErrors.password = "Password is required.";
      return {
        ok: false,
        error: "Email and password are required.",
        fieldErrors
      };
    }

    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) {
      const normalized = normalizeLoginFailure(error);
      return { ok: false, error: normalized.message, fieldErrors: normalized.fieldErrors };
    }

    if (isRememberMeEnabled()) {
      window.sessionStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    } else {
      window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    }

    return { ok: true };
  };

  const signUpWithUsername = async (email, username, password, confirmPassword) => {
    await init();
    if (!state.client) return { ok: false, error: "Client unavailable.", fieldErrors: {} };

    const fieldErrors = {};
    if (!email) fieldErrors.email = "Email is required.";
    if (!username) fieldErrors.username = "Username is required.";
    if (!password) fieldErrors.password = "Password is required.";
    if (!confirmPassword) fieldErrors.confirmPassword = "Please confirm your password.";
    if (Object.keys(fieldErrors).length) {
      return { ok: false, error: "Please fill in all fields.", fieldErrors };
    }

    if (password !== confirmPassword) {
      return {
        ok: false,
        error: "Passwords do not match.",
        fieldErrors: {
          password: "",
          confirmPassword: "Passwords do not match."
        }
      };
    }

    if (!isValidUsername(username)) {
      return {
        ok: false,
        error: "Username must be 3-24 characters (letters, numbers, underscore).",
        fieldErrors: {
          username: "Use 3–24 characters: letters, numbers, and underscores only."
        }
      };
    }

    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });

    if (error) {
      const normalized = normalizeSignUpFailure(error);
      const merged = { ...normalized.fieldErrors };
      if (!Object.keys(merged).length && normalized.message) {
        return { ok: false, error: normalized.message, fieldErrors: {} };
      }
      return { ok: false, error: normalized.message, fieldErrors: merged };
    }

    if (data.user?.identities && data.user.identities.length === 0) {
      const message = "An account with this email already exists. Try logging in.";
      return {
        ok: false,
        error: message,
        fieldErrors: { email: message }
      };
    }

    return { ok: true };
  };

  const reportScore = async (gameKey, scoreValue, scoreLabel, extras = {}) => {
    await init();
    if (!state.client) return { saved: false, reason: "client_unavailable" };

    const numericScore = Number(scoreValue);
    if (!Number.isFinite(numericScore)) {
      return { saved: false, reason: "invalid_score" };
    }

    const normalizedGameKey = normalizeGameKey(gameKey);
    if (!normalizedGameKey) {
      return { saved: false, reason: "invalid_game_key" };
    }
    const maxScore = GAME_MAX_SCORES[normalizedGameKey];
    if (!Number.isFinite(maxScore)) {
      return { saved: false, reason: "invalid_game_key" };
    }
    if (numericScore < 0 || numericScore > maxScore) {
      showStatus(`Score out of range for ${GAME_NAMES[normalizedGameKey] || normalizedGameKey}.`, "error");
      return { saved: false, reason: "invalid_score_range" };
    }
    if (!state.session?.user) {
      writeLastSignedOutScore({
        game_key: normalizedGameKey,
        score: numericScore,
        score_label: scoreLabel || String(scoreValue),
        country_code: null,
        created_at: new Date().toISOString()
      });
      showStatus("Log in to save your score. Your last result was stored for later.", "info");
      return { saved: false, reason: "not_authenticated", storedForLater: true };
    }

    let countryCode = null;
    try {
      const geoRes = await withTimeout(fetch("/api/geo"), 3000, "Geo lookup timed out.");
      if (geoRes.ok) {
        const geo = await geoRes.json();
        const c = geo && geo.country;
        if (typeof c === "string" && /^[A-Za-z]{2}$/.test(c.trim())) {
          countryCode = c.trim().toUpperCase();
        }
      }
    } catch (_) {
      /* geo optional */
    }

    const fallbackSave = async () => {
      const fallbackResult = await persistDisplayScore({
        game_key: normalizedGameKey,
        score: numericScore,
        score_label: scoreLabel || String(scoreValue),
        country_code: countryCode,
        created_at: new Date().toISOString()
      });
      if (!fallbackResult.saved) {
        return { saved: false, error: fallbackResult.error };
      }
      return { saved: true, method: "display_fallback" };
    };

    const gameSession = state.activeGameSessions[normalizedGameKey];
    if (!gameSession?.id) {
      const fallback = await fallbackSave();
      if (fallback.saved) {
        return fallback;
      }
      showStatus(`Score save failed: ${fallback.error.message}`, "error");
      return { saved: false, reason: "missing_game_session", error: fallback.error };
    }

    const durationSeconds = Math.max(
      0,
      Math.floor((Date.now() - gameSession.startedAtMs) / 1000)
    );

    const rpcArgs = {
      p_session_id: gameSession.id,
      p_score: numericScore,
      p_score_label: scoreLabel || String(scoreValue),
      p_duration_seconds: durationSeconds,
      p_country_code: countryCode
    };
    if (Array.isArray(extras.verifyTranscript)) {
      rpcArgs.p_verify_transcript = extras.verifyTranscript;
    }
    if (
      ["melody1", "melody2", "melody3"].includes(normalizedGameKey) &&
      Array.isArray(extras.melodyTranscript)
    ) {
      rpcArgs.p_melody_transcript = extras.melodyTranscript;
    }

    const verifiedResult = await callRpcWithRetry(
      () => state.client.rpc("submit_game_score", rpcArgs),
      2,
      6000,
      "submit_game_score timed out."
    );
    if (!verifiedResult.ok) {
      const fallback = await fallbackSave();
      delete state.activeGameSessions[normalizedGameKey];
      if (fallback.saved) {
        return { saved: true, method: "verified_fallback", primaryError: verifiedResult.error };
      }
      queuePendingScore({
        game_key: normalizedGameKey,
        score: numericScore,
        score_label: scoreLabel || String(scoreValue),
        country_code: countryCode,
        created_at: new Date().toISOString()
      });
      showStatus("Score queued locally. Will retry automatically.", "info");
      return { saved: true, queued: true, reason: "queued_pending_save", error: verifiedResult.error };
    }

    delete state.activeGameSessions[normalizedGameKey];
    showStatus("Score saved.", "success");
    return { saved: true };
  };

  const startGameSession = async (gameKey) => {
    await init();
    if (!state.client || !state.session?.user) {
      return { ok: false, reason: "not_authenticated" };
    }
    const normalizedGameKey = normalizeGameKey(gameKey);
    if (!normalizedGameKey) {
      return { ok: false, reason: "invalid_game_key" };
    }

    let data;
    let error;
    try {
      const result = await withTimeout(
        state.client.rpc("create_game_session", {
          p_game_key: normalizedGameKey
        }),
        6000,
        "create_game_session timed out."
      );
      data = result.data;
      error = result.error;
    } catch (err) {
      error = err;
    }

    if (error || !data) {
      showStatus(`Could not start secure game session: ${error?.message || "Unknown error"}`, "error");
      return { ok: false, reason: "rpc_failed", error };
    }

    let seed = null;
    const { data: sessionRow, error: sessionFetchError } = await state.client
      .from("game_sessions")
      .select("challenge_seed")
      .eq("id", data)
      .maybeSingle();

    if (!sessionFetchError && sessionRow && sessionRow.challenge_seed != null) {
      const raw = sessionRow.challenge_seed;
      seed = typeof raw === "bigint" ? raw.toString() : raw;
    }

    state.activeGameSessions[normalizedGameKey] = {
      id: data,
      startedAtMs: Date.now(),
      seed
    };

    return { ok: true, seed };
  };

  const peekGameSession = (gameKey) => {
    const k = normalizeGameKey(gameKey);
    const s = state.activeGameSessions[k];
    if (!s?.id) return null;
    return { sessionId: s.id, seed: s.seed ?? null, startedAtMs: s.startedAtMs };
  };

  const aggregateScoresByGame = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = row.game_key;
      const score = Number(row.score);
      if (!Number.isFinite(score)) continue;
      let agg = map.get(key);
      if (!agg) {
        agg = { scores: [], lastPlayedAt: null, lastMs: 0 };
        map.set(key, agg);
      }
      agg.scores.push(score);
      if (row.created_at) {
        const t = new Date(row.created_at).getTime();
        if (!Number.isNaN(t) && t >= agg.lastMs) {
          agg.lastMs = t;
          agg.lastPlayedAt = row.created_at;
        }
      }
    }
    const out = [];
    for (const [game_key, agg] of map) {
      const scores = agg.scores;
      const high_score = Math.max(...scores);
      const avg_score = scores.reduce((a, b) => a + b, 0) / scores.length;
      out.push({
        game_key,
        high_score,
        avg_score,
        attempts: scores.length,
        last_played_at: agg.lastPlayedAt
      });
    }
    out.sort((a, b) => a.game_key.localeCompare(b.game_key));
    return out;
  };

  const fetchMyHighScores = async () => {
    await init();
    if (!state.client || !state.session?.user) return [];
    const { data, error } = await state.client
      .from("game_scores")
      .select("game_key, score, created_at");
    if (error) {
      showStatus(`Could not load high scores: ${error.message}`, "error");
      return [];
    }
    return aggregateScoresByGame(data || []);
  };

  const fetchHighScoreForGame = async (gameKey) => {
    await init();
    if (!state.client || !state.session?.user) return null;
    const key = normalizeGameKey(gameKey);
    const { data, error } = await state.client
      .from("game_scores")
      .select("score, created_at")
      .eq("game_key", key);
    if (error) {
      showStatus(`Could not load high score: ${error.message}`, "error");
      return null;
    }
    if (!data?.length) return null;
    const scores = [];
    let lastPlayedAt = null;
    let lastMs = 0;
    for (const row of data) {
      const score = Number(row.score);
      if (Number.isFinite(score)) scores.push(score);
      if (row.created_at) {
        const t = new Date(row.created_at).getTime();
        if (!Number.isNaN(t) && t >= lastMs) {
          lastMs = t;
          lastPlayedAt = row.created_at;
        }
      }
    }
    if (!scores.length) return null;
    return {
      game_key: key,
      high_score: Math.max(...scores),
      avg_score: scores.reduce((a, b) => a + b, 0) / scores.length,
      attempts: scores.length,
      last_played_at: lastPlayedAt
    };
  };

  const fetchTotalCompletedTests = async () => {
    await init();
    if (!state.client || !state.session?.user) return 0;
    const { count, error } = await state.client
      .from("game_scores")
      .select("id", { count: "exact", head: true });
    if (error) {
      showStatus(`Could not load stats: ${error.message}`, "error");
      return 0;
    }
    return count ?? 0;
  };

  const fetchRecentGameScores = async (limit = 20) => {
    await init();
    if (!state.client || !state.session?.user) return [];
    const cap = Math.min(Math.max(1, Number(limit) || 20), 50);
    const { data, error } = await state.client
      .from("game_scores")
      .select("game_key, score, score_label, created_at")
      .order("created_at", { ascending: false })
      .limit(cap);
    if (error) {
      showStatus(`Could not load recent attempts: ${error.message}`, "error");
      return [];
    }
    return data || [];
  };

  window.MMAuth = {
    init,
    reportScore,
    fetchMyHighScores,
    fetchHighScoreForGame,
    fetchTotalCompletedTests,
    fetchRecentGameScores,
    startGameSession,
    peekGameSession,
    loginWithPassword,
    signUpWithUsername,
    signOutAndReload: performLogout,
    gameNameForKey: (key) => GAME_NAMES[normalizeGameKey(key)] || normalizeGameKey(key) || key,
    gameKeyFromPath: () => normalizeGameKey(window.location.pathname),
    getSession: () => state.session,
    getProfile: () => state.profile,
    showStatus,
    setRememberMe,
    isRememberMeEnabled,
    retryPendingScores: () => flushPendingScores({ silent: false }),
    pendingScoresCount: () => readPendingScores().length
  };

  ensureAuthNav();
  bindLogoutClickDelegation();
  init();
})();
