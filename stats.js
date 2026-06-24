(() => {
  const GAME_ICONS = {
    melody1: "music-2",
    melody2: "music-2",
    melody3: "music-2",
    interval1: "waves",
    interval2: "waves",
    harmony1: "piano",
    harmony2: "piano",
    harmony3: "piano",
    tempo1: "clock",
    tempo2: "clock",
    pitch1: "music",
    rhythm1: "drum"
  };

  const CHART_COLORS = {
    gold: "#fbbf24",
    goldSoft: "rgba(251, 191, 36, 0.18)",
    goldLine: "rgba(251, 191, 36, 0.85)",
    rolling: "#60a5fa",
    rollingSoft: "rgba(96, 165, 250, 0.15)",
    grid: "rgba(148, 163, 184, 0.12)",
    text: "#9ca3af",
    pb: "#34d399"
  };

  let performanceChart = null;
  let distributionChart = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatAttemptDate(iso) {
    if (!iso) return { line1: "—", line2: "" };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { line1: "—", line2: "" };
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const line1 = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { line1, line2: `${hh}:${mm}` };
  }

  function shortDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  function computeStats(history, gameKey) {
    const scores = history.map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
    if (!scores.length) {
      return {
        attempts: 0,
        highScore: null,
        avgScore: null,
        consistency: null,
        lastPlayedAt: null,
        pbIndex: -1
      };
    }

    const highScore = Math.max(...scores);
    const pbIndex = scores.lastIndexOf(highScore);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    const variance =
      scores.length > 1
        ? scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / scores.length
        : 0;
    const stdDev = Math.sqrt(variance);

    const meta = window.MMAuth.getScoreMetaForGame(gameKey);
    let consistency = null;
    if (scores.length > 1) {
      if (meta.kind === "outOf" && meta.max > 0) {
        consistency = Math.max(0, Math.min(100, 100 - (stdDev / meta.max) * 100));
      } else {
        const range = highScore > 0 ? highScore : 1;
        consistency = Math.max(0, Math.min(100, 100 - (stdDev / range) * 100));
      }
    }

    return {
      attempts: scores.length,
      highScore,
      avgScore,
      consistency,
      lastPlayedAt: history[history.length - 1]?.created_at || null,
      pbIndex
    };
  }

  function rollingAverage(values, windowSize) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const slice = values.slice(start, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      out.push(Math.round(avg * 10) / 10);
    }
    return out;
  }

  function buildDistributionBuckets(scores, gameKey) {
    const meta = window.MMAuth.getScoreMetaForGame(gameKey);
    const buckets = new Map();

    if (meta.kind === "outOf" && meta.max === 10) {
      for (let i = 0; i <= 10; i++) buckets.set(i, 0);
      scores.forEach((s) => {
        const k = Math.round(s);
        if (k >= 0 && k <= 10) buckets.set(k, (buckets.get(k) || 0) + 1);
      });
      return {
        labels: Array.from(buckets.keys()).map((k) => String(k)),
        values: Array.from(buckets.values())
      };
    }

    if (meta.kind === "outOf" && meta.max === 100) {
      const ranges = [
        { label: "0–49", min: 0, max: 49 },
        { label: "50–69", min: 50, max: 69 },
        { label: "70–84", min: 70, max: 84 },
        { label: "85–94", min: 85, max: 94 },
        { label: "95–100", min: 95, max: 100 }
      ];
      const counts = ranges.map(() => 0);
      scores.forEach((s) => {
        const idx = ranges.findIndex((r) => s >= r.min && s <= r.max);
        if (idx >= 0) counts[idx]++;
      });
      return { labels: ranges.map((r) => r.label), values: counts };
    }

    const max = Math.max(...scores, 1);
    const step = max <= 20 ? 2 : max <= 50 ? 5 : max <= 200 ? 10 : 25;
    const top = Math.ceil(max / step) * step;
    const labels = [];
    const values = [];
    for (let start = 0; start <= top; start += step) {
      const end = start + step - 1;
      labels.push(start === end ? String(start) : `${start}–${end}`);
      const count = scores.filter((s) => s >= start && s <= end).length;
      values.push(count);
    }
    return { labels, values };
  }

  function chartBaseOptions(yMax) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: CHART_COLORS.text, boxWidth: 12, padding: 16, font: { size: 12 } }
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          borderColor: "rgba(148, 163, 184, 0.25)",
          borderWidth: 1,
          titleColor: "#f8fafc",
          bodyColor: "#d1d5db",
          padding: 12
        }
      },
      scales: {
        x: {
          ticks: { color: CHART_COLORS.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
          grid: { color: CHART_COLORS.grid }
        },
        y: {
          beginAtZero: true,
          suggestedMax: yMax,
          ticks: { color: CHART_COLORS.text },
          grid: { color: CHART_COLORS.grid }
        }
      }
    };
  }

  function renderPerformanceChart(canvas, history, gameKey, stats) {
    if (!canvas || !window.Chart) return;
    if (performanceChart) {
      performanceChart.destroy();
      performanceChart = null;
    }

    const scores = history.map((r) => Number(r.score));
    const labels = history.map((r, i) => shortDate(r.created_at) || `#${i + 1}`);
    const meta = window.MMAuth.getScoreMetaForGame(gameKey);
    const yMax = meta.kind === "outOf" ? meta.max : undefined;
    const rollWindow = scores.length >= 5 ? 5 : 3;
    const rolling = scores.length >= 3 ? rollingAverage(scores, rollWindow) : null;

    const datasets = [
      {
        label: "Score",
        data: scores,
        borderColor: CHART_COLORS.goldLine,
        backgroundColor: CHART_COLORS.goldSoft,
        pointBackgroundColor: scores.map((s, i) =>
          i === stats.pbIndex ? CHART_COLORS.pb : CHART_COLORS.gold
        ),
        pointBorderColor: scores.map((s, i) =>
          i === stats.pbIndex ? CHART_COLORS.pb : CHART_COLORS.gold
        ),
        pointRadius: scores.map((_, i) => (i === stats.pbIndex ? 6 : 3)),
        pointHoverRadius: 6,
        borderWidth: 2,
        fill: true,
        tension: 0.25
      }
    ];

    if (rolling) {
      datasets.push({
        label: `${rollWindow}-test avg`,
        data: rolling,
        borderColor: CHART_COLORS.rolling,
        backgroundColor: CHART_COLORS.rollingSoft,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.35
      });
    }

    if (stats.highScore != null) {
      datasets.push({
        label: "Personal best",
        data: scores.map(() => stats.highScore),
        borderColor: "rgba(52, 211, 153, 0.55)",
        borderWidth: 1.5,
        borderDash: [4, 6],
        pointRadius: 0,
        fill: false
      });
    }

    performanceChart = new window.Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: chartBaseOptions(yMax)
    });
  }

  function renderDistributionChart(canvas, history, gameKey) {
    if (!canvas || !window.Chart) return;
    if (distributionChart) {
      distributionChart.destroy();
      distributionChart = null;
    }

    const scores = history.map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
    const dist = buildDistributionBuckets(scores, gameKey);

    distributionChart = new window.Chart(canvas, {
      type: "bar",
      data: {
        labels: dist.labels,
        datasets: [
          {
            label: "Attempts",
            data: dist.values,
            backgroundColor: dist.values.map((v) =>
              v > 0 ? "rgba(251, 191, 36, 0.75)" : "rgba(148, 163, 184, 0.15)"
            ),
            borderColor: "rgba(251, 191, 36, 0.9)",
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        ...chartBaseOptions(undefined),
        plugins: {
          ...chartBaseOptions(undefined).plugins,
          legend: { display: false }
        }
      }
    });
  }

  function renderSummaryCards(stats, gameKey) {
    const host = document.getElementById("stats-summary-cards");
    if (!host) return;

    const cards = [
      {
        label: "Personal best",
        value: stats.highScore != null ? window.MMAuth.formatScoreLabel(stats.highScore, gameKey) : "—",
        highlight: true
      },
      {
        label: "Average",
        value:
          stats.avgScore != null
            ? window.MMAuth.formatScoreLabel(stats.avgScore, gameKey, { forAverage: true })
            : "—"
      },
      {
        label: "Tests completed",
        value: stats.attempts ? String(stats.attempts) : "—"
      },
      {
        label: "Consistency",
        value:
          stats.consistency != null ? `${Math.round(stats.consistency)}%` : stats.attempts === 1 ? "—" : "—"
      }
    ];

    host.innerHTML = cards
      .map(
        (c) =>
          `<div class="stats-summary-card${c.highlight ? " stats-summary-card--highlight" : ""}">` +
          `<span class="stats-summary-label">${escapeHtml(c.label)}</span>` +
          `<span class="stats-summary-value">${escapeHtml(c.value)}</span>` +
          `</div>`
      )
      .join("");
  }

  function renderHistoryTable(history, gameKey) {
    const host = document.getElementById("stats-history-rows");
    const emptyEl = document.getElementById("stats-history-empty");
    const wrap = document.getElementById("stats-history-wrap");
    if (!host || !emptyEl || !wrap) return;

    if (!history.length) {
      emptyEl.hidden = false;
      wrap.hidden = true;
      host.innerHTML = "";
      return;
    }

    emptyEl.hidden = true;
    wrap.hidden = false;

    const reversed = history.slice().reverse();
    host.innerHTML = reversed
      .map((row, idx) => {
        const attemptNum = history.length - idx;
        const parts = window.MMAuth.formatScoreParts(Number(row.score), gameKey);
        const dateFmt = formatAttemptDate(row.created_at);
        const scoreInner = parts
          ? `<span class="stats-history-score-num">${escapeHtml(parts.main)}</span>` +
            `<span class="stats-history-score-suffix">${escapeHtml(parts.suffix)}</span>`
          : row.score_label
            ? `<span class="stats-history-score-num">${escapeHtml(String(row.score_label))}</span>`
            : `<span class="stats-history-score-num">—</span>`;

        return (
          `<div class="stats-history-row">` +
          `<div class="stats-history-col stats-history-col--num">${attemptNum}</div>` +
          `<div class="stats-history-col stats-history-col--date">` +
          `<div class="stats-history-date-line1">${escapeHtml(dateFmt.line1)}</div>` +
          `<div class="stats-history-date-line2">${escapeHtml(dateFmt.line2)}</div>` +
          `</div>` +
          `<div class="stats-history-col stats-history-col--score">${scoreInner}</div>` +
          `</div>`
        );
      })
      .join("");
  }

  function showState(state) {
    const guest = document.getElementById("stats-guest");
    const loading = document.getElementById("stats-loading");
    const content = document.getElementById("stats-content");
    const invalid = document.getElementById("stats-invalid");
    const empty = document.getElementById("stats-empty");

    if (guest) guest.hidden = state !== "guest";
    if (loading) loading.hidden = state !== "loading";
    if (content) content.hidden = state !== "content";
    if (invalid) invalid.hidden = state !== "invalid";
    if (empty) empty.hidden = state !== "empty";
  }

  async function initStatsPage() {
    const gameKey = window.MMAuth.parseStatsGameKeyFromPath();
    const titleEl = document.getElementById("stats-game-title");
    const breadcrumbEl = document.getElementById("stats-breadcrumb-game");
    const playBtn = document.getElementById("stats-play-btn");
    const iconEl = document.getElementById("stats-game-icon");

    if (!window.MMAuth.isValidGameKey(gameKey)) {
      if (titleEl) titleEl.textContent = "Stats";
      showState("invalid");
      return;
    }

    const gameName = window.MMAuth.gameNameForKey(gameKey);
    const gamePath = window.MMAuth.gamePathForKey(gameKey);
    document.title = `${gameName} Stats | Musical Metrics`;

    if (titleEl) titleEl.textContent = gameName;
    if (breadcrumbEl) breadcrumbEl.textContent = gameName;
    if (playBtn) playBtn.href = gamePath;
    if (iconEl) {
      iconEl.setAttribute("data-lucide", GAME_ICONS[gameKey] || "bar-chart-3");
      if (window.lucide?.createIcons) window.lucide.createIcons();
    }

    showState("loading");
    await window.MMAuth.init();

    const session = window.MMAuth.getSession();
    if (!session?.user) {
      const loginLink = document.getElementById("stats-guest-login");
      if (loginLink) {
        loginLink.href = `/login?redirect=${encodeURIComponent(`/stats/${gameKey}`)}`;
      }
      showState("guest");
      return;
    }

    const history = await window.MMAuth.fetchGameScoreHistory(gameKey, { limit: 200 });
    if (!history.length) {
      const emptyPlay = document.getElementById("stats-empty-play");
      if (emptyPlay) emptyPlay.href = gamePath;
      showState("empty");
      return;
    }

    const stats = computeStats(history, gameKey);
    const lastPlayedEl = document.getElementById("stats-last-played");
    if (lastPlayedEl) {
      if (stats.lastPlayedAt) {
        const fmt = formatAttemptDate(stats.lastPlayedAt);
        lastPlayedEl.textContent = `Last played ${fmt.line1} at ${fmt.line2}`;
        lastPlayedEl.hidden = false;
      } else {
        lastPlayedEl.hidden = true;
      }
    }

    renderSummaryCards(stats, gameKey);
    renderPerformanceChart(
      document.getElementById("stats-performance-chart"),
      history,
      gameKey,
      stats
    );
    renderDistributionChart(
      document.getElementById("stats-distribution-chart"),
      history,
      gameKey
    );
    renderHistoryTable(history, gameKey);
    showState("content");

    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function bindMobileMenu() {
    const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
    const mobileMenu = document.getElementById("mobile-menu");
    if (!mobileMenuToggle || !mobileMenu) return;

    mobileMenuToggle.addEventListener("click", () => {
      mobileMenu.classList.toggle("active");
      mobileMenuToggle.classList.toggle("active");
    });
    mobileMenu.querySelectorAll(".mobile-menu-link").forEach((link) => {
      link.addEventListener("click", () => {
        mobileMenu.classList.remove("active");
        mobileMenuToggle.classList.remove("active");
      });
    });
    document.addEventListener("click", (event) => {
      if (!mobileMenuToggle.contains(event.target) && !mobileMenu.contains(event.target)) {
        mobileMenu.classList.remove("active");
        mobileMenuToggle.classList.remove("active");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindMobileMenu();
    if (window.lucide?.createIcons) window.lucide.createIcons();

    const waitForAuth = () => {
      if (!window.MMAuth) {
        setTimeout(waitForAuth, 50);
        return;
      }
      initStatsPage();
    };
    waitForAuth();
  });

  window.addEventListener("mm-auth-changed", () => {
    if (window.MMAuth) initStatsPage();
  });
})();
