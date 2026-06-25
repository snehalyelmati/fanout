#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const REPORT_SCHEMA = "doubleword.safe-work-unit-eval";
const REPORT_VERSION = 1;
const PREDICTION_SCHEMA = "doubleword.safe-work-unit-prediction";
const PREDICTION_VERSION = 1;
const DEFAULT_OUT = join("runs", "safe-work-unit-eval");
const VERDICTS = ["safe_independent", "safe_after_dependency", "unsafe", "inconclusive"];
const EVIDENCE_SCOPE = "retrospective_trace_derived_planner_reliability_not_runtime_tat";

function parseArgs(argv) {
  const tracePaths = [];
  let predictions;
  let out = DEFAULT_OUT;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--predictions") {
      predictions = argv[++index];
      if (!predictions) throw new Error("--predictions requires a JSONL file");
    } else if (arg === "--out") {
      out = argv[++index];
      if (!out) throw new Error("--out requires a directory");
    } else {
      tracePaths.push(arg);
    }
  }

  if (!tracePaths.length) throw new Error("at least one trace path is required");
  if (!predictions) throw new Error("--predictions is required");
  return { tracePaths, predictions, out };
}

function collectJsonl(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".jsonl") ? [path] : [];
  if (!stat.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => collectJsonl(join(path, entry.name))).sort();
}

