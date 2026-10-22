// Node test harness for the PURE LOGIC section of bsd_event_analyzer.html.
// Usage: node test_logic.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'bsd_event_analyzer.html'), 'utf8');
const B = html.indexOf('===== PURE LOGIC BEGIN =====');
const E = html.indexOf('/* ===== PURE LOGIC END =====');
if (B < 0 || E < B) { console.error('PURE LOGIC section not found'); process.exit(1); }
const src = html.slice(html.indexOf('*/', B) + 2, E);
const PL = vm.runInNewContext(src + '\n;PureLogic', {}, { filename: 'pure_logic.js' });

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL: ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function section(name, fn) { const f0 = fail; fn(); console.log((fail === f0 ? 'ok   ' : 'FAIL ') + name); }

// deterministic PRNG
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Build an RGBA buffer of n pixels: fraction `redFrac` lamp-red, rest panel grey, with noise.
function lampImage(n, redFrac, noise, seed) {
  const r = rng(seed), d = new Uint8ClampedArray(n * 4);
  const nRed = Math.round(n * redFrac);
  for (let i = 0; i < n; i++) {
    const j = i * 4, nz = () => (r() - 0.5) * 2 * noise;
    if (i < nRed) { d[j] = 230 + nz(); d[j + 1] = 40 + nz(); d[j + 2] = 35 + nz(); }   // lamp red
    else { const g = 128 + nz(); d[j] = g; d[j + 1] = g + nz() * 0.3; d[j + 2] = g + nz() * 0.3; } // grey panel
    d[j + 3] = 255;
  }
  return d;
}

const P = PL.DEFAULT_RED;

section('rgbToHsv basic colors', () => {
  const c = PL.rgbToHsv(255, 0, 0); ok(c.h === 0 && c.s === 1 && c.v === 1, 'pure red', c);
  ok(near(PL.rgbToHsv(0, 255, 0).h, 120), 'green 120');
  ok(near(PL.rgbToHsv(0, 0, 255).h, 240), 'blue 240');
  ok(near(PL.rgbToHsv(255, 0, 128).h, 360 - 30.117647, 1e-4), 'magenta-red ~330', PL.rgbToHsv(255, 0, 128));
  const g = PL.rgbToHsv(128, 128, 128); ok(g.s === 0 && g.h === 0, 'grey s=0', g);
  ok(PL.rgbToHsv(0, 0, 0).v === 0, 'black v=0');
});

section('isRedRgb thresholds', () => {
  ok(PL.isRedRgb(230, 40, 35, P), 'lamp red');
  ok(PL.isRedRgb(255, 60, 0, P), 'hue 14 (orange-red) is red');
  ok(!PL.isRedRgb(255, 80, 0, P), 'hue ~19 is not red');
  ok(PL.isRedRgb(255, 0, 60, P), 'hue ~346 is red');
  ok(!PL.isRedRgb(255, 0, 80, P), 'hue ~341 is not red');
  ok(!PL.isRedRgb(128, 128, 128, P), 'grey');
  ok(!PL.isRedRgb(255, 255, 255, P), 'white');
  ok(!PL.isRedRgb(0, 0, 0, P), 'black');
  ok(!PL.isRedRgb(80, 10, 10, P), 'dark red below V 0.35');
  ok(!PL.isRedRgb(220, 160, 160, P), 'pink below S 0.45');
  ok(PL.isRedRgb(90, 30, 30, { ...P, vMin: 0.3 }), 'tunable vMin');
  ok(!PL.isRedRgb(255, 60, 0, { ...P, hueLo: 10 }), 'tunable hueLo');
  // agreement with rgbToHsv on a sweep
  const r = rng(7); let mism = 0;
  for (let i = 0; i < 20000; i++) {
    const a = r() * 255 | 0, b = r() * 255 | 0, c = r() * 255 | 0, h = PL.rgbToHsv(a, b, c);
    const exp = h.s > 0 && h.v >= P.vMin && h.s >= P.sMin && (h.h <= P.hueLo || h.h >= P.hueHi);
    if (exp !== PL.isRedRgb(a, b, c, P)) mism++;
  }
  ok(mism === 0, 'isRedRgb agrees with rgbToHsv on 20k random pixels', mism);
  // redScore fast path must count exactly what isRedRgb counts (default + edge params)
  for (const q of [P, { hueLo: 0, hueHi: 360, sMin: 0, vMin: 0 }, { hueLo: 59, hueHi: 301, sMin: 0.2, vMin: 0.1 }, { hueLo: 90, hueHi: 270, sMin: 0.3, vMin: 0.3 }]) {
    const buf = new Uint8ClampedArray(40000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 7 === 0) ? 255 : r() * 256 | 0;
    let cnt = 0; for (let i = 0; i < buf.length; i += 4) if (PL.isRedRgb(buf[i], buf[i + 1], buf[i + 2], q)) cnt++;
    ok(near(PL.redScore(buf, q), cnt / 10000), 'redScore == isRedRgb count ' + JSON.stringify(q));
  }
});

