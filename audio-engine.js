(function () {
  // Legacy MP3 filenames (e.g. sounds/C4.mp3) label notes one octave below the
  // pitch players heard via Web Audio decode + BufferSource playback. Shift up
  // so smplr matches the original in-game register.
  const LEGACY_MP3_OCTAVE_OFFSET = 12;
  const SMPLR_URL = 'https://cdn.jsdelivr.net/npm/smplr@0.16.3/dist/index.mjs';
  // Short detached notes: brief hold + release tail (audible length ≈ duration + ampRelease).
  const DEFAULT_NOTE_DURATION = 0.45;
  const DEFAULT_AMP_RELEASE = 0.21;

  const SEMITONE_MAP = {
    c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
    'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
  };

  function parseNoteNameFromPath(path) {
    if (!path || typeof path !== 'string') return null;
    const filename = decodeURIComponent(path.split('/').pop() || '');
    const match = filename.match(/^([A-Ga-g])([#b]?)(\d)\.mp3$/i);
    if (!match) return null;
    return `${match[1].toUpperCase()}${match[2]}${match[3]}`;
  }

  function noteNameToMidi(name) {
    if (!name || typeof name !== 'string') return null;
    const match = name.trim().match(/^([A-Ga-g])([#b]?)(\d+)$/);
    if (!match) return null;
    const letter = match[1].toLowerCase();
    const accidental = match[2].toLowerCase();
    const octave = parseInt(match[3], 10);
    const semitoneKey = accidental ? `${letter}${accidental}` : letter;
    const semitone = SEMITONE_MAP[semitoneKey];
    if (semitone === undefined || !Number.isFinite(octave)) return null;
    return (octave + 1) * 12 + semitone;
  }

  function parseNoteKey(key, pathHint) {
    const fromPath = parseNoteNameFromPath(pathHint);
    if (fromPath) {
      const midi = noteNameToMidi(fromPath);
      return midi !== null ? midi + LEGACY_MP3_OCTAVE_OFFSET : null;
    }

    const fromKey = noteNameToMidi(String(key));
    if (fromKey !== null) return fromKey + LEGACY_MP3_OCTAVE_OFFSET;

    return null;
  }

  class SharedAudioEngine {
    constructor() {
      this.context = null;
      this.masterGain = null;
      this.piano = null;
      this.loadPromise = null;
      this.noteMap = {};
      this.keyToMidi = new Map();
      this.loadedMidis = new Set();
      this.warmedUp = false;
      this.activeStops = new Map();
    }

    ensureContext() {
      if (!this.context) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.context = new Ctx();
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = 1;
        this.masterGain.connect(this.context.destination);
      }
      return this.context;
    }

    async resume() {
      const ctx = this.ensureContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    }

    buildKeyToMidi(noteMap) {
      const keyToMidi = new Map();
      for (const [key, path] of Object.entries(noteMap)) {
        const midi = parseNoteKey(key, path);
        if (midi !== null) {
          keyToMidi.set(String(key), midi);
        }
      }
      return keyToMidi;
    }

    async loadPiano(midis, onProgress) {
      const ctx = this.ensureContext();
      const needed = [...new Set(midis)].sort((a, b) => a - b);
      const allLoaded = needed.every((m) => this.loadedMidis.has(m));
      if (this.piano && allLoaded) {
        if (onProgress) onProgress(needed.length, needed.length);
        return;
      }

      if (this.loadPromise) {
        await this.loadPromise;
        const stillNeeded = needed.every((m) => this.loadedMidis.has(m));
        if (stillNeeded) return;
      }

      const mergedMidis = [...new Set([...this.loadedMidis, ...needed])].sort((a, b) => a - b);

      this.loadPromise = (async () => {
        const { SplendidGrandPiano } = await import(SMPLR_URL);

        if (this.piano) {
          try {
            this.piano.stop();
          } catch (_) {
            /* ignore */
          }
        }

        const piano = new SplendidGrandPiano(ctx, {
          volume: 80,
          decayTime: DEFAULT_AMP_RELEASE,
          notesToLoad: {
            notes: mergedMidis,
            velocityRange: [1, 127],
          },
        });

        if (piano.output && piano.output.input) {
          piano.output.input.connect(this.masterGain);
        }

        let progressTimer = null;
        if (onProgress) {
          progressTimer = window.setInterval(() => {
            const { loaded, total } = piano.loadProgress || {};
            if (total) onProgress(loaded, total);
          }, 200);
        }

        try {
          await piano.load;
          this.piano = piano;
          mergedMidis.forEach((m) => this.loadedMidis.add(m));
          if (onProgress) {
            const { total } = piano.loadProgress || {};
            onProgress(total || mergedMidis.length, total || mergedMidis.length);
          }
          await this.warmup();
        } finally {
          if (progressTimer !== null) {
            window.clearInterval(progressTimer);
          }
        }
      })();

      try {
        await this.loadPromise;
      } finally {
        this.loadPromise = null;
      }
    }

    async warmup() {
      if (this.warmedUp || !this.piano || !this.context) return;
      if (this.context.state !== 'running') return;
      this.warmedUp = true;
      try {
        const stop = this.piano.start({
          note: 60,
          velocity: 1,
          duration: 0.05,
          ampRelease: 0.05,
          stopId: -1,
        });
        if (typeof stop === 'function') stop();
        this.piano.stop();
      } catch (_) {
        this.warmedUp = false;
      }
    }

    async init(noteMap, options = {}) {
      this.noteMap = { ...noteMap };
      this.ensureContext();
      this.keyToMidi = this.buildKeyToMidi(this.noteMap);

      const midis = [...this.keyToMidi.values()];
      if (!midis.length) {
        throw new Error('No valid notes in note map');
      }

      await this.loadPiano(midis, options.onProgress);
    }

    async initWithButton(noteMap, continueBtn) {
      const btn = continueBtn instanceof HTMLElement ? continueBtn : null;
      const originalText = btn ? btn.textContent : '';

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Loading piano…';
      }

      try {
        await this.init(noteMap, {
          onProgress: (loaded, total) => {
            if (btn && total) {
              btn.textContent = `Loading piano… (${loaded}/${total})`;
            }
          },
        });
        if (btn) {
          btn.textContent = originalText;
          btn.disabled = false;
        }
      } catch (err) {
        if (btn) {
          btn.textContent = 'Loading failed — tap to retry';
          btn.disabled = false;
        }
        throw err;
      }
    }

    resolveMidi(keyOrPath) {
      const key = String(keyOrPath);
      if (this.keyToMidi.has(key)) {
        return this.keyToMidi.get(key);
      }
      if (this.noteMap[key]) {
        const midi = parseNoteKey(key, this.noteMap[key]);
        if (midi !== null) return midi;
      }
      const fromPath = parseNoteNameFromPath(keyOrPath);
      if (fromPath) {
        const midi = noteNameToMidi(fromPath);
        return midi !== null ? midi + LEGACY_MP3_OCTAVE_OFFSET : null;
      }
      const fromKey = noteNameToMidi(key);
      return fromKey !== null ? fromKey + LEGACY_MP3_OCTAVE_OFFSET : null;
    }

    stopAll() {
      for (const stop of this.activeStops.values()) {
        if (typeof stop === 'function') stop();
      }
      this.activeStops.clear();
      if (this.piano) {
        try {
          this.piano.stop();
        } catch (_) {
          /* ignore */
        }
      }
    }

    playNote(keyOrPath, options = {}) {
      if (!this.piano || !this.context) return null;

      const {
        when = this.context.currentTime,
        gain = 1,
        detune = 0,
        duration = DEFAULT_NOTE_DURATION,
        ampRelease = DEFAULT_AMP_RELEASE,
      } = options;

      const midi = this.resolveMidi(keyOrPath);
      if (midi === null) return null;

      const velocity = Math.max(1, Math.min(127, Math.round(gain * 90)));

      try {
        this.activeStops.get(midi)?.();
        const stop = this.piano.start({
          note: midi,
          velocity,
          detune,
          time: when,
          duration,
          ampRelease,
          stopId: midi,
        });
        if (typeof stop === 'function') {
          this.activeStops.set(midi, stop);
        }
        return { midi, stop };
      } catch (_) {
        return null;
      }
    }

    playChord(keysOrPaths, options = {}) {
      const { when = this.context.currentTime, gain = 0.7 } = options;
      return keysOrPaths
        .map((key) => this.playNote(key, { ...options, when, gain: gain }))
        .filter(Boolean);
    }
  }

  window.AudioEngine = new SharedAudioEngine();
})();
