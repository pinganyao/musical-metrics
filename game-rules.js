(() => {
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

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
})();
