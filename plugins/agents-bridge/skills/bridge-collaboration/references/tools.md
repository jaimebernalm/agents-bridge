# Tools

Every tool works from either app. The bridge derives who is calling from the chat's own process on each call; no argument can choose the author. A changed chat (another process or project) is never adopted silently. IDs are UUIDs; use a new one for each new request, and repeat one only to read the result of the identical request.

## Find and check

- `list_chats {}`: the live chats that can join, with exact `sessionId`, provider, `surfaceLabel` (Claude Desktop, Claude CLI or Codex Desktop), folder, status and bridge capabilities. Read-only.
- `check_ready {peerId}`: whether this chat can start a collaboration with that chat now. Returns `readyForCheck`, a `code` and a `message`, including when the person must approve in the panel first. Sends nothing and grants nothing. It cannot observe whether the other chat will actually answer: verify that with a short message after starting.
- `diagnose`: why the bridge does or does not work here. In Claude it takes no input; in Codex it takes `{cwd, peerId?}`. Read-only.

## Set up and start

`propose_collaboration`, for a request the person made in words:

```json
{"objective": "What they asked for", "newChat": true, "peerId": "UUID when newChat is false",
 "allowEdits": true, "editScope": "What the other chat may do", "maxMessages": 24, "minutes": 30, "initialBarrier": false}
```

`maxMessages` null removes the message limit; `minutes` goes up to 1440 (24 hours). `requestId` is optional: pass one only to make a retry return the same proposal. It grants nothing: it returns the card of questions to ask the person (`ask`, `questionId`), or opens the panel prefilled with `"approval": "panel"`.

`prepare_collaboration`:

```json
{
  "requestId": "UUID",
  "peerId": "exact session UUID of the other chat",
  "context": {"objective": "Goal", "constraints": [], "references": [], "priorAnalysis": {"codex": "Earlier analysis", "claude": "Earlier analysis"}},
  "routine": {"mode": "free", "starts": {"codex": "existing", "claude": "existing"}},
  "limits": {"maxMessages": 24, "maxSeconds": 1800},
  "coordination": {"initialBarrier": false},
  "openPanel": true
}
```

- `routine` is optional. `mode` defaults to `free`; `starts` says whether each chat begins new work or continues its earlier analysis, not whether a chat was opened for it; it is inferred from non-empty `priorAnalysis`. An explicit `existing` needs the text, and an explicit `new` rejects it.
- `limits.maxMessages` counts both chats' messages; null removes the limit. `maxSeconds` goes up to 86400 (24 hours) and always applies.
- `coordination` and `implementation` are optional: see [coordination.md](coordination.md) and [implementation.md](implementation.md).
- The panel opens privately when the person must approve, unless `openPanel` is false. A Claude-started collaboration waits as a draft until the person approves it there; that approval covers the whole collaboration, including later contexts when `consent.coversLaterContexts` is true.

`start_collaboration {runId, supervised: true, allowBusyPeer?: false}`: reserves both chats (not their files) and starts the deadline. Only the chat that prepared it can start it. A busy chat needs waiting, or `allowBusyPeer: true` when the person chose that.

## Exchange

`send_message {runId, messageId, text, replyTo?, task?}`

- `task`: `{"taskId": "UUID", "intent": "analyze" | "discuss" | "synthesize" | "review", "target": {"resultId": "UUID", "version": 1}}`. A review needs its exact `target`; the server attaches that draft and its hash.
- `replyTo` must name a current message addressed to this chat.
- Each message counts against the limits. A repeated `messageId` with the same content reads the recorded attempt and never sends again; never reuse it for different content.

What the other chat receives starts with a `CC_CDX_DESKTOP_V2` line carrying `runId`, `messageId`, `contextVersion` and `replyTo`, then the text, then a note on how to answer. Answer with `send_message` using that `runId` and the `messageId` as `replyTo`. Delivery receipts show transport progress, not that the other chat understood.

`record_report {runId, reportId, report, text}` records only your own report; `text` holds the actual analysis, draft or review:

```json
{"kind": "response", "declaredState": "analysis", "disagreements": []}
{"kind": "result", "resultId": "UUID", "version": 1, "title": "Proposal", "disagreements": []}
{"kind": "review", "resultId": "UUID", "version": 1, "verdict": "revise", "disagreements": ["A remaining doubt"]}
```

Add `taskId` to tie a report to its task. `declaredState` is `analysis`, `perspective`, `needs_input`, `blocked` or `done`; `verdict` is `agree`, `revise` or `disagree`. Result versions are numbered and fixed by their author. These are declarations: they change no collaboration state and certify no consensus.

## Read, change and close

- `get_status {runId?}`: without `runId`, your collaborations; with it, the participants, context and its version, messages with delivery evidence (a message to a Claude chat normally ends at `socket-written`, `native_claude_not_observed`: the bridge cannot see Claude read it, and its reply is the proof), tasks, reports, results, reviews (`current: false` once a newer version or context replaces what they reviewed), limits, deadline, `consent`, `editAuthorization` and `coordination` (its `revision`, the controlling lease and, with phases, `structured`).
- `control_collaboration {runId, commandId, expectedRevision, control}`: `expectedRevision` is `coordination.revision` from `get_status`. Actions: `pause`, `resume`, `context`, `phase`, `task`, `recover`, `cancel`, `finish`; see [coordination.md](coordination.md). Finish with `{"action": "finish", "closure": {"result": {"resultId": "UUID", "version": 1}, "summary": "…", "disposition": "proposal"}}` or `with_disagreements` / `incomplete`; the result is optional. Only the chat that started the collaboration controls it from a chat; the person can also control it in the panel.
- `export_collaboration {runId, format: "markdown" | "json"}`: the full record as text, without secrets. It writes no file; it includes exact IDs and local paths, so review before sharing.

When a chat's process or project changes, cancel and prepare again; never follow a replacement chat by its name. When a delivery is uncertain, read `get_status` and ask the person for the decision it needs instead of sending again.

## Panel and new chats

`open_panel {}`, `apply_panel_action {commandId}` and the new-chat tools are described in [panel.md](panel.md).
