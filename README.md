# BSD Event Analyzer

Single-file offline tool (`bsd_event_analyzer.html`) for finding BSD warning-lamp events in long test-drive screen recordings and reviewing them against the rear-side cameras. Open it from disk in Chrome or Edge; no install, no network.

## Status
- [x] Phase 1: load/player, ROI tool, lamp calibration, live lamp score
- [ ] Phase 2: scan (seek + play modes), event extraction, strip chart
- [ ] Phase 3: review UI, hotkeys, time mapping
- [ ] Phase 4: exports, i18n completion, auto-suggestion

## Tests
```
node test_logic.js
```
Loads the `PURE LOGIC` section of the HTML and tests it with synthetic data.

## Video formats
MKV/MP4 with H.264 or VP9 play directly (multi-GB files are streamed from disk). If a file will not play:
```
ffmpeg -i in.mkv -c copy out.mp4
ffmpeg -i in.mkv -c:v libx264 -crf 23 -an out.mp4
```
