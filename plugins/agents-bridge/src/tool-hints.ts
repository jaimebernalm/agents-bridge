// The four MCP tool hints, always all set, so clients and directories that require them read each tool's real behavior.
// Every bridge tool stays on this computer (its chats, the panel and its state folder), so none is open-world. A tool that
// writes is idempotent when a repeated call with the same arguments, request IDs included, returns the first result.
export type ToolHints = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };

export const readOnlyTool: ToolHints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const writingTool = (hints: { destructive: boolean; idempotent: boolean }): ToolHints =>
  ({ readOnlyHint: false, destructiveHint: hints.destructive, idempotentHint: hints.idempotent, openWorldHint: false });
