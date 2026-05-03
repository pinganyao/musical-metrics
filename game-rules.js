(() => {
  const waitForMMAuth = (timeoutMs = 4000) =>
    new Promise((resolve) => {
      if (window.MMAuth) {
        resolve(window.MMAuth);
        return;
      }
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (window.MMAuth) {
          window.clearInterval(timer);
          resolve(window.MMAuth);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          resolve(null);
        }
      }, 50);
    });

  const ensureAuthScript = () =>
    new Promise((resolve) => {
      if (window.MMAuth) {
        resolve(window.MMAuth);
        return;
      }

      const existing = document.querySelector('script[data-mm-auth-script="true"]');
      if (existing) {
        waitForMMAuth().then(resolve);
        return;
      }

      const script = document.createElement("script");
      script.src = "supabase-auth.js";
      script.defer = true;
      script.dataset.mmAuthScript = "true";
      script.addEventListener("load", () => {
        waitForMMAuth().then(resolve);
      }, { once: true });
      script.addEventListener("error", () => resolve(null), { once: true });
      document.head.appendChild(script);
    });

  const rulesDiv = document.querySelector('.rules');
  if (!rulesDiv) return;

  const titleEl = document.querySelector('.main-content h1');
  const titleText = titleEl ? `${titleEl.textContent.trim()} Rules` : 'Game Rules';
  const rulesText = Array.from(rulesDiv.querySelectorAll('p'))
    .map((p) => p.textContent.trim())
    .filter(Boolean);

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

  const scoreEl = document.getElementById('finalScore');
  const gameOverEl = document.querySelector('.game-over');
  const gameOverButtons = gameOverEl ? gameOverEl.querySelector('.game-center-align-large-gap') : null;
  const gameKey = (() => {
    const path = window.location.pathname || '';
    const segments = path.split('/').filter(Boolean);
    const last = segments.length ? segments[segments.length - 1] : path;
    return last.replace(/\.html$/i, '');
  })();
  let wasGameOverVisible = false;
  let scoreReportedForCurrentGameOver = false;
  let gameOverVisibleAtMs = 0;
  let scoreReportInFlight = false;
  let retrySaveBtn = null;

  const ensureRetrySaveButton = () => {
    if (!(gameOverButtons instanceof HTMLElement)) return null;
    if (retrySaveBtn instanceof HTMLElement) return retrySaveBtn;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'retrySaveBtn';
    btn.className = 'control-button';
    btn.style.display = 'none';
    btn.textContent = 'Retry score save';
    btn.addEventListener('click', async () => {
      const mmAuth = await ensureAuthScript();
      if (!mmAuth || typeof mmAuth.retryPendingScores !== 'function') return;
      btn.disabled = true;
      btn.textContent = 'Retrying...';
      try {
        await mmAuth.retryPendingScores();
        const remaining = typeof mmAuth.pendingScoresCount === 'function' ? mmAuth.pendingScoresCount() : 0;
        if (!remaining) {
          btn.style.display = 'none';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Retry score save';
      }
    });
    gameOverButtons.appendChild(btn);
    retrySaveBtn = btn;
    return btn;
  };

  const isVisible = (element) => {
    if (!element) return false;
    const styles = window.getComputedStyle(element);
    return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0';
  };

  const parseScore = (scoreText) => {
    const match = scoreText.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  };

  const maybeReportScore = async () => {
    if (!scoreEl || !gameOverEl || !gameKey) return;
    if (scoreReportInFlight) return;
    const isGameOverVisible = isVisible(gameOverEl);

    if (isGameOverVisible && !wasGameOverVisible) {
      scoreReportedForCurrentGameOver = false;
      gameOverVisibleAtMs = Date.now();
    }
    wasGameOverVisible = isGameOverVisible;

    if (!isGameOverVisible || scoreReportedForCurrentGameOver) return;
    if (Date.now() - gameOverVisibleAtMs < 180) {
      window.setTimeout(() => {
        maybeReportScore();
      }, 220);
      return;
    }

    const scoreText = scoreEl.textContent ? scoreEl.textContent.trim() : '';
    const scoreValue = parseScore(scoreText);
    if (scoreValue === null) return;

    scoreReportInFlight = true;
    try {
      const mmAuth = await ensureAuthScript();
      if (!mmAuth || typeof mmAuth.reportScore !== 'function') return;

      const melodyGames = ["melody1", "melody2", "melody3"];
      const extras = {};
      if (Array.isArray(window.mmVerifyTranscript) && window.mmVerifyTranscript.length > 0) {
        extras.verifyTranscript = window.mmVerifyTranscript.slice();
      } else if (melodyGames.includes(gameKey) && Array.isArray(window.mmMelodyTranscript)) {
        extras.melodyTranscript = window.mmMelodyTranscript.slice();
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await mmAuth.reportScore(gameKey, scoreValue, scoreText, extras);
        if (result && result.saved) {
          scoreReportedForCurrentGameOver = true;
          if (retrySaveBtn instanceof HTMLElement) {
            retrySaveBtn.style.display = 'none';
          }
          if (result.queued) {
            const retryBtn = ensureRetrySaveButton();
            if (retryBtn) retryBtn.style.display = 'inline-block';
          }
          break;
        }
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    } finally {
      scoreReportInFlight = false;
      if (isVisible(gameOverEl) && !scoreReportedForCurrentGameOver) {
        window.setTimeout(() => {
          maybeReportScore();
        }, 900);
      }
    }
  };

  const scoreObserver = new MutationObserver(() => {
    maybeReportScore();
  });

  if (scoreEl) {
    scoreObserver.observe(scoreEl, { characterData: true, childList: true, subtree: true });
  }

  if (gameOverEl) {
    scoreObserver.observe(gameOverEl, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  maybeReportScore();

  const continueBtnForSession = document.getElementById('continueBtn');
  const playAgainBtnForSession = document.getElementById('playAgainBtn');

  const beginSecureSession = async () => {
    try {
      const mmAuth = await ensureAuthScript();
      if (!mmAuth || typeof mmAuth.startGameSession !== 'function') return;
      const sessionResult = await mmAuth.startGameSession(gameKey);
      if (sessionResult?.ok && sessionResult.seed != null) {
        const s = sessionResult.seed;
        window.mmChallengeSeed = typeof s === 'bigint' ? s.toString() : s;
      }
      window.mmVerifyTranscript = [];
    } catch (_) {
      /* non-blocking: gameplay must continue even if session bootstrap fails */
    }
  };

  if (continueBtnForSession) {
    continueBtnForSession.addEventListener('click', () => {
      void beginSecureSession();
    });
  }

  if (playAgainBtnForSession) {
    playAgainBtnForSession.addEventListener('click', () => {
      void beginSecureSession();
    });
  }

  void (async () => {
    const mmAuth = await ensureAuthScript();
    if (!mmAuth || typeof mmAuth.pendingScoresCount !== 'function') return;
    if (mmAuth.pendingScoresCount() > 0) {
      const retryBtn = ensureRetrySaveButton();
      if (retryBtn) retryBtn.style.display = 'inline-block';
    }
  })();

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
})();
