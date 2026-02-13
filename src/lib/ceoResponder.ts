import { loadAgents, getSetting, getPendingApprovalCount, loadSkills, loadMissions } from './database';
import { skills as skillDefinitions } from '../data/skillDefinitions';

interface CEOContext {
  mission: string | null;
  agentCount: number;
  pendingApprovals: number;
  enabledSkillCount: number;
  totalAvailableSkills: number;
  missionCount: number;
  ceoName: string;
  orgName: string;
}

async function gatherContext(): Promise<CEOContext> {
  const enabledSkills = (await loadSkills()).filter(s => s.enabled);
  const availableSkills = skillDefinitions.filter(s => s.status === 'available');
  const missions = await loadMissions();
  const agents = await loadAgents();
  return {
    mission: await getSetting('primary_mission'),
    agentCount: agents.length,
    pendingApprovals: await getPendingApprovalCount(),
    enabledSkillCount: enabledSkills.length,
    totalAvailableSkills: availableSkills.length,
    missionCount: missions.length,
    ceoName: (await getSetting('ceo_name')) ?? 'CEO',
    orgName: (await getSetting('org_name')) ?? 'the organization',
  };
}

const PATTERNS: [RegExp, (ctx: CEOContext) => string][] = [
  // Mission / goals
  [/mission|goal|objective|vision|purpose/i, ctx =>
    ctx.mission
      ? `Our primary mission: "${ctx.mission}". If you want to update it or add sub-missions, head to the Missions board.`
      : `We haven't set a primary mission yet. Tell me what ${ctx.orgName} is trying to achieve.`
  ],

  // Skills & marketplace
  [/skill|capabilit|tool|marketplace|refresh/i, ctx => {
    const remaining = ctx.totalAvailableSkills - ctx.enabledSkillCount;
    if (remaining > 0) {
      return `We have ${ctx.enabledSkillCount} of ${ctx.totalAvailableSkills} available skills enabled. You might want to check the Skills page — there are ${remaining} more we could turn on. Also worth refreshing from the Marketplace to see if anything new has dropped.`;
    }
    return `All ${ctx.totalAvailableSkills} available skills are enabled — nice. Keep an eye on the Skills page for new additions from the Marketplace.`;
  }],

  // Agents / hiring / team
  [/agent|hire|team|staff|workforce|recruit/i, ctx =>
    ctx.agentCount > 0
      ? `We have ${ctx.agentCount} agent${ctx.agentCount > 1 ? 's' : ''} on the floor. Need more hands? Head to Surveillance to hire.`
      : `No agents yet. Head to Surveillance and let's start building the team.`
  ],

  // Approvals
  [/approval|pending|request|authorize/i, ctx =>
    ctx.pendingApprovals > 0
      ? `${ctx.pendingApprovals} pending approval${ctx.pendingApprovals > 1 ? 's' : ''} waiting for you. Check the Approvals page.`
      : `No pending approvals. All clear on that front.`
  ],

  // Surveillance / office
  [/surveillance|office|floor|monitor|watch/i, () =>
    `The Surveillance feed shows the office in real-time. Head there to see what the team is up to.`
  ],

  // Vault / API keys
  [/vault|api\s*key|credential|secret/i, () =>
    `API keys and credentials are stored in The Vault. Make sure all required services are connected.`
  ],

  // Budget / financials
  [/budget|financ|cost|spend|money/i, () =>
    `Check the Financials page for budget vs actual breakdowns. Keep an eye on API costs as we scale.`
  ],

  // Audit / logs
  [/audit|log|history|event/i, () =>
    `The Audit page has a full event log. You can filter by severity and agent.`
  ],

  // Status / report
  [/status|report|update|how.*things|what.*happening/i, ctx => {
    const parts: string[] = [];
    parts.push(`${ctx.agentCount} agent${ctx.agentCount !== 1 ? 's' : ''} active`);
    parts.push(`${ctx.enabledSkillCount} skill${ctx.enabledSkillCount !== 1 ? 's' : ''} enabled`);
    parts.push(`${ctx.missionCount} mission${ctx.missionCount !== 1 ? 's' : ''} tracked`);
    if (ctx.pendingApprovals > 0) parts.push(`${ctx.pendingApprovals} pending approval${ctx.pendingApprovals > 1 ? 's' : ''}`);
    return `Quick status: ${parts.join(', ')}. ${ctx.pendingApprovals > 0 ? 'Those approvals could use your attention.' : 'Everything running smooth.'}`;
  }],

  // Help
  [/help|what can you|what do you/i, () =>
    `I can help with missions, hiring, skills, approvals, and general ops. Ask me about anything or tell me what you need.`
  ],

  // Greetings
  [/^(hey|hi|hello|yo|sup|morning|evening|afternoon)/i, ctx =>
    `Hey! What's on your mind? I'm keeping tabs on ${ctx.orgName} operations.`
  ],

  // Thanks
  [/thank|cheers|appreciate/i, () =>
    `Anytime. That's what I'm here for. What else do you need?`
  ],
];

const FALLBACKS = [
  `Interesting. Tell me more about what you're thinking.`,
  `I hear you. Want me to look into anything specific on that?`,
  `Noted. Is there an action you'd like me to take on this?`,
  `Got it. Let me know if you need me to dig deeper on any front.`,
  `Copy that. Anything else on your mind?`,
];

let fallbackIndex = 0;

/**
 * Generate a scripted CEO response based on keyword matching.
 * No LLM required — pure pattern matching with context from DB.
 */
export async function getCEOResponse(userText: string): Promise<string> {
  const ctx = await gatherContext();

  for (const [pattern, responder] of PATTERNS) {
    if (pattern.test(userText)) {
      return responder(ctx);
    }
  }

  // Cycle through fallbacks
  const response = FALLBACKS[fallbackIndex % FALLBACKS.length];
  fallbackIndex++;
  return response;
}
