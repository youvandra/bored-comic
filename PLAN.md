# BoredComic — Project Plan

## Overview
ComicGen is an **A2MCP Agent Service Provider** on OKX.AI that generates a complete comic from a natural-language prompt. A requesting agent sends a genre, page count, and style — ComicGen writes the story, panels it page-by-page, generates each panel, assembles the PDF, and returns **decision-grade metadata** the agent can evaluate without reading the comic.

One-shot generation: no negotiation, no revision loop. Pay-per-call via x402.

## Tech Stack
- **Runtime**: Node.js + TypeScript + Express
- **Agent interface**: Model Context Protocol (`@modelcontextprotocol/sdk`, Streamable HTTP at `/mcp`)
- **LLM**: Sumopod API (deepseek-v4-flash)
- **Image Gen**: Replicate API (black-forest-labs/flux-2-pro)
- **PDF Assembly**: `pdf-lib` (lightweight, no heavy deps)
- **PDF Assembly**: `pdf-lib` (lightweight, no heavy deps)
- **Payment**: x402 v2 (same as WalletLens — `@okxweb3/x402-express`)
- **Frontend**: Alpine.js + Tailwind CSS (CDN, no build step)
- **Storage**: VPS temp files (24h TTL)

## Why A2MCP (not A2A)
- No negotiation needed — genre, pages, style are known upfront
- No revision loop — one-shot generation, if bad, agent calls again
- Fixed pricing — pay per generation, not per negotiation round
- Same model as WalletLens: agent calls a tool, gets structured output back

## Architecture

```
Agent call tools/create_comic
         │
         ▼
 POST /mcp (MCP Streamable HTTP)
         │
         ▼
┌─────────────────────────────┐
│ 1. Writer (LLM)             │
│    - Genre → storyboard     │
│    - Per-page panel breakdown│
│    - Character descriptions  │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│ 2. Illustrator (Image Gen)  │
│    - Generate panel per page│
│    (parallel batch)         │
│    - Assemble page layout   │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│ 3. Assembler                │
│    - Generate PDF           │
│    - Per-page evidence      │
│    - Decision-grade delivery│
└──────────┬──────────────────┘
           ▼
Response: {
  summary, pdfUrl, pageUrls[],
  totalPanels, storyArc, characterList,
  evidence { ... }
}
```

## Pipeline Detail

### 1. Writer (`writer.ts`)
Takes user prompt → generates structured storyboard via LLM.

**Input:** `{ prompt, genre, pages, style }`

**Output** (JSON-parsed from LLM):
```json
{
  "title": "Hantu di Kos",
  "synopsis": "A student moves into an empty boarding house with a dark past...",
  "characters": [
    { "name": "Rudi", "role": "protagonist", "appearance": "young man, 20s, curly hair, glasses" }
  ],
  "pages": [
    {
      "page": 1,
      "panels": 4,
      "storyBeat": "Rudi arrives at the boarding house, meets the caretaker",
      "dialogue": ["Panel 1: Rudi stands in front of the boarding house..."]
    }
  ]
}
```

### 2. Illustrator (`illustrator.ts`)
Takes panel descriptions → generates images → assembles into pages.

- Per-panel prompt: combine character description + scene description + style
- Parallel: all panels for all pages generated concurrently
- Page assembly: vertical stack or grid layout depending on panel count

### 3. Assembler (`assembler.ts`)
- Generates PDF from page images via `pdf-lib`
- Stores temp files with jobId prefix
- Cleanup after 24h TTL

## MCP Tool

### `generate_comic`

**Input Schema:**
```
{
  prompt: string       // "horror boarding house ghost story 5 pages"
  genre?: string       // horror, romance, action, comedy, manga, fantasy, 18+
  pages: number        // 1-10 (MVP cap)
  style?: string       // manga, western, semi-realistic, chibi (default: manga)
  aspectRatio?: string // "3:4" | "9:16" | "1:1" (default: 3:4 standard comic)
}
```

