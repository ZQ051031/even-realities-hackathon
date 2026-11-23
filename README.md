# Glance: a heads-up assistant for Even Realities G2

Entry for **Heads Up: Even Realities Hackathon** on DoraHacks (TVM Ventures × Daos Hub). Proposed track: **Track 04, AI Assistants & Work**.

Glance is a hands-free card deck for the G2 display (576×288, monochrome green). It answers "what's next, and what do I have to do?" without your phone:

| Card | What you see | Tap | Hold |
|---|---|---|---|
| **NOW** | next event + countdown, location, progress of the current event, top reminder | route to next event | **voice reminder** |
| **AGENDA** | today's timeline, `▶` marks now/next | pick an event (list), tap again to route to it | |
| **FOCUS** | Pomodoro timer (25/5 by default), progress bar, sessions done | start / pause | reset |
| **GO** | turn-by-turn style step cards to the event location (`STEP 1 of 3 ●○○`) | next step | restart route |
| **REMIND** | pending reminders with due times | mark the first one done | snooze 10 min |

- **Swipe up/down** cycles cards. **Double tap** returns to NOW; a double tap on NOW exits (`shutDownPageContainer`).
- **Heads-up alerts pop up by themselves**: a reminder that is due, an event starting in 5 minutes (tap opens its route), or a finished focus session (the break starts by itself). Tap = done/open, swipe = snooze/dismiss. Alerts close on their own after 20 s.
- A running focus timer stays visible in the header on every card (`▶ 24:35`).
- **Voice reminders**: hold on NOW and say *"remind me to call mum in 20 minutes"*. Glance records from the glasses microphone, transcribes on your own server (offline `whisper.cpp` by default), shows the parsed reminder and saves it after 8 s unless you change it. See [Voice reminders](#voice-reminders).
- **Contextual menu** (system long-press): Start/pause focus, Snooze reminder 10m, Route to next event, Refresh agenda, Reset focus timer, Voice reminder.
- **Phone companion page** (the WebView's phone screen, or the right side of the browser demo): type or speak a voice reminder, add/remove reminders, set focus/break minutes, set the calendar source, reset the demo.

![NOW card](docs/sim-now.png) ![AGENDA card](docs/sim-agenda.png)
![GO card](docs/sim-go.png) ![FOCUS card](docs/sim-focus.png)
![Reminder alert](docs/sim-reminder-alert.png) ![Event alert](docs/sim-event-alert.png)
![Voice: listening](docs/sim-voice-listen.png) ![Voice: confirm](docs/sim-voice-confirm.png)
![Contextual menu](docs/sim-menu.png)

*(Screenshots from the Even Hub simulator, taken by `npm run demo`. The voice screens show a real transcription of spoken audio through the simulator's microphone path.)*

**Layout.** Every card uses the same grid on the 576×288 display: a header (card name, card dots `●○○○○`, `DEMO` when the demo day is shown, and a clock box that hugs the right edge and also shows a running focus timer), one bordered body of at most 6 lines (the only event-capture container), and a dim footer that always says what tap / hold / swipe / double tap do right now. Text is clipped to fit and only uses glyphs the G2 font renders; the tests check every screen against the SDK's validator.

### Calendar data

- **Demo day (default):** without configuration, Glance shows a generated demo day, labelled `DEMO` in the header, so it works with no account and no API key.
- **Your calendar:** set `GLANCE_ICS_URL` to any iCal feed, for example the Google Calendar "Secret address in iCal format". Glance's small proxy (`/api/agenda`) fetches and parses the feed on the server, so the secret URL never reaches the glasses app. `GLANCE_ICS_FILE` reads a local `.ics` file instead.
- The parser (`src/core/ics.ts`) handles UTC, TZID, floating and all-day times; DURATION; DAILY and WEEKLY RRULEs (INTERVAL, COUNT, UNTIL, BYDAY); EXDATE; RECURRENCE-ID overrides; and cancelled events.
- **Route steps:** put lines like `GO: Take the lift to Level 3 | 1 min` in an event's description and the GO card uses them. Without them, Glance builds generic steps: leave by (walk time), head to the location, arrive.

## Run it

### Prerequisites

- **Node.js 22.18+ or 24** (tested with 24.22) and npm. The standalone proxy runs `.ts` directly through Node's type stripping.
- **Linux only:** the simulator needs WebKitGTK: `sudo apt-get install libwebkit2gtk-4.1-0`. macOS and Windows need nothing extra.
- **No accounts:** no Even Realities, Even Hub or DoraHacks account and no API key are needed to build, test or run Glance in the simulator. The simulator ships as an npm dev dependency.

### 1. Install

```bash
git clone https://github.com/ZQ051031/even-realities-hackathon.git
cd even-realities-hackathon
npm install
```

### 2. Start the dev server

```bash
npm run dev                                    # demo day
# or with a real calendar:
GLANCE_ICS_URL='https://calendar.google.com/calendar/ical/.../basic.ics' npm run dev
# or with the bundled sample calendar:
GLANCE_ICS_FILE=fixtures/sample-calendar.ics npm run dev
```

Vite serves the app on http://localhost:5173 and mounts the agenda proxy at `/api/agenda` and the speech-to-text endpoint at `/api/transcribe`. To turn on voice reminders, also set the `GLANCE_WHISPER_*` variables below.

### 3. Open it in the Even Hub simulator

In a second terminal:

```bash
npm run simulate                    # = evenhub-simulator http://localhost:5173
```

The simulator opens two windows: the phone WebView (Glance's companion page) and the glasses display. Use the simulator's touchpad controls: click, double click, swipe up/down, long press.

Scripted or remote demo: start the simulator with its automation server and drive it over HTTP:

```bash
npx evenhub-simulator http://localhost:5173 --automation-port 9898
curl http://127.0.0.1:9898/api/ping                                  # pong
curl -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' -d '{"action":"down"}'
# actions: click, double_click, up, down, context_menu, long_press, long_press_release
curl -o glasses.png http://127.0.0.1:9898/api/screenshot/glasses     # 576x288 PNG
```

### Scripted demo (one command)

```bash
npm run demo                                   # Linux needs DISPLAY set, like the simulator itself
npm run demo -- --pace 4 --keep                # slower, and leave the simulator open for recording
npm run demo -- --voice tts                    # include the voice reminder, spoken by espeak-ng (Linux + PulseAudio)
npm run demo -- --voice mic                    # include the voice reminder, you say it into your mic
```

`scripts/demo.ts` writes a demo calendar with times relative to now (`demo-out/demo.ics`), starts Vite and the simulator with its automation server (or attaches to ones already running on 5173/9898), then walks the whole app with ~3 s per step: the 5-minute event alert → GO route steps → NOW → AGENDA and the event picker → FOCUS → GO → REMIND → voice reminder → a due reminder popping up → done → contextual menu. Each step saves a screenshot to `demo-out/NN-step.png` and a line in `demo-out/captions.txt` (time, file, caption) for your voice-over. It takes about 75 s; nothing is uploaded. Voice needs speech-to-text configured (below), otherwise that step is skipped.

### Voice reminders

Flow: **hold on NOW** (or menu → Voice reminder, or **Speak** on the companion page) → `LISTENING` with a level meter → stop talking (or tap) → `TRANSCRIBING` → `NEW REMINDER` shows the parsed text and time. Tap saves, swipe moves it ±10 min, hold records again, double tap drops it. With no input it saves itself after 8 s, so it works hands-free.

- **Audio:** on Even Hub, `bridge.audioControl(true, AudioInputSource.Glasses)` streams 16 kHz 16-bit PCM in `audioEvent`s. The browser demo uses the browser microphone instead. Glance detects the end of speech itself (adaptive noise floor, 1.2 s of silence, 10 s max), then posts a WAV to `/api/transcribe`.
- **Speech-to-text runs on your Glance server, not on a cloud account by default.** Offline with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (no account, no key):

  ```bash
  git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp && cd ~/whisper.cpp
  cmake -B build && cmake --build build -j --config Release
  sh ./models/download-ggml-model.sh base.en            # ~140 MB
  cd -  # back to Glance
  GLANCE_WHISPER_CMD=~/whisper.cpp/build/bin/whisper-cli \
  GLANCE_WHISPER_MODEL=~/whisper.cpp/models/ggml-base.en.bin npm run dev
  ```

  Or any OpenAI-compatible `/audio/transcriptions` endpoint: `GLANCE_STT_URL=…` (`GLANCE_STT_KEY`, `GLANCE_STT_MODEL` optional). `GET /api/transcribe` reports which engine is on. Without either, the voice screen says speech-to-text is off; typing the sentence into the companion page's Voice reminder box still runs the same parser.
- **What it understands:** "remind me to…", "don't forget to…", "I need to…", "note to self…" followed by `in 20 minutes` / `in an hour and a half` / `in half an hour` / `at 6 pm` / `at 9:30` / `at noon` / `tonight` / `tomorrow at 8`. No time means in 30 min (marked on the confirm screen).

### 4. Browser demo (no simulator)

Open http://localhost:5173/?mock in any browser. A 576×288 mock of the G2 display shows next to the companion page.

| Key | Gesture |
|---|---|
| `↑` / `↓` | swipe |
| `Enter` / `Space` | tap |
| `Esc` / `Backspace` | double tap |
| `L` | long press (on NOW: voice reminder) |
| `M` | contextual menu |

On-screen buttons do the same. Outside the Even Hub WebView, the mock is used automatically.

### 5. Test, build and package

```bash
npm test          # 47 tests (vitest): ICS parsing/recurrence, focus timer, state machine, voice parser, endpointing, WAV,
                  # voice screens, STT server (fake whisper), controller mic capture, SDK layout validation, event mapping, proxy
npm run build     # tsc --noEmit + vite build -> dist/
npm run pack      # builds and packs out.ehpk with evenhub-cli (local only, nothing is uploaded)
```

The tests validate every card in many states against the SDK's own `validateEvenHubPageContainer`. They also check Even Hub limits: at most 8 containers, exactly one event-capture container, at most 20 list items of 64 characters each, and only glyphs the G2 firmware font renders.

### Optional: standalone agenda proxy

Use this if you host the static `dist/` somewhere else:

```bash
GLANCE_ICS_URL='https://…/basic.ics' PORT=8787 npm run agenda-server
```

Then enter `http://<host>:8787/api/agenda` in the companion page's Calendar field. If that origin is not the app's own, add a network permission/whitelist for it to `app.json` before packing for a real device.

## How it's built

```
src/core/        pure, testable logic: state machine + views (app.ts), ICS parser, focus timer, route steps, page limits
src/platform/    Even Hub renderer (create/rebuild/textContainerUpgrade over a serial queue), browser mock,
                 bridge-or-localStorage persistence, agenda loading with demo fallback, controller
src/companion.ts phone-side settings UI
src/core/voice.ts reminder parser ("call mum in 20 minutes" -> text + due time), endpointer, WAV encoder
server/          /api/agenda proxy and /api/transcribe speech-to-text (Vite plugin + standalone Node server)
scripts/demo.ts  scripted simulator walkthrough (npm run demo)
test/            vitest suites
```

- Each card is 4 text containers: header, clock, body (the single event-capture container) and footer hint. The agenda picker swaps in a native list container.
- Card switches update text in place with `textContainerUpgrade`. A full `rebuildPageContainer` happens only when the layout changes (deck ↔ list), which keeps BLE traffic low.
- State (reminders, focus timer) is saved with the bridge's `setLocalStorage`, so it survives an app restart.

## Hackathon rules and disclosure

### Build window rules (read on the DoraHacks page, 2026-11-22)

- Build starts **Nov 23, 2026 12:00 Dubai time (GMT+4)**, which is 08:00 UTC and 16:00 HKT/CST.
- Submission deadline is **Nov 29, 2026 23:59 Dubai time**, which is 19:59 UTC and **Nov 30, 03:59 HKT/CST**.
- Rule text: "Build during the hackathon. Open-source libraries and existing APIs are allowed; say in your README what existed before Nov 23."
- Remote demos are allowed and physical glasses are not required (the Even Hub simulator is fine). A submission needs a public repo and a demo video.

### What existed before Nov 23

This is commit `c27f1a9`, the first commit in this repo:

- the official template `even-realities/evenhub-templates/minimal` (Vite + TypeScript + Even Hub SDK), copied unmodified, with only dependency versions bumped
- `PLAN.md` (design notes written during research) and a README skeleton

Everything else was written after the window opened on Nov 23: all of `src/` except the template entry, `server/`, `scripts/`, `test/`, `fixtures/`, `docs/`, the UI and this README. Third-party code: only the npm dependencies in `package.json`, plus whisper.cpp as an optional, separately installed speech-to-text tool (not vendored).

## DoraHacks submission notes (for the team; not submitted)

The submission and demo video are still to do. Nothing has been submitted to DoraHacks.

- **Track:** 04, AI Assistants & Work. Alternative: the general category.
- **Repo:** https://github.com/ZQ051031/even-realities-hackathon (public).
- **One-liner:** "Glance turns your G2 into a hands-free day planner. Your next meeting, a focus timer, gentle reminders and step-by-step 'get there' cards, all one glance and one tap away."
- **Demo video plan (2–3 min, simulator):**
  Run `npm run demo -- --voice mic --pace 4 --keep` and record the screen; `demo-out/captions.txt` has the timings. It shows:
  1. The 5-minute event alert opening the GO route, stepping to "You have arrived".
  2. NOW card with the countdown, then AGENDA and the event picker.
  3. FOCUS started, the timer staying in the header on other cards.
  4. Voice: hold, say "remind me to call mum in 20 minutes", the confirm card, saved in REMIND.
  5. A reminder popping up by itself, tap done, then the contextual menu.
  6. Afterwards, by hand: the phone companion (type a voice reminder, load a real calendar with `GLANCE_ICS_URL`).
  7. Close with the hands-free design: one capture container, text-only cards, alerts and voice confirms that finish by themselves.
- **Disclosure:** copy the "What existed before Nov 23" section above.
- **Known limits:**
  - Tested in simulator v0.9.5 only, not on physical G2 hardware, so BLE timing and real fonts are not verified.
  - Simulator times use the host machine's clock and timezone.
  - Voice was tested end to end in the simulator (speech played into its microphone input → whisper.cpp → saved reminder) and in unit tests; the browser-microphone path of the `?mock` demo was not tested with real audio. English only with the `base.en` model.
  - The `.ehpk` is not published to Even Hub; that needs a developer account.
