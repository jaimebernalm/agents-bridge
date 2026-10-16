# Agents Bridge

[Visit the website](https://jaimebernalm.github.io/agents-bridge/) · [Install](#install-about-5-minutes)

**Get your Claude Code chat and your Codex chat working together as equals, inside the Desktop apps you already use.**

Both apps install it as `agents-bridge` (Claude Code + Codex) and show it as **Agents Bridge**.

> **Desktop apps only, for now.** The bridge connects Claude Desktop (Code tab) with Codex Desktop on macOS. The terminal versions (Claude Code CLI and Codex CLI) are not supported yet; support for them is planned.

Ask either chat to work with the other one. The chat asks you three short questions: whether the other agent may edit code, the limits, and whether to start. You answer **Yes**, or open a small panel to change anything first. The two chats message each other directly while you watch. At the end you get a result that shows who said what and where they still disagree.

It's an easier, collaboration-focused take on [Claude UDS Bridge](https://github.com/LeonKohli/claude-uds-bridge): the same local Claude ↔ Codex bridge, plus a guided panel so you never have to manage sessions or settings by hand.

<!-- Demo GIF goes here: both apps side by side with the panel open. -->

## Why have them collaborate?

- **They catch each other's mistakes.** Two different models make different errors. When one reviews the other's plan or code, problems that a single agent would miss tend to surface.
- **Disagreements stay visible.** You see where they disagree instead of getting one confident answer, so you know what to double-check.
- **Everything is traceable.** Every message, result and review is recorded with who wrote it and which exact version it refers to. You can follow how they got to the answer and export the whole exchange.

## Why not just use codex-plugin-cc?

OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (and community plugins that go the other way) make one agent call the other as a **background tool**: a fresh headless run that has none of your chat history and hands back one answer. That works well for a quick second opinion.

This bridge connects **two real conversations** instead:

| | Agent-as-a-tool plugins | This bridge |
|---|---|---|
| The other agent | A fresh CLI run with no history | Your actual Codex and Claude chats, with everything they already know |
| Who starts | One direction per plugin | Either chat |
| Shape | One job in, one answer out | A real back-and-forth, with message and time limits |
| You stay in control | A slash command | A local panel: approve, pause, finish, export |
| Editing | The called agent edits your files | Off until you allow it in the panel, with a written scope; local edits and commits only |
| Memory | Job output only | Context, results, reviews and disagreements are saved and survive restarts |

Use codex-plugin-cc for a one-shot review. Use this bridge when you want the two agents to plan, investigate or build something together over several steps.

## Requirements

- **macOS.** The Desktop apps the bridge connects aren't available on Linux, and Windows is not supported.
- **[Codex Desktop](https://openai.com/codex/)**, running. Messages are delivered into a Codex chat through the app, so the Codex CLI alone is not enough.
- **[Claude Desktop](https://claude.ai/download)**, using the **Code** tab (Claude Code 2.1.224 or later).
- **[Bun](https://bun.sh)** 1.4 or later: `curl -fsSL https://bun.sh/install | bash`
- Git.

Both apps use your normal subscriptions. The bridge itself makes no model calls and sends nothing off your machine.

## Install (about 5 minutes)

Run these in a terminal. You need Bun installed first (see Requirements).

**1. Install the Codex side**

```bash
codex plugin marketplace add jaimebernalm/agents-bridge
```

```bash
codex plugin add agents-bridge@jaimebernalm
```

Then open Codex, find **Agents Bridge** in its plugins, and **trust both hooks**. Codex ignores plugin hooks until you do, and without them a chat can't receive messages. Open a **new** Codex chat afterwards; chats that were already open don't pick up the plugin.

**2. Install the Claude side**

```bash
claude plugin marketplace add jaimebernalm/agents-bridge
```

```bash
claude plugin install agents-bridge@jaimebernalm
```

Then open a **new** Code chat in Claude Desktop.

**3. Check that they see each other**

Open the same project folder in both apps and ask either chat:

> Use Agents Bridge to list the chats in this folder.

You should see the other app's chat listed. If you don't, see [Troubleshooting](#troubleshooting).

## Your first collaboration

1. In either chat, describe what you want, for example:

   > Collaborate with Codex on this: review the error handling in `src/api` and propose fixes. 20 messages, 20 minutes.

2. The chat asks you three short questions:
   - **Editing:** may the other agent edit files and make local commits (no push, pull requests or merges)? To allow more, write it in **Other**, for example "add push and pull requests".
   - **Limits:** the proposed messages and time, two larger steps, or unlimited messages · 24 h. You can also write your own, such as "40 messages, 45 min".
   - **Start:** start with a new chat in the other app (or the one you named)?
     - **Yes:** the collaboration starts with what you chose. If it needs a new chat, the other app opens on one with a message ready: send it there and the collaboration starts once that chat is linked. If Claude asks you to trust the folder, it may then start that chat without its folder; the chat asks to move to the project folder, and once you approve it links itself.
     - **Change chat or details in the panel:** the panel opens in its own small window in the top-right corner of your screen, with the form already filled in (**Suggested by …**) and what you chose. Choose one of your open chats instead of a new one, or change the objective, the limits (messages or **No limit**, time up to 24 hours), editing and its scope, then press **Start** there. Move or resize it and the next panel opens where you left it.
     - **Cancel:** the proposal is discarded.

   Or write what you'd change instead; the chat asks again with your change. Nothing is sent until you choose **Yes**.

3. Watch the messages arrive. The chat leaves the panel as a card (**Bridge panel**): open it and press **Open the panel**, and the panel opens in its own window, where you can **Pause**, **Finish** or **Export** (Markdown or JSON) at any time.

Closed the panel? Open that card again, or ask either chat to "open the bridge panel".

### Ideas to try

- **Review:** "Have Claude review the change Codex just made and list concrete defects."
- **Plan, then build:** "Plan this feature with Codex, then implement it phase by phase." One approval covers every phase.
- **Debug:** "Each of you investigate why this test is flaky, then compare your findings."
- **Design:** "Compare two approaches to the caching layer and keep the disagreements."

## What you control

- **Nothing starts without you.** A chat can suggest a collaboration; only you start it, by answering **Yes** to its questions or pressing **Start** in the panel. The bridge reads your answer from the app itself, never from what an agent says.
- **Editing is opt-in.** The other agent may edit only if you switch it on, within the scope you write. That covers local edits and commits only. Push, pull requests, merges and deploys stay excluded unless your scope says otherwise, and each app's own approval prompts still apply.
- **Messages carry no authority.** Text from the other agent never grants permissions, whatever it says.
- **Limits are enforced.** Message count and deadline apply to both directions.
- **Nothing is sent twice.** If a delivery is uncertain, the bridge shows it as uncertain and does not resend it.
- **It stays local.** Messages travel over local sockets and the Codex app's connection. History is kept in a private SQLite file on your machine.
- **No fake consensus.** Results record who wrote what. "Agree" is a declaration by an agent, never a verified agreement.
- **Your account, your sandbox.** The bridge keeps an agent's words and the other chat's messages from counting as your decisions. An agent that can run any command as you, with no sandbox, can also change your files and the bridge's own; keep each app's sandbox and approval prompts on if you need that boundary.

## Troubleshooting

**The other chat isn't found.**
It was probably opened before the plugin was installed. Open a new chat in that app, in the same folder. For Codex, quitting and reopening the app also works.

**Codex never receives anything.**
Check that both plugin hooks are trusted in Codex, then open a new Codex chat. For a full diagnosis, ask the Codex chat:

> Diagnose the bridge for this folder.

It changes nothing and tells you what's missing.

**Messages to Claude show as "Held by the other chat".**
By default, Claude holds messages from a session running in a different permission mode. Use the same permission mode in both chats, or set `"crossSessionInbound": "accept"` in `~/.claude/settings.json`. That setting applies to all your Claude sessions, so choose it knowingly.

**The panel says "reload plugin".**
A chat is still running an older version of the bridge. Open a new chat in that app.

## Update

**Updating from 0.14 or earlier:** the plugin used to be called `cc-cdx-bridge` (and, before 0.12, `claude-uds-bridge` in Codex). Remove the old one first:

```bash
codex plugin remove cc-cdx-bridge@jaimebernalm
```

```bash
claude plugin uninstall cc-cdx-bridge@jaimebernalm
```

Then, for any update:

```bash
codex plugin marketplace upgrade jaimebernalm && codex plugin add agents-bridge@jaimebernalm
```

```bash
claude plugin marketplace update jaimebernalm && claude plugin update agents-bridge@jaimebernalm
```

Then open new chats in both apps. If Codex asks again, re-trust the hooks. Your collaboration history and saved authorizations are kept.

## Known limits

- Delivery into Codex relies on Codex Desktop's internal app connection. A Codex update can break it. The bridge then refuses to deliver rather than guessing, and the panel tells you.
- Desktop apps on macOS only. The Claude Code CLI and the Codex CLI are not supported yet.
- Last tested with Codex Desktop 26.930 and Claude Code 2.1.286 on macOS. Please [open an issue](https://github.com/jaimebernalm/agents-bridge/issues) with your versions if something breaks.
- The bridge does not lock files. When both agents edit, give them separate files or separate worktrees.

## Learn more

- [Detailed reference](docs/REFERENCE.md): every tool, transport limits and reception settings.
- [How the two-way Desktop mode works](docs/BIDIRECTIONAL_DESKTOP.md)
- [The agents' guide](plugins/agents-bridge/skills/bridge-collaboration/SKILL.md) and [its tool reference](plugins/agents-bridge/skills/bridge-collaboration/references/tools.md)
- [Coordinated implementation](plugins/agents-bridge/skills/bridge-collaboration/references/implementation.md)
- [Protocol coverage](plugins/agents-bridge/PROTOCOL-COVERAGE.md)

## Contributing

```bash
git clone https://github.com/jaimebernalm/agents-bridge.git && cd agents-bridge/plugins/agents-bridge
```

```bash
bun install --frozen-lockfile && bun run check && bun test && bun run build
```

The plugins run the bundled files in `dist/` and `panel-dist/`, so run `bun run build` after changing anything under `src/` or `ui/`. To try your build, add the clone as a marketplace (`codex plugin marketplace add /path/to/agents-bridge`, `claude plugin marketplace add /path/to/agents-bridge`) instead of the GitHub one. CI runs the suite on macOS and Linux.

## License and credits

MIT, see [LICENSE](LICENSE). Based on [Leon Kohli's Claude UDS Bridge](https://github.com/LeonKohli/claude-uds-bridge). The state folder and a few internal identifiers keep the name `claude-uds-bridge` for compatibility; [`names.ts`](plugins/agents-bridge/src/names.ts) lists them. Don't enable this fork and the upstream plugin in the same chat.
