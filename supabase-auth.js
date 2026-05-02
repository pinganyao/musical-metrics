(() => {
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

    const email = state.session?.user?.email || null;
    const username = state.profile?.username || null;
    const displayName = username || email || "User";

    if (email) {
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

    const { data, error } = await state.client
      .from("profiles")
      .select("user_id, username")
      .eq("user_id", state.session.user.id)
      .maybeSingle();

    if (error) {
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

  const init = async () => {
    if (state.initialized) return;
    if (state.initPromise) {
      await state.initPromise;
      return;
    }

    state.initPromise = (async () => {
      await loadSupabaseLib();

      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        showStatus("Supabase SDK is unavailable.", "error");
        return;
      }

      state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: getPreferredAuthStorage()
        }
      });
      const sessionResult = await state.client.auth.getSession();
      state.session = sessionResult.data.session;
      await ensureProfileForSession();

      ensureAuthNav();
      updateAuthUi();

      state.client.auth.onAuthStateChange(async (_event, session) => {
        state.session = session;
        await ensureProfileForSession();
        ensureAuthNav();
        updateAuthUi();
      });

      state.initialized = true;
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

  const reportScore = async (gameKey, scoreValue, scoreLabel) => {
    await init();
    if (!state.client) return { saved: false, reason: "client_unavailable" };
    if (!state.session?.user) {
      showStatus("Log in to save your score.", "info");
      return { saved: false, reason: "not_authenticated" };
    }

    const numericScore = Number(scoreValue);
    if (!Number.isFinite(numericScore)) {
      return { saved: false, reason: "invalid_score" };
    }

    const normalizedGameKey = normalizeGameKey(gameKey);
    if (!normalizedGameKey) {
      return { saved: false, reason: "invalid_game_key" };
    }

    const gameSession = state.activeGameSessions[normalizedGameKey];
    if (!gameSession?.id) {
      return { saved: false, reason: "missing_game_session" };
    }

    const durationSeconds = Math.max(
      0,
      Math.floor((Date.now() - gameSession.startedAtMs) / 1000)
    );

    const { error } = await state.client.rpc("submit_game_score", {
      p_session_id: gameSession.id,
      p_score: numericScore,
      p_score_label: scoreLabel || String(scoreValue),
      p_duration_seconds: durationSeconds
    });
    if (error) {
      showStatus(`Score save failed: ${error.message}`, "error");
      return { saved: false, reason: "insert_failed", error };
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

    const { data, error } = await state.client.rpc("create_game_session", {
      p_game_key: normalizedGameKey
    });

    if (error || !data) {
      showStatus(`Could not start secure game session: ${error?.message || "Unknown error"}`, "error");
      return { ok: false, reason: "rpc_failed", error };
    }

    state.activeGameSessions[normalizedGameKey] = {
      id: data,
      startedAtMs: Date.now()
    };

    return { ok: true };
  };

  const fetchMyHighScores = async () => {
    await init();
    if (!state.client || !state.session?.user) return [];
    const { data, error } = await state.client
      .from("my_game_high_scores")
      .select("game_key, high_score, attempts, last_played_at")
      .order("game_key");
    if (error) {
      showStatus(`Could not load high scores: ${error.message}`, "error");
      return [];
    }
    return data || [];
  };

  const fetchHighScoreForGame = async (gameKey) => {
    await init();
    if (!state.client || !state.session?.user) return null;
    const { data, error } = await state.client
      .from("my_game_high_scores")
      .select("game_key, high_score, attempts, last_played_at")
      .eq("game_key", gameKey)
      .maybeSingle();
    if (error) {
      showStatus(`Could not load high score: ${error.message}`, "error");
      return null;
    }
    return data;
  };

  window.MMAuth = {
    init,
    reportScore,
    fetchMyHighScores,
    fetchHighScoreForGame,
    startGameSession,
    loginWithPassword,
    signUpWithUsername,
    gameNameForKey: (key) => GAME_NAMES[normalizeGameKey(key)] || normalizeGameKey(key) || key,
    gameKeyFromPath: () => normalizeGameKey(window.location.pathname),
    getSession: () => state.session,
    getProfile: () => state.profile,
    showStatus,
    setRememberMe,
    isRememberMeEnabled
  };

  bindLogoutClickDelegation();
  init();
})();
