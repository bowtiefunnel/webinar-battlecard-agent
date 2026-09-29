# Workflow 2: Battlecard — Slack Action Handler

[Open in n8n](https://jomarebalida.app.n8n.cloud/workflow/7fv8sCi8qhC8aeuM) ·
[Source](../n8n-workflows/battlecard-slack-action-handler.ts)

Handles the 3 buttons Workflow 1 posts. This has to be a **separate** workflow because
Slack's interactivity model requires its own dedicated inbound webhook (the
"Interactivity & Shortcuts Request URL" in the Slack app's settings) — a single
workflow can't both post a message and later receive that same message's button click.

## Node-by-node

| Node | Type | What it does |
|---|---|---|
| **Slack Interaction Webhook** | Webhook trigger | Receives Slack's interaction POST. `responseMode: 'responseNode'` — Slack requires an explicit ack within 3 seconds via a `Respond to Webhook` node, not the trigger's own default response. |
| **Parse Slack Interaction** | Set | Slack sends the payload as `application/x-www-form-urlencoded` with a JSON *string* in the `payload` field. This node does the one `JSON.parse()` and stores the result as `payload` — used by 6+ downstream nodes, which is exactly the case where a dedicated Set node earns its place instead of inlining the parse everywhere. |
| **Route by Action** | Switch (`rules` mode) | Routes on `payload.actions[0].action_id`: `claim_lead` (case 0), `review_talking_points` (case 1), `launch_sequence` (case 2), anything else falls to `Unknown Action` (case 3, via `fallbackOutput: 'extra'`). |
| **Claim Lead in Supabase** | Supabase (`row` / `update`) | Writes `claimed_by` and `claimed_at` onto the `accounts` row matching the `accountId` packed into the button's `value` field. |
| **Set Claim Lead Response** | Set | Sets `responseText` to a confirmation string. |
| **Set Review Response** | Set | No write — Review Talking Points is informational only (the talking points are already in the posted message). Sets `responseText` to an acknowledgment. |
| **Log Outbound Sequence (Simulated)** | Supabase (`row` / `create`) | Writes a row to `outbound_log` — a stand-in for a real Outreach/Salesloft API call. Swap this node for a real HTTP Request when ready. |
| **Set Launch Sequence Response** | Set | Sets `responseText` to a confirmation string. |
| **Set Unknown Action Response** | Set | Fallback branch's `responseText`. |
| **Respond to Slack** | Respond to Webhook | The single ack point all four branches converge on (a valid "fan-in" — only one branch fires per execution, so reading `$json.responseText` here is deterministic even though it's fed by 4 different upstream paths). |

## How the account context gets to this workflow

Workflow 1 packs `{ accountId, domain }` as a JSON string into every button's `value`
field when it builds the Slack blocks. This workflow reads it back with
`JSON.parse($('Parse Slack Interaction').item.json.payload.actions[0].value)` — no
second database lookup needed to know which account a click belongs to.

## What "only one branch fires" actually means

Each of the 4 branches (claim_lead / review / launch_sequence / unknown) is a
**complete, independent path**: do the write (if any) → set `responseText` → flow into
the shared `Respond to Slack` node. Since only one branch executes per Slack click, all
of them safely converge on one Respond node reading `$json` — there's no "last branch
wins" ambiguity here, because there's only ever one branch per execution in the first
place.
