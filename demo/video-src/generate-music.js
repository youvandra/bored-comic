// Synthesizes an ~88s upbeat synth/chiptune backing track as a 16-bit stereo WAV.
// Pure Node, no deps. Style: energetic comic-action lo-fi — pad chords, plucky
// bass, light drums. Sections: intro -> groove -> bridge (softer) -> push -> outro.
const fs = require("fs");
const path = require("path");

const SR = 44100;
const BPM = 112;
const BEAT = 60 / BPM; // 0.5357s
const BAR = BEAT * 4;
const BARS = 41; // ~87.9s
const DUR = BARS * BAR;
const N = Math.ceil(DUR * SR);
const L = new Float64Array(N);
const R = new Float64Array(N);

// note name -> frequency
const A4 = 440;
function freq(semisFromA4) {
  return A4 * Math.pow(2, semisFromA4 / 12);
}
// semitone offsets from A4 for named notes (octave 4 reference)
const NOTE = { C: -9, D: -7, E: -5, F: -8 + 4, G: -2, A: 0, B: 2 };
function n(name, oct) {
  return freq(NOTE[name] + (oct - 4) * 12);
}

// chord progression: Am F C G (vi IV I V) — loops each 4 bars
const PROG = [
  [n("A", 3), n("C", 4), n("E", 4)],
  [n("F", 3), n("A", 3), n("C", 4)],
  [n("C", 3), n("E", 3), n("G", 3), n("C", 4)],
  [n("G", 3), n("B", 3), n("D", 4)],
];
const BASS_ROOT = [n("A", 1), n("F", 1), n("C", 2), n("G", 1)];
// A-minor pentatonic pool for lead
const PENTA = [n("A", 4), n("C", 5), n("D", 5), n("E", 5), n("G", 5), n("A", 5)];

function addSample(t, vL, vR) {
  const i = Math.floor(t * SR);
  if (i >= 0 && i < N) {
    L[i] += vL;
    R[i] += vR;
  }
}

// render an oscillator note into the buffers
function tone(start, dur, f, amp, { shape = "saw", attack = 0.01, decay = dur, pan = 0, detune = 0, lp = 1 } = {}) {
  const s0 = Math.floor(start * SR);
  const s1 = Math.min(N, Math.floor((start + dur) * SR));
  let phase = 0, phase2 = 0;
  const dp = (f * (1 + detune)) / SR;
  const dp2 = (f * (1 - detune)) / SR;
  let lpState = 0;
  const gL = amp * (1 - Math.max(0, pan)) ;
  const gR = amp * (1 + Math.min(0, pan));
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    // envelope
    let env = t < attack ? t / attack : Math.exp(-(t - attack) / (decay * 0.45));
    let v;
    if (shape === "saw") v = (phase % 1) * 2 - 1 + ((phase2 % 1) * 2 - 1);
    else if (shape === "square") v = (phase % 1 < 0.5 ? 1 : -1) * 1.2;
    else if (shape === "tri") { const p = phase % 1; v = (p < 0.5 ? p * 4 - 1 : 3 - p * 4) * 1.6; }
    else v = Math.sin(phase * 2 * Math.PI) * 1.5;
    phase += dp; phase2 += dp2;
    // one-pole lowpass
    lpState += lp * (v - lpState);
    const out = lpState * env;
    L[i] += out * gL;
    R[i] += out * gR;
  }
}

function kick(start, amp = 1) {
  const s0 = Math.floor(start * SR);
  const s1 = Math.min(N, s0 + Math.floor(0.22 * SR));
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const f = 120 * Math.exp(-t * 22) + 42;
    const env = Math.exp(-t * 16);
    const v = Math.sin(2 * Math.PI * f * t * (1 + 8 * Math.exp(-t * 40))) * env * 0.9 * amp;
    L[i] += v; R[i] += v;
  }
}
let noiseSeed = 22222;
function rnd() { noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff; return noiseSeed / 0x40000000 - 1; }
function snare(start, amp = 1) {
  const s0 = Math.floor(start * SR);
  const s1 = Math.min(N, s0 + Math.floor(0.16 * SR));
  let hp = 0, prev = 0;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const env = Math.exp(-t * 26);
    const nz = rnd();
    hp = 0.9 * (hp + nz - prev); prev = nz;
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 34) * 0.5;
    const v = (hp * 0.6 + body) * env * 0.65 * amp;
    L[i] += v * 0.9; R[i] += v;
  }
}
function hat(start, amp = 1, open = false) {
  const s0 = Math.floor(start * SR);
  const s1 = Math.min(N, s0 + Math.floor((open ? 0.12 : 0.04) * SR));
  let hp = 0, prev = 0;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const env = Math.exp(-t * (open ? 26 : 70));
    const nz = rnd();
    hp = 0.96 * (hp + nz - prev); prev = nz;
    const v = hp * env * 0.22 * amp;
    L[i] += v * (i % 2 ? 1 : 0.7); R[i] += v * (i % 2 ? 0.7 : 1);
  }
}

