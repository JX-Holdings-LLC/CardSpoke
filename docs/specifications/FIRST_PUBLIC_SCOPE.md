# CardSpoke First Public Scope

## Purpose

This document defines the intended scope for CardSpoke's first public version.

CardSpoke is the main local-first web app. The public repository should focus on the core CardSpoke experience first, then desktop packaging, then mobile packaging. It should not currently carry roadmap, code, tests, or documentation for unrelated spin-offs, OS-specific products, or alternate apps built on CardSpoke as a base.

## Product Definition

CardSpoke is a private, local-first notebook where every note is a card, organized in flexible card trees.

It should help users:

- Capture ideas and notes as cards
- Nest cards into parent/child structures
- Link related cards together
- Find information through search, tags, bookmarks, backlinks, and recent cards
- Keep control of their data through local storage and export/import
- Extend the app through optional plugins without bloating the default experience

## Platform Priority

1. Web app
2. Desktop packaging
3. Mobile packaging

Mobile and desktop should serve the main CardSpoke app. They are not separate product lines in this repository.

## Included in the First Public Version

### Core App

- Card CRUD
- Parent/child hierarchy
- Card duplication
- Bookmarks
- Recent cards
- Card links with `[[Card Title]]`
- Backlinks
- Related cards
- Tags and tag management
- Search and advanced search
- Rich text / Markdown-style editing
- Grid, list, and compact views
- Dark/light theme
- High contrast mode
- Typography presets
- Keyboard shortcuts
- Undo/redo
- Trash recovery

### Data Ownership

- Local-first storage
- JSON export/import
- TXT import/export
- Markdown export
- CSV export
- No required account
- No required server
- No telemetry by default
- No hosted sync in the public preview

### Plugin System

- Plugin Manager
- Theme, Feature, and App plugin layers
- Permission prompts
- Risk assessment
- Safe Mode
- Plugin lifecycle: install, enable, suspend, delete
- Sample plugins
- Plugin developer documentation

### Release Hygiene

- Clear README
- Feature catalog aligned with the current app
- Release checklist
- Known limitations
- Security and privacy docs
- Tests for core app and plugin behavior

## Explicitly Out of Scope

The first public version does not include:

- OS-specific shells
- OS-native information suite work
- Alternate app modes such as Notes, Projects, Decks, Contacts, Plant Pal, or Repository
- Typed-card platform/domain systems
- Runtime profiles such as `full`, `lite`, or `os`
- A standalone core-only build target
- Cloud storage drivers such as Google Drive, OneDrive, or WebDAV
- Hosted sync
- Real-time collaboration
- Full PowerPoint replacement features
- PPTX import/export
- Full contacts sync
- Full project manager UI
- Full Plant Pal tracking UI
- Full reminder/notification engine

These may become future projects or separate repositories, but they should not shape the first public CardSpoke app release.

## Future-Version Parking Lot

The following are valid ideas, but they should be tracked outside the first public scope:

- Cloud/off-device storage
- Desktop-specific polish
- Mobile-specific security hardening
- Advanced plugin marketplace/gallery workflows
- Optional encrypted exports
- Larger data integrity tools
- More sophisticated onboarding

## Release Rule

A public release should not advertise a capability unless it is implemented, tested, documented, and visible in the main CardSpoke app.
