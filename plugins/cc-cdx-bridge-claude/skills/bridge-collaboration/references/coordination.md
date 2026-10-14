# Coordination: phases, tasks, pause and recovery

Every collaboration can be paused, moved to a new context and finished. Two extras are optional: phases with assigned tasks, and an initial barrier where each chat analyses on its own before seeing the other's analysis. None of this erases what either chat already knows or adds rounds the work does not need.

## Controls

Send each control with `control_collaboration {runId, commandId, expectedRevision, control}`. Read `coordination.revision` from `get_status` right before and pass it as `expectedRevision`; a stale revision fails, so read again instead of repeating. The same `commandId` with the same content is safe to repeat.

- `pause`: no new messages; replies that arrive are held until resume. The deadline keeps running. Pausing does not interrupt a tool already running in either app.
- `resume`: continues after checking both chats again. It refuses while a delivery is uncertain.
- `context`: a new full `context` (`objective`, `constraints`, `references`, `priorAnalysis`) as the next version. Use it to move to the next phase of a plan. Change it only when no delivery is uncertain and both chats have finished answering: replies to the previous version are recorded but not delivered. Then send the first task of the new context. If `consent.coversLaterContexts` is false, the change voids the person's approval; ask them to approve again in the panel instead of preparing a new collaboration.
- `phase`: one of `context`, `independent_analysis`, `critique`, `verification`, `synthesis`, `final_review`, chosen when useful, with `coordinationRevision` from `coordination.structured.revision`. A closed initial barrier cannot be skipped.
- `task`: `{taskId, intent, target?}` with `assignee: "self"` assigns work to your own chat; report it with that `taskId`. Tasks for the other chat travel with `send_message`.
- `recover`: after the controlling chat's process crashed or its lease expired, take control back. It checks both chats again, marks unclaimed reservations as not sent (their budget stays spent) and never resends anything. Then `resume` explicitly. It fails while another live process holds control.
- `cancel` / `finish`: end the collaboration and release both chats; see [tools.md](tools.md) for the closure. Work already delivered cannot be withdrawn.

Lease and deadline are separate: recovering never resets the deadline or the message budget. At the deadline or when the messages run out, the bridge closes the collaboration and keeps everything for export.

## Tasks and reports

With tasks, a report counts only when it names a task assigned to its author in the current context version, and each task takes one valid report. To revise a result, use a new `synthesize` task and the next result version. A review must target exactly the version its task names. A plain reply without a report is kept as conversation, not as a completed task; a reply to an old context is recorded as stale.

In `get_status`, a review with `current: false` reviewed an older version or context. `validatedConsensus` is always false: reviews say what each chat declared, not that they agree. The closure keeps the reviews and objections next to the declared disposition; nothing requires two reviews before finishing.

## Initial barrier

Prepare with `coordination: {initialBarrier: true}`, both chats starting new and no earlier analyses. The first phase is `independent_analysis`.

1. Assign yourself an `analyze` task with `control_collaboration` action `task`, and send the other chat its own `analyze` task containing the objective, never your analysis.
2. Work on your analysis. If the other chat answers first, its analysis is recorded privately and held back.
3. Record your analysis with `record_report`: `kind: "response"`, your `taskId` and `declaredState: "analysis"`. The other chat does the same for its task.
4. Once both analyses of this context exist, the barrier opens and each chat receives the other's analysis once. Then choose a phase or send the next task.

A context change resets the barrier. The guarantee covers only the analyses recorded through the bridge in this collaboration: it does not erase memory, isolate shared files or catch analysis pasted into other text. Never call it guaranteed independence.

## Delivery evidence

Each message records its context, whether the other chat's reception allowed it, its native input ID and when it was consumed and answered. A correlated reply proves an answer arrived, not that the reasoning is sound. A message to a Claude chat stays at `socket-written` with `recipientAdmission: native_claude_not_observed`: Claude keeps no input record the bridge can read, so that is its normal final state, not a fault to report; that chat's reply is the evidence it arrived. When a delivery stays uncertain, the bridge cannot tell whether the other chat received it and will not resend; wait for evidence, or cancel and explain the limit to the person.
