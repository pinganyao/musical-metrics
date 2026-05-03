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

  const state = {
    client: null,
    session: null,
    profile: null,
    initialized: false,
    initPromise: null,
    statusTimer: null,
    authMenuOutsideListenerBound: false,
    logoutClickDelegationBound: false,
    activeGameSessions: {}
  };

  const ACTIVE_SESSIONS_KEY = "mm_active_sessions_v1";
  const PENDING_SCORES_KEY = "mm_pending_score_submits_v1";

  const persistActiveSessions = () => {
    try {
      sessionStorage.setItem(ACTIVE_SESSIONS_KEY, JSON.stringify(state.activeGameSessions));
    } catch (_) {}
  };

  /** Recover session ids after reload / memory loss so submit_game_score can still run. */
  const hydrateActiveSessions = () => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== "object" || !v.id) continue;
        const cur = state.activeGameSessions[k];
        if (!cur?.id) {
          state.activeGameSessions[k] = {
            id: v.id,
            startedAtMs: typeof v.startedAtMs === "number" ? v.startedAtMs : Date.now(),
            seed: v.seed ?? null
          };
        }
      }
    } catch (_) {}
  };

  const clearScorePersistence = () => {
    try {
      sessionStorage.removeItem(ACTIVE_SESSIONS_KEY);
      localStorage.removeItem(PENDING_SCORES_KEY);
    } catch (_) {}
    state.activeGameSessions = {};
  };

  const rpcErrorRetryable = (error) => {
    const msg = ((error && error.message) || "").toLowerCase();
    if (!msg) return true;
    if (
      /invalid transcript|session not found|already used|expired|authentication required|too quickly|does not exist|could not find the function|unknown api/i.test(
        msg
      )
    )
      return false;
    if (/network|fetch|timeout|failed to fetch|502|503|504|429/i.test(msg)) return true;
    return true;
  };

  const enqueuePendingScoreSubmit = (gameKey, entry) => {
    try {
      const raw = localStorage.getItem(PENDING_SCORES_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(queue)) return;
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `ps_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const kind = entry && entry.kind === "display" ? "display" : "verified";
      queue.push({
        id,
        gameKey,
        createdAt: Date.now(),
        attempts: 0,
        kind,
        rpc: entry && entry.rpc ? entry.rpc : null,
        display: entry && entry.display ? entry.display : null
      });
      localStorage.setItem(PENDING_SCORES_KEY, JSON.stringify(queue));
    } catch (_) {}
  };

  const flushPendingScoreSubmits = async () => {
    await init();
    hydrateActiveSessions();
    if (!state.client || !state.session?.user) return;
    let raw;
    try {
      raw = localStorage.getItem(PENDING_SCORES_KEY);
    } catch (_) {
      return;
    }
    if (!raw) return;
    let queue;
    try {
      queue = JSON.parse(raw);
    } catch (_) {
      localStorage.removeItem(PENDING_SCORES_KEY);
      return;
    }
    if (!Array.isArray(queue) || !queue.length) return;

    const kept = [];
    let savedAny = false;
    for (const item of queue) {
      if (!item) continue;
      let error = null;
      if (item.kind === "display" && item.display) {
        const res = await state.client.rpc("submit_game_score_display", item.display);
        error = res.error;
      } else if (item.rpc) {
        const res = await state.client.rpc("submit_game_score", item.rpc);
        error = res.error;
      } else {
        continue;
      }
      if (!error) {
        savedAny = true;
        const gk = item.gameKey;
        if (gk && state.activeGameSessions[gk]) {
          delete state.activeGameSessions[gk];
          persistActiveSessions();
        }
        continue;
      }
      const msg = ((error && error.message) || "").toLowerCase();
      if (
        item.kind === "display" &&
        /authentication required|invalid score|invalid game key/i.test(msg)
      ) {
        continue;
      }
      if (
        item.kind !== "display" &&
        /session not found|expired|already used|invalid transcript|authentication required/i.test(msg)
      ) {
        continue;
      }
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 80) kept.push(item);
    }
    try {
      if (kept.length) localStorage.setItem(PENDING_SCORES_KEY, JSON.stringify(kept));
      else localStorage.removeItem(PENDING_SCORES_KEY);
    } catch (_) {}
    if (savedAny) {
      showStatus("Score saved.", "success");
    }
  };

  let persistenceHooksBound = false;
  const bindScorePersistenceHooks = () => {
    if (persistenceHooksBound || typeof window === "undefined") return;
    persistenceHooksBound = true;
    const onReconnect = () => {
      dismissTransientConnectionStatus();
      void flushPendingScoreSubmits();
      try {
        window.dispatchEvent(new CustomEvent("mm-try-score-sync"));
      } catch (_) {}
    };
    window.addEventListener("online", onReconnect);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onReconnect();
      });
    }
    window.setInterval(() => void flushPendingScoreSubmits(), 45000);
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

  const loadSupabaseLib = () =>
    new Promise((resolve, reject) => {
      if (window.supabase && typeof window.supabase.createClient === "function") {
        resolve();
        return;
      }

      const existing = document.querySelector('script[data-mm-supabase-lib="true"]');
      if (existing) {
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

  /** Clears connection-delay toasts that otherwise linger after Wi‑Fi returns (timer auto-hide is unreliable when tabs throttle timeouts). */
  const dismissTransientConnectionStatus = () => {
    const inlineStatus = document.getElementById("mm-inline-status");
    const bar = document.getElementById("mm-status-bar");
    const inlineVisible = inlineStatus && inlineStatus.style.display !== "none";
    const barVisible = bar && bar.style.display !== "none";
    const text = (
      (inlineVisible && inlineStatus.textContent) ||
      (barVisible && bar.textContent) ||
      ""
    ).trim();
    if (!text) return;
    if (!/^(Still connecting|Waiting for network)/i.test(text)) return;
    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.statusTimer = null;
    if (inlineStatus) inlineStatus.style.display = "none";
    if (bar) bar.style.display = "none";
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
        <button type="button" id="mm-auth-signout-button" style="width:100%;text-align:left;border:0;background:none;color:#fff;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;">Sign out</button>
      </div>
    </div>
  `;

  const performLogout = async () => {
    await init();
    clearScorePersistence();
    if (!state.client) {
      window.location.reload();
      return;
    }
    const { error } = await state.client.auth.signOut();
    if (error) {
      showStatus(error.message, "error");
      return;
    }
    window.location.reload();
  };

  const bindLogoutClickDelegation = () => {
    if (state.logoutClickDelegationBound) return;
    state.logoutClickDelegationBound = true;
    document.addEventListener(
      "click",
      async (event) => {
        const t = event.target;
        if (!(t instanceof Element)) return;
        const signOutEl = t.closest("#mm-auth-signout-button, #mm-auth-logout-button-mobile");
        if (!signOutEl) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = document.getElementById("mm-auth-menu");
        const trigger = document.getElementById("mm-auth-menu-trigger");
        if (menu) menu.style.display = "none";
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        await performLogout();
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
          '<button type="button" id="mm-auth-logout-button-mobile" class="mobile-menu-link" style="border:0;background:none;cursor:pointer;text-align:left;">SIGN OUT</button>'
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

        state.client.auth.onAuthStateChange(async (_event, session) => {
          state.session = session;
          await ensureProfileForSession();
          void syncCountryFromEdge();
          ensureAuthNav();
          updateAuthUi();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("mm-auth-changed"));
          }
        });

        state.initialized = true;
        hydrateActiveSessions();
        bindScorePersistenceHooks();
        void flushPendingScoreSubmits();
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

  /** Verified session create + score-submit RPC deadline (display fallback shares submit cap). */
  const RPC_CREATE_SESSION_TIMEOUT_MS = 30000;
  const SUBMIT_SCORE_RPC_MS = 28000;

  const reportScore = async (gameKey, scoreValue, scoreLabel, extras = {}) => {
    await init();
    hydrateActiveSessions();

    if (!state.client) {
      showStatus("Score not saved: app did not finish loading. Refresh and try again.", "error");
      return { saved: false, reason: "client_unavailable" };
    }

    try {
      const refreshed = await state.client.auth.getSession();
      if (refreshed?.data?.session) state.session = refreshed.data.session;
    } catch (_) {}

    try {
      await state.client.auth.refreshSession();
    } catch (_) {}

    if (!state.session?.user) {
      showStatus("Log in to save your score.", "info");
      return { saved: false, reason: "not_authenticated" };
    }

    const numericScore = Number(scoreValue);
    if (!Number.isFinite(numericScore)) {
      showStatus("Score not saved: could not read the score from the page.", "error");
      return { saved: false, reason: "invalid_score" };
    }

    const normalizedGameKey = normalizeGameKey(gameKey);
    if (!normalizedGameKey) {
      showStatus("Score not saved: unknown game. Refresh and try again.", "error");
      return { saved: false, reason: "invalid_game_key" };
    }

    hydrateActiveSessions();
    let gameSession = state.activeGameSessions[normalizedGameKey];
    if (!gameSession?.id) {
      hydrateActiveSessions();
      gameSession = state.activeGameSessions[normalizedGameKey];
    }

    let durationSeconds = 1;
    if (gameSession?.startedAtMs != null && Number.isFinite(gameSession.startedAtMs)) {
      durationSeconds = Math.floor((Date.now() - gameSession.startedAtMs) / 1000);
      if (!Number.isFinite(durationSeconds)) durationSeconds = 1;
      durationSeconds = Math.min(7200, Math.max(1, durationSeconds));
    }

    let countryCode = null;
    try {
      const geoRes = await fetch("/api/geo");
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

    const displayPayload = {
      p_game_key: normalizedGameKey,
      p_score: numericScore,
      p_score_label: scoreLabel || String(scoreValue),
      p_country_code: countryCode
    };

    const submitDisplayOnce = () =>
      Promise.race([
        state.client.rpc("submit_game_score_display", displayPayload),
        new Promise((resolve) =>
          window.setTimeout(
            () => resolve({ error: { message: "Score submit timed out." } }),
            SUBMIT_SCORE_RPC_MS
          )
        )
      ]);

    showStatus("Saving score…", "info");

    let lastError = null;

    if (gameSession?.id) {
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

      for (let attempt = 0; attempt < 20; attempt++) {
        if (attempt > 0) {
          const delayMs = Math.min(400 + attempt * 280, 6500);
          await new Promise((r) => setTimeout(r, delayMs));
        }

        const { error } = await Promise.race([
          state.client.rpc("submit_game_score", rpcArgs),
          new Promise((resolve) =>
            window.setTimeout(
              () => resolve({ error: { message: "Score submit timed out." } }),
              SUBMIT_SCORE_RPC_MS
            )
          )
        ]);

        if (!error) {
          delete state.activeGameSessions[normalizedGameKey];
          persistActiveSessions();
          showStatus("Score saved.", "success");
          void flushPendingScoreSubmits();
          return { saved: true };
        }

        lastError = error;
        if (!rpcErrorRetryable(error)) {
          break;
        }
      }
    }

    for (let attempt = 0; attempt < 15; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(350 + attempt * 240, 5000);
        await new Promise((r) => setTimeout(r, delayMs));
      }

      const { error } = await submitDisplayOnce();

      if (!error) {
        delete state.activeGameSessions[normalizedGameKey];
        persistActiveSessions();
        showStatus("Score saved.", "success");
        void flushPendingScoreSubmits();
        return { saved: true, viaDisplayFallback: true };
      }

      lastError = error;
      if (!rpcErrorRetryable(error)) {
        enqueuePendingScoreSubmit(normalizedGameKey, { kind: "display", display: displayPayload });
        showStatus(`Score save failed: ${error.message}`, "error");
        void flushPendingScoreSubmits();
        return { saved: false, reason: "display_failed", error };
      }
    }

    enqueuePendingScoreSubmit(normalizedGameKey, { kind: "display", display: displayPayload });
    showStatus(
      "Connection was unstable. Your score is saved on this device and will upload automatically — stay online or reopen this site.",
      "info"
    );
    void flushPendingScoreSubmits();
    return { saved: true, queued: true, error: lastError };
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

    const { data, error } = await state.client.rpc("create_game_session", {
      p_game_key: normalizedGameKey
    });

    if (error || !data) {
      showStatus(`Could not start secure game session: ${error?.message || "Unknown error"}`, "error");
      return { ok: false, reason: "rpc_failed", error };
    }

    let seed = null;
    for (let fetchAttempt = 0; fetchAttempt < 6; fetchAttempt++) {
      const { data: sessionRow, error: sessionFetchError } = await state.client
        .from("game_sessions")
        .select("challenge_seed")
        .eq("id", data)
        .maybeSingle();

      if (!sessionFetchError && sessionRow && sessionRow.challenge_seed != null) {
        const raw = sessionRow.challenge_seed;
        seed = typeof raw === "bigint" ? raw.toString() : raw;
        break;
      }
      await new Promise((r) => setTimeout(r, 60 + fetchAttempt * 90));
    }

    state.activeGameSessions[normalizedGameKey] = {
      id: data,
      startedAtMs: Date.now(),
      seed
    };
    persistActiveSessions();

    return { ok: true, seed };
  };

  /** Supabase fetch has no built-in deadline; a stalled TCP leave awaits hanging forever and blocks Continue. */
  const startGameSessionWithTimeout = (gameKey) => {
    const main = startGameSession(gameKey).then(
      (r) => r,
      (err) => ({ ok: false, reason: "rpc_threw", error: err })
    );
    const timeout = new Promise((resolve) =>
      window.setTimeout(
        () => resolve({ ok: false, reason: "rpc_timeout" }),
        RPC_CREATE_SESSION_TIMEOUT_MS
      )
    );
    return Promise.race([main, timeout]);
  };

  /** Wait until the browser reports connectivity (e.g. user turns Wi-Fi on after loading offline). */
  const waitForOnline = (timeoutMs) =>
    new Promise((resolve) => {
      if (typeof navigator === "undefined" || navigator.onLine) {
        resolve();
        return;
      }
      const onDone = () => {
        clearTimeout(timer);
        window.removeEventListener("online", onOnline);
        resolve();
      };
      const onOnline = () => onDone();
      const timer = window.setTimeout(onDone, timeoutMs);
      window.addEventListener("online", onOnline, { once: true });
    });

  /**
   * Run before verified gameplay so challenge_seed matches the server.
   * Lives here (not only game-rules.js) so it exists as soon as supabase-auth loads — Continue must not await heavy AudioEngine.init first.
   */
  const beginVerifiedSession = async (gameKey) => {
    await init();
    let slowHintTimer = null;
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        showStatus("Waiting for network…", "info");
      }

      slowHintTimer = window.setTimeout(() => {
        showStatus("Still connecting…", "info");
      }, 2500);

      let sessionResult = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 350 * attempt));
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            await waitForOnline(8000);
          }
        } else if (typeof navigator !== "undefined" && !navigator.onLine) {
          await waitForOnline(6000);
        }

        sessionResult = await startGameSessionWithTimeout(gameKey);
        if (sessionResult?.ok) break;
        if (sessionResult?.reason === "not_authenticated") break;
        if (sessionResult?.reason === "rpc_timeout") {
          showStatus(
            "Session setup timed out. Check your connection and tap Continue again.",
            "error"
          );
          break;
        }
      }

      if (sessionResult?.ok && sessionResult.seed != null) {
        const s = sessionResult.seed;
        window.mmChallengeSeed = typeof s === "bigint" ? s.toString() : s;
      }
    } finally {
      if (slowHintTimer) clearTimeout(slowHintTimer);
      dismissTransientConnectionStatus();
    }
    window.mmVerifyTranscript = [];
  };

  window.mmBeginVerifiedSession = beginVerifiedSession;

  /**
   * Call after mmBeginVerifiedSession on Continue. Guests may play without a session; logged-in users
   * must have a session row + challenge_seed or gameplay uses random data while the DB expects a fixed seed — saves fail.
   */
  const ensureVerifiedPlayReady = async (gameKey) => {
    await init();
    hydrateActiveSessions();
    if (!state.session?.user) return true;

    const k = normalizeGameKey(gameKey);
    if (!k) return false;

    let entry = state.activeGameSessions[k];
    if (entry?.id && entry.seed != null && entry.seed !== "") return true;

    const hydrateSeedForEntry = async (candidate) => {
      if (!candidate?.id || !state.client) return false;
      const { data: row, error: rowErr } = await state.client
        .from("game_sessions")
        .select("challenge_seed")
        .eq("id", candidate.id)
        .maybeSingle();
      if (rowErr || !row || row.challenge_seed == null) return false;
      const raw = row.challenge_seed;
      const seedStr = typeof raw === "bigint" ? raw.toString() : raw;
      state.activeGameSessions[k] = {
        id: candidate.id,
        startedAtMs: typeof candidate.startedAtMs === "number" ? candidate.startedAtMs : Date.now(),
        seed: seedStr
      };
      persistActiveSessions();
      window.mmChallengeSeed = seedStr;
      return true;
    };

    if (await hydrateSeedForEntry(entry)) return true;

    // A timed-out beginVerifiedSession can leave Continue blocked even though a retry would succeed.
    // Self-heal by recreating/refreshing the secure session in-place.
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = await startGameSessionWithTimeout(k);
      if (!retry?.ok) {
        if (retry?.reason === "not_authenticated") break;
        continue;
      }
      const retryEntry = state.activeGameSessions[k];
      if (retry.seed != null && retry.seed !== "") {
        const s = typeof retry.seed === "bigint" ? retry.seed.toString() : retry.seed;
        window.mmChallengeSeed = s;
        return true;
      }
      if (await hydrateSeedForEntry(retryEntry)) {
        return true;
      }
    }

    showStatus(
      "Could not start a verified round (missing session or challenge seed). Stay online and tap Continue again.",
      "error"
    );
    return false;
  };

  window.mmEnsureVerifiedPlayReady = ensureVerifiedPlayReady;

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
    beginVerifiedSession,
    ensureVerifiedPlayReady,
    peekGameSession,
    loginWithPassword,
    signUpWithUsername,
    signOutAndReload: performLogout,
    gameNameForKey: (key) => GAME_NAMES[normalizeGameKey(key)] || normalizeGameKey(key) || key,
    gameKeyFromPath: () => normalizeGameKey(window.location.pathname),
    getSession: () => state.session,
    getProfile: () => state.profile,
    showStatus,
    dismissConnectionHints: dismissTransientConnectionStatus,
    setRememberMe,
    isRememberMeEnabled
  };

  ensureAuthNav();
  bindLogoutClickDelegation();
  init();
})();
