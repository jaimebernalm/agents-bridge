# cc-cdx-bridge

This folder holds the source of Claude ⇄ Codex Bridge and its Codex plugin; `bun run build` also builds the Claude plugin into [`../cc-cdx-bridge-claude`](../cc-cdx-bridge-claude). For what the bridge does and how to install it, read the [repository README](../../README.md); for the tools and limits, the [reference](../../docs/REFERENCE.md).

- `src/`: the MCP servers (`server.ts` for Codex, `claude-server.ts` for Claude), the shared collaboration tools (`desktop-runtime.ts`), the Codex receiver and the panel's local service. [`names.ts`](src/names.ts) holds every name a person or an agent sees.
- `ui/`: the panel, built into `panel-dist/`.
- `skills/bridge-collaboration/`: the guide both agents follow.
- `test/`: the suite, run against the sources and, in CI, against the bundles.

Examples once the plugin is loaded:

- “Work with the Claude chat in this project to find a better approach.” (`free`)
- “Research these alternatives together and check the evidence.” (`research`)
- “Review this plan with Codex and keep any disagreement.” (`review`)
- “Plan this feature with the other chat, then implement it phase by phase.” (one collaboration, one approval)

[PROTOCOL-COVERAGE.md](PROTOCOL-COVERAGE.md) compares the transport against Claude Code's documented cross-session messaging, case by case.
