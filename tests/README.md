# CardSpoke Test Suite

This directory contains the project's automated uvu suites for core behavior, plugin runtime systems, and regression coverage.

## Running Tests

```bash
# Run all test files under tests/
npm test

# Re-run automatically while editing
npm run test:watch
```

## Current Suite Status

- Framework: [uvu](https://github.com/lukeed/uvu)
- Test files: 35 (`*.test.js`)
- Latest baseline: **423 / 423 passing** (`npm test`, verified at 0.21.1)

## What's Covered

- Core card CRUD, links/backlinks, hierarchy, and navigation flows
- Search (single dataset + multi-dataset), tags, and UI state persistence
- App initialization, menu/footer handlers, semantic selector expectations
- Plugin runtime systems (validator, API contexts, middleware pipeline, component registry, permissions, phase 2/3 features)
- Local file and storage-related behavior in the test harness

## Layout

- `helpers.js` — shared mocks and test utility functions
- `*.test.js` — feature-focused suites (one domain per file)

## Adding New Tests

1. Add a new `*.test.js` file in `tests/`.
2. Import `test`/`assert` from `uvu` and any helpers from `./helpers.js`.
3. Keep each case focused on one behavior and include edge conditions.
4. Run `npm test` before submitting changes.

The September 2026 review adds real RPC/vnode/worker regression tests and controlled-IO tests of the production persistence functions. Browser QA now has 95 assertions across 20 scenarios, including standalone file loading, offline reload, 1000-card search, current worker consent, and data preservation after reload. Unit helpers and static assertions are useful but do not replace these built-app checks.
