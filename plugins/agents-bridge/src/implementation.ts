import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  mkdtempSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join, sep } from "node:path";
import { z } from "zod";
import { uuid } from "./claude";
import { git, inspectProject } from "./project";
import { type Participant } from "./participants";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function safePath(path: string) {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path
      .split("/")
      .some(
        (p) =>
          p === ".." || p === "." || p.toLowerCase() === ".git" || p === "",
      )
  );
}
const scope = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) => safePath(p.endsWith("/") ? p.slice(0, -1) : p),
    "Use a relative file or directory/ scope without traversal or .git",
  );
const workspace = z
  .object({
    root: z.string().min(1).max(4096),
    paths: z.array(scope).min(1).max(100),
  })
  .strict();
export const implementationSchema = z
  .object({
    strategy: z.enum(["files", "worktrees"]),
    workspaces: z.object({ codex: workspace, claude: workspace }).strict(),
    requiredChecks: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(20)
      .default(["tests"]),
  })
  .strict();
export type ImplementationInput = z.infer<typeof implementationSchema>;
type Workspace = z.infer<typeof workspace> & {
  provider: "codex" | "claude";
  sessionId: string;
  device: string;
  inode: string;
};
export type ImplementationPlan = {
  strategy: "files" | "worktrees";
  baseCommit: string;
  commonGitDir: string;
  workspaces: Workspace[];
  requiredChecks: string[];
  isolation: "agreement_only" | "git_worktrees";
  executionPermissions: "unchanged";
};
const covers = (scope: string, path: string) =>
  scope.endsWith("/") ? path.startsWith(scope) : path === scope;