section('redScore on synthetic lamp ROIs (noisy)', () => {
  ok(PL.redScore(new Uint8ClampedArray(0), P) === 0, 'empty -> 0');
  const on = PL.redScore(lampImage(48 * 48, 0.6, 25, 1), P);
  const off = PL.redScore(lampImage(48 * 48, 0.0, 25, 2), P);
  ok(near(on, 0.6, 0.01), 'ON lamp ~0.60', on);
  ok(off === 0, 'OFF lamp grey with noise -> 0', off);
  ok(PL.redScore(lampImage(100, 1, 0, 3), P) === 1, 'all red -> 1');
  // glitchy frame: compression noise leaves a few reddish pixels
  const glitch = PL.redScore(lampImage(48 * 48, 0.03, 25, 4), P);
  ok(glitch < 0.05, 'small red speckle stays low', glitch);
});

section('thresholdFromSamples / lampIsOn', () => {
  ok(near(PL.thresholdFromSamples(0.6, 0.02), 0.31), 'midpoint');
  ok(PL.thresholdFromSamples(0.1, 0.2) === null, 'ON < OFF -> null');
  ok(PL.thresholdFromSamples(0.2, 0.2) === null, 'ON == OFF -> null');
  ok(PL.thresholdFromSamples(null, 0.1) === null, 'missing -> null');
  ok(PL.lampIsOn(0.31, 0.31) && !PL.lampIsOn(0.309, 0.31), 'boundary is >=');
  ok(!PL.lampIsOn(null, 0.3), 'null score off');
  // a noisy ON/OFF sequence classifies correctly with the calibrated threshold
  const thr = PL.thresholdFromSamples(PL.redScore(lampImage(2304, 0.6, 25, 5), P), PL.redScore(lampImage(2304, 0, 25, 6), P));
  const truth = [0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0];
  const got = truth.map((b, i) => PL.lampIsOn(PL.redScore(lampImage(2304, b ? 0.45 + 0.2 * (i % 3) / 2 : 0.02 * (i % 3), 30, 100 + i), P), thr) ? 1 : 0);
  ok(got.join('') === truth.join(''), 'noisy sequence classified', got.join(''));
});

