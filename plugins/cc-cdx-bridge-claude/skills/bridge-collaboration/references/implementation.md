# Implementing together

Use an implementation contract only for implementation the person already authorized, in their own chat or through a valid `editAuthorization` from the panel. The contract records who may change which files; it grants no permission to run, commit or publish. Asking for analysis or a review, or choosing the `implement` orientation, does not authorize editing. The bridge provides no editor locks, sandbox or test runner.

## The contract

Create worktrees with the normal Git tools if you need them. The contract names existing, **clean** roots of the same repository at the same commit, and each chat's own project must belong to that repository. Do not move a chat, open another chat silently or change permissions.

Add it to `prepare_collaboration`:

```json
{"implementation": {"strategy": "files",
  "workspaces": {"codex": {"root": "/absolute/repo", "paths": ["src/client/"]},
                 "claude": {"root": "/absolute/repo", "paths": ["src/server/", "test/server.test.ts"]}},
  "requiredChecks": ["typecheck", "tests"]}}
```

- `files`: one shared checkout with scopes that do not overlap (compared case-insensitively). It records an agreement and detects deviations; it does not prove which chat wrote a file.
- `worktrees`: separate, non-nested worktree roots. Scopes may overlap; integration may then conflict. Worktrees separate files, not what each chat is allowed to access.
- Scopes are literal relative files, or folders ending in `/`: no absolute paths, `..`, `.git`, NUL or backslashes. Files Git ignores are left out. Changed tracked files and new files must fit a scope.
- Limits: 500 changed files per workspace, files up to 4 MiB, a combined patch up to 16000 bytes. Split larger work into several candidates. Symlink and submodule changes and unresolved merges are refused.
- The Codex chat's bridge must support implementation (`implementationReceiver` in `list_chats`).

## Edit, capture, check, review

1. Start the collaboration and send the other chat its exact root, paths and one concrete task. Each chat edits with its own tools. Changes are allowed only inside registered roots; a changed process, repository or commit, or a change outside the scopes, blocks the next message.
2. Capture: `record_changes {runId, operationId: "new UUID", action: {action: "capture"}}`. It produces a fixed candidate and a result version authored by you. Only the original author versions a candidate; the other chat reviews it instead.
3. Run the real checks with your normal tools and record one per required name: `action: {action: "check", check: {candidateHash: "64 hex", name: "tests", command: "bun test", exitCode: 0, summary: "What ran and what it showed"}}`. The bridge never runs or verifies the command, and failures stay visible. The latest check for that exact candidate and name counts. Any change needs a new capture and new checks.
4. Ask the other chat to review that exact result version with a `review` task, including the relevant check output. The server attaches the captured patch. Only a current `agree` from the other chat counts toward readiness; a new capture needs a new review, even with identical content.
5. Inspect: `action: {action: "inspect"}`. The bridge rereads the workspaces, checks the candidate, required checks and review, and integrates the patches against the base in a private index. It never touches the real index, checkout, branches or remote; conflicts keep both patches.

## Ready to integrate

`ready_to_integrate` means the scope, hash, base and patch checks passed and the declared checks and review exist. It does not prove the tests ran or that the change is right, and it is only true at that moment: a new context, a later edit, a failed check or a newer review undoes it.

Applying, committing, merging, pushing or deploying the patch are separate steps with the normal tools, inside what the person authorized. A patch is never approval to publish. A collaboration can still finish `incomplete` or `with_disagreements` without being ready; everything stays in the export. After updating the plugin, open new chats: running chats keep the version they started with.
