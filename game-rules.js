(() => {
  /** Defer scripts can run after this module; poll until MMAuth exists so score save never runs “too early” silently. */
  const ensureAuthScript = async () => {
    if (window.MMAuth) return window.MMAuth;
    const until = Date.now() + 8000;
    while (!window.MMAuth && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 40));
    }
    if (window.MMAuth) return window.MMAuth;

    return new Promise((resolve) => {
      const existing = document.querySelector('script[data-mm-auth-script="true"]');
      if (existing) {
        existing.addEventListener(
          "load",
          () => resolve(window.MMAuth || null),
          { once: true }
        );
        existing.addEventListener("error", () => resolve(null), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "supabase-auth.js";
      script.defer = true;
      script.dataset.mmAuthScript = "true";
      script.addEventListener("load", () => resolve(window.MMAuth || null), { once: true });
      script.addEventListener("error", () => resolve(null), { once: true });
      document.head.appendChild(script);
    });
  };

  const showScoreSaveFailed = (message) => {
    if (window.MMAuth && typeof window.MMAuth.showStatus === "function") {
      window.MMAuth.showStatus(message, "error");
      return;
    }
    const bar = document.getElementById("mm-status-bar");
    if (bar) {
      bar.textContent = message;
      bar.style.display = "block";
      bar.style.background = "rgba(74, 121, 255, 0.14)";
      bar.style.border = "1px solid rgba(255, 208, 66, 0.62)";
      bar.style.color = "#fff";
    }
  };

  const scoreEl = document.getElementById('finalScore');
  const gameOverEl = document.querySelector('.game-over');
  const gameKey = (() => {
    const path = window.location.pathname || '';
    const segments = path.split('/').filter(Boolean);
    const last = segments.length ? segments[segments.length - 1] : path;
    return last.replace(/\.html$/i, '');
  })();
  let wasGameOverVisible = false;
  let scoreReportedForCurrentGameOver = false;
  let scoreReportTail = Promise.resolve();
  let scoreSubmitInFlight = false;

  /** Used only for the MutationObserver fallback path (not for mm-game-over). */
  const isGameOverPanelShown = (element) => {
    if (!element) return false;
    if (typeof element.checkVisibility === 'function') {
      try {
        return element.checkVisibility({
          checkOpacity: false,
          contentVisibilityAuto: true
        });
      } catch (_) {
        /* fall through */
      }
    }
    const styles = window.getComputedStyle(element);
    return styles.display !== 'none' && styles.visibility !== 'hidden';
  };

  const parseScore = (scoreText) => {
    const match = scoreText.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  };

  const buildExtras = () => {
    const melodyGames = ['melody1', 'melody2', 'melody3'];
    const verifyTranscriptGames = [
      'harmony1',
      'harmony2',
      'harmony3',
      'interval1',
      'interval2',
      'tempo1',
      'tempo2',
      'pitch1',
      'rhythm1'
    ];
    const extras = {};
    if (melodyGames.includes(gameKey)) {
      extras.melodyTranscript = Array.isArray(window.mmMelodyTranscript)
        ? window.mmMelodyTranscript.slice()
        : [];
    } else if (verifyTranscriptGames.includes(gameKey)) {
      extras.verifyTranscript = Array.isArray(window.mmVerifyTranscript)
        ? window.mmVerifyTranscript.slice()
        : [];
    }
    return extras;
  };

  /** Shared RPC path — visibility is handled by callers. */
  const reportScoreNow = async () => {
    if (!scoreEl || !gameKey) return;
    if (scoreSubmitInFlight) return;
    scoreSubmitInFlight = true;

    const scoreText = scoreEl.textContent ? scoreEl.textContent.trim() : '';
    const scoreValue = parseScore(scoreText);
    if (scoreValue === null) {
      scoreSubmitInFlight = false;
      return;
    }

    const extras = buildExtras();

    const mmAuth = await ensureAuthScript();
    if (!mmAuth || typeof mmAuth.reportScore !== 'function') {
      showScoreSaveFailed(
        'Score not saved: account module did not load in time. Refresh the page and play once more.'
      );
      scoreSubmitInFlight = false;
      return;
    }

    try {
      let result = await mmAuth.reportScore(gameKey, scoreValue, scoreText, extras);
      if (
        result &&
        !result.saved &&
        (result.reason === 'insert_failed' ||
          result.reason === 'display_failed' ||
          result.reason === 'client_unavailable')
      ) {
        await new Promise((r) => setTimeout(r, 700));
        result = await mmAuth.reportScore(gameKey, scoreValue, scoreText, extras);
      }
      if (result && result.saved) {
        scoreReportedForCurrentGameOver = true;
      }
    } catch (e) {
      showScoreSaveFailed(
        `Score not saved: ${e && e.message ? e.message : 'network or server error'}. Try again.`
      );
    } finally {
      scoreSubmitInFlight = false;
    }
  };

  /**
   * Primary path: every game dispatches `mm-game-over` when the round ends.
   * Run after layout so `#finalScore` is committed; do not rely on MutationObserver order or checkVisibility.
   */
  const submitScoreAfterGameOverEvent = async () => {
    if (!scoreEl || !gameKey) return;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    if (scoreReportedForCurrentGameOver) return;
    await reportScoreNow();
  };

  /** Fallback when observers fire without relying on the custom event. */
  const runMaybeReportScore = async () => {
    if (!scoreEl || !gameOverEl || !gameKey) return;

    const isGameOverVisible = isGameOverPanelShown(gameOverEl);

    if (isGameOverVisible && !wasGameOverVisible) {
      scoreReportedForCurrentGameOver = false;
    }
    wasGameOverVisible = isGameOverVisible;

    if (!isGameOverVisible || scoreReportedForCurrentGameOver) return;

    await reportScoreNow();
  };

  const enqueueScoreReport = () => {
    scoreReportTail = scoreReportTail
      .then(() => runMaybeReportScore())
      .catch(() => {});
  };

  const scoreObserver = new MutationObserver(() => {
    enqueueScoreReport();
    window.setTimeout(() => enqueueScoreReport(), 400);
  });

  if (scoreEl) {
    scoreObserver.observe(scoreEl, { characterData: true, childList: true, subtree: true });
  }

  if (gameOverEl) {
    scoreObserver.observe(gameOverEl, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  enqueueScoreReport();

  window.addEventListener('online', () => enqueueScoreReport());
  window.addEventListener('mm-try-score-sync', () => enqueueScoreReport());
  window.addEventListener('mm-game-over', () => {
    void submitScoreAfterGameOverEvent();
  });
  window.addEventListener('mm-auth-changed', () => enqueueScoreReport());

  const rulesDiv = document.querySelector('.rules');
  const titleEl = document.querySelector('.main-content h1');
  const titleText = titleEl ? `${titleEl.textContent.trim()} Rules` : 'Game Rules';
  const rulesText = rulesDiv
    ? Array.from(rulesDiv.querySelectorAll('p'))
        .map((p) => p.textContent.trim())
        .filter(Boolean)
    : [];

  if (!rulesText.length) return;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'rules-fab';
  fab.id = 'rulesFab';
  fab.setAttribute('aria-label', 'Show game rules');
  fab.innerHTML = '<i data-lucide="help-circle" class="rules-fab-icon"></i>';

  const modal = document.createElement('div');
  modal.className = 'rules-modal';
  modal.id = 'rulesModal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="rules-modal-backdrop" data-rules-close="true"></div>
    <div class="rules-modal-card" role="dialog" aria-modal="true" aria-label="${titleText}">
      <div class="rules-modal-header">
        <div class="rules-modal-title">${titleText}</div>
        <button type="button" class="rules-modal-close" id="rulesModalClose" aria-label="Close rules">
          <i data-lucide="x" class="rules-fab-icon"></i>
        </button>
      </div>
      <ul class="rules-modal-list">
        ${rulesText.map((text) => `<li>${text}</li>`).join('')}
      </ul>
      <button type="button" class="control-button control-button-block" id="rulesModalGotIt">Got it</button>
    </div>
  `;

  const anchorContainer = document.querySelector('.main-content') || document.body;
  anchorContainer.appendChild(fab);
  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#rulesModalClose');
  const gotItBtn = modal.querySelector('#rulesModalGotIt');

  const isRulesVisible = () => {
    const styles = window.getComputedStyle(rulesDiv);
    return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
  };

  const syncFabVisibility = () => {
    fab.style.display = isRulesVisible() ? 'none' : 'flex';
  };

  const openRules = () => {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeRules = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };

  fab.addEventListener('click', openRules);
  closeBtn.addEventListener('click', closeRules);
  gotItBtn.addEventListener('click', closeRules);
  modal.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.rulesClose === 'true') {
      closeRules();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      closeRules();
    }
  });

  const continueBtn = document.getElementById('continueBtn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      setTimeout(syncFabVisibility, 50);
    });
  }

  const observer = new MutationObserver(syncFabVisibility);
  observer.observe(rulesDiv, { attributes: true, attributeFilter: ['style', 'class'] });

  syncFabVisibility();

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
})();