section('ROI geometry', () => {
  const r = PL.rectFromPoints(0.8, 0.9, 0.2, 0.1);
  ok(near(r.x, 0.2) && near(r.y, 0.1) && near(r.w, 0.6) && near(r.h, 0.8), 'any drag direction', r);
  const c = PL.clampNormRect({ x: -0.1, y: 0.5, w: 0.3, h: 0.7 });
  ok(near(c.x, 0) && near(c.w, 0.2) && near(c.h, 0.5), 'clamped to [0,1]', c);
  ok(PL.clampNormRect({ x: 0.5, y: 0.5, w: 0, h: 0.1 }) === null, 'zero width -> null');
  ok(PL.clampNormRect({ x: 2, y: 0, w: 1, h: 1 }) === null, 'fully outside -> null');
  ok(PL.clampNormRect({ x: 'a', y: 0, w: 1, h: 1 }) === null, 'garbage -> null');
  const n = PL.clampNormRect({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 });
  ok(near(n.x, 0.3) && near(n.y, 0.4), 'negative w/h normalized', n);
  const mv = PL.moveRect({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }, 0.5, -1);
  ok(near(mv.x, 0.8) && near(mv.y, 0), 'move clamps inside', mv);
  // normalized ROIs survive a resolution change
  const roi = { x: 0.68, y: 0.66, w: 0.05, h: 0.08 };
  const a = PL.normToPx(roi, 1660, 927), b = PL.normToPx(roi, 3320, 1854);
  ok(Math.abs(b.sx - 2 * a.sx) <= 1 && Math.abs(b.sw - 2 * a.sw) <= 1, 'scales with resolution', [a, b]);
  const e = PL.normToPx({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, 100, 100);
  ok(e.sx + e.sw <= 100 && e.sy + e.sh <= 100 && e.sw >= 1, 'stays inside frame', e);
});

section('fmtVideoTime', () => {
  ok(PL.fmtVideoTime(0) === '00:00.000', 'zero');
  ok(PL.fmtVideoTime(65.5) === '01:05.500', 'm:s.ms');
  ok(PL.fmtVideoTime(3723.004) === '1:02:03.004', 'hours');
  ok(PL.fmtVideoTime(59.9996) === '01:00.000', 'rounds up across minute');
  ok(PL.fmtVideoTime(NaN) === '--:--.---' && PL.fmtVideoTime(Infinity) === '--:--.---', 'invalid');
});

section('fps estimation', () => {
  const mk = (fps, n, drop) => { const a = []; for (let i = 0; i < n; i++) if (!drop || i % drop) a.push(i / fps + 5); return a; };
  ok(PL.estimateFps(mk(30, 30)) === 30, '30 fps');
  ok(PL.estimateFps(mk(59.94, 40)) === 59.94, '59.94 fps');
  ok(PL.estimateFps(mk(60, 40, 5)) === 60, '60 fps with dropped frames');
  ok(PL.estimateFps(mk(60.2, 40)) === 60, '60.2 measured snaps to 60');
  ok(PL.estimateFps([1, 1, 1]) === null, 'not enough data');
  ok(PL.snapFps(37) === 37, 'non-standard kept');
});

section('session key match', () => {
  const a = PL.sessionKey('drive.mkv', 1987654321, 3605.1234);
  ok(a.duration === 3605.123, 'duration rounded to ms');
  ok(PL.sessionKeyMismatch(a, PL.sessionKey('drive.mkv', 1987654321, 3605.4)).length === 0, 'duration within 0.5 s');
  ok(PL.sessionKeyMismatch(a, PL.sessionKey('drive.mkv', 1987654321, 3606)).join() === 'duration', 'duration off');
  ok(PL.sessionKeyMismatch(a, PL.sessionKey('drive2.mkv', 1, 3605)).join() === 'name,size', 'name+size off');
  ok(PL.sessionKeyMismatch(null, a)[0] === 'missing', 'missing');
  ok(PL.sessionKeyMismatch(PL.sessionKey('x', 1, Infinity), PL.sessionKey('x', 1, Infinity)).length === 0, 'unknown duration on both');
});

// ---------------- Phase 2 ----------------
const G = PL.DEFAULT_GREEN;

section('green classifier (BSD Active)', () => {
  ok(PL.isHueInRangeRgb(40, 200, 60, G), 'lamp green');
  ok(PL.isHueInRangeRgb(60, 220, 120, G), 'green-cyan ~142');
  ok(!PL.isHueInRangeRgb(230, 40, 35, G), 'red is not green');
  ok(!PL.isHueInRangeRgb(200, 200, 40, G), 'yellow 60 not green');
  ok(!PL.isHueInRangeRgb(40, 120, 240, G), 'blue not green');
  ok(!PL.isHueInRangeRgb(128, 128, 128, G), 'grey');
  ok(!PL.isHueInRangeRgb(20, 70, 25, G), 'dark green below V');
  const img = new Uint8ClampedArray(400 * 4);
  for (let i = 0; i < 400; i++) { const on = i < 300; img.set(on ? [40, 210, 70, 255] : [120, 122, 125, 255], i * 4); }
  ok(near(PL.greenScore(img, G), 0.75), 'greenScore 0.75', PL.greenScore(img, G));
  ok(PL.greenScore(new Uint8ClampedArray(0), G) === 0, 'empty -> 0');
});

section('parseTime', () => {
  ok(PL.parseTime('') === null && PL.parseTime('  ') === null && PL.parseTime(null) === null, 'empty -> null');
  ok(PL.parseTime('83.5') === 83.5, 'seconds');
  ok(PL.parseTime('1:23') === 83, 'm:ss');
  ok(PL.parseTime('01:02:03.25') === 3723.25, 'h:mm:ss.ms');
  ok(PL.parseTime(PL.fmtVideoTime(3723.004)) === 3723.004, 'round-trips fmtVideoTime');
  ok(Number.isNaN(PL.parseTime('1:75')), 'seconds >= 60 invalid');
  ok(Number.isNaN(PL.parseTime('abc')) && Number.isNaN(PL.parseTime('-5')), 'garbage invalid');
});

// Synthetic sampled timeline: fn(t) -> {L,R,A} scores, sampled every dt seconds.
function timeline(t0, t1, dt, fn) {
  const out = [];
  const n = Math.round((t1 - t0) / dt);
  for (let i = 0; i <= n; i++) { const t = +(t0 + i * dt).toFixed(6); out.push(Object.assign({ t }, fn(t, i))); }
  return out;
}
const OPTS = { thrL: 0.3, thrR: 0.3, thrA: 0.3, gate: true, mergeGap: 0.5, minDuration: 0.3, maxHalf: 0.5 };
const inR = (t, a, b) => t >= a && t < b;

section('samples: merge / pack / coverage', () => {
  const ex = timeline(0, 10, 1, () => ({ L: 0, R: 0, A: 1 }));
  const fresh = timeline(3, 5, 0.5, () => ({ L: 1, R: 0, A: 1 }));
  const m = PL.mergeSamples(ex, fresh, 3, 5);
  ok(m.length === 11 - 3 + 5, 'replaced 3 old samples by 5 new', m.length);
  ok(m.every((s, i) => i === 0 || s.t > m[i - 1].t), 'still sorted');
  ok(m.filter(s => s.t >= 3 && s.t <= 5).every(s => s.L === 1), 'range holds only fresh');
  ok(PL.mergeSamples([], fresh, 3, 5).length === 5, 'into empty');
  ok(PL.lowerBound(ex, 4.5) === 5 && PL.lowerBound(ex, -1) === 0 && PL.lowerBound(ex, 99) === 11, 'lowerBound');
  const pk = PL.packSamples([{ t: 1.23456, L: 0.71234, R: 0, A: null }]);
  const up = PL.unpackSamples(JSON.parse(JSON.stringify(pk)));
  ok(up.length === 1 && up[0].t === 1.235 && up[0].L === 0.712 && up[0].A === null, 'pack/unpack round trip', up);
  ok(PL.unpackSamples({ data: [[null, 1], 'x', [2, 0.5, 0.1, 0.9]] }).length === 1, 'unpack skips bad rows');
  ok(PL.unpackSamples(null).length === 0, 'unpack null');
  const cov = PL.coverageSec(timeline(0, 10, 0.2, () => ({})).concat(timeline(20, 30, 0.2, () => ({}))), 1);
  ok(near(cov, 20, 1e-6), 'coverage skips 10 s hole', cov);
  ok(near(PL.scanEta(0, 100, 25, 10), 30) && PL.scanEta(0, 100, 0, 5) === null, 'scanEta');
});

section('events: clean ON/OFF + edge placement', () => {
  // L on from 2.0 to 4.0 (samples at 5 fps), BSD active
  const s = timeline(0, 10, 0.2, t => ({ L: inR(t, 2, 4) ? 0.7 : 0.01, R: 0, A: 0.8 }));
  const ev = PL.extractEvents(s, OPTS);
  ok(ev.length === 1 && ev[0].side === 'L' && ev[0].id === 1, 'one L event', ev);
  ok(near(ev[0].tStart, 1.9, 1e-6) && near(ev[0].tEnd, 3.9, 1e-6), 'edges halfway to neighbours', ev[0]);
  ok(near(ev[0].duration, 2.0, 1e-6), 'duration ~2.0 s');
  // lamp on at the very first / last sample: edges clamp to sample times
  const e2 = PL.extractEvents(timeline(0, 3, 0.2, t => ({ L: 0.7, R: 0, A: 1 })), OPTS);
  ok(e2.length === 1 && e2[0].tStart === 0 && e2[0].tEnd === 3, 'whole range ON', e2);
  // data hole: edges extend at most maxHalf
  const holes = [{ t: 0, L: 0, A: 1 }, { t: 0.2, L: 0.8, A: 1 }, { t: 0.4, L: 0.8, A: 1 }, { t: 10, L: 0, A: 1 }];
  const e3 = PL.extractEvents(holes, OPTS);
  ok(e3.length === 1 && near(e3[0].tEnd, 0.9), 'edge capped by maxHalf over data gap', e3);
});

section('events: noisy sequence, short glitches', () => {
  const r = rng(42);
  const truth = [[5, 9], [20, 21.5], [40, 47]];
  const s = timeline(0, 60, 0.2, t => {
    const on = truth.some(([a, b]) => inR(t, a, b));
    return { L: on ? 0.55 + (r() - 0.5) * 0.3 : 0.04 + r() * 0.08, R: 0.02, A: 0.9 };
  });
  // inject glitches: one-sample flash while OFF, one-sample dropout while ON
  s[Math.round(30 / 0.2)].L = 0.9;     // flash at 30 s (0.2 s long -> < minDuration)
  s[Math.round(7 / 0.2)].L = 0.0;      // dropout inside 5–9 s
  s[Math.round(44 / 0.2)].L = 0.0;     // dropout inside 40–47 s
  const ev = PL.extractEvents(s, OPTS);
  ok(ev.length === 3, '3 events (flash dropped, dropouts merged)', ev.map(e => [e.tStart, e.tEnd]));
  ev.forEach((e, i) => ok(Math.abs(e.tStart - truth[i][0]) <= 0.2 && Math.abs(e.tEnd - truth[i][1]) <= 0.2, 'edges within one sample #' + (i + 1), e));
  // without merging, each dropout splits an event
  ok(PL.extractEvents(s, { ...OPTS, mergeGap: 0 }).length === 5, 'mergeGap 0 -> dropouts split');
  // without min duration the flash appears
  ok(PL.extractEvents(s, { ...OPTS, minDuration: 0 }).length === 4, 'minDuration 0 -> flash kept');
});

section('events: merge-gap and min-duration boundaries', () => {
  const seg = (a, b) => ({ tStart: a, tEnd: b });
  ok(PL.mergeSegments([seg(0, 1), seg(1.49, 2)], 0.5).length === 1, 'gap 0.49 < 0.5 merges');
  ok(PL.mergeSegments([seg(0, 1), seg(1.5, 2)], 0.5).length === 2, 'gap 0.50 == mergeGap does not merge');
  ok(PL.mergeSegments([seg(0, 1), seg(1.51, 2)], 0.5).length === 2, 'gap 0.51 does not merge');
  const chain = PL.mergeSegments([seg(0, 1), seg(1.3, 2), seg(2.4, 3)], 0.5);
  ok(chain.length === 1 && chain[0].tEnd === 3, 'chained merge', chain);
  ok(PL.mergeSegments([seg(0, 5), seg(1, 2)], 0.5)[0].tEnd === 5, 'contained segment keeps outer end');
  ok(PL.dropShort([seg(0, 0.3)], 0.3).length === 1, 'duration == min kept');
  ok(PL.dropShort([seg(0, 0.29)], 0.3).length === 0, 'duration < min dropped');
  // sampled: a 0.5 s OFF gap at 10 fps (5 OFF samples) with mergeGap 0.5 -> edges 0.5 apart -> not merged; 0.4 s gap -> merged
  const mk = gap => timeline(0, 6, 0.1, t => ({ L: (inR(t, 1, 2.5) || inR(t, 2.5 + gap, 4)) ? 0.8 : 0, R: 0, A: 1 }));
  ok(PL.extractEvents(mk(0.4), OPTS).length === 1, 'sampled 0.4 s gap merges');
  ok(PL.extractEvents(mk(0.5), OPTS).length === 2, 'sampled 0.5 s gap stays split');
});

section('events: simultaneous L + R', () => {
  const s = timeline(0, 20, 0.2, t => ({ L: inR(t, 5, 10) ? 0.7 : 0, R: inR(t, 7, 12) ? 0.7 : 0, A: 1 }));
  const ev = PL.extractEvents(s, OPTS);
  ok(ev.length === 2, 'two events', ev);
  ok(ev[0].side === 'L' && ev[1].side === 'R' && ev[0].id === 1 && ev[1].id === 2, 'sorted by start, ids 1..n');
  const same = PL.extractEvents(timeline(0, 10, 0.2, t => ({ L: inR(t, 2, 4) ? 1 : 0, R: inR(t, 2, 4) ? 1 : 0, A: 1 })), OPTS);
  ok(same.length === 2 && same[0].side === 'L' && same[1].side === 'R', 'identical times -> L then R');
});

section('events: BSD Active gating', () => {
  // L lamp on 2–8 s, but BSD Active only on from 5 s
  const s = timeline(0, 12, 0.2, t => ({ L: inR(t, 2, 8) ? 0.7 : 0, R: inR(t, 1, 3) ? 0.7 : 0, A: t >= 5 ? 0.9 : 0.02 }));
  const ev = PL.extractEvents(s, OPTS);
  ok(ev.length === 1 && ev[0].side === 'L', 'R (active off) suppressed, L kept', ev);
  ok(near(ev[0].tStart, 4.9, 1e-6), 'L event starts when BSD Active turns on', ev[0]);
  ok(PL.extractEvents(s, { ...OPTS, gate: false }).length === 2, 'gate off -> both');
  // missing A scores (no BSD_ACTIVE ROI) with gate on -> nothing counts
  const noA = timeline(0, 5, 0.2, t => ({ L: 0.7, R: 0, A: null }));
  ok(PL.extractEvents(noA, OPTS).length === 0 && PL.extractEvents(noA, { ...OPTS, gate: false }).length === 1, 'null A');
  // binarize directly
  const b = PL.binarize([{ L: 0.5, A: 0.5 }, { L: 0.5, A: 0.1 }, { L: 0.1, A: 0.5 }], 'L', 0.3, 'A', 0.3);
  ok(b.join() === 'true,false,false', 'binarize with gate', b);
});

section('events: irregular play-mode sampling', () => {
  // ~7.5 samples/s with jitter and a 0.6 s stall inside an event
  const r = rng(3), s = [];
  for (let t = 0; t < 30; t += 0.1 + r() * 0.06) {
    if (t > 12.0 && t < 12.6) continue;   // stall
    s.push({ t, L: inR(t, 10, 15) ? 0.7 : 0.02, R: 0, A: 1 });
  }
  const ev = PL.extractEvents(s, OPTS);
  ok(ev.length === 1 && Math.abs(ev[0].tStart - 10) < 0.2 && Math.abs(ev[0].tEnd - 15) < 0.2, 'one event across the stall', ev);
});

section('extractEvents throughput (perf sanity)', () => {
  const s = timeline(0, 7200, 0.2, (t, i) => ({ L: (i % 97) < 10 ? 0.7 : 0, R: (i % 131) < 20 ? 0.7 : 0, A: 1 }));
  const t0 = process.hrtime.bigint();
  const ev = PL.extractEvents(s, OPTS);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 300, '2 h at 5 Hz (36k samples) in < 300 ms', ms.toFixed(1) + ' ms');
  console.log(`      (${s.length} samples -> ${ev.length} events in ${ms.toFixed(1)} ms)`);
});

