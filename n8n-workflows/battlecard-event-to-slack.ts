import { workflow, node, trigger, sticky, newCredential, expr, languageModel, outputParser } from '@n8n/workflow-sdk';

// ── Capture ──────────────────────────────────────────────────────────
const eventWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Webinar Event Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'webinar-battlecard-event',
      authentication: 'none', // demo webhook; n8n webhook URLs are unguessable by default
      responseMode: 'onReceived',
    },
  },
});

// ── Middleware Merge: simulated CRM lookup by email domain ────────────
const lookupAccount = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Look Up Account (Simulated CRM)',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'accounts',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'anyFilter',
      filters: {
        conditions: [
          {
            keyName: 'domain',
            condition: 'eq',
            keyValue: expr(`{{ $('Webinar Event Webhook').item.json.body.attendee.email.split('@')[1] }}`),
          },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase (Simulated CRM)') },
  },
});

// ── Compute the slug/URL once, reused by 4 downstream nodes ────────────
const computeSlug = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Compute Battlecard Slug',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'slug',
            name: 'slug',
            type: 'string',
            value: expr(`={{ String($('Look Up Account (Simulated CRM)').item.json.company_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }}`),
          },
          {
            id: 'battlecard-url',
            name: 'battlecardUrl',
            type: 'string',
            value: expr(`={{ 'https://labs.bowtiefunnel.com/battlecards/' + String($('Look Up Account (Simulated CRM)').item.json.company_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '/' }}`),
          },
        ],
      },
    },
  },
});

// ── Enrich & Synth: Bitscale waterfall enrichment ──────────────────────
const bitscaleEnrich = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Bitscale Enrichment',
    parameters: {
      method: 'POST',
      // Replace YOUR_GRID_ID and the input column key with your real Bitscale grid.
      url: 'https://api.bitscale.ai/api/v1/grids/REPLACE_WITH_GRID_ID/run',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpTemplatedCustomAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(`={{ {
        "mode": "sync",
        "inputs": {
          "REPLACE_WITH_INPUT_COLUMN_UUID": $('Look Up Account (Simulated CRM)').item.json.domain
        }
      } }}`),
      options: { timeout: 15000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential('Bitscale API') },
  },
});

// ── Enrich & Synth: cognitive synthesis, as a real AI Agent ────────────
// Subnodes: an Anthropic Chat Model (does the actual API call) and a
// Structured Output Parser (forces the reply into the JSON shape below via
// tool-calling, not prompt-engineering hope). See docs/04-ai-agent-explained.md.
const anthropicModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  version: 1.6,
  config: { name: 'Anthropic Chat Model', parameters: {} },
});

const structuredParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Structured Output Parser',
    parameters: {
      schemaType: 'manual',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: {
          account_summary: { type: 'string' },
          flagged_competitors: { type: 'array', items: { type: 'string' } },
          objection_bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['account_summary', 'flagged_competitors', 'objection_bullets'],
      }),
      // NOTE: no autoFix — that needs its own separate fixer-model subnode,
      // which hit a validation quirk when nested under the parser. Known gap:
      // a malformed model reply fails the run instead of retrying. See
      // docs/05-current-demo-state.md.
    },
  },
});

const claudeSynthesis = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Claude Battlecard Synthesis',
    parameters: {
      promptType: 'define',
      text: expr(`={{
              (() => {
                const account = $('Look Up Account (Simulated CRM)').item.json;
                const event = $('Webinar Event Webhook').item.json.body;
                const enrichment = $('Bitscale Enrichment').item.json.outputs || {};
                return \`Account: \${account.company_name} (\${account.domain}), pipeline stage: \${account.pipeline_stage}, owner: \${account.owner_ae}.
Attendee Q&A: "\${event.session.qa_question}"
Poll response: "\${event.session.poll_response}"
Enrichment data: \${JSON.stringify(enrichment)}\`;
              })()
            }}`),
      hasOutputParser: true,
      options: {
        systemMessage:
          'You are a sales battlecard synthesis assistant. You analyze live webinar Q&A and enrichment data to produce concise, accurate talking points for a sales rep.',
      },
    },
    subnodes: { model: anthropicModel, outputParser: structuredParser },
  },
});

