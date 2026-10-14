import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { uuid } from './claude';
import { askOf, createQuestion, readQuestion, settleQuestion } from './bridge-questions';
import { questionTestTool } from './names';

type Asker = { provider: 'claude' | 'codex'; sessionId: string };
export type QuestionTestOptions = { stateDir: string; codexHome: string; authenticate: (meta?: Record<string, unknown>) => Promise<Asker> };

// The same test in both apps: the bridge hands the agent one sample question, the agent asks it with the app's
// own question tool, and a second call shows whether the person's answer reached the bridge from the app (Claude's
// hook, or Codex's own chat history) rather than from the agent.
export function registerQuestionTest(server: McpServer, options: QuestionTestOptions) {
  server.registerTool(questionTestTool, {
    description: 'Test asking the person a bridge question with this app’s own question tool. Without questionId it returns a sample '
      + 'question to ask word for word; call it again with that questionId after the person answers to see whether the answer reached '
      + 'the bridge directly from the app. Use it only when the person asks for this test. Sends nothing to the other chat and grants nothing.',
    inputSchema: { questionId: uuid.optional() }, annotations: { openWorldHint: false },
  }, async ({ questionId }, extra) => {
    const asker = await options.authenticate(extra._meta as Record<string, unknown> | undefined);
    const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    if (!questionId) {
      const record = createQuestion(options.stateDir, { provider: asker.provider, sessionId: asker.sessionId });
      return result({ questionId: record.id, ask: askOf(record),
        instructions: 'Ask the person exactly this question, word for word, with your own question tool (AskUserQuestion in Claude Code; '
          + 'in Codex request_user_input, or request_user_input_async where the first is unavailable) and only these options. '
          + 'Do not answer it yourself or describe it in text instead. '
          + `Wait for their answer, then call ${questionTestTool} with this questionId and show them the result.` });
    }
    const stored = readQuestion(options.stateDir, questionId);
    if (!stored || stored.sessionId !== asker.sessionId) throw new Error('No bridge question with this ID was asked in this chat');
    const record = settleQuestion(options.stateDir, options.codexHome, stored);
    const received = record.received;
    return result({ questionId: record.id, receivedFromApp: !!received,
      ...(received ? { answer: received.answers[0] ?? null, source: received.source, tool: received.tool, exactQuestion: received.exactQuestion,
        secondsToAnswer: Math.round((received.at - record.askedAt) / 1000), responseShape: received.responseShape, rawResponse: received.rawResponse } : {}),
      note: received ? `The app gave this answer to the bridge (${received.source === 'app_hook' ? 'its hook after the question tool' : 'the chat’s own history'}); the agent did not relay it.`
        : 'The bridge has not received an answer: either the person has not answered yet, the question was not shown with the app’s '
          + 'question tool, or this app does not hand that answer to the bridge.' });
  });
}
