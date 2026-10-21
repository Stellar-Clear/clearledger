import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkSdkArtifacts,
  collectEntryTargets,
  expandWorkspacePackages,
  formatReport,
  parseWorkspaceGlobs,
} from "./check-sdk-artifacts.mjs";

function timestamp(seconds) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
}

function write(path, contents, seconds) {
  writeFileSync(path, contents);
  utimesSync(path, timestamp(seconds), timestamp(seconds));
}

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "clearledger-sdk-artifacts-"));
  const packageDir = join(root, "packages", "sdk");

  mkdirSync(join(packageDir, "src"), { recursive: true });
  write(
    join(root, "pnpm-workspace.yaml"),
    ["packages:", "  - packages/*", ""].join("\n"),
    1,
  );
  write(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "@clearledger/sdk",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: { build: "tsc" },
      },
      null,
      2,
    ),
    1,
  );
  write(join(packageDir, "tsconfig.json"), "{}", 2);
  write(join(packageDir, "src", "index.ts"), "export const value = 1;\n", 10);

  return { root, packageDir };
}

test("parseWorkspaceGlobs reads only the packages block", () => {
  const globs = parseWorkspaceGlobs(
    [
      "packages:",
      '  - "apps/*"',
      "  - packages/*",
      "  - '!packages/ignored'",
      "",
      "overrides:",
      "  foo: 1",
      "",
    ].join("\n"),
  );

  assert.deepEqual(globs, ["apps/*", "packages/*"]);
});

test("expandWorkspacePackages resolves package directories", () => {
  const { root, packageDir } = createWorkspace();

  try {
    assert.deepEqual(expandWorkspacePackages(root, ["packages/*"]), [
      packageDir,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectEntryTargets includes main, types, bin, and exports", () => {
  const targets = collectEntryTargets({
    main: "dist/index.js",
    types: "./dist/index.d.ts",
    bin: { clearledger: "./dist/cli.js" },
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./package.json": "./package.json",
    },
  });

  assert.deepEqual(
    targets.map((target) => target.path),
    ["dist/index.js", "dist/index.d.ts", "dist/cli.js", "package.json"],
  );
});

test("checkSdkArtifacts reports missing, stale, then current artifacts", () => {
  const { root, packageDir } = createWorkspace();

  try {
    const missing = checkSdkArtifacts(root);
    assert.equal(missing.failures.length, 1);
    assert.equal(missing.failures[0].problems[0].kind, "missing");
    assert.match(formatReport(missing), /missing main target dist\/index\.js/);

    mkdirSync(join(packageDir, "dist"), { recursive: true });
    write(
      join(packageDir, "dist", "index.js"),
      "export const value = 1;\n",
      20,
    );
    write(
      join(packageDir, "dist", "index.d.ts"),
      "export declare const value = 1;\n",
      20,
    );

    const current = checkSdkArtifacts(root);
    assert.equal(current.failures.length, 0);
    assert.match(formatReport(current), /artifacts are current/);

    write(join(packageDir, "src", "index.ts"), "export const value = 2;\n", 30);

    const stale = checkSdkArtifacts(root);
    assert.equal(stale.failures.length, 1);
    assert.equal(stale.failures[0].problems[0].kind, "stale");
    assert.match(
      formatReport(stale),
      /dist\/index\.(js|d\.ts) is older than src\/index\.ts/,
    );
    assert.match(formatReport(stale), /pnpm --filter @clearledger\/sdk build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "checkSdkArtifacts ignores packages without build output declarations",
  () => {
    const root = mkdtempSync(join(tmpdir(), "clearledger-sdk-artifacts-"));

    try {
      mkdirSync(join(root, "packages", "app"), { recursive: true });
      write(
        join(root, "pnpm-workspace.yaml"),
        ["packages:", "  - packages/*", ""].join("\n"),
        1,
      );
      write(
        join(root, "packages", "app", "package.json"),
        JSON.stringify({ name: "app", scripts: { build: "next build" } }),
        1,
      );

      const result = checkSdkArtifacts(root);
      assert.equal(result.packages.length, 0);
      assert.equal(result.failures.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