**Output (decision-grade):**
```jsonc
{
  "jobId": "abc123",
  "summary": "5-page horror manga 'Hantu di Kos': 18 panels, 4 characters, style consistency 0.85. Generated in 32s.",
  "title": "Hantu di Kos",
  "pages": 5,
  "totalPanels": 18,
  "style": "manga",
  "genre": "horror",
  "characters": [
    { "name": "Rudi", "role": "protagonist", "appearance": "young man, 20s, curly hair, glasses" }
  ],
  "pageUrls": [
    "https://comicgen.my.id/comics/abc123/page-1.png",
    "https://comicgen.my.id/comics/abc123/page-2.png"
  ],
  "pdfUrl": "https://comicgen.my.id/comics/abc123/comic.pdf",
  "perPage": [
    {
      "page": 1,
      "panels": 4,
      "storyBeat": "Rudi arrives at the boarding house",
      "imageUrl": "https://comicgen.my.id/comics/abc123/page-1.png",
      "evidence": {
        "model": "gemini-2.0-flash",
        "promptChars": 512,
        "characterCount": 2,
        "caveat": "Generated from text prompt — character appearance may vary slightly across pages."
      }
    }
  ],
  "evidence": {
    "model": "gemini-2.0-flash",
    "pagesGenerated": 5,
    "panelsGenerated": 18,
    "generationTimeSec": 32,
    "costEstimateUsd": 0.15,
    "caveat": "Comic is AI-generated. Story coherence and visual consistency are heuristic, not guaranteed."
  }
}
```

## Pricing (x402)

**Cost model (our side):**
| Component | Cost |
|-----------|------|
| LLM storyboard (text) | ~$0.005 |
| Image generation per panel | ~$0.003 (FLUX 2 Pro) |
| PDF assembly | ~$0 |
| **5 pages (18 panels) via FLUX 2 Pro** | **~$0.06** |

**Charge per call:**
| Pages | Price |
|-------|-------|
| 1-3  | 0.5 USDT |
| 4-6  | 1.0 USDT |
| 7-10 | 1.5 USDT |

20 free calls/IP/day.

## Project Structure

```
comicgen/
├── .gitignore
├── AGENTS.md, PLAN.md, TASKS.md, README.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts          # Express server, routes, x402, MCP mounting
│       ├── config.ts         # Environment config
│       ├── types.ts          # Types (Comic, Page, Panel, Delivery)
│       ├── mcp.ts            # MCP server — 1 tool (generate_comic)
│       ├── pipeline.ts       # Orchestrator: writer → illustrator → assembler
│       ├── writer.ts         # LLM storyboard generation
│       ├── illustrator.ts    # Image generation + panel assembly
│       ├── assembler.ts      # PDF generation
│       ├── storage.ts        # Temp file management
│       ├── x402.ts           # Payment gate (freemium + HTTP 402)
│       └── *.test.ts
└── frontend/
    └── index.html            # Alpine + Tailwind comic reader
```

## Image Generation Notes

### Model Choice

**FLUX 2 Pro (via Replicate API)**
- Pro: quality tinggi, fast inference, output langsung sebagai URL
- Cost: ~$0.003 per image (Schnell-level pricing, Pro quality)
- Format: sync API via `Prefer: wait` header → langsung dapet image URL
- Aspect ratio: 1:1 per panel, assembled into pages in the pipeline

### Character Consistency Strategy
Instead of finetuning or controlnet (too complex):
- **Per-page character reference block** di prompt: `Character 'Rudi': young man, curly hair, glasses, 20s, wearing blue jacket.`
- **Style anchor** di tiap panel prompt: `manga style, black and white screentone, consistent with previous panels`
- LLM generate panel descriptions yang explicitly reference character appearance every time

## Honesty Rules (borrowed from WalletLens)
- **Style consistency score capped at 0.95** — never certainty across generated pages
- **Evidence travels with every comic** — model, panels, generation time, and caveat
- **No fabricated characters** — every character in the output was explicitly defined in the storyboard
- **The fee matches reality** — pricing reflects actual LLM + image gen cost

## Character Consistency Strategy

To keep characters looking the same across pages without finetuning:

1. **Writer phase** — LLM outputs structured character descriptions (name, appearance, outfit)
2. **Style anchor injection** — every panel prompt includes a `[CHARACTER_REF]` block with the full character description
3. **Same seed per session** — if the image API supports seeding, use a derived seed per character
4. **Style reference image** — first generated panel is fed back as style reference for subsequent panels (if API supports it)

This is honest-by-design: the `evidence` block per page explicitly states `characterRefUsed: true` and the model name, so the agent knows consistency is prompt-based, not finetuned.