// ── Enrich & Synth: assemble the Slack Block Kit array ─────────────────
const buildBlocks = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Build Battlecard Blocks',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'battlecard-blocks',
            name: 'blocks',
            type: 'array',
            value: expr(`={{
              (() => {
                const synth = $('Claude Battlecard Synthesis').item.json.output || { account_summary: 'Synthesis unavailable.', flagged_competitors: [], objection_bullets: [] };
                const account = $('Look Up Account (Simulated CRM)').item.json;
                const event = $('Webinar Event Webhook').item.json.body;
                const battlecardUrl = $('Compute Battlecard Slug').item.json.battlecardUrl;

                // Packed into each button's value so Workflow 2 knows which account to act on
                // without a second lookup.
                const actionContext = JSON.stringify({ accountId: account.id, domain: account.domain });

                return [
                  { type: 'header', text: { type: 'plain_text', text: \`🔥 High-Intent: \${account.company_name}\` } },
                  { type: 'section', text: { type: 'mrkdwn', text: \`*Pipeline:* \${account.pipeline_stage} | *Owner:* \${account.owner_ae}\\n*Q&A:* \${event.session.qa_question}\\n*Poll:* \${event.session.poll_response}\` } },
                  { type: 'section', text: { type: 'mrkdwn', text: \`*Summary:* \${synth.account_summary}\` } },
                  { type: 'section', text: { type: 'mrkdwn', text: \`*Competitors flagged:* \${(synth.flagged_competitors || []).join(', ') || 'None'}\` } },
                  { type: 'section', text: { type: 'mrkdwn', text: \`*Objection talking points:*\\n\${(synth.objection_bullets || []).map(b => \`• \${b}\`).join('\\n')}\` } },
                  { type: 'section', text: { type: 'mrkdwn', text: '<' + battlecardUrl + '|📄 View Full Battlecard →>' } },
                  { type: 'divider' },
                  {
                    type: 'actions',
                    elements: [
                      { type: 'button', text: { type: 'plain_text', text: 'Claim Lead' }, action_id: 'claim_lead', value: actionContext, style: 'primary' },
                      { type: 'button', text: { type: 'plain_text', text: 'Review Talking Points' }, action_id: 'review_talking_points', value: actionContext },
                      { type: 'button', text: { type: 'plain_text', text: 'Launch Sequence' }, action_id: 'launch_sequence', value: actionContext, style: 'danger' },
                    ],
                  },
                ];
              })()
            }}`),
          },
        ],
      },
    },
  },
});