// ---------------- Phase 3 ----------------
section('clock parsing + formatting', () => {
  ok(PL.parseClock('11:36:48 AM') === 11 * 3600 + 36 * 60 + 48, '12 h AM');
  ok(PL.parseClock('11:36:48 pm') === 23 * 3600 + 36 * 60 + 48, '12 h PM, lower case');
  ok(PL.parseClock('12:00:05 AM') === 5, '12 AM is midnight');
  ok(PL.parseClock('12:00:05 PM') === 12 * 3600 + 5, '12 PM is noon');
  ok(PL.parseClock('23:05:01') === 83101, '24 h');
  ok(PL.parseClock('7:05') === 7 * 3600 + 300, 'H:MM');
  ok(PL.parseClock('11:36:48.5') === 41808.5, 'fractional seconds');
  ok(PL.parseClock('') === null, 'empty -> null');
  for (const bad of ['24:00:00', '13:00 PM', '0:10 AM', '10:60', '10:00:60', 'abc', '1:2:3'])
    ok(Number.isNaN(PL.parseClock(bad)), 'invalid: ' + bad);
  ok(PL.fmtClock(41808.9) === '11:36:48', 'fmtClock truncates');
  ok(PL.fmtClock(86400 + 5) === '00:00:05' && PL.fmtClock(-5) === '23:59:55', 'fmtClock wraps both ways');
  ok(PL.fmtClock(NaN) === '--:--:--', 'fmtClock invalid');
  ok(PL.fmtHMS(116.9) === '00:01:56' && PL.fmtHMS(3723) === '01:02:03' && PL.fmtHMS(0) === '00:00:00', 'fmtHMS (sheet Timeline)');
  ok(PL.fmtHMS(-1) === '--:--:--', 'fmtHMS invalid');
});

