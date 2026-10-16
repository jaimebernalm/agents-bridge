# Claude ⇄ Codex Bridge: reference

> New here? Start with the [README](../README.md). This page is the technical reference for the current version.

Fork maintained at [jaimebernalm/cc-cdx-bridge](https://github.com/jaimebernalm/cc-cdx-bridge), based on [Leon Kohli's Claude UDS Bridge](https://github.com/LeonKohli/claude-uds-bridge). It connects a Codex Desktop chat and a Claude Code chat on the same computer so they can collaborate, with a local panel where the person approves and follows each collaboration. Messages travel over local Unix sockets and Codex Desktop's app connection; the models still run through their own providers. Text from either chat grants no permission to edit, run or publish, and reviews and test receipts are declarations, never certified consensus.

## Names

| What | Name |
| --- | --- |
| Plugin, in both apps | `cc-cdx-bridge` (Claude Code + Codex) |
| Name shown in both apps | Claude ⇄ Codex Bridge |
| MCP server, in both apps | `cc_cdx_bridge` |
| Skill | `bridge-collaboration` |
| Marketplace | `jaimebernalm` |

A few internal names keep the upstream name `claude-uds-bridge` because they are stored on disk or travel between chats: the state folder `$CODEX_HOME/plugin-state/claude-uds-bridge/`, the entrypoint a Codex receiver registers with (`codex-claude-uds-bridge`) and the client type sent to Codex Desktop. Renaming them would lose past collaborations and grants, or stop older chats from recognizing a Codex receiver. The message headers (`CC_CDX_DESKTOP_V2`, `CC_CDX_DESKTOP_PANEL_COMMAND`) are part of the protocol. [`names.ts`](../plugins/cc-cdx-bridge/src/names.ts) defines all of them.

## Requirements

- Codex Desktop, running. Delivery into a Codex chat goes through the app's connection, so the Codex CLI alone has no inbox.
- macOS, where both Desktop apps run. The transport itself uses POSIX sockets and is tested on Linux too; Windows named pipes are not implemented.
- Claude Code 2.1.224 or later, the first release with [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging), used from the Code tab of Claude Desktop.
- Bun 1.4 or later. The launcher checks the app's `PATH`, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`.

## Install

From GitHub:

```bash
codex plugin marketplace add jaimebernalm/cc-cdx-bridge
codex plugin add cc-cdx-bridge@jaimebernalm
claude plugin marketplace add jaimebernalm/cc-cdx-bridge
claude plugin install cc-cdx-bridge@jaimebernalm
```

From a local checkout, use its path instead of `jaimebernalm/cc-cdx-bridge`. For Claude there is also a marketplace inside the Claude plugin folder, for testing a local build: `claude plugin marketplace add ./plugins/cc-cdx-bridge-claude` and `claude plugin install cc-cdx-bridge@cc-cdx-bridge-local`.

Codex ignores plugin hooks until you trust them: open the plugin in Codex and confirm both. A Codex chat becomes reachable when its `SessionStart` hook runs, so open a new chat afterwards. In Claude, open a new Code chat; one that was already open may keep its previous server.

Updating from 0.11 or earlier: the Codex plugin was called `claude-uds-bridge`. Remove it with `codex plugin remove claude-uds-bridge@jaimebernalm` before adding `cc-cdx-bridge@jaimebernalm`, then trust the new plugin's hooks. Collaborations and grants are kept.

The repository holds two plugins: `plugins/cc-cdx-bridge` is the source and the Codex plugin, and `plugins/cc-cdx-bridge-claude` is the Claude plugin built from it, kept separate so Claude does not load Codex's hooks.

## Tools

Both apps expose the same collaboration tools under the same names. The bridge derives who is calling from the chat's own process on every call; no argument can choose the author.

| Tool | What it does |
| --- | --- |
| `propose_collaboration` | Puts a collaboration the person asked for in words into the panel, prefilled, for their approval. Grants nothing. |
| `list_chats` | Lists the live chats that can join, with exact IDs, folders, status and capabilities. |
| `check_ready` | Checks whether this chat can start a collaboration with another one now, and whether the person must approve first. |
| `prepare_collaboration` | Records objective, context, orientation, limits and optional coordination or implementation contract. Sends nothing. |
| `start_collaboration` | Reserves both chats and starts the deadline. Sends nothing. |
| `send_message` | Sends the next message or task to the other chat, or answers it. |
| `record_report` | Records this chat's own analysis, result version or review. |
| `get_status` | Reads a collaboration's saved state, or lists this chat's collaborations. |
| `control_collaboration` | Pauses, resumes, changes context or phase, assigns a task, recovers, cancels or finishes. |
| `record_changes` | Captures, checks and inspects file changes under an implementation contract. |
| `export_collaboration` | Returns the full record as Markdown or JSON, without writing a file. |
| `open_panel` | Opens the panel in the person's browser and returns a link without credentials. |
| `request_new_chat` | Asks for a new chat in the other app; it opens only after the person authorizes it. |
| `get_new_chat_status` | Reads the state of a new-chat request. |
| `open_new_chat` | Carries out an authorized new-chat request once. |
| `report_new_chat` | Reports how opening the new chat went. |
| `apply_panel_action` | Applies an action the person submitted in the panel. |
| `diagnose` | Reports why the bridge does or does not work in this chat. |

Codex also has `connect_this_chat`, which connects a Codex chat opened before the hooks were trusted, keeping the conversation; and a hidden `session_start` that its hook calls. The agents' guide, with arguments and report shapes, is the [`bridge-collaboration` skill](../plugins/cc-cdx-bridge/skills/bridge-collaboration/SKILL.md).

Version 0.12.0 retired the tools of the earlier Codex-only protocol (`collaboration_*`), the free messaging tools (`send_message` without a collaboration, `list_sessions`, `status`, `inbox`) and the panel's **Classic** page; 0.12.1 removed the code behind them. Earlier collaborations stay in the state folder, and a message in their format (`CC_CDX_RUN_V1`) is dropped.

## How a message arrives

A message steers the receiving chat's active turn, or starts a turn when it is idle; a running tool is never interrupted, as in Claude Code's own [delivery between tool calls](https://code.claude.com/docs/en/cross-session-messaging#message-delivery). It arrives marked as external input from another agent, with a `CC_CDX_DESKTOP_V2` line naming the collaboration and the message to answer. The receiving chat answers with `send_message`.

## Reception in Codex

Each Codex chat has a receive setting. New chats use `default`: answers from the Claude chat of a collaboration that chat started are accepted once the person remembers the project on the panel's **Authorization** page, and a collaboration started by Claude needs the person's approval of that collaboration in the panel. A message held because the two chats run different permission modes opens a native dialog; held text reaches the model only if the person releases it, and it expires after five minutes by default. Chats from earlier versions may keep an explicit `accept`, `hold` or `refuse` setting; `check_ready` reports it, and opening a new Codex chat clears it.

Claude's own reception is configured in Claude: by default it holds messages from a session in a different permission mode (`crossSessionInbound` in `~/.claude/settings.json`).

## Check that it works

Ask either chat to diagnose the bridge. From a terminal, in a Codex Desktop chat's environment:

```bash
cd plugins/cc-cdx-bridge
bun run doctor --project ../..
```

The diagnosis is read-only: it sends nothing, creates no receiver and changes no settings. It checks the Codex chat's identity and capabilities, the exact folder, the processes, the installed files and the Claude engine versions. Reception and hook trust stay explicitly unknown when the apps do not expose them. Exit 2 means a missing prerequisite; exit 3 means the transport is ready but reception or trust still need checking; exit 1 is a command error. `bun run attach --project ../..` connects the current Codex chat (from `CODEX_THREAD_ID` or `--thread UUID`) without clearing its history or changing permissions.

## Transport limits

- A serialized message may reach 1,048,576 characters; the sender refuses anything larger before writing.
- A burst of 30 messages to one chat is the most it can send at once; the budget grows by one message every two seconds.
- At most 100 messages stay held, and at most 50 accepted messages wait for Codex to take them up.
- `socket-written`, `started` and `steered` report transport progress, not a model reply.
- The bridge does not lock files. Agree on who edits which files before both chats edit one repository.
- Delivery uses Codex Desktop's internal app connection. An incompatible app version makes delivery fail as `unknown` instead of guessing.

[`PROTOCOL-COVERAGE.md`](../plugins/cc-cdx-bridge/PROTOCOL-COVERAGE.md) compares the transport against Claude's documented behavior case by case, including the cases it does not cover.

## Development

```bash
cd plugins/cc-cdx-bridge
bun install --frozen-lockfile
bun run check
bun test
bun run build
```

The plugins run the bundled `dist/` and `panel-dist/` files, so run `bun run build` after changing anything under `src/` or `ui/`; it also rebuilds the Claude plugin. CI runs the suite on macOS and Linux, against both the sources and the bundles. For the panel's UI, `cd ui && bun install --frozen-lockfile`.

- `bun run smoke:desktop` sends one random arithmetic challenge from an existing Codex Desktop chat to a Claude Code session in the same folder and requires the exact answer back. It changes no permission settings and never resends held messages. Use `--list`, `--peer UUID`, `--thread UUID` and `--timeout SECONDS`; results stay under `.local/desktop-smoke/`.
- `bun run verify:installation` installs the plugin into a fresh private Codex home, updates from an older distribution, compares the cached files and checks that uninstalling and reinstalling keep private history, policies and grants. It copies no authentication and trusts no hooks.

The Claude transport follows the [socket protocol documented by PeterSR](https://github.com/PeterSR/claude-code-socket-transport/tree/480bd83c0bf1c63161c5afdb0976bbff849c926b). Delivery into Codex uses `thread-follower-steer-turn` and `thread-follower-start-turn` on the existing chat and confirms through the returned turn ID.

## License

MIT. See [LICENSE](../LICENSE). Original work: Leon Kohli. Do not enable this fork and the upstream plugin in the same chat; installing this fork does not remove the upstream plugin or its hook trust.
