# Privacy

Agents Bridge runs entirely on your computer. It has no account, no server of its own and no telemetry.

## The plugins (Claude Code and Codex)

- **What they store.** Collaborations, the messages between the two chats, your panel choices and approvals are kept in local files under `~/.codex/plugin-state/claude-uds-bridge` (or `$CODEX_HOME/plugin-state/claude-uds-bridge`, or `AGENTS_BRIDGE_STATE_DIR` if you set it). Only your user account can read them.
- **What they send.** Nothing leaves your computer. The two chats talk through local sockets, and the approval panel is served on `127.0.0.1` only. The plugins make no requests to the internet and collect no analytics.
- **What they read.** The chats' own session files from Claude Code and Codex, to find your open chats and deliver messages, and the project folders you authorize for a collaboration.
- **Deleting your data.** Uninstall the plugins and delete the folder above. A collaboration can also be exported from the panel before you delete it.

The models still run under Anthropic's and OpenAI's terms. Whatever the two chats say to each other is part of those conversations, just like anything you type.

## The website (agentsbridge.dev)

The site is hosted on Vercel and uses Vercel Web Analytics to count page views. It sets no cookies and does not identify you; Vercel reports only aggregated visits (page, referrer, country, browser and device type). The site has no forms, accounts or other tracking.

## Contact

Questions about privacy: open an issue at https://github.com/jaimebernalm/agents-bridge/issues.
