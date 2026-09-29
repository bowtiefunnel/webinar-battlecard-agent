# Workflow 1: Battlecard — Webinar Event to Slack

[Open in n8n](https://jomarebalida.app.n8n.cloud/workflow/GC8P5Dhd2jDJ8Rl9) ·
[Source](../n8n-workflows/battlecard-event-to-slack.ts)

10 nodes, executed strictly in sequence (n8n runs top-to-bottom, no automatic
concurrency).

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Webinar Event Webhook** | Webhook trigger | Entry point. Receives POST with `attendee`, `session` (Q&A, poll, dwell time). No auth — n8n webhook URLs are unguessable by default. |
| 2 | **Look Up Account (Simulated CRM)** | Supabase (`row` / `getAll`) | Looks up the `accounts` table by the attendee's email domain. Returns 0 or 1 row — if 0, the rest of the chain simply doesn't run for that execution (no CRM match = no battlecard, by design, not a bug). |
| 3 | **Compute Battlecard Slug** | Set | Derives a URL-safe slug from the company name and the eventual battlecard page URL (`labs.bowtiefunnel.com/battlecards/<slug>/`). Computed once here because 4 downstream nodes need it. |
| 4 | **Bitscale Enrichment** | HTTP Request | POSTs to Bitscale's Grid Run API (`api.bitscale.ai/api/v1/grids/:gridId/run`) with the account domain, gets back tech-stack/hiring/buying-committee signals. |
| 5 | **Claude Battlecard Synthesis** | **AI Agent** (+ 2 subnodes) | The real cognitive-synthesis step. See [`04-ai-agent-explained.md`](04-ai-agent-explained.md) — this is not a plain LLM call, it's a full Agent node with a Chat Model and a Structured Output Parser wired underneath it. |
| 6 | **Build Battlecard Blocks** | Set | Assembles the Slack Block Kit array: header, pipeline/owner/Q&A/poll section, AI-generated summary, competitors flagged, objection bullets, a link to the full HTML page, and the 3-button action bar. |
| 7 | **Build Battlecard HTML** | Set | Assembles a complete standalone HTML page (same visual family as the `competitor-battlecards` project) — Account Snapshot, Live Signal, Suggested Actions, Account Summary, Competitors Flagged, Objection Talking Points. |
| 8 | **Check Existing Battlecard Page** | HTTP Request | GETs the GitHub Contents API to check if this slug's page already exists (needed to get its `sha` for an update, not just a create). `neverError: true` so a 404 doesn't throw. |
| 9 | **Commit Battlecard to GitHub** | HTTP Request | PUTs the HTML to `bowtiefunnel/bowtie-funnel-Labs` at `docs/battlecards/<slug>/index.html`, live seconds later at `labs.bowtiefunnel.com/battlecards/<slug>/` via GitHub Pages. |
| 10 | **Post Battlecard to Slack** | Slack (`message` / `post`) | Posts the Block Kit card to `#battlecard-demo` (channel `C0C5B6UN23U`), using `messageType: 'block'` and the exact `{ "blocks": [...] }` wrapper Slack's API expects. |

## Key expressions worth understanding

**Slug computation** (in `Compute Battlecard Slug`, reused everywhere downstream):
```js
String(account.company_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
```

**Reading the Agent's output** (in `Build Battlecard Blocks` and `Build Battlecard HTML`):
```js
const synth = $('Claude Battlecard Synthesis').item.json.output || { /* fallback */ };
// synth.account_summary, synth.flagged_competitors, synth.objection_bullets
```
No `JSON.parse()` — the Structured Output Parser subnode already guarantees this is a
real object, not a string.

**The GitHub commit body** (in `Commit Battlecard to GitHub`) — base64-encodes the HTML
and conditionally includes `sha` only if the page already existed:
```js
{
  message: 'Battlecard: ' + account.company_name,
  content: Buffer.from(html, 'utf-8').toString('base64'),
  branch: 'main',
  ...(sha ? { sha } : {})
}
```

## Node naming matters here

Every downstream expression references upstream nodes **by name** (`$('Look Up Account
(Simulated CRM)')`, not `$json`) — per n8n's own best practice, this survives refactors
and stays unambiguous even as nodes get inserted or reordered. If you rename a node in
the n8n UI, every expression referencing it by that name breaks. Don't rename nodes
without updating every reference (search the whole workflow first).
