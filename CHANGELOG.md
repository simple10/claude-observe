# Changelog

## v0.8.0 — Session pinning, sorting, and CLI tooling

This release adds several dashboard UI enhancements like session pinning and sort controls, making it easier to organize and find sessions. The CLI gains new commands like hook-sync and hook-autostart, and the `/observe` skill was enhanced with more subcommands and debugging tools. The plugin now checks server health during SessionStart events, sends a status message visible in claude, and auto repairs stopped servers.

### Features

- Pin sessions to the sidebar for quick access, with green indicators for active sessions
- Sort sessions by recent activity or creation date in the sidebar, home page, and project page
- Auto-collapse sidebar session groups when they exceed 10 items
- In-app changelog modal with version checking
- `observe logs` and `observe debug` CLI commands for troubleshooting
- `hook-sync` and `hook-autostart` commands with fast container restart
- Unified `/observe` skill with argument hints (merged observe and observe-status)
- `db-reset` CLI command for clearing the database

### Fixes

- Resolve project slug from URL hash on page refresh
- Prevent premature server exit with a 30-second shutdown delay
- Reduce memory usage from event data retention
- Suppress Radix DialogContent aria-describedby warning on all modals
- Upgrade Vite to address security vulnerability

### Other

- Centralized configuration and extracted shared libraries (hooks, fs, docker env)
- Reorganized tests and added CLI and MCP server test coverage
- Updated documentation, release scripts, and developer tooling

## v0.7.5 — Search polish, timeline fixes, and release tooling

No breaking changes. This version is just cosmetic improvements.

### Features

- Improved search UI with input debouncing, highlighted active border, clear button, and whitespace-only filtering
- Added cursor pointer to clickable elements in the sidebar and stream list
- Display plugin version in the sidebar and redesigned the Settings > Projects view

### Fixes

- Fixed timeline dot positioning to align correctly with trace events
- Fixed timeline animation so dots animate smoothly as a group instead of individually

### Other

- Added fresh install test harness with integration into the release workflow
- Improved release script with dry-run flag, skip-build option, and Claude-generated changelogs
- Updated contributor documentation and formatting configuration
