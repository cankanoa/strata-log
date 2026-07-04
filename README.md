# Strata Log

Strata Log is a CSDB-backed time tracking app built with React. The desktop shell uses Electron for macOS and Windows, and the shared web app is prepared for a Capacitor iOS wrapper.

## Features

- Live timer with break tracking
- Manual time entry with nested breaks
- CSDB-backed storage with strict validation
- Template-based file creation
- Custom metadata fields with `text` and `select` types
- Entries list with sorting and filtering
- Weekly interval calendar view
- Monthly totals calendar view
- Desktop tray/menu bar integration hooks

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm test
npm run build:web
npm run cap:sync
```
