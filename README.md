# Project Focus (Electron MVP)

Desktop app for macOS to help you stay focused with simple sessions, gentle reminders, and lightweight task tracking.

## Quick start

1) Install Node.js LTS (v18+ recommended). On macOS, download from the official website or use a version manager.
2) In Terminal:

```
cd "$(dirname "$0")"
npm install
npm run start
```

The app window should open. If notifications are blocked, macOS may prompt you to allow them.

## Features (MVP)

- Focus session timer with start/pause/reset
- Configurable session length and reminder interval
- Desktop notifications to gently nudge during sessions
- Simple task list (local storage)
- Basic stats: sessions completed and total focused minutes

## Roadmap (from project docs, to be refined)

- Distraction detection and smarter reminders
- Focus modes per context (work/study)
- Schedule-based focus blocks and calendar integration
- App usage analytics and insights (privacy-first)
- Packaging and code signing for distribution

## Build macOS package

Packaging requires developer tools and codesigning setup.

```
npm run build
```

This will produce a `.dmg` under `dist/` using electron-builder.

## Notes

- Data is stored locally in the browser storage for MVP. A subsequent iteration can move to a persistent store.
- This project was scaffolded automatically. Feel free to rename, refactor, or move files.