function readJsonl(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [{ ...JSON.parse(line), sourceFile: file, sourceLine: index + 1 }];
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${error instanceof Error ? error.message : error}`);
      }
    });
}

function diagnostic(row, context, field, message) {
  const trace = typeof row.traceId === "string" ? ` trace ${row.traceId}` : "";
  const unit = typeof row.unitId === "string" ? ` unit ${row.unitId}` : "";
  throw new Error(`${row.sourceFile}:${row.sourceLine}:${trace}${unit}${context ? ` ${context}` : ""} field ${field}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(row, object, field, context = "") {
  if (typeof object[field] !== "string" || !object[field].trim()) diagnostic(row, context, field, "expected non-empty string");
}

function requireArray(row, object, field, context = "") {
  if (!Array.isArray(object[field])) diagnostic(row, context, field, "expected array");
}

function optionalStringArray(row, object, field, context = "") {
  if (object[field] === undefined) return [];
  requireArray(row, object, field, context);
  for (const [index, value] of object[field].entries()) {
    if (typeof value !== "string" || !value.trim()) diagnostic(row, context, `${field}[${index}]`, "expected non-empty string");
  }
  return [...object[field]].sort();
}

function validateBoundary(row, boundary) {
  if (!isObject(boundary)) diagnostic(row, "", "prefixBoundary", "expected object");
  if (!Number.isInteger(boundary.line) || boundary.line < 1) diagnostic(row, "", "prefixBoundary.line", "expected positive integer JSONL line");
  if (boundary.messageId !== undefined && typeof boundary.messageId !== "string") diagnostic(row, "", "prefixBoundary.messageId", "expected string when present");
  return { line: boundary.line, messageId: boundary.messageId ?? null };
}

function validateActiveBoundaryClaim(row, claim, context) {
  if (!isObject(claim)) diagnostic(row, context, "activeBoundaryClaim", "expected object");
  if (claim.status !== "active" && claim.status !== "background") diagnostic(row, context, "activeBoundaryClaim.status", "expected active or background");
  if (typeof claim.requiredForNextActionableResponse !== "boolean") diagnostic(row, context, "activeBoundaryClaim.requiredForNextActionableResponse", "expected boolean");
  if (typeof claim.boundary !== "string" || !claim.boundary.trim()) diagnostic(row, context, "activeBoundaryClaim.boundary", "expected non-empty string");
  return {
    status: claim.status,
    requiredForNextActionableResponse: claim.requiredForNextActionableResponse,
    boundary: claim.boundary,
  };
}

function validatePredictionRow(row) {
  if (row.schema !== PREDICTION_SCHEMA) diagnostic(row, "", "schema", `expected ${PREDICTION_SCHEMA}`);
  if (row.version !== PREDICTION_VERSION) diagnostic(row, "", "version", `expected ${PREDICTION_VERSION}`);
  requireString(row, row, "traceId");
  const prefixBoundary = validateBoundary(row, row.prefixBoundary);
  requireArray(row, row, "proposedUnits");
  if (!row.proposedUnits.length) diagnostic(row, "", "proposedUnits", "expected at least one unit");

  const seen = new Set();
  const proposedUnits = row.proposedUnits.map((unit) => {
    if (!isObject(unit)) diagnostic(row, "", "proposedUnits", "expected unit objects");
    requireString(row, unit, "unitId", "unit");
    if (seen.has(unit.unitId)) diagnostic({ ...row, unitId: unit.unitId }, "unit", "unitId", "duplicate unit id");
    seen.add(unit.unitId);
    requireString(row, unit, "title", `unit ${unit.unitId}`);
    requireArray(row, unit, "ownedFiles", `unit ${unit.unitId}`);
    requireArray(row, unit, "readOnlyFiles", `unit ${unit.unitId}`);
    requireArray(row, unit, "dependencies", `unit ${unit.unitId}`);
    requireArray(row, unit, "validationRequirements", `unit ${unit.unitId}`);
    requireArray(row, unit, "reviewRequirements", `unit ${unit.unitId}`);
    requireArray(row, unit, "cancellationRules", `unit ${unit.unitId}`);
    const activeBoundaryClaim = validateActiveBoundaryClaim(row, unit.activeBoundaryClaim, `unit ${unit.unitId}`);

    const label = unit.label;
    if (label !== undefined && (!isObject(label) || !VERDICTS.includes(label.expectedVerdict))) {
      diagnostic(row, `unit ${unit.unitId}`, "label.expectedVerdict", `expected one of ${VERDICTS.join(", ")}`);
    }

    return {
      unitId: unit.unitId,
      title: unit.title,
      ownedFiles: optionalStringArray(row, unit, "ownedFiles", `unit ${unit.unitId}`),
      readOnlyFiles: optionalStringArray(row, unit, "readOnlyFiles", `unit ${unit.unitId}`),
      mutableResources: optionalStringArray(row, unit, "mutableResources", `unit ${unit.unitId}`),
      dependencies: optionalStringArray(row, unit, "dependencies", `unit ${unit.unitId}`),
      validationRequirements: optionalStringArray(row, unit, "validationRequirements", `unit ${unit.unitId}`),
      reviewRequirements: optionalStringArray(row, unit, "reviewRequirements", `unit ${unit.unitId}`),
      cancellationRules: optionalStringArray(row, unit, "cancellationRules", `unit ${unit.unitId}`),
      activeBoundaryClaim,
      speculative: unit.speculative === true,
      label: label ? { expectedVerdict: label.expectedVerdict } : null,
    };
  });

  return {
    traceId: row.traceId,
    predictionId: row.predictionId ?? `${row.traceId}:${prefixBoundary.line}`,
    prefixBoundary,
    proposedUnits,
    source: row.sourceFile,
    sourceLine: row.sourceLine,
  };
}

function traceIdFromRows(rows, source) {
  const session = rows.find((row) => row.type === "session");
  return session?.id ?? basename(source).replace(/\.jsonl$/, "");
}

function rowText(row) {
  const chunks = [];
  const message = row.message ?? {};
  if (typeof row.type === "string") chunks.push(row.type);
  if (typeof row.event === "string") chunks.push(row.event);
  if (typeof message.role === "string") chunks.push(message.role);
  for (const part of Array.isArray(message.content) ? message.content : []) {
    if (typeof part.text === "string") chunks.push(part.text);
    if (typeof part.name === "string") chunks.push(part.name);
    if (typeof part.toolName === "string") chunks.push(part.toolName);
    if (isObject(part.arguments)) chunks.push(JSON.stringify(part.arguments));
    if (typeof part.content === "string") chunks.push(part.content);
  }
  return chunks.join("\n");
}

function extractPaths(text) {
  const paths = new Set();
  const pathLike = /(?:^|[\s"'`(])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.@-]+\.[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|rs|py|go|java|kt|swift|css|scss|html|sh))/g;
  for (const match of text.matchAll(pathLike)) paths.add(match[1]);
  return [...paths].sort();
}

function extractCommands(text) {
  const commands = new Set();
  const commandLike = /(npm run [A-Za-z0-9:_-]+|pnpm [A-Za-z0-9:_-]+|yarn [A-Za-z0-9:_-]+|pytest\b[^\n"]*|cargo test\b[^\n"]*|go test\b[^\n"]*|git\b [^\n"]+)/g;
  for (const match of text.matchAll(commandLike)) commands.add(match[1].trim());
  return [...commands].sort();
}

function summarizeRows(rows) {
  const text = rows.map(rowText).join("\n");
  const paths = extractPaths(text);
  const commands = extractCommands(text);
  return {
    rowCount: rows.length,
    messageCount: rows.filter((row) => row.type === "message").length,
    toolResultCount: rows.filter((row) => row.message?.role === "toolResult").length,
    paths,
    commands,
    validationCommands: commands.filter((command) => /\b(test|check|lint|typecheck|pytest)\b/.test(command)),
    gitCommands: commands.filter((command) => command.startsWith("git ")),
  };
}

function intersect(a, b) {
  const bSet = new Set(b);
  return [...new Set(a)].filter((value) => bSet.has(value)).sort();
}

function hasDependency(unit, other) {
  return unit.dependencies.includes(other.unitId);
}

function addReason(reasons, code, message, evidence = {}) {
  reasons.push({ code, message, evidence });
}

function evaluateUnit(unit, allUnits, prefix, suffix) {
  const reasons = [];
  const declaredDependencies = unit.dependencies.filter((dep) => allUnits.some((candidate) => candidate.unitId === dep));
  const prefixVisibleFiles = new Set(prefix.paths);
  const suffixVisibleFiles = new Set(suffix.paths);

  for (const other of allUnits) {
    if (other.unitId === unit.unitId) continue;
    const ownedOverlap = intersect(unit.ownedFiles, other.ownedFiles);
    const resourceOverlap = intersect(unit.mutableResources, other.mutableResources);
    if (ownedOverlap.length || resourceOverlap.length) {
      const dependencyDeclared = hasDependency(unit, other) || hasDependency(other, unit);
      addReason(
        reasons,
        dependencyDeclared ? "ownership_overlap_with_declared_dependency" : "ownership_overlap_without_dependency",
        dependencyDeclared
          ? "Overlapping owned files or mutable resources require dependency ordering."
          : "Overlapping owned files or mutable resources make parallel execution unsafe.",
        { otherUnitId: other.unitId, ownedFiles: ownedOverlap, mutableResources: resourceOverlap },
      );
    }
  }

  const hiddenInputs = unit.readOnlyFiles.filter((file) => !prefixVisibleFiles.has(file) && suffixVisibleFiles.has(file));
  if (hiddenInputs.length) {
    addReason(reasons, "hidden_suffix_dependency", "Read-only inputs only appear in suffix evidence, so they were not prefix-visible to the planner.", { files: hiddenInputs });
  }

  if (unit.ownedFiles.length && unit.validationRequirements.length === 0) {
    addReason(reasons, "missing_validation", "Unit mutates files but omits validation requirements.", { ownedFiles: unit.ownedFiles });
  }

  if (unit.ownedFiles.length && unit.reviewRequirements.length === 0) {
    addReason(reasons, "missing_review", "Unit mutates files but omits tier1 review or synthesis requirements.", { ownedFiles: unit.ownedFiles });
  }

  if (unit.activeBoundaryClaim.requiredForNextActionableResponse === true && unit.activeBoundaryClaim.status === "background") {
    addReason(reasons, "active_boundary_mistake", "Unit claims background execution while also being required for the next actionable response.", { activeBoundaryClaim: unit.activeBoundaryClaim });
  }

  if (unit.speculative && unit.cancellationRules.length === 0) {
    addReason(reasons, "missing_cancellation_rule", "Speculative work omits cancellation rules.", {});
  }

  const staleFiles = unit.speculative ? unit.ownedFiles.filter((file) => suffixVisibleFiles.has(file)) : [];
  if (staleFiles.length) {
    addReason(reasons, "stale_speculative_work", "Suffix evidence touches files owned by speculative work, making stale or wasted output possible.", { files: staleFiles });
  }

  if (!unit.ownedFiles.length && !unit.readOnlyFiles.length && !unit.mutableResources.length) {
    addReason(reasons, "insufficient_evidence", "Unit declares no file or mutable resource surface to evaluate.", {});
  }

  const unsafeCodes = new Set([
    "ownership_overlap_without_dependency",
    "hidden_suffix_dependency",
    "missing_validation",
    "missing_review",
    "active_boundary_mistake",
    "missing_cancellation_rule",
    "stale_speculative_work",
  ]);
  const dependentCodes = new Set(["ownership_overlap_with_declared_dependency"]);
  let verdict = "safe_independent";
  if (reasons.some((reason) => reason.code === "insufficient_evidence")) verdict = "inconclusive";
  if (declaredDependencies.length || reasons.some((reason) => dependentCodes.has(reason.code))) verdict = "safe_after_dependency";
  if (reasons.some((reason) => unsafeCodes.has(reason.code))) verdict = "unsafe";

  if (verdict === "safe_independent") {
    addReason(reasons, "prefix_supported_no_conflicts", "Prefix-visible file/resource surface has validation, review, cancellation, and no detected suffix conflicts.", {
      ownedFiles: unit.ownedFiles,
      readOnlyFiles: unit.readOnlyFiles,
      mutableResources: unit.mutableResources,
    });
  }

  return {
    unitId: unit.unitId,
    title: unit.title,
    verdict,
    label: unit.label,
    reasons,
    ownedFiles: unit.ownedFiles,
    readOnlyFiles: unit.readOnlyFiles,
    mutableResources: unit.mutableResources,
    dependencies: unit.dependencies,
    validationRequirements: unit.validationRequirements,
    reviewRequirements: unit.reviewRequirements,
    cancellationRules: unit.cancellationRules,
    activeBoundaryClaim: unit.activeBoundaryClaim,
    speculative: unit.speculative,
  };
}

function computeMetrics(unitResults) {
  const counts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]));
  for (const result of unitResults) counts[result.verdict]++;
  const labeled = unitResults.filter((result) => result.label);
  const safePredictions = labeled.filter((result) => result.verdict === "safe_independent");
  const trueSafePredictions = safePredictions.filter((result) => result.label.expectedVerdict === "safe_independent");
  const expectedSafe = labeled.filter((result) => result.label.expectedVerdict === "safe_independent");
  const dependencyLabeled = labeled.filter((result) => result.label.expectedVerdict === "safe_after_dependency" || result.verdict === "safe_after_dependency");
  const conflictLabeled = labeled.filter((result) => result.reasons.some((reason) => reason.code.includes("overlap")) || result.label.expectedVerdict === "unsafe");

  const ratio = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 1000) / 1000 : null;
  return {
    primaryMetric: "safetyPrecision",
    totalUnits: unitResults.length,
    verdictCounts: counts,
    labeledUnitCount: labeled.length,
    safetyPrecision: labeled.length ? ratio(trueSafePredictions.length, safePredictions.length) : null,
    unsafeFalsePositiveCount: labeled.length ? safePredictions.length - trueSafePredictions.length : null,
    recall: labeled.length ? ratio(trueSafePredictions.length, expectedSafe.length) : null,
    dependencyAccuracy: dependencyLabeled.length ? ratio(dependencyLabeled.filter((result) => result.verdict === result.label.expectedVerdict).length, dependencyLabeled.length) : null,
    conflictAccuracy: conflictLabeled.length ? ratio(conflictLabeled.filter((result) => result.verdict === result.label.expectedVerdict).length, conflictLabeled.length) : null,
    inconclusiveRate: ratio(counts.inconclusive, unitResults.length),
    recallAvailable: labeled.length > 0,
  };
}

