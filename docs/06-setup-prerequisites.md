# Setup prerequisites — what's needed to make this run for real

The n8n MCP tooling used to build this can't create credentials, Supabase projects, or
Bitscale grids — those are all steps only you can do. Do these, then say so, and the
fake-data stand-ins (Look Up Account, Bitscale Enrichment, and the disabled GitHub
nodes) can be swapped back to the real integrations.

## 1. Supabase project

Create a project (or reuse an existing one) and run this in the SQL Editor:

```sql
create table accounts (
  id uuid primary key default gen_random_uuid(),
  domain text unique not null,
  company_name text not null,
  pipeline_stage text not null,
  owner_ae text not null,
  owner_sdr text,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table outbound_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  triggered_by text not null,
  sequence_name text not null,
  triggered_at timestamptz not null default now()
);

-- Seed one row so a test event has something to match.
insert into accounts (domain, company_name, pipeline_stage, owner_ae, owner_sdr)
values ('acmecorp.com', 'Acme Corp', 'evaluation', 'Dana AE', 'Sam SDR');
```

## 2. Bitscale grid

In your Bitscale workspace:
- Confirm your **workspace plan includes API access** (Enterprise-tier feature per
  Bitscale's docs).
- Set up a **Grid** with an input column for a company domain and output columns for
  whatever enrichment signals you want (tech stack, hiring, buying committee, etc.).
- Note the **Grid ID** and the **column UUIDs** — these replace the literal
  `REPLACE_WITH_GRID_ID` and `REPLACE_WITH_INPUT_COLUMN_UUID` text currently in the
  `Bitscale Enrichment` node's URL and request body.

## 3. Create three n8n credentials (UI only)

| Credential name | Type | Used by |
|---|---|---|
| `Supabase (Simulated CRM)` | Supabase API (`supabaseApi`) | Look Up Account, Claim Lead in Supabase, Log Outbound Sequence |
| `Bitscale API` | HTTP Header Auth (Templated) (`httpTemplatedCustomAuth`) — template `{"headers":{"X-API-KEY":"{{api_key}}"}}` | Bitscale Enrichment |
| `GitHub API (Labs)` | HTTP Header Auth (Templated) (`httpTemplatedCustomAuth`) — template `{"headers":{"Authorization":"Bearer {{token}}"}}`, needs `contents:write` on `bowtiefunnel/bowtie-funnel-Labs` | Check Existing Battlecard Page, Commit Battlecard to GitHub |

The Slack credential (`Slack OAuth2 API`) and the Anthropic Chat Model's credential
(Gateway credits, auto-assigned) already exist — no action needed there.

## 4. Slack

The `#battlecard-demo` channel already exists (`C0C5B6UN23U`) and the bot is a member
(it created the channel). If you want a different/production channel, swap the
`channelId.value` in the `Post Battlecard to Slack` node.

For Workflow 2 to receive real button clicks, register its webhook URL as the Slack
app's **Interactivity & Shortcuts Request URL** (api.slack.com/apps → your app →
Interactivity & Shortcuts). Get the live URL from the workflow's trigger node once
published.

## 5. Real Goldcast data shape — read before wiring a live webhook

A real Goldcast **event summary export** was checked against this project's assumptions
(see the original webinar CSV: `Beyond The Webinar - August 20_event_summary.csv`). It
exposes:
- `Number Of Questions Asked`, `Number Of Poll Participated` — **counts**, not verbatim
  question/answer text
- `Live Event Time Spent (Minutes)` — real dwell time, in minutes not seconds
- `Engagement Score` — a ready-made intent score Goldcast already computes
- **No verbatim Q&A or poll-response text anywhere in that export**

This project's webhook payload assumes Goldcast hands over the actual question text
(`qa_question`) and poll answer text (`poll_response`) — a reasonable read of the
original concept slide, but unverified against Goldcast's real live webhook/API (which
may differ from its summary *export*). Before wiring this to a real Goldcast webhook,
confirm whether their live event webhook actually carries verbatim text, or only counts
and a score like the export does. If it's only counts, the synthesis prompt needs to
change — Claude can't write specific objection-handling bullets from "3 questions asked"
the way it can from an actual question.

## 6. After all of the above

1. Swap `Look Up Account (Simulated CRM)` and `Bitscale Enrichment` back to the real
   node definitions in [`n8n-workflows/battlecard-event-to-slack.ts`](../n8n-workflows/battlecard-event-to-slack.ts)
   (they're currently faked live in n8n — see
   [`docs/05-current-demo-state.md`](05-current-demo-state.md)).
2. Re-enable `Check Existing Battlecard Page` and `Commit Battlecard to GitHub`.
3. Run a real end-to-end test with a real webinar event (or a hand-crafted payload
   matching your confirmed Goldcast shape from step 5).
4. Only then consider publishing/activating the workflow for production traffic.