section('time mapping incl. midnight rollover', () => {
  const a = { video: 83.0, clock: PL.parseClock('11:36:48 AM') };
  ok(PL.fmtClock(PL.videoToClock(83, a)) === '11:36:48', 'anchor itself');
  ok(PL.fmtClock(PL.videoToClock(83 + 3600 + 12.4, a)) === '12:37:00', 'one hour later');
  ok(PL.fmtClock(PL.videoToClock(0, a)) === '11:35:25', 'before the anchor');
  const late = { video: 10, clock: PL.parseClock('23:59:50') };
  ok(PL.fmtClock(PL.videoToClock(15, late)) === '23:59:55', 'before midnight');
  ok(PL.fmtClock(PL.videoToClock(20, late)) === '00:00:00', 'exactly midnight');
  ok(PL.fmtClock(PL.videoToClock(85, late)) === '00:01:05', 'rolls past midnight');
  ok(PL.fmtClock(PL.videoToClock(10 + 2 * 86400 + 30, late)) === '00:00:20', 'multi-day wraps');
  const early = { video: 100, clock: PL.parseClock('00:00:30') };
  ok(PL.fmtClock(PL.videoToClock(40, early)) === '23:59:30', 'backwards across midnight');
  ok(PL.videoToClock(5, null) === null && PL.videoToClock(NaN, a) === null, 'no anchor / bad time -> null');
});

