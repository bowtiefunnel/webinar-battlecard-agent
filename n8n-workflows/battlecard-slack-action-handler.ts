import { workflow, node, trigger, switchCase, sticky, newCredential, expr } from '@n8n/workflow-sdk';

// ── Capture: Slack sends interaction payloads here ─────────────────────
const slackActionWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Slack Interaction Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'battlecard-slack-actions',
      authentication: 'none',
      responseMode: 'responseNode', // Slack needs an explicit ack within 3s via Respond to Webhook
    },
  },
});

// ── Parse: Slack sends form-urlencoded body with a JSON string in `payload` ─
const parseInteraction = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Parse Slack Interaction',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'parsed-payload',
            name: 'payload',
            type: 'object',
            value: expr(`={{ JSON.parse($('Slack Interaction Webhook').item.json.body.payload) }}`),
          },
        ],
      },
    },
  },
});

// ── Route by which button was clicked ───────────────────────────────────
const routeAction = switchCase({
  version: 3.4,
  config: {
    name: 'Route by Action',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          {
            outputKey: 'claim_lead',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr(`{{ $('Parse Slack Interaction').item.json.payload.actions[0].action_id }}`), operator: { type: 'string', operation: 'equals' }, rightValue: 'claim_lead' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'review_talking_points',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr(`{{ $('Parse Slack Interaction').item.json.payload.actions[0].action_id }}`), operator: { type: 'string', operation: 'equals' }, rightValue: 'review_talking_points' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'launch_sequence',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr(`{{ $('Parse Slack Interaction').item.json.payload.actions[0].action_id }}`), operator: { type: 'string', operation: 'equals' }, rightValue: 'launch_sequence' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown Action' },
    },
  },
});

// ── Branch: Claim Lead → write ownership to the simulated CRM ───────────
const claimLead = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Claim Lead in Supabase',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'accounts',
      filterType: 'manual',
      matchType: 'anyFilter',
      filters: {
        conditions: [
          { keyName: 'id', condition: 'eq', keyValue: expr(`={{ JSON.parse($('Parse Slack Interaction').item.json.payload.actions[0].value).accountId }}`) },
        ],
      },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'claimed_by', fieldValue: expr(`={{ $('Parse Slack Interaction').item.json.payload.user.username }}`) },
          { fieldId: 'claimed_at', fieldValue: expr(`={{ $now.toISO() }}`) },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase (Simulated CRM)') },
  },
});
const claimLeadResponseText = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set Claim Lead Response',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'response-text', name: 'responseText', type: 'string', value: expr(`={{ '✅ Lead claimed by ' + $('Parse Slack Interaction').item.json.payload.user.username }}`) },
        ],
      },
    },
  },
});

// ── Branch: Review Talking Points → acknowledge only, no write ──────────
const reviewTalkingPointsResponseText = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set Review Response',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'response-text', name: 'responseText', type: 'string', value: '📋 Talking points are in the message above — no additional action needed.' },
        ],
      },
    },
  },
});

// ── Branch: Launch Sequence → simulated outbound trigger ────────────────
const launchSequence = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log Outbound Sequence (Simulated)',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'outbound_log',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'account_id', fieldValue: expr(`={{ JSON.parse($('Parse Slack Interaction').item.json.payload.actions[0].value).accountId }}`) },
          { fieldId: 'triggered_by', fieldValue: expr(`={{ $('Parse Slack Interaction').item.json.payload.user.username }}`) },
          { fieldId: 'sequence_name', fieldValue: 'battlecard-followup' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase (Simulated CRM)') },
  },
});
const launchSequenceResponseText = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set Launch Sequence Response',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'response-text', name: 'responseText', type: 'string', value: expr(`={{ '🚀 Outbound sequence logged (simulated) by ' + $('Parse Slack Interaction').item.json.payload.user.username }}`) },
        ],
      },
    },
  },
});

// ── Fallback branch ───────────────────────────────────────────────────
const unknownActionResponseText = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Set Unknown Action Response',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'response-text', name: 'responseText', type: 'string', value: '⚠️ Unrecognized action.' },
        ],
      },
    },
  },
});

// ── Respond: single ack point, all four branches fan in here ────────────
const respondToSlack = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond to Slack',
    parameters: {
      respondWith: 'json',
      responseBody: expr(`={{ { "response_type": "in_channel", "replace_original": false, "text": $json.responseText } }}`),
      options: { responseCode: 200 },
    },
  },
});

const stickyRoute = sticky(
  '### Review Gate: action handling\nEach branch is a complete path: do the write (if any), set responseText, then fall through to the shared Respond node. Only one branch fires per Slack click.',
  [parseInteraction, routeAction, claimLead, claimLeadResponseText, reviewTalkingPointsResponseText, unknownActionResponseText],
  { color: 7 }
);
const stickyOutbound = sticky(
  '### 5. Outbound (simulated)\nLaunch Sequence logs to outbound_log instead of calling a real SEP. Swap in a real Outreach/Salesloft HTTP Request here when ready.',
  [launchSequence, launchSequenceResponseText],
  { color: 3 }
);

export default workflow('webinar-battlecard-slack-action-handler', 'Battlecard: Slack Action Handler')
  .add(slackActionWebhook)
  .to(parseInteraction)
  .to(routeAction
    .onCase(0, claimLead.to(claimLeadResponseText.to(respondToSlack)))
    .onCase(1, reviewTalkingPointsResponseText.to(respondToSlack))
    .onCase(2, launchSequence.to(launchSequenceResponseText.to(respondToSlack)))
    .onCase(3, unknownActionResponseText.to(respondToSlack)))
  .add(stickyRoute)
  .add(stickyOutbound);
