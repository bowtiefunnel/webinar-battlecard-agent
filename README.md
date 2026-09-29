# Webinar Battlecard Agent

Turns a live webinar high-intent signal (a Q&A question, a poll answer) into an
interactive Slack battlecard for the account owner — enriched, synthesized by a real
AI Agent, and backed by a full hosted HTML page — within seconds of the event.

This is the **Account Intelligence & Dynamic Battlecard Agent** from the original
concept slide, built as two connected n8n workflows.

## Live workflows

| Workflow | n8n link | Purpose |
|---|---|---|
| **Battlecard: Webinar Event to Slack** | [open in n8n](https://jomarebalida.app.n8n.cloud/workflow/GC8P5Dhd2jDJ8Rl9) | Event → CRM lookup → enrichment → AI synthesis → Slack card + HTML page |
| **Battlecard: Slack Action Handler** | [open in n8n](https://jomarebalida.app.n8n.cloud/workflow/7fv8sCi8qhC8aeuM) | Handles the Slack button clicks (Claim Lead / Review Talking Points / Launch Sequence) |

Source of truth for both lives in this repo under [`n8n-workflows/`](n8n-workflows/) as
`@n8n/workflow-sdk` TypeScript — the live n8n instance is built from this code, but has
also been toggled between "real" and "demo/fake-data" states repeatedly while testing.
See [`docs/05-current-demo-state.md`](docs/05-current-demo-state.md) for what's actually
live in n8n *right now* versus what this repo's source represents as the intended
end-state.

## Read the docs in this order

1. [`docs/01-architecture.md`](docs/01-architecture.md) — the 5-step architecture, and how each step maps to actual n8n nodes
2. [`docs/02-workflow-1-event-to-slack.md`](docs/02-workflow-1-event-to-slack.md) — node-by-node walkthrough of the main workflow
3. [`docs/03-workflow-2-slack-action-handler.md`](docs/03-workflow-2-slack-action-handler.md) — node-by-node walkthrough of the button-click handler
4. [`docs/04-ai-agent-explained.md`](docs/04-ai-agent-explained.md) — exactly how the AI Agent node works, step by step
5. [`docs/05-current-demo-state.md`](docs/05-current-demo-state.md) — what's real vs. faked right now, and the live sample battlecards
6. [`docs/06-setup-prerequisites.md`](docs/06-setup-prerequisites.md) — what you need to do to make this run for real

## TL;DR architecture

```
Webhook (webinar event)
  → Look Up Account (CRM lookup)
  → Compute Battlecard Slug
  → Bitscale Enrichment (waterfall enrichment)
  → Claude Battlecard Synthesis (real AI Agent)
  → Build Battlecard Blocks (Slack Block Kit)
  → Build Battlecard HTML (full page)
  → Commit to GitHub (labs.bowtiefunnel.com/battlecards/<slug>/)
  → Post to Slack (interactive card, 3 action buttons)
      ↓ (button click)
  Slack Interaction Webhook
  → Route by Action
  → Claim Lead / Review Talking Points / Launch Sequence
  → Respond to Slack
```

## Status

**Demo-proven, not yet production-live.** Every step in the chain has been executed for
real at least once (including a genuine Claude API call and a genuine Slack post), but
three external integrations (Supabase CRM, Bitscale enrichment, GitHub auto-commit)
are currently standing on fake data because their credentials haven't been created yet.
See [`docs/06-setup-prerequisites.md`](docs/06-setup-prerequisites.md) for exactly what's
needed to flip them to real.
