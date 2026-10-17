# Privacy policy

Agents Bridge runs entirely on your computer. It has no account, no server of its own and no telemetry.

- **Stored:** collaborations, the messages between the two chats, your panel choices and approvals, in local files under `~/.codex/plugin-state/claude-uds-bridge` (or `$CODEX_HOME/plugin-state/claude-uds-bridge`, or `AGENTS_BRIDGE_STATE_DIR`). Only your user account can read them.
- **Sent:** nothing leaves your computer. The chats talk through local sockets, and the approval panel is served on `127.0.0.1` only. No analytics.
- **Read:** Claude Code's and Codex's own session files, to find your open chats, and the project folders you authorize.
- **Deleting:** uninstall the plugins and delete the folder above.

The full policy, including the website, is in [PRIVACY.md](../../PRIVACY.md) at the repository root.
