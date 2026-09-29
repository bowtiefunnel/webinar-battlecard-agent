# Architecture: the 5 steps

This project implements the "Account Intelligence & Dynamic Battlecard Agent" concept —
a hybrid/connected architecture where event middleware (n8n) orchestrates external
enrichment APIs and a frontier LLM, with a human-in-the-loop gate before anything
outbound happens.

## Step 1 — Capture (Event Webhook)

**Concept:** a webinar platform (Goldcast) fires an immediate webhook when an attendee
takes a high-intent action — asking a question, answering a poll, crossing a dwell-time
threshold.

**Built as:** `Webinar Event Webhook` — a plain n8n Webhook trigger. In this build it
receives a sample Goldcast-*shaped* JSON payload (attendee email/name, a Q&A question,
a poll response, dwell time in seconds), not a live Goldcast integration. See
[`docs/06-setup-prerequisites.md`](06-setup-prerequisites.md) for the real-data caveat
uncovered from an actual Goldcast export — worth reading before wiring this to a real
Goldcast webhook.

## Step 2 — Middleware Merge

**Concept:** the middleware parses the event and queries the CRM for the parent
account's status, pipeline stage, and assigned AE/SDR.

**Built as:** `Look Up Account (Simulated CRM)` — queries a Supabase table (`accounts`)
by the attendee's email domain, standing in for a real CRM. `Compute Battlecard Slug`
immediately follows it to derive a URL-safe slug and the eventual battlecard page URL,
used by four downstream nodes.

## Step 3 — Enrich & Synth

**Concept:** waterfall enrichment (Clay/Bitscale) pulls tech-stack and buying-signal
data; a frontier model (Claude/GPT-4o) synthesizes it into objection-handling talking
points; the result gets assembled into an interactive card.

**Built as:**
- `Bitscale Enrichment` — an HTTP Request node calling Bitscale's real Grid Run API
  (`api.bitscale.ai/api/v1/grids/:gridId/run`).
- `Claude Battlecard Synthesis` — a real **AI Agent** node (not a plain completion
  call). See [`docs/04-ai-agent-explained.md`](04-ai-agent-explained.md) for exactly
  how this works.
- `Build Battlecard Blocks` — assembles the Slack Block Kit array.
- `Build Battlecard HTML` — assembles a full standalone HTML page in the same visual
  family as the `competitor-battlecards` project's template.

## Step 4 — Review Gate

**Concept:** the card posts to the rep's Slack workspace with interactive buttons;
nothing downstream happens until a human clicks one.

**Built as:** `Commit Battlecard to GitHub` (publishes the HTML page to
`labs.bowtiefunnel.com/battlecards/<slug>/`) → `Post Battlecard to Slack` (posts the
interactive card with **Claim Lead**, **Review Talking Points**, **Launch Sequence**
buttons). The click itself is handled by the *second* workflow — see
[`docs/03-workflow-2-slack-action-handler.md`](03-workflow-2-slack-action-handler.md) —
because Slack's interactivity model requires its own separate inbound webhook; a single
workflow can't both post a message and later receive that message's button click.

## Step 5 — Outbound

**Concept:** the rep's click triggers CRM ownership writeback and/or launches a sales
engagement sequence (Outreach/Salesloft).

**Built as:** in the second workflow, **Claim Lead** writes ownership back to the
Supabase `accounts` table (simulated CRM writeback), and **Launch Sequence** writes a
row to an `outbound_log` table — a simulated stand-in for a real Outreach/Salesloft API
call. This was a deliberate scope decision for the demo, not a technical limitation —
swapping in a real SEP call is a single HTTP Request node once you're ready.

## Trade-offs, inherited from the original design

- **Point-to-point webhook chains** need ongoing schema/API maintenance as each
  external service's shape drifts.
- **Public HTML hosting**: the battlecard page publishes to a GitHub Pages site
  (`bowtie-funnel-Labs`) that also hosts other public-facing resources. Fine for this
  demo's fake account data — reconsider before pointing it at real prospect data (see
  [`docs/05-current-demo-state.md`](05-current-demo-state.md)).
