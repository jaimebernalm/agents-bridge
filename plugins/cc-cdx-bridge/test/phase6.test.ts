import { test, expect } from "bun:test";
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { git, inspectProject } from "../src/project";
import {
  normalizeImplementation,
  captureImplementation,
  previewIntegration,
  type ImplementationInput,
} from "../src/implementation";
import { type Participant } from "../src/participants";
export async function gitOK(root: string, args: string[]) {
  const r = await git(root, args);
  if (r.code !== 0) throw new Error(r.error);
  return r.output;
}
export async function repo() {
  const root = realpathSync(mkdtempSync("/tmp/phase6-"));
  await gitOK(root, ["init", "-q"]);
  await gitOK(root, ["config", "user.email", "fixture@example.invalid"]);
  await gitOK(root, ["config", "user.name", "Fixture"]);
  writeFileSync(join(root, ".gitignore"), "*\n!*.txt\n!.gitignore\n");
  writeFileSync(join(root, "codex.txt"), "codex base\n");
  writeFileSync(join(root, "claude.txt"), "claude base\n");
  await gitOK(root, ["add", ".gitignore", "codex.txt", "claude.txt"]);
  await gitOK(root, ["commit", "-qm", "base"]);
  return root;
}
const input = (root: string): ImplementationInput => ({
  strategy: "files",
  workspaces: {
    codex: { root, paths: ["codex.txt", "new.txt"] },
    claude: { root, paths: ["claude.txt"] },
  },
  requiredChecks: ["tests"],
});
async function participants(root: string) {
  const project = await inspectProject(root);
  return ["codex", "claude"].map((provider, i) => ({
    sessionId: randomUUID(),
    name: provider,
    provider: provider as "codex" | "claude",
    surface: i ? "claude-desktop" : "codex-claude-uds-bridge",
    pid: i + 1,
    procStart: String(i),
    socketPath: "/tmp/" + i + ".sock",
    version: i ? "2.1.286" : "stream-11",
    status: "idle",
    project,
  })) satisfies Participant[];
}
async function fixture() {
  const root = await repo(),
    state = mkdtempSync("/tmp/phase6-state-"),
    ps = await participants(root),
    plan = await normalizeImplementation(input(root), ps);
  const capture = async () => ({
    candidate: {
      ...(await captureImplementation(plan, 1)),
      resultId: randomUUID(),
      version: 1,
      createdAt: Date.now(),
    },
  });
  return {
    root,
    state,
    plan,
    capture,
    close() {
      rmSync(root, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    },
  };
}
test("clean base, explicit roots, disjoint scopes and safe paths are mandatory", async () => {
  const root = await repo();
  try {
    const ps = await participants(root);
    expect((await normalizeImplementation(input(root), ps)).isolation).toBe(
      "agreement_only",
    );
    for (const path of [
      "../bad",
      "/tmp/bad",
      ".git/config",
      "a/../b",
      "a\\b",
      "",
    ]) {
      const bad = input(root);
      bad.workspaces.codex.paths = [path];
      await expect(normalizeImplementation(bad, ps)).rejects.toThrow();
    }
    const overlap = input(root);
    overlap.workspaces.claude.paths = ["codex.txt"];
    await expect(normalizeImplementation(overlap, ps)).rejects.toThrow(
      "overlap",
    );
    const subtree = input(root);
    subtree.workspaces.codex.paths = ["src/"];
    subtree.workspaces.claude.paths = ["src/code.txt"];
    await expect(normalizeImplementation(subtree, ps)).rejects.toThrow(
      "overlap",
    );
    writeFileSync(join(root, "codex.txt"), "dirty");
    await expect(normalizeImplementation(input(root), ps)).rejects.toThrow(
      "clean",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("edits, additions and deletions integrate without changing index, HEAD or source files", async () => {
  const x = await fixture();
  try {
    const before = await gitOK(x.root, ["rev-parse", "HEAD"]),
      index = readFileSync(join(x.root, ".git/index"));
    writeFileSync(join(x.root, "codex.txt"), "codex edited\n");
    writeFileSync(join(x.root, "new.txt"), "new contents\n");
    rmSync(join(x.root, "claude.txt"));
    const { candidate: c } = await x.capture();
    expect(c.snapshots[0]!.files.map((f) => f.path)).toEqual([
      "codex.txt",
      "new.txt",
    ]);
    expect(c.snapshots[1]!.files[0]!.hash).toBeNull();
    const preview = await previewIntegration(x.plan, c, x.state);
    expect(preview.clean).toBe(true);
    expect(preview.patch).toContain("new contents");
    expect(preview.patch).toContain("deleted file mode");
    expect(await gitOK(x.root, ["rev-parse", "HEAD"])).toBe(before);
    expect(readFileSync(join(x.root, ".git/index"))).toEqual(index);
    expect(readFileSync(join(x.root, "codex.txt"), "utf8")).toBe(
      "codex edited\n",
    );
  } finally {
    x.close();
  }
});
test("out-of-scope, dangling symlink and size limits cannot enter captured material", async () => {
  const x = await fixture();
  try {
    writeFileSync(join(x.root, "outside.txt"), "outside");
    await expect(captureImplementation(x.plan, 1)).rejects.toThrow("scope");
    rmSync(join(x.root, "outside.txt"));
    symlinkSync("/nonexistent-fixture-path", join(x.root, "new.txt"));
    await expect(captureImplementation(x.plan, 1)).rejects.toThrow("Symlink");
    rmSync(join(x.root, "new.txt"));
    writeFileSync(join(x.root, "new.txt"), "x".repeat(17000));
    await expect(captureImplementation(x.plan, 1)).rejects.toThrow("16000");
    writeFileSync(join(x.root, "new.txt"), "x".repeat(4 * 1024 * 1024 + 1));
    await expect(captureImplementation(x.plan, 1)).rejects.toThrow("4 MiB");
  } finally {
    x.close();
  }
});
test("real worktrees combine clean patches and report conflicts while preserving files and indexes", async () => {
  const root = await repo(),
    state = mkdtempSync("/tmp/phase6-index-"),
    a = join(state, "a"),
    b = join(state, "b");
  try {
    await gitOK(root, ["worktree", "add", "--detach", a, "HEAD"]);
    await gitOK(root, ["worktree", "add", "--detach", b, "HEAD"]);
    const ps = await participants(root);
    const raw: ImplementationInput = {
      strategy: "worktrees",
      workspaces: {
        codex: { root: a, paths: ["codex.txt"] },
        claude: { root: b, paths: ["claude.txt"] },
      },
      requiredChecks: ["tests"],
    };
    const plan = await normalizeImplementation(raw, ps);
    expect(plan.isolation).toBe("git_worktrees");
    writeFileSync(join(a, "codex.txt"), "a changed\n");
    writeFileSync(join(b, "claude.txt"), "b changed\n");
    expect(readFileSync(join(root, "codex.txt"), "utf8")).toBe("codex base\n");
    let snap = await captureImplementation(plan, 1);
    const c = { ...snap, resultId: randomUUID(), version: 1, createdAt: 1 };
    const indexPath = (
        await gitOK(a, [
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        ])
      ).trim(),
      before = readFileSync(indexPath);
    expect((await previewIntegration(plan, c, state)).clean).toBe(true);
    expect(readFileSync(indexPath)).toEqual(before);
    await gitOK(a, ["restore", "codex.txt"]);
    await gitOK(b, ["restore", "claude.txt"]);
    raw.workspaces.claude.paths = ["codex.txt"];
    const conflictPlan = await normalizeImplementation(raw, ps);
    writeFileSync(join(a, "codex.txt"), "conflict a\n");
    writeFileSync(join(b, "codex.txt"), "conflict b\n");
    snap = await captureImplementation(conflictPlan, 1);
    const beforeConflict = readFileSync(indexPath);
    expect(
      (
        await previewIntegration(
          conflictPlan,
          { ...snap, resultId: randomUUID(), version: 1, createdAt: 1 },
          state,
        )
      ).clean,
    ).toBe(false);
    expect(readFileSync(join(a, "codex.txt"), "utf8")).toBe("conflict a\n");
    expect(readFileSync(join(b, "codex.txt"), "utf8")).toBe("conflict b\n");
    expect(readFileSync(indexPath)).toEqual(beforeConflict);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
test("workspace identity and frozen HEAD remain mandatory after writes", async () => {
  const x = await fixture();
  try {
    writeFileSync(join(x.root, "codex.txt"), "change");
    await gitOK(x.root, ["add", "codex.txt"]);
    await gitOK(x.root, ["commit", "-qm", "new head"]);
    await expect(captureImplementation(x.plan, 1)).rejects.toThrow(
      "frozen HEAD",
    );
  } finally {
    x.close();
  }
});
test("renames cannot hide a deleted source outside scope and pathspec metacharacters stay literal", async () => {
  const root = await repo();
  try {
    writeFileSync(join(root, "outside.txt"), "source\n");
    await gitOK(root, ["add", "outside.txt"]);
    await gitOK(root, ["commit", "-qm", "source"]);
    const plan = await normalizeImplementation(
      input(root),
      await participants(root),
    );
    rmSync(join(root, "outside.txt"));
    writeFileSync(join(root, "new.txt"), "source\n");
    await expect(captureImplementation(plan, 1)).rejects.toThrow("scope");
    await gitOK(root, ["restore", "outside.txt"]);
    rmSync(join(root, "new.txt"));
    const raw = input(root);
    raw.workspaces.codex.paths = ["codex*.txt"];
    const literal = await normalizeImplementation(
      raw,
      await participants(root),
    );
    writeFileSync(join(root, "codex.txt"), "not literal");
    await expect(captureImplementation(literal, 1)).rejects.toThrow("scope");
    await gitOK(root, ["restore", "codex.txt"]);
    writeFileSync(join(root, "codex*.txt"), "literal file\n");
    const captured = await captureImplementation(literal, 1);
    expect(captured.snapshots[0]!.files[0]!.path).toBe("codex*.txt");
    expect(captured.snapshots[0]!.patch).toContain("literal file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("scope deletions reject symlinks and Git links; initial roots reject symlinks and foreign repos", async () => {
  const root = await repo(),
    other = await repo(),
    link = root + "-link";
  try {
    symlinkSync(other, link);
    const raw = input(root);
    raw.workspaces.codex.root = link;
    await expect(
      normalizeImplementation(raw, await participants(root)),
    ).rejects.toThrow("symlink");
    raw.workspaces.codex.root = other;
    await expect(
      normalizeImplementation(raw, await participants(root)),
    ).rejects.toThrow("repository");
    rmSync(join(root, "codex.txt"));
    symlinkSync("claude.txt", join(root, "codex.txt"));
    await gitOK(root, ["add", "codex.txt"]);
    await gitOK(root, ["commit", "-qm", "symlink base"]);
    const plan = await normalizeImplementation(
      input(root),
      await participants(root),
    );
    rmSync(join(root, "codex.txt"));
    await expect(captureImplementation(plan, 1)).rejects.toThrow(
      "Symlink/submodule",
    );
    await gitOK(root, ["restore", "codex.txt"]);
    await gitOK(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000," + plan.baseCommit + ",linked",
    ]);
    await gitOK(root, ["commit", "-qm", "gitlink base"]);
    mkdirSync(join(root, "linked"));
    const scopes = input(root);
    scopes.workspaces.codex.paths = ["linked"];
    const gitlink = await normalizeImplementation(
      scopes,
      await participants(root),
    );
    await gitOK(root, ["rm", "--cached", "linked"]);
    await expect(captureImplementation(gitlink, 1)).rejects.toThrow(
      "Symlink/submodule",
    );
  } finally {
    rmSync(link, { force: true });
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
