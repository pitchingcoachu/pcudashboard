import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import { getSessionFromCookies } from '../../../../lib/auth';
import { resolveDashboardApiBaseUrl, resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveDashboardPlayerIdentity, scopedPlayerQueryName, shouldScopeDashboardPlayer } from '../../../../lib/dashboard-player-scope';
import { getAnthropicClient, DASHBOARD_CHAT_MODEL } from '../../../../lib/anthropic-client';
import { buildToolsForSession, type ChatSessionContext } from '../../../../lib/chat/tools';
import { buildProgrammingToolsForSession, type ProgrammingSessionContext } from '../../../../lib/chat/programming-tools';
import { buildSystemPrompt } from '../../../../lib/chat/system-prompt';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { getPlayerForUser } from '../../../../lib/training-db';

export const maxDuration = 120;

type ChatBody = {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pageContext?: { suite?: string };
};

type PageLink = { title: string; href: string };

function collectToolTrace(messages: BetaMessageParam[]): { toolNames: string[]; toolResultTexts: string[] } {
  const toolNames: string[] = [];
  const toolResultTexts: string[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        toolNames.push(block.name);
      } else if (block.type === 'tool_result') {
        const content = block.content;
        if (typeof content === 'string') {
          toolResultTexts.push(content);
        } else if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'text') toolResultTexts.push(item.text);
          }
        }
      }
    }
  }
  return { toolNames, toolResultTexts };
}

function findPageLinkFromTrace(toolResultTexts: string[]): PageLink | null {
  for (const text of toolResultTexts) {
    try {
      const parsed = JSON.parse(text) as { matches?: Array<{ title?: string; href?: string }> };
      if (Array.isArray(parsed.matches) && parsed.matches.length > 0) {
        const first = parsed.matches[0];
        if (first.title && first.href) {
          return { title: first.title, href: first.href };
        }
      }
    } catch {
      // not a find_page result; ignore
    }
  }
  return null;
}

function computeConfidence(toolNames: string[], toolResultTexts: string[], finalText: string): 'low' | 'medium' | 'high' {
  const dataToolNames = new Set([
    'get_player_stat', 'get_leaderboard', 'compare_splits', 'get_ab_report', 'get_best_pitch_by_metric',
    'get_player_schedule', 'get_player_cycle_program', 'get_player_bullpen_log',
    'get_player_weight_logs', 'get_exercise_trend', 'find_scheduling_gaps',
  ]);
  const calledDataTool = toolNames.some((name) => dataToolNames.has(name));
  if (!calledDataTool) {
    // Either a pure navigation/glossary answer, or the model answered/asked without data —
    // low confidence unless it's clearly a clarifying question.
    return /\?\s*$/.test(finalText.trim()) ? 'low' : 'medium';
  }
  const anyErrorResult = toolResultTexts.some((text) => {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      return Boolean(parsed.error);
    } catch {
      return false;
    }
  });
  return anyErrorResult ? 'medium' : 'high';
}

