# Changelog Modal

Show the project changelog in a modal when the user clicks the version indicator in the sidebar.

## Server

Add `GET /api/changelog` to `app/server/server.mjs`. Read `CHANGELOG.md` from the project root and return it as `{ markdown: string }`. Return 404 if the file is missing.

## Client

### ChangelogModal component

- New file: `app/client/src/components/changelog-modal.tsx`
- Radix `Dialog` (same pattern as `SettingsModal`)
- Fetch changelog via `useQuery` with `enabled: open` (lazy fetch)
- Render with `react-markdown` (new dependency)
- Style the rendered markdown with Tailwind prose classes or manual heading/list styles to match the app's dark/light theme
- Show loading state while fetching

### Sidebar trigger

- In `sidebar.tsx`, wrap the version footer area with an `onClick` that opens the `ChangelogModal`
- Add hover/cursor styling to indicate it's clickable

### API client

- Add `fetchChangelog()` to `api-client.ts`

## Dependencies

- `react-markdown` — add to `app/client/package.json`
