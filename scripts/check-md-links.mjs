#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
]);
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function walkMarkdown(root) {
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compareStrings(a.name, b.name),
    );

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          visit(join(directory, entry.name));
        }
        continue;
      }

      if (entry.isFile() && MARKDOWN_EXTENSIONS.has(extname(entry.name))) {
        files.push(join(directory, entry.name));
      }
    }
  }

  visit(root);
  return files;
}

function extname(name) {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}

function listMarkdownFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.md', '*.markdown'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split('\0')
      .filter(Boolean)
      .map((file) => join(root, file))
      .filter((file) => {
        try {
          return statSync(file).isFile();
        } catch {
          return false;
        }
      })
      .sort(compareStrings);
  } catch {
    return walkMarkdown(root).sort(compareStrings);
  }
}

function stripInlineCode(line) {
  return line.replace(/`+[^`]*`+/g, (match) => ' '.repeat(match.length));
}

function readDestination(line, start) {
  let index = start;

  while (index < line.length && /\s/.test(line[index])) {
    index += 1;
  }

  if (line[index] === '<') {
    const end = line.indexOf('>', index + 1);
    if (end === -1) {
      return null;
    }
    return { target: line.slice(index + 1, end), end: end + 1 };
  }

  let depth = 0;
  const targetStart = index;

  while (index < line.length) {
    const character = line[index];

    if (character === '\\') {
      index += 2;
      continue;
    }

    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (/\s/.test(character) && depth === 0) {
      break;
    }

    index += 1;
  }

  return { target: line.slice(targetStart, index), end: index };
}

function extractInlineLinks(line) {
  const links = [];
  let searchFrom = 0;

  while (searchFrom < line.length) {
    const marker = line.indexOf('](', searchFrom);
    if (marker === -1) {
      break;
    }

    const destination = readDestination(line, marker + 2);
    if (!destination) {
      searchFrom = marker + 2;
      continue;
    }

    let cursor = destination.end;
    while (cursor < line.length && /\s/.test(line[cursor])) {
      cursor += 1;
    }

    if (line[cursor] === '"' || line[cursor] === "'" || line[cursor] === '(') {
      const quote = line[cursor] === '(' ? ')' : line[cursor];
      const titleEnd = line.indexOf(quote, cursor + 1);
      if (titleEnd !== -1) {
        cursor = titleEnd + 1;
        while (cursor < line.length && /\s/.test(line[cursor])) {
          cursor += 1;
        }
      }
    }

    if (line[cursor] === ')') {
      links.push(destination.target);
      searchFrom = cursor + 1;
    } else {
      searchFrom = marker + 2;
    }
  }

  return links;
}

function extractLinks(lines) {
  const links = [];
  let fence = null;
  let inComment = false;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    let line = rawLine;

    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) {
        return;
      }
      line = line.slice(end + 3);
      inComment = false;
    }

    if (fence) {
      const closing = line.match(FENCE);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = null;
      }
      return;
    }

    const opening = line.match(FENCE);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      return;
    }

    const commentStart = line.indexOf('<!--');
    if (commentStart !== -1) {
      const commentEnd = line.indexOf('-->', commentStart + 4);
      if (commentEnd === -1) {
        inComment = true;
        line = line.slice(0, commentStart);
      } else {
        line = line.slice(0, commentStart) + line.slice(commentEnd + 3);
      }
    }

    line = stripInlineCode(line);

    const definition = line.match(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/);
    if (definition) {
      links.push({ target: definition[1].replace(/^<|>$/g, ''), line: lineNumber });
    }

    for (const target of extractInlineLinks(line)) {
      links.push({ target, line: lineNumber });
    }
  });

  return links;
}

function headingText(line) {
  return line
    .replace(/^ {0,3}#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*~]/g, '')
    .trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function anchorsFor(content) {
  const anchors = new Set();
  const used = new Set();
  const occurrences = new Map();

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const base = slugify(headingText(heading[1]));
      let slug = base;

      if (used.has(slug)) {
        let suffix = (occurrences.get(base) ?? 0) + 1;
        while (used.has(`${base}-${suffix}`)) {
          suffix += 1;
        }
        occurrences.set(base, suffix);
        slug = `${base}-${suffix}`;
      }

      if (slug) {
        anchors.add(slug);
        used.add(slug);
      }
    }

    const explicit = line.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi);
    for (const match of explicit) {
      anchors.add(match[1]);
    }
  }

  return anchors;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWithin(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function createExactExists(root) {
  const cache = new Map();

  function entriesFor(directory) {
    if (!cache.has(directory)) {
      try {
        cache.set(directory, new Set(readdirSync(directory)));
      } catch {
        cache.set(directory, null);
      }
    }
    return cache.get(directory);
  }

  return function exactExists(target) {
    if (!isWithin(root, target)) {
      return existsSync(target);
    }

    const segments = relative(root, target).split(sep).filter(Boolean);
    let current = root;

    for (const segment of segments) {
      const entries = entriesFor(current);
      if (!entries || !entries.has(segment)) {
        return false;
      }
      current = join(current, segment);
    }

    return existsSync(current);
  };
}

function checkRepository(root) {
  const files = listMarkdownFiles(root);
  const exactExists = createExactExists(root);
  const anchorCache = new Map();
  const broken = [];
  let checkedLinks = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const links = extractLinks(content.split(/\r?\n/));

    for (const link of links) {
      let target = link.target.trim();
      if (!target || target.startsWith('//')) {
        continue;
      }

      if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1);
      }

      if (EXTERNAL_SCHEME.test(target) || target.startsWith('mailto:')) {
        continue;
      }

      checkedLinks += 1;

      const hashIndex = target.indexOf('#');
      let pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const anchorPart = hashIndex === -1 ? '' : safeDecode(target.slice(hashIndex + 1));
      const queryIndex = pathPart.indexOf('?');
      if (queryIndex !== -1) {
        pathPart = pathPart.slice(0, queryIndex);
      }
      pathPart = safeDecode(pathPart);

      let destination;
      let resolved;

      if (!pathPart) {
        destination = file;
        resolved = file;
      } else {
        resolved = resolve(dirname(file), pathPart);
        destination = resolved;

        if (!exactExists(resolved)) {
          broken.push({
            file: toPosix(relative(root, file)),
            line: link.line,
            target: link.target,
          });
          continue;
        }
      }

      if (!anchorPart || !MARKDOWN_EXTENSIONS.has(extname(destination))) {
        continue;
      }

      let isFile = false;
      try {
        isFile = statSync(resolved).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) {
        continue;
      }

      if (!anchorCache.has(resolved)) {
        anchorCache.set(resolved, anchorsFor(readFileSync(resolved, 'utf8')));
      }

      if (!anchorCache.get(resolved).has(anchorPart)) {
        broken.push({
          file: toPosix(relative(root, file)),
          line: link.line,
          target: link.target,
        });
      }
    }
  }

  broken.sort(
    (a, b) =>
      compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.target, b.target),
  );

  return { files: files.length, links: checkedLinks, broken };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`self-test failed: ${message}`);
  }
}

function runSelfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), 'clearledger-md-links-'));

  try {
    const success = join(sandbox, 'success');
    mkdirSync(join(success, 'img'), { recursive: true });
    writeFileSync(join(success, 'img', 'logo.png'), '');
    writeFileSync(
      join(success, 'guide.md'),
      ['# Guide', '', '## Hello World', '', '## Hello World', ''].join('\n'),
    );
    writeFileSync(
      join(success, 'README.md'),
      [
        '# Root',
        '',
        '- [Guide](guide.md)',
        '- [Heading](guide.md#hello-world)',
        '- [Duplicate heading](guide.md#hello-world-1)',
        '- [Image](img/logo.png)',
        '- [External](https://example.com)',
        '- [Email](mailto:test@example.com)',
        '',
        '```md',
        '[Broken link](missing.md)',
        '```',
        '',
      ].join('\n'),
    );

    const passing = checkRepository(success);
    assert(passing.broken.length === 0, 'valid links were reported as broken');

    const brokenFile = join(sandbox, 'broken-file');
    mkdirSync(brokenFile);
    writeFileSync(join(brokenFile, 'README.md'), '# Root\n\n[Missing](missing.md)\n');
    const missing = checkRepository(brokenFile);
    assert(missing.broken.length === 1, 'missing file was not reported');
    assert(missing.broken[0].file === 'README.md', 'missing file source was not reported');
    assert(missing.broken[0].line === 3, 'missing file line number was not reported');
    assert(missing.broken[0].target === 'missing.md', 'missing file target was not reported');

    const brokenAnchor = join(sandbox, 'broken-anchor');
    mkdirSync(brokenAnchor);
    writeFileSync(join(brokenAnchor, 'guide.md'), '# Guide\n\n## Hello World\n');
    writeFileSync(join(brokenAnchor, 'README.md'), '# Root\n\n[Missing anchor](guide.md#goodbye)\n');
    const anchor = checkRepository(brokenAnchor);
    assert(anchor.broken.length === 1, 'missing anchor was not reported');
    assert(anchor.broken[0].target === 'guide.md#goodbye', 'missing anchor target was not reported');

    process.stdout.write('Self-test passed: success, broken file, and broken anchor cases.\n');
    return 0;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    return runSelfTest();
  }

  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const requested = args.filter((argument) => !argument.startsWith('-'));
  const targets = requested.length > 0 ? requested : [root];
  let failed = false;

  for (const target of targets) {
    const absolute = resolve(target);
    const result = checkRepository(absolute);

    for (const broken of result.broken) {
      process.stdout.write(`${broken.file}:${broken.line} -> ${broken.target}\n`);
      failed = true;
    }

    process.stdout.write(
      `Checked ${result.links} local links in ${result.files} Markdown file(s): ${result.broken.length} broken.\n`,
    );
  }

  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