// ── Assemble the full HTML page (same visual family as competitor-battlecards) ─
const buildHtml = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Build Battlecard HTML',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'battlecard-html',
            name: 'battlecardHtml',
            type: 'string',
            value: expr(`={{
(() => {
  const account = $('Look Up Account (Simulated CRM)').item.json;
  const event = $('Webinar Event Webhook').item.json.body;
  const synth = $('Claude Battlecard Synthesis').item.json.output || { account_summary: 'Synthesis unavailable.', flagged_competitors: [], objection_bullets: [] };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dwellMin = Math.round((event.session.dwell_time_seconds || 0) / 60);
  const competitorsList = (synth.flagged_competitors || []).length
    ? '<ul>' + (synth.flagged_competitors || []).map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>'
    : '<p>None flagged.</p>';
  const objectionsList = '<ul>' + (synth.objection_bullets || []).map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>';
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Battlecard — ' + esc(account.company_name) + '</title>',
    '<style>',
    ':root { --teal: #5eead4; --black: #0a0a0a; --gray: #6b7280; --border: #d1d5db; --danger: #dc2626; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; font-family: -apple-system, "Segoe UI", Arial, sans-serif; background: #fff; color: #111; }',
    'header.hero { background: var(--black); padding: 28px 40px; display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; }',
    'header.hero h1 { color: var(--teal); margin: 0; font-size: 28px; }',
    'header.hero .badge { color: #fca5a5; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }',
    '.meta { color: #6b7280; font-size: 13px; padding: 8px 40px 0; }',
    'main { display: grid; grid-template-columns: 320px 1fr; gap: 24px; padding: 24px 40px 48px; align-items: start; }',
    '@media (max-width: 900px) { main { grid-template-columns: 1fr; } }',
    '.left-col, .right-col { display: flex; flex-direction: column; gap: 20px; }',
    '.box, .panel { border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }',
    '.box-header, .panel-header { padding: 10px 16px; font-weight: 700; font-size: 13px; letter-spacing: .02em; text-transform: uppercase; }',
    '.box-header.teal { background: var(--teal); color: #063a35; }',
    '.panel-header.gray { background: var(--gray); color: #fff; }',
    '.box-body, .panel-body { padding: 14px 16px; font-size: 14px; line-height: 1.6; }',
    'ul { margin: 0; padding-left: 18px; }',
    'p { margin: 0 0 10px; }',
    'p:last-child { margin-bottom: 0; }',
    '.kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 14px; }',
    '.kv dt { color: #6b7280; }',
    '.kv dd { margin: 0; font-weight: 600; }',
    '.actions { display: flex; gap: 10px; flex-wrap: wrap; }',
    '.action-pill { border: 1px solid var(--border); border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; }',
    '.action-pill.primary { background: var(--teal); border-color: var(--teal); color: #063a35; }',
    '.action-pill.danger { background: #fee2e2; border-color: var(--danger); color: var(--danger); }',
    'footer { padding: 16px 40px; font-size: 12px; color: #9ca3af; }',
    '</style>',
    '</head>',
    '<body>',
    '<header class="hero"><h1>🔥 ' + esc(account.company_name) + '</h1><span class="badge">Live webinar signal</span></header>',
    '<div class="meta">Battlecard generated ' + esc($now.toISO()) + ' · ' + esc(account.domain) + '</div>',
    '<main>',
    '<div class="left-col">',
    '<div class="box"><div class="box-header teal">Account Snapshot</div><div class="box-body"><dl class="kv"><dt>Pipeline</dt><dd>' + esc(account.pipeline_stage) + '</dd><dt>Owner (AE)</dt><dd>' + esc(account.owner_ae) + '</dd><dt>Owner (SDR)</dt><dd>' + esc(account.owner_sdr || '—') + '</dd></dl></div></div>',
    '<div class="box"><div class="box-header teal">Live Signal</div><div class="box-body"><p><strong>Q&amp;A:</strong> "' + esc(event.session.qa_question) + '"</p><p><strong>Poll:</strong> ' + esc(event.session.poll_response) + '</p><p><strong>Dwell time:</strong> ' + dwellMin + ' min</p></div></div>',
    '<div class="box"><div class="box-header teal">Suggested Actions</div><div class="box-body actions"><span class="action-pill primary">Claim Lead</span><span class="action-pill">Review Talking Points</span><span class="action-pill danger">Launch Sequence</span></div></div>',
    '</div>',
    '<div class="right-col">',
    '<div class="panel"><div class="panel-header gray">Account Summary</div><div class="panel-body"><p>' + esc(synth.account_summary) + '</p></div></div>',
    '<div class="panel"><div class="panel-header gray">Competitors Flagged</div><div class="panel-body">' + competitorsList + '</div></div>',
    '<div class="panel"><div class="panel-header gray">Objection Talking Points</div><div class="panel-body">' + objectionsList + '</div></div>',
    '</div>',
    '</main>',
    '<footer>Bowtie Funnel — Account Intelligence &amp; Dynamic Battlecard Agent (demo)</footer>',
    '</body>',
    '</html>',
  ].join('\\n');
})()
}}`),
          },
        ],
      },
    },
  },
});

