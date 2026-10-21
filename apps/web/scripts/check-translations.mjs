#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");

export const DEFAULT_CONFIG_PATH = path.join(WEB_ROOT, "i18n", "locales.json");
export const DEFAULT_MESSAGES_DIR = path.join(WEB_ROOT, "messages");

const ARGUMENT_TYPES = new Set([
  "number",
  "date",
  "time",
  "plural",
  "select",
  "selectordinal",
]);
const BRANCH_TYPES = new Set(["plural", "select", "selectordinal"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectStrings(value, keyPath, strings, problems) {
  if (typeof value === "string") {
    strings.set(keyPath, value);
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key.includes(".")) {
        problems.push(
          `key "${keyPath ? `${keyPath}.${key}` : key}" contains a "."`,
        );
        continue;
      }
      collectStrings(
        child,
        keyPath ? `${keyPath}.${key}` : key,
        strings,
        problems,
      );
    }
    return;
  }

  problems.push(
    `"${keyPath || "<root>"}" must be a string or an object, received ${Array.isArray(value) ? "array" : typeof value}`,
  );
}

export function extractPlaceholders(message) {
  const placeholders = new Set();
  const problems = [];
  const roots = [];
  const openBraces = [];
  let quoted = false;

  for (let index = 0; index < message.length; index += 1) {
    const character = message[index];

    if (character === "'") {
      if (quoted) {
        if (message[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }

      const next = message[index + 1];
      if (next === "'") {
        index += 1;
        continue;
      }
      if (next === "{" || next === "}" || next === "#") {
        quoted = true;
      }
      continue;
    }

    if (quoted) {
      continue;
    }

    if (character === "{") {
      const parent = openBraces.at(-1) ?? null;
      const node = { open: index, close: null, children: [] };
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
      openBraces.push(node);
      continue;
    }

    if (character === "}") {
      const node = openBraces.pop();
      if (!node) {
        problems.push(`unmatched "}" at position ${index}`);
        continue;
      }
      node.close = index;
    }
  }

  for (const node of openBraces) {
    problems.push(`unmatched "{" at position ${node.open}`);
  }

  function visitBranchBody(node) {
    for (const child of node.children) {
      visitArgument(child);
    }
  }

  function visitArgument(node) {
    if (node.close === null) {
      return;
    }

    const expression = message.slice(node.open + 1, node.close).trim();

    if (expression === "") {
      problems.push(`empty placeholder at position ${node.open}`);
      return;
    }

    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(expression);
    if (!nameMatch) {
      problems.push(`malformed placeholder at position ${node.open}`);
      return;
    }

    const name = nameMatch[1];
    placeholders.add(name);

    const rest = expression.slice(name.length).trim();
    if (rest === "") {
      return;
    }

    if (!rest.startsWith(",")) {
      problems.push(`malformed argument "${name}" at position ${node.open}`);
      return;
    }

    const typeMatch = /^,\s*([A-Za-z]+)/.exec(rest);
    if (!typeMatch) {
      problems.push(
        `missing argument type after "${name}" at position ${node.open}`,
      );
      return;
    }

    const type = typeMatch[1];
    if (!ARGUMENT_TYPES.has(type)) {
      problems.push(
        `unknown argument type "${type}" for "${name}" at position ${node.open}`,
      );
      return;
    }

    if (BRANCH_TYPES.has(type)) {
      const branches = rest.slice(typeMatch[0].length);
      if (!/\bother\s*\{/.test(branches)) {
        problems.push(`"${name}" (${type}) is missing an "other" branch`);
      }
      for (const child of node.children) {
        visitBranchBody(child);
      }
    }
  }

  for (const root of roots) {
    visitArgument(root);
  }

  return { placeholders, problems: [...new Set(problems)] };
}

export function checkTranslations({
  configPath = DEFAULT_CONFIG_PATH,
  messagesDir = DEFAULT_MESSAGES_DIR,
  readDirectory = fs.readdirSync,
} = {}) {
  const errors = [];
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!isPlainObject(config)) {
    return {
      errors: [`${configPath} must contain a JSON object`],
      locales: [],
    };
  }

  const { sourceLocale, supportedLocales } = config;
  if (typeof sourceLocale !== "string" || sourceLocale.length === 0) {
    return {
      errors: [`${configPath} must define a non-empty "sourceLocale"`],
      locales: [],
    };
  }
  if (
    !Array.isArray(supportedLocales) ||
    supportedLocales.length === 0 ||
    supportedLocales.some(
      (locale) => typeof locale !== "string" || locale.length === 0,
    )
  ) {
    return {
      errors: [
        `${configPath} must define a non-empty "supportedLocales" string array`,
      ],
      locales: [],
    };
  }
  if (new Set(supportedLocales).size !== supportedLocales.length) {
    return {
      errors: [
        `${configPath} contains duplicate entries in "supportedLocales"`,
      ],
      locales: supportedLocales,
    };
  }
  if (!supportedLocales.includes(sourceLocale)) {
    return {
      errors: [
        `source locale "${sourceLocale}" must be listed in "supportedLocales"`,
      ],
      locales: supportedLocales,
    };
  }

  const catalogFiles = readDirectory(messagesDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort();

  for (const catalog of catalogFiles) {
    if (!supportedLocales.includes(catalog)) {
      errors.push(
        `message catalog "${catalog}.json" is not listed in supportedLocales in ${configPath}`,
      );
    }
  }

  const catalogs = new Map();
  for (const locale of supportedLocales) {
    const file = path.join(messagesDir, `${locale}.json`);
    if (!fs.existsSync(file)) {
      errors.push(`${locale}: missing message catalog ${file}`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(`${locale}: cannot parse ${file}: ${error.message}`);
      continue;
    }

    if (!isPlainObject(parsed)) {
      errors.push(`${locale}: ${file} must contain a JSON object`);
      continue;
    }

    const strings = new Map();
    const problems = [];
    collectStrings(parsed, "", strings, problems);
    for (const problem of problems) {
      errors.push(`${locale}: ${problem}`);
    }
    catalogs.set(locale, strings);
  }

  const source = catalogs.get(sourceLocale);
  if (source) {
    for (const [key, message] of source) {
      const { problems } = extractPlaceholders(message);
      for (const problem of problems) {
        errors.push(
          `${sourceLocale}: malformed message at "${key}": ${problem}`,
        );
      }
    }
  }

  for (const locale of supportedLocales) {
    if (locale === sourceLocale) {
      continue;
    }

    const target = catalogs.get(locale);
    if (!target || !source) {
      continue;
    }

    for (const key of [...source.keys()].sort()) {
      if (!target.has(key)) {
        errors.push(`${locale}: missing key "${key}"`);
      }
    }

    for (const key of [...target.keys()].sort()) {
      if (!source.has(key)) {
        errors.push(`${locale}: extra key "${key}"`);
      }
    }

    for (const key of [...source.keys()].sort()) {
      if (!target.has(key)) {
        continue;
      }

      const sourceMessage = source.get(key);
      const targetMessage = target.get(key);
      const sourcePlaceholders = extractPlaceholders(sourceMessage);
      const targetPlaceholders = extractPlaceholders(targetMessage);

      for (const problem of targetPlaceholders.problems) {
        errors.push(`${locale}: malformed message at "${key}": ${problem}`);
      }

      const missing = [...sourcePlaceholders.placeholders]
        .filter((name) => !targetPlaceholders.placeholders.has(name))
        .sort();
      const extra = [...targetPlaceholders.placeholders]
        .filter((name) => !sourcePlaceholders.placeholders.has(name))
        .sort();

      if (missing.length > 0) {
        errors.push(
          `${locale}: "${key}" is missing placeholder(s) from ${sourceLocale}: ${missing.map((name) => `{${name}}`).join(", ")}`,
        );
      }
      if (extra.length > 0) {
        errors.push(
          `${locale}: "${key}" has placeholder(s) not present in ${sourceLocale}: ${extra.map((name) => `{${name}}`).join(", ")}`,
        );
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    locales: supportedLocales,
    sourceLocale,
  };
}

function writeFixture(
  root,
  name,
  sourceMessages,
  targetMessages,
  targetLocale = "es",
) {
  const directory = path.join(root, name);
  const messagesDir = path.join(directory, "messages");
  fs.mkdirSync(messagesDir, { recursive: true });
  fs.writeFileSync(
    path.join(messagesDir, "en.json"),
    `${JSON.stringify(sourceMessages, null, 2)}\n`,
  );
  if (targetMessages !== undefined) {
    fs.writeFileSync(
      path.join(messagesDir, `${targetLocale}.json`),
      `${JSON.stringify(targetMessages, null, 2)}\n`,
    );
  }
  const configPath = path.join(directory, "locales.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ sourceLocale: "en", supportedLocales: ["en", targetLocale] }, null, 2)}\n`,
  );
  return { configPath, messagesDir };
}

export function runSelfTest() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "clearledger-translations-"),
  );
  const source = {
    Greeting: "Hello {name}",
    Items: "{count, plural, one {# item} other {# items}}",
    Quoted: "Use '{name}' literally",
  };

  const cases = [
    {
      name: "complete catalogs",
      target: {
        Greeting: "Hola {name}",
        Items: "{count, plural, one {# elemento} other {# elementos}}",
        Quoted: "Usa '{name}' literalmente",
      },
    },
    {
      name: "missing key",
      target: { Greeting: "Hola {name}", Items: source.Items },
      expected: /es: missing key "Quoted"/,
    },
    {
      name: "extra key",
      target: { ...source, Obsolete: "viejo" },
      expected: /es: extra key "Obsolete"/,
    },
    {
      name: "missing placeholder",
      target: { Greeting: "Hola", Items: source.Items, Quoted: source.Quoted },
      expected: /es: "Greeting" is missing placeholder\(s\) from en: \{name\}/,
    },
    {
      name: "unexpected placeholder",
      target: { ...source, Greeting: "Hola {nombre}" },
      expected:
        /es: "Greeting" has placeholder\(s\) not present in en: \{nombre\}/,
    },
    {
      name: "malformed message",
      target: { ...source, Greeting: "Hola {name" },
      expected: /es: malformed message at "Greeting": unmatched "\{"/,
    },
  ];

  let failures = 0;
  try {
    for (const testCase of cases) {
      const { configPath, messagesDir } = writeFixture(
        root,
        testCase.name,
        source,
        testCase.target,
      );
      const result = checkTranslations({ configPath, messagesDir });
      const passed = testCase.expected
        ? result.errors.some((error) => testCase.expected.test(error))
        : result.errors.length === 0;

      if (passed) {
        console.log(`PASS ${testCase.name}`);
      } else {
        failures += 1;
        console.error(`FAIL ${testCase.name}`);
        for (const error of result.errors) {
          console.error(`  ${error}`);
        }
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failures > 0) {
    throw new Error(`${failures} self-test case(s) failed`);
  }

  console.log(`Translation checker self-test passed (${cases.length} cases).`);
}

function parseArguments(argv) {
  const options = {
    selfTest: false,
    configPath: DEFAULT_CONFIG_PATH,
    messagesDir: DEFAULT_MESSAGES_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument === "--config") {
      index += 1;
      if (index >= argv.length) {
        throw new Error("--config requires a path");
      }
      options.configPath = path.resolve(argv[index]);
    } else if (argument.startsWith("--config=")) {
      options.configPath = path.resolve(argument.slice("--config=".length));
    } else if (argument === "--messages-dir") {
      index += 1;
      if (index >= argv.length) {
        throw new Error("--messages-dir requires a path");
      }
      options.messagesDir = path.resolve(argv[index]);
    } else if (argument.startsWith("--messages-dir=")) {
      options.messagesDir = path.resolve(
        argument.slice("--messages-dir=".length),
      );
    } else if (argument === "--help" || argument === "-h") {
      console.log(
        [
          "Usage: node scripts/check-translations.mjs [options]",
          "",
          "Options:",
          "  --self-test              Run the checker against built-in fixtures",
          "  --config <path>          Locale config (default: i18n/locales.json)",
          "  --messages-dir <path>    Message catalog directory (default: messages)",
          "  --help                   Show this help",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.selfTest) {
      runSelfTest();
      return;
    }

    const result = checkTranslations(options);
    if (result.errors.length > 0) {
      console.error("Translation check failed:");
      for (const error of result.errors) {
        console.error(`  - ${error}`);
      }
      console.error(
        `\n${result.errors.length} problem(s) across ${result.locales.length} supported locale(s).`,
      );
      process.exitCode = 1;
      return;
    }

    const translated = result.locales.length - 1;
    console.log(
      `Translation check passed: ${result.sourceLocale} source, ${translated} translated locale(s), no missing keys or placeholder mismatches.`,
    );
  } catch (error) {
    console.error(`Translation check could not run: ${error.message}`);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
