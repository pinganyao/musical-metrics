# Musical Metrics

**Musical Metrics** is a collection of twelve browser-based ear-training games that exercise listening skills across melody, harmony, intervals, tempo, pitch, and rhythm. The project explores **hearing ability as part of musical learning**—both as a research instrument and as a practical practice tool for musicians at every level.

Play live: **[musicalmetrics.xyz](https://musicalmetrics.xyz)**

---

## Highlights

- **12 interactive games** spanning six categories, from beginner-friendly drills to challenges aimed at advanced musicians  
- **Accounts & leaderboards** — sign in to save scores and compare results on global leaderboards  
- **Server-verified scoring** — gameplay transcripts are validated on the backend so scores reflect genuine performance  
- **Pure web stack** — runs in modern browsers with no install; UI designed in **Figma**, implemented as static HTML, CSS, and JavaScript  

For richer descriptions of each game’s design, difficulty curve, and research context, see the portfolio document **Musical Metrics – Portfolio** (PDF).

---

## Who it’s for

Some games welcome listeners with little formal training; others assume familiarity with **music theory** (interval names, chord symbols, etc.). Many rounds act as focused **ear-training** exercises—useful alone or alongside lessons—and the competitive angle (friends, family, or the leaderboard) keeps practice engaging.

---

## Games at a glance

Games are grouped into six categories. Within a category, difficulty generally increases with each numbered level. Melody games typically **end on the first mistake**; many other games use a **fixed number of rounds** so strong players still face a bounded challenge.

### Melody (`melody1`, `melody2`, `melody3`)

Tests **relative pitch** and **melodic memory**. The computer plays an expanding melody; you **play it back** on the on-screen instrument.

| Game | Summary |
|------|--------|
| **Melody I** | Beginner-friendly: builds from a single random note in **C major**, adding one note per level; the melody repeats to aid memory. |
| **Melody II** | Like Melody I, but each level uses a **new random melody**, sharply raising the difficulty. |
| **Melody III** | Among the hardest games: same structure as Melody II on a **chromatic** palette—very demanding for ears used only to diatonic material. |

### Interval (`interval1`, `interval2`)

Two notes sound in succession; you identify the **interval** (quality and size—e.g. major 3rd, perfect 5th).

| Game | Summary |
|------|--------|
| **Interval I** | Accessible: notes sit in a fixed register (**C4–C5**), with the first note anchored at **middle C**—focus is largely on the second note. |
| **Interval II** | Notes span **three octaves** (compound intervals collapse to simple equivalents); order is not fixed—the **higher note may come first**. |

### Harmony (`harmony1`, `harmony2`, `harmony3`)

A **chord** plays at random; you choose the **chord type** heard.

| Game | Summary |
|------|--------|
| **Harmony I** | Six core types in **root position**; *sus2* vs *sus4* can be subtle in isolation. |
| **Harmony II** | Adds types such as **dominant** and **half-diminished**, plus **7th chords**—you distinguish both quality and whether a seventh is present. |
| **Harmony III** | Adds **inversions** and richer extensions (**6th**, **9th**, **add9**). |

### Tempo (`tempo1`, `tempo2`)

| Game | Summary |
|------|--------|
| **Tempo I** | Identify the **BPM** of a random metronome click track—some find it trivial, others use counting tricks (e.g. anchoring from 60 BPM). |
| **Tempo II** | Hear a tempo, then **tap it back**—trains steadiness and internal pulse; scoring stays forgiving for casual play. |

### Pitch (`pitch1`)

**Pitch I** is distinctive: a reference tone is played, then a **detuned** test tone (up to **±50 cents** via **[Tone.js](https://tonejs.github.io/)**). You estimate how many **cents** sharp or flat—much harder than noticing “something’s wrong,” even though humans often resolve ~5–10 cent differences in AB tests.

### Rhythm (`rhythm1`)

The newest addition: each round plays a **four-beat** pattern built from **quavers, triplets, semiquavers, or sextuplets**. You **tap the rhythm** back; **absolute tempo** may differ as long as **relative timing** matches. Naming the subdivision before tapping tends to improve accuracy.

---

## Research & data

Musical Metrics supports ongoing work on whether **listening performance** relates to factors such as **years of instrumental study**. Aggregated gameplay enables analyses similar to those illustrated in the portfolio (e.g. score distributions by experience). Leaderboards and authenticated play extend this with broader, opt-in participation.

---

## Tech stack

| Layer | Details |
|-------|--------|
| **Client** | Static HTML/CSS/JavaScript, **[Tone.js](https://tonejs.github.io/)** for synthesis and pitch manipulation, **[Lucide](https://lucide.dev/)** icons |
| **Backend** | **[Supabase](https://supabase.com/)** — PostgreSQL, Auth, Row Level Security, and RPC for session creation and **verified** score submission |
| **Migrations** | SQL under `supabase/migrations/` documents schema and server-side game logic |

There is no heavy client framework: pages load scripts shared across games (`audio-engine.js`, `supabase-auth.js`, `verified-rng.js`, etc.) for audio, auth, and verification.

---

## Repository layout (overview)

```
musical-metrics/
├── index.html, dashboard.html, leaderboard.html, login.html, …
├── melody*.html, interval*.html, harmony*.html, tempo*.html, pitch1.html, rhythm1.html
├── globals.css, audio-engine.js, supabase-auth.js, verified-rng.js, game-rules.js
├── api/geo.js
├── assets/
└── supabase/migrations/    # database schema & score verification logic
```

---

## Local development

This site is **static-first**: open pages via a local HTTP server (many games rely on correct module/audio behavior and avoid `file://` quirks):

```bash
# Example: Python 3
python3 -m http.server 8080
# Then visit http://localhost:8080
```

Supabase credentials in the client use the **publishable (anon) key**; the database is protected by **RLS** and server-side checks. Applying schema changes requires the **Supabase CLI** (or Dashboard SQL) and the migrations in `supabase/migrations/`.

---

## Credits & contact

**Musical Metrics** — concept, design, and implementation.

Social links appear on the live site’s footer and structured data on [musicalmetrics.xyz](https://musicalmetrics.xyz).

---

*Extended game-by-game narrative and research framing: **Musical Metrics – Portfolio** (PDF).*
