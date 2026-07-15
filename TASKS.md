# BoredComic — Task Tracker

## Phase 1: Foundation
- [x] `done` Create AGENTS.md, PLAN.md, TASKS.md, .gitignore
- [x] `done` Initialize project structure (directories, package.json, tsconfig)
- [x] `done` Setup Express server with basic health endpoint
- [x] `done` Create TypeScript types (comic, page, panel, character, delivery)
- [x] `done` Setup .env with API keys

## Phase 2: Core Pipeline — Writer
- [x] `done` Implement storyboard generator (LLM: prompt → panel descriptions per page)
- [x] `done` Implement character consistency system (reference descriptions → prompt per panel)

## Phase 3: Core Pipeline — Illustrator
- [x] `done` Integrate Replicate API (black-forest-labs/flux-2-pro)
- [x] `done` Implement panel generation (parallel per page)
- [x] `done` Implement page assembly (layout + merge panels)

## Phase 4: Delivery
- [x] `done` Implement PDF generation
- [x] `done` Build decision-grade delivery (per-page evidence + summary)
- [x] `done` Implement MCP tool (`generate_comic`)

## Phase 5: x402 Payment
- [x] `done` Implement freemium quota (20 free/day)
- [x] `done` Implement x402 payment middleware
- [x] `done` Set pricing

## Phase 6: Frontend
- [x] `done` Design comic reader (Alpine.js + Tailwind)
- [x] `done` Implement page navigation & preview
- [x] `done` Implement generation form

## Phase 7: Git & GitHub
- [ ] `pending` Initialize git repository and push initial code
- [ ] `pending` Verify GitHub remote and push

## Phase 8: Register ASP on OKX.AI
- [ ] `pending` Register identity + service on onchainos
- [ ] `pending` Submit for listing approval
- [ ] `pending` Verify MCP endpoint responds tools/list