function evaluatePrediction(prediction, trace) {
  if (prediction.prefixBoundary.line > trace.rows.length) {
    throw new Error(`${prediction.source}:${prediction.sourceLine}: trace ${prediction.traceId} field prefixBoundary.line: boundary exceeds trace length ${trace.rows.length}`);
  }
  const prefixRows = trace.rows.filter((row) => row.sourceLine <= prediction.prefixBoundary.line);
  const suffixRows = trace.rows.filter((row) => row.sourceLine > prediction.prefixBoundary.line);
  const prefix = summarizeRows(prefixRows);
  const suffix = summarizeRows(suffixRows);
  const unitResults = prediction.proposedUnits.map((unit) => evaluateUnit(unit, prediction.proposedUnits, prefix, suffix));
  return {
    traceId: prediction.traceId,
    predictionId: prediction.predictionId,
    predictionSource: prediction.source,
    retrospectiveEvidenceSource: trace.source,
    prefixBoundary: prediction.prefixBoundary,
    prefixContext: prefix,
    suffixEvidence: suffix,
    unitResults,
    metrics: computeMetrics(unitResults),
  };
}

function buildMarkdown(report) {
  const lines = [
    "# Safe Work Unit Prefix Evaluation",
    "",
    "This report is retrospective trace-derived planner reliability evidence over sampled Pi trace prefixes. It does not prove live runtime TAT improvement, production safety, or runtime Planned Parallel RPE behavior.",
    "",
    `Evidence scope: \`${report.evidenceScope}\``,
    `Primary metric: \`${report.metrics.primaryMetric}\``,
    "",
    "## Aggregate metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total units | ${report.metrics.totalUnits} |`,
    `| Safe independent | ${report.metrics.verdictCounts.safe_independent} |`,
    `| Safe after dependency | ${report.metrics.verdictCounts.safe_after_dependency} |`,
    `| Unsafe | ${report.metrics.verdictCounts.unsafe} |`,
    `| Inconclusive | ${report.metrics.verdictCounts.inconclusive} |`,
    `| Safety precision | ${report.metrics.safetyPrecision ?? "unavailable"} |`,
    `| Unsafe false positives | ${report.metrics.unsafeFalsePositiveCount ?? "unavailable"} |`,
    `| Recall | ${report.metrics.recallAvailable ? report.metrics.recall : "unavailable"} |`,
    `| Dependency accuracy | ${report.metrics.dependencyAccuracy ?? "unavailable"} |`,
    `| Conflict accuracy | ${report.metrics.conflictAccuracy ?? "unavailable"} |`,
    `| Inconclusive rate | ${report.metrics.inconclusiveRate ?? "unavailable"} |`,
    "",
    "## Prefix and suffix separation",
    "",
    "| Trace | Prediction source | Retrospective evidence source | Prefix boundary line | Prefix rows | Suffix rows |",
    "| --- | --- | --- | ---: | ---: | ---: |",
  ];

  for (const evaluation of report.evaluations) {
    lines.push(`| ${evaluation.traceId} | ${evaluation.predictionSource} | ${evaluation.retrospectiveEvidenceSource} | ${evaluation.prefixBoundary.line} | ${evaluation.prefixContext.rowCount} | ${evaluation.suffixEvidence.rowCount} |`);
  }

  lines.push("", "## Unit verdicts", "", "| Trace | Unit | Verdict | Reasons |", "| --- | --- | --- | --- |");
  for (const evaluation of report.evaluations) {
    for (const unit of evaluation.unitResults) {
      lines.push(`| ${evaluation.traceId} | ${unit.unitId} | ${unit.verdict} | ${unit.reasons.map((reason) => reason.code).join(", ")} |`);
    }
  }

  lines.push("", "Insufficient trace evidence is scored as `inconclusive`, not safe.");
  return `${lines.join("\n")}\n`;
}