section('frame count + review window', () => {
  ok(PL.frameCount(10.0, 10.5, 60) === 30, '0.5 s at 60 fps = 30 frames');
  ok(PL.frameCount(10, 10, 30) === 0, 'same frame -> 0');
  ok(PL.frameCount(1 / 30 * 100 + 0.004, 1 / 30 * 117 - 0.004, 30) === 17, 'rounds to frame index');
  ok(PL.frameCount(11, 10, 30) === null, 'out before in -> null');
  ok(PL.frameCount(null, 10, 30) === null && PL.frameCount(1, 2, 0) === null, 'missing -> null');
  const w = PL.eventWindow({ tStart: 2, tEnd: 5 }, 4, 2, 6);
  ok(w[0] === 0 && w[1] === 6, 'window clamped to video', w);
  const w2 = PL.eventWindow({ tStart: 100, tEnd: 103 }, 4, 2, 600);
  ok(w2[0] === 96 && w2[1] === 105, 'window -4/+2', w2);
  const st = PL.stripTimes(96, 105, 12);
  ok(st.length === 12 && st[0] === 96 && st[11] === 105 && near(st[1] - st[0], 9 / 11), '12 evenly spaced thumbnails');
  ok(PL.stripTimes(0, 10, 1)[0] === 5, 'single thumb = middle');
  ok(PL.KPI.join() === 'overtaking,overtaken,infrastructure,unclear', 'KPI order = hotkeys 1..4');
});