// ---- arrangement ----
// bar index helpers
const t0 = (bar) => bar * BAR;

for (let bar = 0; bar < BARS; bar++) {
  const sec =
    bar < 4 ? "intro" :
    bar < 16 ? "groove" :
    bar < 24 ? "bridge" :
    bar < 36 ? "push" :
    "outro";
  const chord = PROG[bar % 4];
  const bass = BASS_ROOT[bar % 4];
  const bt = t0(bar);
  const energy = sec === "intro" ? 0.5 : sec === "bridge" ? 0.62 : sec === "outro" ? 0.45 : 1;

  // pad chord — soft attack, whole bar
  for (const f of chord) {
    tone(bt, BAR * 1.05, f, 0.045 * (sec === "bridge" ? 1.3 : 1), {
      shape: "saw", attack: 0.4, decay: BAR, detune: 0.003, lp: 0.08,
      pan: (f > 300 ? 0.3 : -0.3),
    });
  }

  if (sec === "intro" && bar < 2) continue; // first 2 bars: pad only

  // bass — 8th-note pluck pattern
  if (sec !== "outro" || bar < BARS - 2) {
    for (let e = 0; e < 8; e++) {
      const accent = e === 0 || e === 5 ? 1 : 0.75;
      const oct = e === 3 || e === 7 ? 2 : 1;
      tone(bt + e * BEAT * 0.5, BEAT * 0.42, bass * oct, 0.16 * accent * energy, {
        shape: "square", attack: 0.004, decay: 0.16, lp: 0.18,
      });
    }
  }

  // drums
  if (sec !== "intro") {
    kick(bt, energy); kick(bt + 2 * BEAT, energy);
    if (sec === "push" && bar % 2 === 1) kick(bt + 3.5 * BEAT, 0.8 * energy);
    snare(bt + BEAT, 0.9 * energy); snare(bt + 3 * BEAT, 0.9 * energy);
    for (let e = 0; e < 8; e++) hat(bt + e * BEAT * 0.5, (e % 2 ? 0.55 : 1) * energy, sec === "push" && e === 7);
  } else {
    for (let e = 0; e < 4; e++) hat(bt + e * BEAT, 0.5);
  }

  // lead — sparse pluck melody on groove/push, deterministic pattern
  if (sec === "groove" || sec === "push") {
    const pat = [0, 2, 4, 3, 5, 4, 2, 1];
    for (let e = 0; e < 8; e++) {
      if ((bar + e) % 3 === 0) continue; // leave holes
      const f = PENTA[pat[(e + bar) % 8] % PENTA.length];
      tone(bt + e * BEAT * 0.5, BEAT * 0.3, f, 0.05 * energy, {
        shape: "tri", attack: 0.005, decay: 0.12, lp: 0.35, pan: e % 2 ? 0.35 : -0.35,
      });
    }
  }
  // bridge arpeggio — gentle
  if (sec === "bridge") {
    for (let e = 0; e < 8; e++) {
      const f = chord[e % chord.length] * 2;
      tone(bt + e * BEAT * 0.5, BEAT * 0.4, f, 0.035, {
        shape: "sine", attack: 0.01, decay: 0.2, lp: 0.5, pan: e % 2 ? 0.4 : -0.4,
      });
    }
  }
}
// final hit
kick(t0(BARS - 1), 1);
tone(t0(BARS - 1), BAR * 2, n("A", 2), 0.12, { shape: "saw", attack: 0.02, decay: BAR * 1.5, lp: 0.12, detune: 0.004 });

// ---- master: soft clip + fade in/out, write WAV ----
const fadeIn = 0.5 * SR, fadeOut = 2.5 * SR;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  let g = 1;
  if (i < fadeIn) g = i / fadeIn;
  if (i > N - fadeOut) g = (N - i) / fadeOut;
  const l = Math.tanh(L[i] * 1.1) * 0.85 * g;
  const r = Math.tanh(R[i] * 1.1) * 0.85 * g;
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
const out = path.join(__dirname, "public", "music.wav");
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log("wrote", out, (pcm.length / SR / 4).toFixed(1) + "s");