const overlaps = (a: string, b: string) => {
  a = a.toLowerCase();
  b = b.toLowerCase();
  return a === b || covers(a, b) || covers(b, a);
};
export async function normalizeImplementation(
  raw: ImplementationInput,
  participants: Participant[],
): Promise<ImplementationPlan> {
  const input = implementationSchema.parse(raw),
    workspaces: Workspace[] = [];
  let baseCommit = "",
    commonGitDir = "";
  for (const provider of ["codex", "claude"] as const) {
    const participant = participants.find((p) => p.provider === provider)!;
    const requested = input.workspaces[provider];
    if (lstatSync(requested.root).isSymbolicLink())
      throw new Error("Workspace root cannot be a symlink");
    const identity = await inspectProject(requested.root);
    if (
      identity.kind !== "git" ||
      identity.directory !== identity.worktree ||
      !identity.head ||
      !identity.commonGitDir
    )
      throw new Error("Implementation requires actual Git worktree roots");
    if (!participant)
      throw new Error("Implementation needs both exact participants");
    if (identity.dirty)
      throw new Error(
        "Implementation starts from clean workspaces; preserve existing changes separately",
      );
    if (
      participant.project.commonGitDir !== identity.commonGitDir ||
      participant.project.head !== identity.head
    )
      throw new Error(
        "Workspace and participant must share the frozen repository and base HEAD",
      );
    if (
      baseCommit &&
      (baseCommit !== identity.head || commonGitDir !== identity.commonGitDir)
    )
      throw new Error("Workspaces require the same Git base and repository");
    baseCommit = identity.head;
    commonGitDir = identity.commonGitDir;
    const stat = statSync(identity.directory, { bigint: true });
    workspaces.push({
      ...requested,
      paths: [...new Set(requested.paths)].sort(),
      root: identity.directory,
      provider,
      sessionId: participant.sessionId,
      device: String(stat.dev),
      inode: String(stat.ino),
    });
  }
  const [a, b] = workspaces as [Workspace, Workspace];
  if (input.strategy === "files") {
    if (a.root !== b.root)
      throw new Error("File agreements require one shared checkout");
    if (a.paths.some((p) => b.paths.some((q) => overlaps(p, q))))
      throw new Error("Shared checkout scopes overlap");
  } else if (
    a.root === b.root ||
    a.root.startsWith(b.root + sep) ||
    b.root.startsWith(a.root + sep)
  )
    throw new Error(
      "Worktree isolation requires two distinct, non-nested Git worktrees",
    );
  return {
    strategy: input.strategy,
    baseCommit,
    commonGitDir,
    workspaces,
    requiredChecks: [...new Set(input.requiredChecks)],
    isolation: input.strategy === "files" ? "agreement_only" : "git_worktrees",
    executionPermissions: "unchanged",
  };
}
async function checkedGit(
  root: string,
  args: string[],
  env?: Record<string, string>,
  input?: string,
) {
  const r = await git(root, args, env, input);
  if (r.code !== 0)
    throw new Error(r.error.trim().slice(0, 2000) || "Git operation failed");
  return r.output;
}
function regular(root: string, path: string) {
  if (!safePath(path)) throw new Error("Unsafe changed path");
  const target = join(root, path);
  let current = root;
  for (const component of path.split("/")) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("Symlink changes/parents are not supported");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { path, hash: null, mode: null };
      throw error;
    }
  }
  const s = lstatSync(target);
  if (!s.isFile() || s.size > 4 * 1024 * 1024)
    throw new Error("Only regular files up to 4 MiB can be captured");
  if (!realpathSync(target).startsWith(root + sep))
    throw new Error("Changed file escaped workspace");
  return {
    path,
    hash: createHash("sha256").update(readFileSync(target)).digest("hex"),
    mode: s.mode & 0o777,
  };
}
export async function captureImplementation(
  plan: ImplementationPlan,
  contextVersion: number,
) {
  const snapshots: {
    provider: string;
    root: string;
    files: ReturnType<typeof regular>[];
    patch: string;
  }[] = [];
  let totalBytes = 0;
  const observed: {
    root: string;
    device: string;
    inode: string;
    head: string | null;
    diffHash: string | null;
    statusHash: string | null;
    files: ReturnType<typeof regular>[];
  }[] = [];
  for (const w of plan.workspaces) {
    const stat = statSync(w.root, { bigint: true }),
      identity = await inspectProject(w.root);
    if (
      String(stat.dev) !== w.device ||
      String(stat.ino) !== w.inode ||
      identity.worktree !== w.root ||
      identity.commonGitDir !== plan.commonGitDir ||
      identity.head !== plan.baseCommit
    )
      throw new Error("Workspace identity or frozen HEAD changed");
    if ((await checkedGit(w.root, ["ls-files", "--unmerged", "-z"])).length)
      throw new Error("Resolve the worktree index conflicts before capture");
    const tracked = (
      await checkedGit(w.root, [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        plan.baseCommit,
        "--",
      ])
    )
      .split("\0")
      .filter(Boolean);
    const untracked = (
      await checkedGit(w.root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    )
      .split("\0")
      .filter(Boolean);
    const changed = [...new Set([...tracked, ...untracked])].sort();
    if (changed.length > 500)
      throw new Error("Capture exceeds 500 changed files");
    const allowed =
      plan.strategy === "files"
        ? plan.workspaces.flatMap((p) => p.paths)
        : w.paths;
    if (changed.some((path) => !allowed.some((p) => covers(p, path))))
      throw new Error("Changes outside the declared scope");
    let patch = await checkedGit(w.root, [
      "diff",
      "--no-renames",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      plan.baseCommit,
      "--",
      ...w.paths.map((p) => ":(literal)" + p.replace(/\/$/, "")),
    ]);
    if (
      /^(?:old mode|new mode|new file mode|deleted file mode) (?:120000|160000)$/m.test(
        patch,
      ) ||
      /^index [a-f0-9]+\.\.[a-f0-9]+ (?:120000|160000)$/m.test(patch)
    )
      throw new Error("Symlink/submodule patches are not supported");
    const allFiles = changed.map((path) => regular(w.root, path));
    const files = allFiles.filter((f) =>
      w.paths.some((p) => covers(p, f.path)),
    );
    for (const file of files.filter((f) => untracked.includes(f.path))) {
      const r = await git(w.root, [
        "diff",
        "--no-index",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        "/dev/null",
        file.path,
      ]);
      if (r.code !== 1) throw new Error("Cannot capture new file");
      patch += r.output;
    }
    if (
      /^(?:old mode|new mode|new file mode|deleted file mode) (?:120000|160000)$/m.test(
        patch,
      ) ||
      /^index [a-f0-9]+\.\.[a-f0-9]+ (?:120000|160000)$/m.test(patch)
    )
      throw new Error("Symlink/submodule patches are not supported");
    totalBytes += Buffer.byteLength(patch);
    if (totalBytes > 16000)
      throw new Error(
        "Captured patches exceed 16000 bytes; split the implementation into smaller candidates",
      );
    const after = await inspectProject(w.root);
    if (
      identity.head !== after.head ||
      identity.diffHash !== after.diffHash ||
      identity.statusHash !== after.statusHash ||
      hash(allFiles) !== hash(changed.map((path) => regular(w.root, path)))
    )
      throw new Error(
        "Concurrent changes during capture; inspect before capturing again",
      );
    observed.push({
      root: w.root,
      device: w.device,
      inode: w.inode,
      head: after.head,
      diffHash: after.diffHash,
      statusHash: after.statusHash,
      files: allFiles,
    });
    snapshots.push({ provider: w.provider, root: w.root, files, patch });
  }
  for (const saved of observed) {
    const stat=statSync(saved.root,{bigint:true});
    const current = await inspectProject(saved.root);
    if (
      String(stat.dev)!==saved.device || String(stat.ino)!==saved.inode || current.worktree!==saved.root || current.commonGitDir!==plan.commonGitDir ||
      saved.head !== current.head ||
      saved.diffHash !== current.diffHash ||
      saved.statusHash !== current.statusHash ||
      hash(saved.files) !==
        hash(saved.files.map((f) => regular(saved.root, f.path)))
    )
      throw new Error("Concurrent changes across workspaces; capture again");
  }
  const value = {
    baseCommit: plan.baseCommit,
    contractHash: hash(plan),
    contextVersion,
    snapshots,
  };
  return { ...value, contentHash: hash(value) };
}
export type Candidate = Awaited<ReturnType<typeof captureImplementation>> & {
  resultId: string;
  version: number;
  createdAt: number;
  reportId?: string;
};
export async function previewIntegration(
  plan: ImplementationPlan,
  candidate: Candidate,
  stateDir: string,
) {
  const temp = mkdtempSync(join(stateDir, "integration-"));
  chmodSync(temp, 0o700);
  const env = { GIT_INDEX_FILE: join(temp, "index") };
  const root = plan.workspaces[0]!.root;
  try {
    await checkedGit(root, ["read-tree", plan.baseCommit], env);
    for (const snapshot of candidate.snapshots) {
      if (!snapshot.patch) continue;
      const check = await git(
        root,
        ["apply", "--cached", "--check", "--whitespace=nowarn", "-"],
        env,
        snapshot.patch,
      );
      if (check.code !== 0)
        return {
          clean: false,
          patch: null,
          error: check.error.trim().slice(0, 2000),
        };
      await checkedGit(
        root,
        ["apply", "--cached", "--whitespace=nowarn", "-"],
        env,
        snapshot.patch,
      );
    }
    const patch = await checkedGit(
      root,
      [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        plan.baseCommit,
        "--",
      ],
      env,
    );
    return { clean: true, patch, error: null };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
