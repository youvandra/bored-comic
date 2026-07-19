# OKX AI Marketplace — ASP A2MCP Listing

## Status

| Field | Value |
|---|---|
| Agent ID | #6006 |
| Name | BoredComic |
| Approval | **Listing under review** (submitted 2026-07-19) |
| Wallet | `youvandrafebrial15@gmail.com` |
| Services | 4 A2MCP |

## CLI Resubmit (via `onchainos`)

### Prerequisites

- `onchainos` CLI installed (`~/.local/bin/onchainos`)
- Wallet logged in: `onchainos wallet status`

### Steps

```bash
# 1. Upload avatar
onchainos agent upload --file /path/to/asp-avatar.png

# 2. Update ASP (description + picture + services)
onchainos agent update \
  --agent-id 6006 \
  --description "Turn any story idea into a complete illustrated comic. Describe a scenario, genre, and characters; BoredComic writes the storyboard, generates panel-by-panel artwork, and delivers a ready-to-read comic. Supports multi-page stories, original character creation for continuity, and per-page revisions." \
  --picture "<CDN_URL_FROM_UPLOAD>" \
  --service '<JSON_ARRAY>'

# 3. Clean duplicates if any (delete by service id)
onchainos agent update --agent-id 6006 --service '<DELETE_JSON>'

# 4. Activate / resubmit for review
onchainos agent activate --agent-id 6006 --preferred-language en

# 5. Check status
onchainos agent get-agents --agent-ids 6006
```

### Services Registered

| # | Service Name | Endpoint | Price | ID |
|---|---|---|---|---|
| 1 | Generate Comic Basic | `https://boredcomic.web.id/gen/basic` | $0.50 | 35422 |
| 2 | Generate Comic Standard | `https://boredcomic.web.id/gen/standard` | $1.00 | 35423 |
| 3 | Generate Comic Premium | `https://boredcomic.web.id/gen/premium` | $3.00 | 35424 |
| 4 | BoredComic Tools | `https://boredcomic.web.id/mcp` | $0.50 | 35425 |

### Service JSON (for `--service` parameter)

```json
[
  {
    "operation": "create",
    "serviceName": "Generate Comic Basic",
    "serviceDescription": "Create short 1-5 page illustrated comics from a scenario description. Best for single scenes, jokes, or quick visual stories. Includes full storyboard writing, dialogue, and panel art.",
    "serviceType": "A2MCP",
    "fee": "0.50",
    "endpoint": "https://boredcomic.web.id/gen/basic"
  },
  {
    "operation": "create",
    "serviceName": "Generate Comic Standard",
    "serviceDescription": "Create 6-10 page illustrated comics - enough for a complete short story. Full storyboard, dialogue, panel composition, and character continuity across pages.",
    "serviceType": "A2MCP",
    "fee": "1.00",
    "endpoint": "https://boredcomic.web.id/gen/standard"
  },
  {
    "operation": "create",
    "serviceName": "Generate Comic Premium",
    "serviceDescription": "Create 11-20 page illustrated comics for narrative-driven stories. Full storyboard with varied panel layouts, multi-character dialogue, and scene composition across all pages.",
    "serviceType": "A2MCP",
    "fee": "3.00",
    "endpoint": "https://boredcomic.web.id/gen/premium"
  },
  {
    "operation": "create",
    "serviceName": "BoredComic Tools",
    "serviceDescription": "Revise individual pages of an existing comic with new instructions, or register original characters (name + visual description) to reuse across stories. Characters persist and can be referenced in any generation.",
    "serviceType": "A2MCP",
    "fee": "0.50",
    "endpoint": "https://boredcomic.web.id/mcp"
  }
]
```

## Notes

1. **Endpoints verified** — each returns 402 with valid `PAYMENT-REQUIRED` header.
2. **4 separate services** — one endpoint per service per marketplace rules, all under 1 ASP.
3. **No free tools in marketplace** — all paid via x402; free tools (`get_quota`, etc.) are server-side waived.
4. **Settlement** — OKX Payment SDK (`@okxweb3/x402-express`) with X Layer facilitator, sync settlement.
5. **Previous rejection** — "unable to receive a response" caused by `opentype.js` crash during probe. Fixed with `npm install`.
6. **Delete operation note** — `delete` requires ALL fields (`serviceName`, `serviceDescription`, `serviceType`, `fee`, `endpoint`) in addition to `id` and `operation`.
