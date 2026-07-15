# BoredComic — Working Rules

## Communication
- All code, comments, commit messages, and documentation MUST be in **English**
- Chat between us can be in **Indonesian** as needed
- Be concise. No unnecessary commentary.

## Commits
- Every **completed task** MUST be committed immediately
- One semantic change = one commit
- Commit message format: `type: description`
  - `feat:` — new feature
  - `fix:` — bug fix
  - `refactor:` — code restructuring
  - `style:` — formatting only
  - `docs:` — documentation
  - `chore:` — config, dependencies

## Code Quality
- TypeScript — strict mode
- No `any` types unless absolutely necessary
- Functions under 50 lines where possible
- No commented-out code
- No console.log in production code (use proper logging)

## Scope Control
- v1: single tool `generate_comic`, A2MCP
- No revision loop — one-shot generation
- Character consistency via prompt engineering, not finetuning
- Frontend is optional (comic reader/preview), served as static files

## Task Tracking
- See `TASKS.md` for current status
- Task states: `pending` → `in_progress` → `done`
