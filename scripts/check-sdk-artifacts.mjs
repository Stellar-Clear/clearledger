#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".next",
  ".turbo",
]);
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasWildcard(segment) {
  return segment.includes("*") || segment.includes("?");
}

function segmentMatches(segment, value) {
  const pattern = segment
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${pattern}$`).test(value);
}

function walkGlob(baseDir, segments, dirsOnly, results) {
  if (segments.length === 0) {
    results.push(baseDir);
    return;
  }

  const [segment, ...rest] = segments;

  if (segment === "." || segment === "") {
    walkGlob(baseDir, rest, dirsOnly, results);
    return;
  }

  if (segment === "**") {
    walkGlob(baseDir, rest, dirsOnly, results);
    for (const entry of safeReadDir(baseDir)) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      walkGlob(join(baseDir, entry.name), segments, dirsOnly, results);
    }
    return;
  }

  if (!hasWildcard(segment)) {
    const target = join(baseDir, segment);
    if (!isDirectory(target)) {
      if (rest.length === 0 && !dirsOnly && isFile(target)) {
        results.push(target);
      }
      return;
    }
    if (rest.length === 0) {
      if (dirsOnly) {
        results.push(target);
      }
      return;
    }
    walkGlob(target, rest, dirsOnly, results);
    return;
  }

  for (const entry of safeReadDir(baseDir)) {
    if (!segmentMatches(segment, entry.name)) {
      continue;
    }
    const child = join(baseDir, entry.name);
    if (rest.length === 0) {
      if (dirsOnly ? entry.isDirectory() : entry.isFile()) {
        results.push(child);
      }
      continue;
    }
    if (entry.isDirectory()) {
      walkGlob(child, rest, dirsOnly, results);
    }
  }
}

export function expandGlob(root, pattern, { dirsOnly = false } = {}) {
  const normalized = stripQuotes(pattern)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");

  if (!normalized) {
    return [];
  }

  const results = [];
  walkGlob(resolve(root), normalized.split("/"), dirsOnly, results);
  return [...new Set(results)].sort();
}

export function parseWorkspaceGlobs(contents) {
  const globs = [];
  let inPackages = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");

    if (!inPackages) {
      if (line.trim() === "packages:") {
        inPackages = true;
      }
      continue;
    }

    if (!line.trim() || /^\s*#/.test(line)) {
      continue;
    }

    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) {
      const glob = stripQuotes(item[1]);
      if (!glob.startsWith("!")) {
        globs.push(glob.replace(/^\.\//, "").replace(/\/+$/, ""));
      }
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }
  }

  return globs;
}

export function expandWorkspacePackages(root, globs) {
  const packages = new Set();
  for (const glob of globs) {
    for (const dir of expandGlob(root, glob, { dirsOnly: true })) {
      packages.add(dir);
    }
  }
  return [...packages].sort();
}

function addTarget(targets, field, value) {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.includes("://") ||
    trimmed.startsWith("node:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~")
  ) {
    return;
  }

  const target = trimmed.replace(/^\.\//, "");
  if (!targets.has(target)) {
    targets.set(target, field);
  }
}

export function collectEntryTargets(pkg) {
  const targets = new Map();

  for (const field of ["main", "module", "types", "typings"]) {
    addTarget(targets, field, pkg[field]);
  }

  if (typeof pkg.bin === "string") {
    addTarget(targets, "bin", pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const [name, value] of Object.entries(pkg.bin)) {
      addTarget(targets, `bin.${name}`, value);
    }
  }

  const walkExports = (field, value) => {
    if (typeof value === "string") {
      addTarget(targets, field, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walkExports(field, item);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) {
        walkExports(field, item);
      }
    }
  };

  if (pkg.exports !== undefined) {
    walkExports("exports", pkg.exports);
  }

  return [...targets].map(([path, field]) => ({ path, field }));
}

function isTestFile(name) {
  return /(?:\.test|\.spec)\.[^.]+$/.test(name);
}

function collectInputFiles(packageDir) {
  const inputs = [];
  const srcDir = join(packageDir, "src");

  const addFile = (path) => {
    try {
      const stat = statSync(path);
      if (stat.isFile()) {
        inputs.push({ path, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore files that disappear during the scan.
    }
  };

  const walk = (dir) => {
    for (const entry of safeReadDir(dir)) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(join(dir, entry.name));
        }
        continue;
      }
      if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(extname(entry.name)) &&
        !isTestFile(entry.name)
      ) {
        addFile(join(dir, entry.name));
      }
    }
  };

  if (isDirectory(srcDir)) {
    walk(srcDir);
    for (const entry of safeReadDir(packageDir)) {
      if (entry.isFile() && /^tsconfig.*\.json$/.test(entry.name)) {
        addFile(join(packageDir, entry.name));
      }
    }
  } else {
    walk(packageDir);
  }

  return inputs;
}

function targetMatches(packageDir, target) {
  if (hasWildcard(target)) {
    return expandGlob(packageDir, target).filter(isFile);
  }

  const absolutePath = resolve(packageDir, target);
  const relativePath = relative(packageDir, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return [];
  }

  return isFile(absolutePath) ? [absolutePath] : [];
}

export function checkSdkArtifacts(root = REPO_ROOT) {
  const workspaceFile = join(root, "pnpm-workspace.yaml");
  const globs = parseWorkspaceGlobs(readFileSync(workspaceFile, "utf8"));
  const packages = [];

  for (const packageDir of expandWorkspacePackages(root, globs)) {
    const packageFile = join(packageDir, "package.json");
    if (!isFile(packageFile)) {
      continue;
    }

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(packageFile, "utf8"));
    } catch (error) {
      throw new Error(
        `Unable to parse ${relative(root, packageFile)}: ${error.message}`,
      );
    }

    const targets = collectEntryTargets(pkg);
    const hasBuildScript = typeof pkg.scripts?.build === "string";
    if (!hasBuildScript || targets.length === 0) {
      continue;
    }

    const name = pkg.name || relative(root, packageDir);
    const problems = [];
    const targetStats = [];

    for (const target of targets) {
      const matches = targetMatches(packageDir, target.path);
      if (matches.length === 0) {
        problems.push({
          kind: "missing",
          field: target.field,
          target: target.path,
        });
        continue;
      }

      for (const path of matches) {
        if (path.endsWith(`${sep}package.json`)) {
          continue;
        }
        targetStats.push({
          path,
          field: target.field,
          mtimeMs: statSync(path).mtimeMs,
        });
      }
    }

    if (problems.length === 0 && targetStats.length > 0) {
      const inputs = collectInputFiles(packageDir);
      const newestInput = inputs.reduce(
        (newest, input) =>
          !newest || input.mtimeMs > newest.mtimeMs ? input : newest,
        null,
      );
      const oldestTarget = targetStats.reduce(
        (oldest, target) =>
          !oldest || target.mtimeMs < oldest.mtimeMs ? target : oldest,
        null,
      );

      if (
        newestInput &&
        oldestTarget &&
        newestInput.mtimeMs > oldestTarget.mtimeMs
      ) {
        problems.push({
          kind: "stale",
          field: oldestTarget.field,
          target: relative(packageDir, oldestTarget.path),
          input: relative(packageDir, newestInput.path),
        });
      }
    }

    packages.push({ name, dir: packageDir, targets, problems });
  }

  return {
    root,
    packages,
    failures: packages.filter((pkg) => pkg.problems.length > 0),
  };
}

function packageLabel(count) {
  return `${count} package${count === 1 ? "" : "s"}`;
}

export function formatReport(result) {
  if (result.failures.length === 0) {
    const checked = packageLabel(result.packages.length);
    return `SDK build artifacts are current (${checked} checked).`;
  }

  const failures = packageLabel(result.failures.length);
  const lines = [`SDK build artifacts need attention for ${failures}:`];

  for (const pkg of result.failures) {
    for (const problem of pkg.problems) {
      if (problem.kind === "missing") {
        lines.push(
          `  ${pkg.name}: missing ${problem.field} target ${problem.target}`,
        );
      } else {
        lines.push(
          `  ${pkg.name}: ${problem.target} is older than ${problem.input}`,
        );
      }
    }
    lines.push(`  Rebuild with: pnpm --filter ${pkg.name} build`);
  }

  return lines.join("\n");
}

export function runCli({
  root = REPO_ROOT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const result = checkSdkArtifacts(root);
  const report = formatReport(result);

  if (result.failures.length > 0) {
    stderr.write(`${report}\n`);
    return 1;
  }

  stdout.write(`${report}\n`);
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli();
}
