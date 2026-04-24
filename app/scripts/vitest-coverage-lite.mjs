import fs from 'node:fs';
import inspector from 'node:inspector';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stateKey = '__claudeAgentCoverageLite';

function getState() {
  process[stateKey] ??= {};
  return process[stateKey];
}

function post(method, params) {
  return new Promise((resolve, reject) => {
    getState().session.post(method, params ?? {}, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

export async function startCoverage() {
  const state = getState();
  state.session = new inspector.Session();
  state.session.connect();
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true,
    allowTriggeredUpdates: true,
  });
}

export async function takeCoverage() {
  if (!getState().session) {
    return undefined;
  }
  return post('Profiler.takePreciseCoverage');
}

export async function stopCoverage() {
  if (!getState().session) {
    return;
  }
  try {
    await post('Profiler.stopPreciseCoverage');
    await post('Profiler.disable');
  } finally {
    getState().session.disconnect();
    getState().session = undefined;
  }
}

class LiteCoverageProvider {
  name = 'custom';
  ctx;
  options;
  coverages = [];

  initialize(ctx) {
    this.ctx = ctx;
    const coverageOptions = ctx._coverageOptions ?? ctx.config.coverage ?? {};
    this.options = {
      ...coverageOptions,
      provider: 'custom',
      reportsDirectory: path.resolve(ctx.config.root, coverageOptions.reportsDirectory ?? 'coverage'),
      reporter: coverageOptions.reporter ?? ['text', 'json'],
      clean: coverageOptions.clean ?? true,
    };
  }

  resolveOptions() {
    return this.options;
  }

  clean(clean = this.options.clean) {
    if (clean) {
      fs.rmSync(this.options.reportsDirectory, { recursive: true, force: true });
    }
    fs.mkdirSync(this.options.reportsDirectory, { recursive: true });
    this.coverages = [];
  }

  onTestRunStart() {
    this.coverages = [];
  }

  onAfterSuiteRun({ coverage }) {
    if (coverage?.result) {
      this.coverages.push(coverage);
    }
  }

  generateCoverage() {
    return this.coverages;
  }

  reportCoverage(coverages) {
    const summary = summarizeCoverage(this.ctx.config.root, coverages);
    const reportPath = path.join(this.options.reportsDirectory, 'coverage-lite.json');
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

    const totals = summary.totals;
    const linePct = formatPercent(totals.coveredLines, totals.lines);
    const fnPct = formatPercent(totals.coveredFunctions, totals.functions);

    console.log('\nCoverage summary');
    console.log(`  Files:     ${summary.files.length}`);
    console.log(`  Lines:     ${linePct} (${totals.coveredLines}/${totals.lines})`);
    console.log(`  Functions: ${fnPct} (${totals.coveredFunctions}/${totals.functions})`);
    console.log(`  Report:    ${path.relative(this.ctx.config.root, reportPath)}`);
  }
}

function summarizeCoverage(root, coverages) {
  const files = new Map();

  for (const coverage of coverages) {
    for (const script of coverage.result ?? []) {
      const filename = toProjectFile(root, script.url);
      if (!filename) {
        continue;
      }

      const source = fs.readFileSync(filename, 'utf8');
      const lineOffsets = getLineOffsets(source);
      const executableLines = getExecutableLines(source);
      const entry = files.get(filename) ?? {
        path: path.relative(root, filename),
        lines: executableLines.size,
        coveredLines: new Set(),
        functions: new Set(),
        coveredFunctions: new Set(),
      };

      for (const fn of script.functions ?? []) {
        if (!fn.functionName) {
          continue;
        }
        const functionKey = `${fn.functionName}:${fn.ranges?.[0]?.startOffset ?? 0}:${fn.ranges?.[0]?.endOffset ?? 0}`;
        entry.functions.add(functionKey);

        const wasCalled = fn.ranges?.some((range) => range.count > 0);
        if (!wasCalled) {
          continue;
        }

        entry.coveredFunctions.add(functionKey);
        for (const range of fn.ranges ?? []) {
          if (range.count <= 0) {
            continue;
          }
          markCoveredLines(source, lineOffsets, executableLines, range, entry.coveredLines);
        }
      }

      files.set(filename, entry);
    }
  }

  const fileSummaries = [...files.values()]
    .map((entry) => ({
      path: entry.path,
      lines: entry.lines,
      coveredLines: entry.coveredLines.size,
      linePercent: toPercent(entry.coveredLines.size, entry.lines),
      functions: entry.functions.size,
      coveredFunctions: entry.coveredFunctions.size,
      functionPercent: toPercent(entry.coveredFunctions.size, entry.functions.size),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const totals = fileSummaries.reduce((acc, file) => {
    acc.lines += file.lines;
    acc.coveredLines += file.coveredLines;
    acc.functions += file.functions;
    acc.coveredFunctions += file.coveredFunctions;
    return acc;
  }, { lines: 0, coveredLines: 0, functions: 0, coveredFunctions: 0 });

  return { files: fileSummaries, totals };
}

function toProjectFile(root, url) {
  if (!url?.startsWith('file://')) {
    return undefined;
  }

  const filename = fileURLToPath(url);
  if (!filename.startsWith(root + path.sep)) {
    return undefined;
  }

  const relativePath = path.relative(root, filename);
  if (!/^(server|client|electron)\//.test(relativePath)) {
    return undefined;
  }

  if (filename.includes(`${path.sep}node_modules${path.sep}`)) {
    return undefined;
  }

  if (filename.includes(`${path.sep}__tests__${path.sep}`) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename)) {
    return undefined;
  }

  if (!/\.(cjs|mjs|js|jsx|ts|tsx)$/.test(filename)) {
    return undefined;
  }

  return filename;
}

function getLineOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function getExecutableLines(source) {
  const lines = new Set();
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('//')) {
      lines.add(index + 1);
    }
  });
  return lines;
}

function markCoveredLines(source, lineOffsets, executableLines, range, coveredLines) {
  const startLine = offsetToLine(lineOffsets, range.startOffset);
  const endLine = offsetToLine(lineOffsets, Math.max(range.startOffset, range.endOffset - 1));

  for (let line = startLine; line <= endLine; line += 1) {
    if (!executableLines.has(line)) {
      continue;
    }
    const text = source.split('\n')[line - 1]?.trim();
    if (text) {
      coveredLines.add(line);
    }
  }
}

function offsetToLine(lineOffsets, offset) {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineOffsets[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return high + 1;
}

function toPercent(covered, total) {
  return total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2));
}

function formatPercent(covered, total) {
  return `${toPercent(covered, total).toFixed(2)}%`;
}

export default {
  getProvider: () => new LiteCoverageProvider(),
  startCoverage,
  takeCoverage,
  stopCoverage,
};
