# BoredComic

**AI comic generator as an A2MCP Agent Service Provider on OKX.AI.** A requesting agent sends a prompt, genre, page count, and style — BoredComic writes the story, generates each panel image, assembles them into pages, and returns a complete PDF with **decision-grade metadata** the agent can evaluate without reading the comic.

| | |
|---|---|
| **Type** | A2MCP — pay-per-call via x402 |
| **Agent ID** | — |
| **Endpoint** | — |
| **Price** | 0.5–1.5 USDT per generation · no free calls |

## Why an agent needs this

An autonomous agent working with creative content constantly runs into requests it cannot fulfill itself: a user wants a comic, but the agent cannot draw, cannot panel, cannot maintain visual consistency across pages. BoredComic is the primitive that answers:

> *"I have a story idea — make it into a comic I can share."*

As structured data the agent can compose — not a web app it has to navigate.

## MCP Tool

### `generate_comic`

| Input | Description |
|-------|-------------|
| `prompt` | What the comic should be about |
| `genre` | horror, romance, action, comedy, manga, fantasy, sci-fi, 18+ |
| `pages` | 1–10 |
| `style` | manga, western, semi-realistic, chibi |
| `aspectRatio` | 3:4, 9:16, 1:1 |

### Delivery shape

```jsonc
{
  "jobId": "cg_...",
  "summary": "5-page horror manga 'Hantu di Kos': 18 panels, 4 characters. Generated in 32s.",
  "title": "Hantu di Kos",
  "pageUrls": ["/comics/<jobId>/page-1.png", ...],
  "pdfUrl": "/comics/<jobId>/comic.pdf",
  "characters": [{ "name": "Rudi", "appearance": "young man, 20s, curly hair, glasses" }],
  "perPage": [{
    "page": 1, "panels": 4, "storyBeat": "...",
    "evidence": { "model": "black-forest-labs/flux-2-pro", "promptChars": 512 }
  }],
  "evidence": {
    "pagesGenerated": 5, "panelsGenerated": 18,
    "generationTimeSec": 32, "costEstimateUsd": 0.15,
    "caveat": "Comic is AI-generated. Story coherence and visual consistency are heuristic, not guaranteed."
  }
}
```

## Architecture

```
                  POST /mcp (MCP, agents)
                         │
                ┌────────▼────────┐
                │  x402.ts        │  freemium gate
                └────────┬────────┘
                ┌────────▼────────┐
                │  pipeline.ts    │  one-shot pipeline
                └────────┬────────┘
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
      writer.ts    illustrator.ts   assembler.ts
      (storyboard) (panel images)  (PDF assembly)
```

## Honesty rules

- **No fabricated characters** — every character is explicitly defined in the storyboard
- **Evidence travels with every comic** — model, panels, generation time, and caveat
- **Style consistency capped at 0.95** — never certainty across generated pages
- **The fee matches reality** — pricing reflects actual LLM + image gen cost

## Development

```bash
cd backend
npm install
cp .env.example .env   # fill in SUMOPOD_API_KEY
npm run dev
```

Then point an MCP client at `http://localhost:3001/mcp`.
