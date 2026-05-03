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

  const rulesDiv = document.querySelector('.rules');
  if (!rulesDiv) return;

  const titleEl = document.querySelector('.main-content h1');
  const titleText = titleEl ? `${titleEl.textContent.trim()} Rules` : 'Game Rules';
  const rulesText = Array.from(rulesDiv.querySelectorAll('p'))
    .map((p) => p.textContent.trim())
    .filter(Boolean);

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

  const runMaybeReportScore = async () => {
    if (!scoreEl || !gameOverEl || !gameKey) return;
    const isGameOverVisible = isVisible(gameOverEl);

    if (isGameOverVisible && !wasGameOverVisible) {
      scoreReportedForCurrentGameOver = false;
    }
    wasGameOverVisible = isGameOverVisible;

    if (!isGameOverVisible || scoreReportedForCurrentGameOver) return;

    const scoreText = scoreEl.textContent ? scoreEl.textContent.trim() : '';
    const scoreValue = parseScore(scoreText);
    if (scoreValue === null) return;

    const melodyGames = ['melody1', 'melody2', 'melody3'];
    const harmonyGames = ['harmony1', 'harmony2', 'harmony3'];
    const extras = {};
    if (melodyGames.includes(gameKey)) {
      extras.melodyTranscript = Array.isArray(window.mmMelodyTranscript)
        ? window.mmMelodyTranscript.slice()
        : [];
    } else if (harmonyGames.includes(gameKey)) {
      extras.verifyTranscript = Array.isArray(window.mmVerifyTranscript)
        ? window.mmVerifyTranscript.slice()
        : [];
    } else if (Array.isArray(window.mmVerifyTranscript) && window.mmVerifyTranscript.length > 0) {
      extras.verifyTranscript = window.mmVerifyTranscript.slice();
    }

    const mmAuth = await ensureAuthScript();
    if (!mmAuth || typeof mmAuth.reportScore !== 'function') {
      showScoreSaveFailed(
        'Score not saved: account module did not load in time. Refresh the page and play once more.'
      );
      return;
    }

    try {
      let result = await mmAuth.reportScore(gameKey, scoreValue, scoreText, extras);
      if (result && !result.saved && result.reason === 'insert_failed') {
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
    }
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
