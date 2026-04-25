(function () {
  class SharedAudioEngine {
    constructor() {
      this.context = null;
      this.masterGain = null;
      this.buffers = new Map();
      this.pathToKey = new Map();
      this.loadingPromise = null;
      this.noteMap = {};
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

    async init(noteMap) {
      this.noteMap = { ...noteMap };
      this.ensureContext();
      await this.preloadNotes(this.noteMap);
    }

    async preloadNotes(noteMap) {
      this.ensureContext();
      this.noteMap = { ...noteMap };

      const entries = Object.entries(noteMap).filter(([, path]) => !this.pathToKey.has(path));
      if (!entries.length) return;

      if (this.loadingPromise) {
        await this.loadingPromise;
      }

      this.loadingPromise = Promise.all(
        entries.map(async ([key, path]) => {
          const response = await fetch(path);
          if (!response.ok) {
            throw new Error(`Failed to load audio file: ${path}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const decoded = await this.context.decodeAudioData(arrayBuffer.slice(0));
          this.buffers.set(key, decoded);
          this.pathToKey.set(path, key);
        })
      ).finally(() => {
        this.loadingPromise = null;
      });

      await this.loadingPromise;
    }

    getBuffer(keyOrPath) {
      if (this.buffers.has(keyOrPath)) {
        return this.buffers.get(keyOrPath);
      }

      if (this.pathToKey.has(keyOrPath)) {
        return this.buffers.get(this.pathToKey.get(keyOrPath));
      }

      if (this.noteMap[keyOrPath]) {
        const mappedPath = this.noteMap[keyOrPath];
        if (this.pathToKey.has(mappedPath)) {
          return this.buffers.get(this.pathToKey.get(mappedPath));
        }
      }

      return null;
    }

    playNote(keyOrPath, options = {}) {
      const {
        when = this.context.currentTime,
        gain = 1,
        playbackRate = 1,
        destination = null
      } = options;

      const buffer = this.getBuffer(keyOrPath);
      if (!buffer) {
        return null;
      }

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;

      const gainNode = this.context.createGain();
      gainNode.gain.value = gain;

      source.connect(gainNode);
      gainNode.connect(destination || this.masterGain);
      source.start(when);

      return { source, gainNode };
    }

    playChord(keysOrPaths, options = {}) {
      const { when = this.context.currentTime, gain = 0.7 } = options;
      const chordGain = this.context.createGain();
      chordGain.gain.value = gain;
      chordGain.connect(this.masterGain);

      return keysOrPaths
        .map((key) => this.playNote(key, { ...options, when, gain: 1, destination: chordGain }))
        .filter(Boolean);
    }
  }

  window.AudioEngine = new SharedAudioEngine();
})();