// ── Review Gate: commit the page to GitHub Pages, then post to Slack ────
const checkExistingPage = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Check Existing Battlecard Page',
    parameters: {
      method: 'GET',
      url: expr(`={{ 'https://api.github.com/repos/bowtiefunnel/bowtie-funnel-Labs/contents/docs/battlecards/' + $('Compute Battlecard Slug').item.json.slug + '/index.html?ref=main' }}`),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpTemplatedCustomAuth',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }] },
      options: { timeout: 15000, response: { response: { neverError: true } } },
    },
    credentials: { httpTemplatedCustomAuth: newCredential('GitHub API (Labs)') },
  },
});

const commitToGithub = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Commit Battlecard to GitHub',
    parameters: {
      method: 'PUT',
      url: expr(`={{ 'https://api.github.com/repos/bowtiefunnel/bowtie-funnel-Labs/contents/docs/battlecards/' + $('Compute Battlecard Slug').item.json.slug + '/index.html' }}`),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpTemplatedCustomAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(`={{
  {
    message: 'Battlecard: ' + $('Look Up Account (Simulated CRM)').item.json.company_name,
    content: Buffer.from($('Build Battlecard HTML').item.json.battlecardHtml, 'utf-8').toString('base64'),
    branch: 'main',
    ...($('Check Existing Battlecard Page').item.json.sha ? { sha: $('Check Existing Battlecard Page').item.json.sha } : {})
  }
}}`),
      options: { timeout: 20000 },
    },
    credentials: { httpTemplatedCustomAuth: newCredential('GitHub API (Labs)') },
  },
});

const postBattlecard = node({
  type: 'n8n-nodes-base.slack',
  version: 2.7,
  config: {
    name: 'Post Battlecard to Slack',
    parameters: {
      resource: 'message',
      operation: 'post',
      authentication: 'oAuth2',
      select: 'channel',
      channelId: { __rl: true, mode: 'id', value: 'C0C5B6UN23U' }, // #battlecard-demo
      messageType: 'block',
      text: expr(`={{ 'High-intent webinar signal: ' + $('Look Up Account (Simulated CRM)').item.json.company_name }}`),
      blocksUi: expr(`={{ { "blocks": $('Build Battlecard Blocks').item.json.blocks } }}`),
    },
    credentials: { slackOAuth2Api: newCredential('Slack OAuth2 API', 'FTCQEbwvU0X8b1N5') },
  },
});

// ── Sticky notes (readability) ──────────────────────────────────────────
const stickyCapture = sticky(
  '### 1. Capture\nSample Goldcast-shaped webhook. Replace with a real Goldcast integration later.',
  [eventWebhook],
  { color: 5 }
);
const stickyEnrichSynth = sticky(
  '### 2-3. Merge, Enrich & Synth\nSupabase simulates the CRM. Bitscale does waterfall enrichment. A real AI Agent (Claude + structured output) drafts the objection bullets.',
  [lookupAccount, computeSlug, bitscaleEnrich, claudeSynthesis, buildBlocks, buildHtml],
  { color: 4 }
);
const stickyReviewGate = sticky(
  '### 4. Review Gate\nCommits the HTML page, then posts the interactive Slack card. Button clicks are handled by the sibling workflow "Battlecard: Slack Action Handler".',
  [checkExistingPage, commitToGithub, postBattlecard],
  { color: 7 }
);

export default workflow('webinar-battlecard-event-to-slack', 'Battlecard: Webinar Event to Slack')
  .add(eventWebhook)
  .to(lookupAccount)
  .to(computeSlug)
  .to(bitscaleEnrich)
  .to(claudeSynthesis)
  .to(buildBlocks)
  .to(buildHtml)
  .to(checkExistingPage)
  .to(commitToGithub)
  .to(postBattlecard)
  .add(stickyCapture)
  .add(stickyEnrichSynth)
  .add(stickyReviewGate);
