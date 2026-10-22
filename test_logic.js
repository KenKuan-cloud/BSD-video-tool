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
