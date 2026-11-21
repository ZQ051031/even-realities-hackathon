# Plan (written 2026-11-22, before the build window opened)

## Build window (from https://dorahacks.io/hackathon/even-realities/detail, read 2026-11-22)
- Schedule (Dubai time, GMT+4): Nov 23 12:00 kickoff, "build starts"; Nov 29 23:59 submission deadline.
- In UTC: 2026-11-23 08:00 -> 2026-11-29 19:59. In HKT/CST: 2026-11-23 16:00 -> 2026-11-30 03:59.
- Rule: "Build during the hackathon. Open-source libraries and existing APIs are allowed; say in your README what existed before Nov 23."
- Submit: public repo + README with setup, demo video <= 3 min (simulator OK), short description + track, up to 5 API feature requests, optional .ehpk.
- Use only apps listed in the tracks you enter. Never commit API keys.

## Pre-window work (allowed: research + skeleton only)
- Read Even Hub docs (display, design guidelines, device APIs, page lifecycle, networking, contextual menu, simulator, packaging).
- Installed CLI 0.2.0 + simulator 0.9.5; verified the official `minimal` template renders in the simulator with no account.
- Scaffolded this repo from `even-realities/evenhub-templates/minimal` (unmodified app code).

## App: "Glance" heads-up assistant (Track 04 - AI Assistants & Work, Google Calendar)
Glasses pages (576x288, max 8 text/list containers, one isEventCapture container):
1. Now card: clock, current/next event + countdown, next reminder. Tap = open agenda, swipe = cycle cards.
2. Agenda: list container of today's events (<=20 items, <=64 chars). Click = event detail card w/ "Go" steps.
3. Focus timer: 25/5 pomodoro, progress bar with ━ ─; tap start/pause, swipe +/-5 min, long press reset.
4. Go cards: step-by-step heads-up route cards for the next event (from event description lines / location).
5. Reminders: due reminder card; tap = done, swipe down = snooze 10 min (the "write" action).
- Contextual menu: Start focus, Snooze, Refresh, Next card. Double-tap root = shutDownPageContainer(1).
- State persisted with bridge.setLocalStorage / localStorage (Android suspend).

Data:
- Small Node server (`server/`) fetches a Google Calendar secret iCal URL (env `GCAL_ICS_URL`), parses ICS, serves `/api/agenda` with CORS. Never ships keys in the app.
- No URL configured -> clearly labelled demo agenda (mock), so the app is always demonstrable.

Browser fallback:
- If `window.flutter_inappwebview` is missing (plain browser), render the same page model into an on-screen 576x288 green mock display with buttons/keys for tap/double/up/down/long-press.

Tests:
- Unit tests for ICS parsing, card formatting (line length limits), timer logic.
- Simulator e2e via `--automation-port` (screenshots + console asserts).
