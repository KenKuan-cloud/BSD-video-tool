# BSD Event Analyzer

Single-file offline tool (`bsd_event_analyzer.html`) for finding BSD warning-lamp events in long test-drive screen recordings and reviewing them against the rear-side cameras. Open it from disk in Chrome or Edge; no install, no network.

## Status
- [x] Phase 1: load/player, ROI tool, lamp calibration, live lamp score
- [x] Phase 2: `BSD_ACTIVE` ROI (green lamp) + green classifier; scan (seek + play modes) that only counts time while BSD Active is on; event extraction; strip chart with L / R / BSD Active tracks
- [x] Phase 3: review UI, KPI hotkeys, Mark In/Out frame count, FPS entry, time mapping
- [x] Phase 5: detection zones (`RL_ZONE` / `RR_ZONE`, 4 corners) find vehicles with or without the lamp; "BSD Light = Off" events; automatic exact frame count
- [x] Save clip: lossless MKV cut from the Edit view or the Review window
- [x] Phase 4: results table + summary chart, exports, i18n completion, auto-suggestion

## How to use
1. **Edit:** open the recording, press *Detect* for the frame rate, draw the ROIs (lamps, BSD Active, both cameras; optionally SPEED, CLOCK, distance boxes and `RL_FPS` / `RR_FPS` over the camera window titles), calibrate each lamp with *Sample ON* / *Sample OFF*, then *Start scan*.
   *Detection zone (optional, recommended):* draw `RL_ZONE` / `RR_ZONE` along the BSD zone in each camera (drag a box, then drag the 4 corners onto the grid lines), press *Sample EMPTY* on 2–3 frames with an empty zone and *Sample VEHICLE* on a frame with a vehicle in it. Vehicles found in the zone while BSD Active is on but no lamp lights are listed as **BSD Light = Off**; every zone event gets an exact frame count after the scan. For short passes scan with *Play 2×* or *Seek 10 samples/s*.
2. **Review:** for each event press `1`–`4` for the KPI type, `I` / `O` to mark the vehicle entering and leaving (frame count), type the camera fps from the capture, add a note. `←` / `→` moves between events. The dashed KPI button is the automatic suggestion; you decide.
3. **Report:** check the summary, then *Export CSV*, *Copy rows for Excel* or *HTML report*. *Save session* keeps everything (settings, scan data, labels) in one JSON file.

## Results table (matches the KPI spreadsheet)
| Column | Source |
|---|---|
| Video Name | video file name |
| Timeline | lamp-on time (On) or the vehicle's entry into the zone (Off), video time `HH:MM:SS` |
| KPI Type | `1` Overtaking (we pass them) · `2` Overtaken (they pass us) · `3` Infrastructure (no vehicle / false alarm) · `4` Unclear |
| R/L | lamp side (L → RL camera, R → RR camera) |
| BSD Light | `On` = lamp event; `Off` = vehicle in the detection zone while BSD Active, but no lamp (missed warning) |
| FPS | camera fps, typed by the reviewer from a zoomed thumbnail of the camera window title (`RL_FPS` / `RR_FPS` ROIs); prefilled from the previous event on that side |
| Frame Count | recording frames the vehicle is inside the detection zone: found automatically (exact frame), or set with Mark In (`I`, first frame inside) / Mark Out (`O`, first frame after it left) |

Optional extra columns: wall-clock start (from the time anchor), note.

Exports: CSV in the column order above, a "Copy rows" button (tab-separated, pastes into the Excel template), self-contained HTML report (table + thumbnails + summary chart of counts by KPI type × side), session JSON.

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