section('labels survive re-thresholding (matchLabels)', () => {
  const E = (side, a, b) => ({ side, tStart: a, tEnd: b });
  const labels = [E('L', 10, 14), E('R', 30, 33), E('L', 50, 51)];
  // same events, slightly shifted edges
  ok(PL.matchLabels([E('L', 9.9, 14.2), E('R', 30.1, 33), E('L', 50.1, 51)], labels).join() === '0,1,2', 'shifted edges keep labels');
  // side must match
  ok(PL.matchLabels([E('R', 10, 14)], labels).join() === '-1', 'other side does not match');
  // an event split in two: the bigger piece keeps the label, the other gets none
  ok(PL.matchLabels([E('L', 10, 11), E('L', 11.6, 14)], labels).join() === '-1,0', 'split: larger overlap wins');
  // two events merged into one: label with the bigger overlap wins, the other label is orphaned
  const two = [E('L', 10, 12), E('L', 12.4, 16)];
  ok(PL.matchLabels([E('L', 10, 16)], two).join() === '1', 'merge: larger overlap label wins');
  // short event that no longer overlaps but starts close by
  ok(PL.matchLabels([E('L', 51, 51.8)], labels).join() === '2', 'no overlap but start within 1 s');
  ok(PL.matchLabels([E('L', 53, 54)], labels).join() === '-1', 'too far -> none');
  // each label used once
  ok(PL.matchLabels([E('L', 10, 14), E('L', 10, 14)], [E('L', 10, 14)]).join() === '0,-1', 'label used once');
  ok(PL.matchLabels([], labels).length === 0 && PL.matchLabels([E('L', 1, 2)], []).join() === '-1', 'empty inputs');
  // end-to-end: extract, label, re-threshold, re-match
  const s = timeline(0, 40, 0.2, t => ({ L: inR(t, 5, 9) ? 0.6 : inR(t, 9, 9.6) ? 0.25 : 0, R: inR(t, 20, 24) ? 0.7 : 0, A: 1 }));
  const ev1 = PL.extractEvents(s, OPTS);
  const lab = ev1.map(e => ({ side: e.side, tStart: e.tStart, tEnd: e.tEnd, kpi: e.side === 'L' ? 'overtaken' : 'overtaking' }));
  const ev2 = PL.extractEvents(s, { ...OPTS, thrL: 0.2 });           // L event now lasts longer
  const m = PL.matchLabels(ev2, lab);
  ok(ev2.length === 2 && m.every(i => i >= 0) && lab[m[0]].kpi === 'overtaken' && lab[m[1]].kpi === 'overtaking', 'labels follow events after threshold change', { ev2, m });
});

section('redScore throughput (perf sanity)', () => {
  const img = lampImage(64 * 64, 0.5, 20, 9);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) PL.redScore(img, P);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 2000, '2000 x 64x64 ROIs in < 2 s', ms.toFixed(0) + ' ms');
  console.log(`      (${(ms / 2000).toFixed(3)} ms per 64x64 lamp ROI)`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