function buildEvidence(toolNames: string[], toolResultTexts: string[]): string[] {
  const evidence: string[] = [];
  const uniqueTools = Array.from(new Set(toolNames));
  if (uniqueTools.length) evidence.push(`Tools used: ${uniqueTools.join(', ')}`);
  for (const text of toolResultTexts) {
    try {
      const parsed = JSON.parse(text) as {
        domain?: string;
        window?: { start?: string; end?: string };
        tableMode?: string;
      };
      if (parsed.domain) evidence.push(`Domain: ${parsed.domain === 'pitching' ? 'Pitching' : 'Hitting'}`);
      if (parsed.window?.start && parsed.window?.end) evidence.push(`Window: ${parsed.window.start} to ${parsed.window.end}`);
      if (parsed.tableMode) evidence.push(`Table mode: ${parsed.tableMode}`);
    } catch {
      // ignore non-JSON tool results
    }
  }
  return Array.from(new Set(evidence));
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ChatBody;
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const clientMessages = rawMessages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content.trim() }));
  if (!clientMessages.length || clientMessages[clientMessages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'A user message is required.' }, { status: 400 });
  }

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  });
  const apiBase = resolveDashboardApiBaseUrl();
  const shouldScopePlayer = shouldScopeDashboardPlayer(session.role, schoolCode);
  const playerIdentity = shouldScopePlayer
    ? await resolveDashboardPlayerIdentity({
        role: session.role,
        organizationId: session.organizationId,
        userId: session.userId,
        name: session.name,
      })
    : null;
  if (shouldScopePlayer && !playerIdentity) {
    return NextResponse.json({ error: 'Player account is not linked to a dashboard player.' }, { status: 403 });
  }

  const isProSchool = schoolCode.trim().toUpperCase() === 'PRO';
  const role: 'admin' | 'coach' | 'player' = session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin';
  const sessionContext: ChatSessionContext = {
    apiBase,
    schoolCode,
    isProSchool,
    shouldScopePlayer,
    scopedPitcherName: shouldScopePlayer ? scopedPlayerQueryName(playerIdentity!, 'Pitching') : undefined,
    scopedHitterName: shouldScopePlayer ? scopedPlayerQueryName(playerIdentity!, 'Hitting') : undefined,
  };

  const programmingEnabled = await canUseProgrammingData(session);
  let programmingContext: ProgrammingSessionContext | null = null;
  let scopedProgrammingPlayerUnresolved = false;
  if (programmingEnabled) {
    const organizationId = await resolveProgrammingOrganizationId(session);
    if (organizationId > 0) {
      let scopedPlayerId: number | undefined;
      if (role === 'player') {
        const ownPlayer = session.userId
          ? await getPlayerForUser({ organizationId, userId: session.userId }).catch(() => null)
          : null;
        scopedPlayerId = ownPlayer ? Number(ownPlayer.id) : undefined;
      }
      // Soft-degrade: if a player-role session can't resolve to a real player row, omit
      // programming tools for this request rather than failing the whole chat — stats
      // tools should still work independently.
      if (role !== 'player' || scopedPlayerId) {
        programmingContext = { organizationId, role, userId: session.userId ?? 0, scopedPlayerId };
      } else {
        scopedProgrammingPlayerUnresolved = true;
      }
    }
  }

  try {
    const client = getAnthropicClient();
    const tools = [
      ...buildToolsForSession({ session: sessionContext, role }),
      ...(programmingContext ? buildProgrammingToolsForSession({ session: programmingContext }) : []),
    ];
    const system = buildSystemPrompt({
      role,
      schoolCode,
      isProSchool,
      scopedPlayerName: shouldScopePlayer ? (sessionContext.scopedPitcherName || sessionContext.scopedHitterName || null) : null,
      currentSuite: body.pageContext?.suite ?? null,
      programmingEnabled: Boolean(programmingContext),
      scopedProgrammingPlayerUnresolved,
    });

    const messages: BetaMessageParam[] = clientMessages.map((m) => ({ role: m.role, content: m.content }));

    // Force the FIRST turn to use a tool. Without this, a question about a real-world-famous
    // player (e.g. an MLB star) can tempt the model into answering from pretrained knowledge
    // about that player instead of calling a tool to look up this dashboard's own tracked data —
    // system-prompt instructions alone were not sufficient to prevent this in testing.
    const runner = client.beta.messages.toolRunner({
      model: DASHBOARD_CHAT_MODEL,
      max_tokens: 4096,
      system,
      tools,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      max_iterations: 8,
      tool_choice: { type: 'any' },
    });

    let iteration = 0;
    for await (const _message of runner) {
      iteration += 1;
      if (iteration === 1) {
        runner.setMessagesParams((params) => ({ ...params, tool_choice: { type: 'auto' } }));
      }
    }
    const finalMessage = await runner.done();
    const finalParams = runner.params;

    const finalText = finalMessage.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const { toolNames, toolResultTexts } = collectToolTrace(finalParams.messages);
    const pageLink = findPageLinkFromTrace(toolResultTexts);
    const confidence = computeConfidence(toolNames, toolResultTexts, finalText);
    const evidence = buildEvidence(toolNames, toolResultTexts);

    console.log('[dashboard-chat] tool trace:', JSON.stringify({
      question: clientMessages[clientMessages.length - 1]?.content,
      toolCalls: toolNames,
      usage: finalMessage.usage,
      stopReason: finalMessage.stop_reason,
    }));

    if (finalMessage.stop_reason === 'refusal') {
      return NextResponse.json({
        answer: "I'm not able to help with that request.",
        confidence: 'low',
        evidence: [],
      });
    }

    return NextResponse.json({
      answer: finalText || 'I was not able to produce an answer for that question.',
      confidence,
      evidence,
      page_link: pageLink,
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'The assistant is temporarily busy. Please try again in a moment.' }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError || (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY'))) {
      return NextResponse.json({ error: 'Coaching Assistant is not configured.' }, { status: 500 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: 'The assistant is temporarily unavailable. Please try again.' }, { status: 502 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to answer chat question.' },
      { status: 502 }
    );
  }
}
