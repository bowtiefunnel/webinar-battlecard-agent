# The AI Agent, step by step

"Claude Battlecard Synthesis" is a real n8n **AI Agent** node
(`@n8n/n8n-nodes-langchain.agent`), not a plain one-shot completion call. It has two
subnodes wired underneath it on the canvas: an **Anthropic Chat Model** and a
**Structured Output Parser**. This is grounded in an actual traced execution, not
documentation guesswork.

| Step | What happens | Node / mechanism |
|---|---|---|
| 1 | Upstream data is ready: account record, enrichment data, raw webhook event (Q&A text, poll response) | Look Up Account → Compute Slug → Bitscale Enrichment |
| 2 | System message set: persona + task instructions | Agent node config (`options.systemMessage`) |
| 3 | User message built dynamically each run — account name/domain/pipeline/owner, the actual Q&A question, poll response, enrichment JSON | Agent node config (`text`, built by expression) |
| 4 | n8n auto-injects a structured-output instruction into the prompt, requiring Claude to call a tool named `format_final_json_response` instead of replying in prose | Triggered by `hasOutputParser: true` |
| 5 | Real API call fires to Claude, using the workspace's Gateway credits (no separate API key needed) | **Anthropic Chat Model** subnode, wired via `ai_languageModel` connection |
| 6 | Claude reasons over the input and drafts its analysis — including inferences not explicitly stated in the Q&A (e.g. flagging a competitor only present in the enrichment data) | Claude (Anthropic API) |
| 7 | Claude calls `format_final_json_response` with its answer shaped to the required schema | Claude (tool-calling) |
| 8 | The tool call is validated against the JSON schema (`account_summary: string`, `flagged_competitors: string[]`, `objection_bullets: string[]`, all required) | **Structured Output Parser** subnode, wired via `ai_outputParser` connection |
| 9a | **On success:** Agent outputs a real object at `$json.output` — no `JSON.parse()` needed downstream | Agent node output |
| 9b | **On failure:** the node throws and the execution fails — no retry configured | Agent node error path (see "Known gap" below) |
| 10 | Downstream nodes read `output.account_summary` / `.flagged_competitors` / `.objection_bullets` directly | Build Battlecard Blocks, Build Battlecard HTML |

## The schema

```json
{
  "type": "object",
  "properties": {
    "account_summary": { "type": "string" },
    "flagged_competitors": { "type": "array", "items": { "type": "string" } },
    "objection_bullets": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["account_summary", "flagged_competitors", "objection_bullets"]
}
```

## Known gap: no `autoFix`

n8n's recommended production pattern for `outputParserStructured` is `autoFix: true`
with a coding-capable fixer model wired to the parser's own `languageModel` subnode —
so a malformed model reply gets one automatic retry instead of failing the whole
execution.

This build **does not have that** — wiring a second model as the parser's fixer hit a
validation warning (`MISSING_REQUIRED_INPUT` on the parser's `ai_languageModel` input)
that wasn't resolved during the demo build. Practical effect: if Claude ever declines to
call the format tool (e.g., genuinely insufficient data, or a rare model hiccup), the
whole run fails instead of self-correcting. In 3 real executions of this exact prompt
shape, it succeeded every time — but this is real production risk, not a hypothetical,
and is the single most valuable hardening item before this goes past demo stage.

## Why an Agent node instead of a plain completion node

n8n's own guidance ("Structured output but no tools? Agent is the easier default with
future expansion in mind") supports either choice here — a plain `@n8n/n8n-nodes-langchain.anthropic`
message node would have worked too, and did work in earlier iterations of this build.
The Agent node was chosen specifically so the AI step is visually and architecturally a
first-class "AI Agent" on the canvas, with room to add tools or memory later without
restructuring the node.