function mergeMetrics(evaluations) {
  return computeMetrics(evaluations.flatMap((evaluation) => evaluation.unitResults));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const traceFiles = args.tracePaths.flatMap(collectJsonl).sort();
  if (!traceFiles.length) throw new Error("no JSONL trace files found");
  const traces = traceFiles.map((source) => {
    const rows = readJsonl(source);
    return { traceId: traceIdFromRows(rows, source), rows, source };
  });
  const traceById = new Map(traces.map((trace) => [trace.traceId, trace]));
  const predictions = readJsonl(args.predictions).map(validatePredictionRow);
  if (!predictions.length) throw new Error(`${args.predictions}: no prediction artifacts found`);

  const evaluations = predictions.map((prediction) => {
    const trace = traceById.get(prediction.traceId);
    if (!trace) throw new Error(`${prediction.source}:${prediction.sourceLine}: trace ${prediction.traceId} field traceId: no matching trace input`);
    return evaluatePrediction(prediction, trace);
  }).sort((a, b) => a.traceId.localeCompare(b.traceId) || a.predictionId.localeCompare(b.predictionId));

  const report = {
    reportSchema: REPORT_SCHEMA,
    reportVersion: REPORT_VERSION,
    generatedAt: "deterministic-offline",
    offline: true,
    deterministic: true,
    evidenceScope: EVIDENCE_SCOPE,
    disclaimer: "Retrospective trace-derived planner reliability evidence only; not runtime TAT evidence.",
    traceInputs: traceFiles,
    predictionInput: args.predictions,
    traceCount: traces.length,
    predictionCount: predictions.length,
    evaluations,
    metrics: mergeMetrics(evaluations),
  };

  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(args.out, "summary.md"), buildMarkdown(report));
  console.log(`safe work unit eval passed (${report.metrics.totalUnits} units, safety precision ${report.metrics.safetyPrecision ?? "unavailable"})`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
