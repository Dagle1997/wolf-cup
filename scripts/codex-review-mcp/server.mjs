#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVER_NAME = "codex_review";
const SERVER_VERSION = "0.1.0";
const DEFAULT_MODEL = process.env.CODEX_REVIEW_MODEL || "gpt-5.2";
const DEFAULT_REASONING_EFFORT = process.env.CODEX_REVIEW_REASONING_EFFORT || "high";
const DEFAULT_MAX_FILES = clampInteger(process.env.CODEX_REVIEW_MAX_FILES, 12, 1, 50);
const DEFAULT_MAX_CHARS_PER_FILE = clampInteger(
  process.env.CODEX_REVIEW_MAX_CHARS_PER_FILE,
  30000,
  1000,
  100000,
);
const DEFAULT_OUTPUT_PATH = "_bmad-output/reviews/codex-review-latest.md";
const MAX_DIFF_CHARS = 40000;

const TOOL_NAME = "review_code";
const TOOL_DESCRIPTION =
  "Run an external Codex review on changed code or selected files and return concrete findings.";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".yarn",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "vendor",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  "",
  ".bat",
  ".c",
  ".cfg",
  ".cmd",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cjs",
  ".dart",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".php",
  ".prisma",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

const TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    review_request: {
      type: "string",
      description:
        "What should be reviewed, including story context, acceptance criteria, and focus areas.",
    },
    workspace_root: {
      type: "string",
      description:
        "Absolute or relative path to the project root. Defaults to the current working directory.",
    },
    paths: {
      type: "array",
      description:
        "Optional files or directories to review. Relative paths are resolved from workspace_root.",
      items: {
        type: "string",
      },
    },
    diff: {
      type: "string",
      description:
        "Optional unified diff or change summary to prioritize during review.",
    },
    model: {
      type: "string",
      description: "OpenAI model ID to use for the review.",
    },
    reasoning_effort: {
      type: "string",
      enum: ["none", "low", "medium", "high", "xhigh"],
      description: "Reasoning effort for supported OpenAI reasoning models.",
    },
    output_path: {
      type: "string",
      description:
        "Optional path for the review report. Defaults to _bmad-output/reviews/codex-review-latest.md.",
    },
    include_git_changes: {
      type: "boolean",
      description:
        "When true and no paths are provided, review files currently changed in git status.",
    },
    include_git_diff: {
      type: "boolean",
      description:
        "When true, include a focused git diff for the selected files when available.",
    },
    max_files: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Maximum number of files to include in the review context.",
    },
    max_chars_per_file: {
      type: "integer",
      minimum: 1000,
      maximum: 100000,
      description: "Maximum characters to read from each file.",
    },
  },
  required: ["review_request"],
};

const REVIEW_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
    },
    overall_risk: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          title: {
            type: "string",
          },
          file: {
            type: "string",
          },
          line_start: {
            type: "integer",
          },
          line_end: {
            type: ["integer", "null"],
          },
          why_it_matters: {
            type: "string",
          },
          fix_hint: {
            type: "string",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
        },
        required: [
          "severity",
          "title",
          "file",
          "line_start",
          "line_end",
          "why_it_matters",
          "fix_hint",
          "confidence",
        ],
      },
    },
    strengths: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  required: ["summary", "overall_risk", "findings", "strengths"],
};

const REVIEW_SYSTEM_PROMPT = [
  "You are Codex acting as a strict, evidence-first code reviewer.",
  "Review only the provided diff and file contents.",
  "Prioritize concrete bugs, regressions, missing validation, security issues, data loss risks, and missing tests.",
  "Avoid style nits unless they would likely cause maintenance or correctness problems.",
  "If no concrete findings are supported by the provided evidence, return an empty findings array.",
  "Use the provided line numbers when you cite files.",
].join(" ");

let framingMode = null;
let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput().catch((error) => {
    logError(error);
  });
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.stdin.resume();

async function drainInput() {
  while (true) {
    if (!inputBuffer.length) {
      return;
    }

    if (!framingMode) {
      framingMode = detectFramingMode(inputBuffer);
      if (!framingMode) {
        return;
      }
    }

    const rawMessage =
      framingMode === "content-length"
        ? readContentLengthMessage()
        : readNewlineDelimitedMessage();

    if (rawMessage === null) {
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      sendError(null, -32700, `Failed to parse JSON: ${error.message}`);
      continue;
    }

    try {
      await handleMessage(message);
    } catch (error) {
      logError(error);
      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        sendError(message.id, -32603, error.message || "Internal server error");
      }
    }
  }
}

function detectFramingMode(buffer) {
  const sample = buffer.toString("utf8");
  const trimmed = sample.trimStart();

  if (!trimmed.length) {
    return null;
  }

  if (/^Content-Length:/i.test(sample)) {
    return "content-length";
  }

  if (trimmed.startsWith("{")) {
    return "newline";
  }

  return null;
}

function readContentLengthMessage() {
  const headerEnd = findHeaderEnd(inputBuffer);
  if (headerEnd === -1) {
    return null;
  }

  const headerText = inputBuffer.subarray(0, headerEnd).toString("utf8");
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error("Missing Content-Length header.");
  }

  const contentLength = Number.parseInt(match[1], 10);
  const bodyStart = headerEnd + getHeaderSeparatorLength(inputBuffer, headerEnd);
  const bodyEnd = bodyStart + contentLength;

  if (inputBuffer.length < bodyEnd) {
    return null;
  }

  const message = inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
  inputBuffer = inputBuffer.subarray(bodyEnd);
  return message;
}

function findHeaderEnd(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf !== -1) {
    return crlf;
  }

  return buffer.indexOf("\n\n");
}

function getHeaderSeparatorLength(buffer, headerEnd) {
  if (buffer.subarray(headerEnd, headerEnd + 4).toString("utf8") === "\r\n\r\n") {
    return 4;
  }

  return 2;
}

function readNewlineDelimitedMessage() {
  const newlineIndex = inputBuffer.indexOf("\n");
  if (newlineIndex === -1) {
    return null;
  }

  const line = inputBuffer.subarray(0, newlineIndex).toString("utf8").trim();
  inputBuffer = inputBuffer.subarray(newlineIndex + 1);

  if (!line) {
    return readNewlineDelimitedMessage();
  }

  return line;
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== "2.0") {
    if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
      sendError(message.id, -32600, "Invalid JSON-RPC message.");
    }
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "method")) {
    return;
  }

  switch (message.method) {
    case "initialize":
      sendResult(message.id, {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    case "notifications/initialized":
      return;
    case "ping":
      sendResult(message.id, {});
      return;
    case "tools/list":
      sendResult(message.id, {
        tools: [
          {
            name: TOOL_NAME,
            description: TOOL_DESCRIPTION,
            inputSchema: TOOL_INPUT_SCHEMA,
          },
        ],
      });
      return;
    case "tools/call":
      await handleToolCall(message);
      return;
    default:
      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        sendError(message.id, -32601, `Method not found: ${message.method}`);
      }
  }
}

async function handleToolCall(message) {
  const name = message.params?.name;
  const args = message.params?.arguments ?? {};

  if (name !== TOOL_NAME) {
    sendResult(message.id, toolError(`Unknown tool: ${name}`));
    return;
  }

  const toolResult = await reviewCode(args);
  sendResult(message.id, toolResult);
}

async function reviewCode(args) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey.trim()) {
    return toolError(
      "OPENAI_API_KEY is not set. Set it before launching Claude Code so codex_review can call the OpenAI Responses API.",
    );
  }

  const reviewRequest =
    typeof args.review_request === "string" ? args.review_request.trim() : "";
  if (!reviewRequest) {
    return toolError("review_request is required.");
  }

  const workspaceRoot = path.resolve(args.workspace_root || process.cwd());
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : DEFAULT_MODEL;
  const reasoningEffort =
    typeof args.reasoning_effort === "string" && args.reasoning_effort.trim()
      ? args.reasoning_effort.trim()
      : DEFAULT_REASONING_EFFORT;
  const maxFiles = clampInteger(args.max_files, DEFAULT_MAX_FILES, 1, 50);
  const maxCharsPerFile = clampInteger(
    args.max_chars_per_file,
    DEFAULT_MAX_CHARS_PER_FILE,
    1000,
    100000,
  );
  const outputPath = resolveOutputPath(workspaceRoot, args.output_path);
  const requestedPaths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string" && value.trim())
    : [];
  const includeGitChanges = args.include_git_changes !== false;
  const includeGitDiff = args.include_git_diff !== false;

  const warnings = [];
  const selection = await gatherReviewTargets({
    workspaceRoot,
    requestedPaths,
    includeGitChanges,
    maxFiles,
    warnings,
  });

  const fileContext = await readFileContext({
    workspaceRoot,
    absolutePaths: selection.absolutePaths,
    maxFiles,
    maxCharsPerFile,
    warnings,
  });

  const diffText = buildDiffText({
    explicitDiff: typeof args.diff === "string" ? args.diff : "",
    workspaceRoot,
    relativePaths: fileContext.relativePaths,
    includeGitDiff,
    warnings,
  });

  if (!fileContext.files.length && !diffText) {
    return toolError("No reviewable file content or diff was found for the requested scope.");
  }

  const requestText = buildReviewRequest({
    reviewRequest,
    workspaceRoot,
    files: fileContext.files,
    diffText,
    warnings,
  });

  const review = await callOpenAI({
    apiKey,
    model,
    reasoningEffort,
    requestText,
  });

  const markdown = renderMarkdownReport({
    review,
    model,
    reasoningEffort,
    workspaceRoot,
    relativePaths: fileContext.relativePaths,
    warnings,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, "utf8");

  return {
    content: [
      {
        type: "text",
        text: renderToolSummary({
          review,
          model,
          reasoningEffort,
          relativePaths: fileContext.relativePaths,
          outputPath,
          warnings,
        }),
      },
    ],
    isError: false,
  };
}

async function gatherReviewTargets({
  workspaceRoot,
  requestedPaths,
  includeGitChanges,
  maxFiles,
  warnings,
}) {
  const absolutePaths = [];

  for (const requestedPath of requestedPaths) {
    const resolvedPath = path.resolve(workspaceRoot, requestedPath);
    const stat = await safeStat(resolvedPath);

    if (!stat) {
      warnings.push(`Requested path was not found: ${requestedPath}`);
      continue;
    }

    if (stat.isDirectory()) {
      await walkDirectory(resolvedPath, absolutePaths, maxFiles);
      continue;
    }

    if (stat.isFile()) {
      absolutePaths.push(resolvedPath);
    }
  }

  if (!absolutePaths.length && includeGitChanges) {
    absolutePaths.push(...getChangedFilesFromGit(workspaceRoot, maxFiles));
  }

  return {
    absolutePaths: uniquePaths(absolutePaths).slice(0, maxFiles),
  };
}

async function walkDirectory(directoryPath, collectedPaths, maxFiles) {
  if (collectedPaths.length >= maxFiles) {
    return;
  }

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (collectedPaths.length >= maxFiles) {
      return;
    }

    if (IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkDirectory(entryPath, collectedPaths, maxFiles);
      continue;
    }

    if (entry.isFile()) {
      collectedPaths.push(entryPath);
    }
  }
}

async function readFileContext({
  workspaceRoot,
  absolutePaths,
  maxFiles,
  maxCharsPerFile,
  warnings,
}) {
  const files = [];
  const relativePaths = [];

  for (const absolutePath of uniquePaths(absolutePaths)) {
    if (files.length >= maxFiles) {
      break;
    }

    const snippet = await readTextSnippet(absolutePath, maxCharsPerFile);
    if (!snippet) {
      warnings.push(`Skipped non-text or unreadable file: ${path.relative(workspaceRoot, absolutePath) || absolutePath}`);
      continue;
    }

    const relativePath = toPortablePath(path.relative(workspaceRoot, absolutePath) || path.basename(absolutePath));
    relativePaths.push(relativePath);
    files.push({
      absolutePath,
      relativePath,
      text: snippet.text,
      truncated: snippet.truncated,
    });

    if (snippet.truncated) {
      warnings.push(`Truncated file content for review: ${relativePath}`);
    }
  }

  return { files, relativePaths };
}

async function readTextSnippet(filePath, maxChars) {
  try {
    const buffer = await fs.readFile(filePath);
    if (isProbablyBinary(filePath, buffer)) {
      return null;
    }

    const text = buffer.toString("utf8");
    if (text.length <= maxChars) {
      return { text, truncated: false };
    }

    return {
      text: `${text.slice(0, maxChars)}\n...[truncated]...`,
      truncated: true,
    };
  } catch {
    return null;
  }
}

function isProbablyBinary(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  const probe = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (probe.includes(0)) {
    return true;
  }

  let suspiciousBytes = 0;
  for (const byte of probe) {
    const isControl = byte < 7 || (byte > 14 && byte < 32);
    if (isControl) {
      suspiciousBytes += 1;
    }
  }

  return probe.length > 0 && suspiciousBytes / probe.length > 0.05;
}

function getChangedFilesFromGit(workspaceRoot, maxFiles) {
  const result = runGit(workspaceRoot, ["status", "--porcelain", "--untracked-files=all"]);
  if (!result.ok || !result.stdout.trim()) {
    return [];
  }

  const changedPaths = [];
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (changedPaths.length >= maxFiles) {
      break;
    }

    let entryPath = line.slice(3).trim();
    if (!entryPath) {
      continue;
    }

    if (entryPath.includes(" -> ")) {
      entryPath = entryPath.split(" -> ").at(-1).trim();
    }

    const absolutePath = path.resolve(workspaceRoot, entryPath);
    if (pathExists(absolutePath)) {
      changedPaths.push(absolutePath);
    }
  }

  return changedPaths;
}

function buildDiffText({ explicitDiff, workspaceRoot, relativePaths, includeGitDiff, warnings }) {
  const sections = [];

  if (explicitDiff.trim()) {
    sections.push(trimToLength(explicitDiff.trim(), MAX_DIFF_CHARS));
  }

  if (!includeGitDiff || !relativePaths.length) {
    return sections.join("\n\n");
  }

  const result = runGit(workspaceRoot, ["diff", "--unified=3", "--", ...relativePaths]);
  if (!result.ok) {
    warnings.push("Git diff could not be loaded for the selected files.");
    return sections.join("\n\n");
  }

  const diff = result.stdout.trim();
  if (!diff) {
    return sections.join("\n\n");
  }

  if (diff.length > MAX_DIFF_CHARS) {
    warnings.push("Git diff was truncated for the review request.");
  }

  sections.push(trimToLength(diff, MAX_DIFF_CHARS));
  return sections.join("\n\n");
}

function buildReviewRequest({ reviewRequest, workspaceRoot, files, diffText, warnings }) {
  const sections = [
    "Review request:",
    reviewRequest.trim(),
    "",
    `Workspace root: ${workspaceRoot}`,
  ];

  if (diffText) {
    sections.push("", "Git diff:", "```diff", diffText, "```");
  }

  for (const file of files) {
    sections.push(
      "",
      `File: ${file.relativePath}`,
      "```text",
      addLineNumbers(file.text),
      "```",
    );
  }

  if (warnings.length) {
    sections.push("", "Context warnings:", ...warnings.map((warning) => `- ${warning}`));
  }

  return sections.join("\n");
}

function addLineNumbers(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => `${String(index + 1).padStart(5, " ")} | ${line}`)
    .join("\n");
}

async function callOpenAI({ apiKey, model, reasoningEffort, requestText }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: {
        effort: reasoningEffort,
      },
      input: [
        {
          role: "system",
          content: REVIEW_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: requestText,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "codex_review_report",
          strict: true,
          schema: REVIEW_RESPONSE_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractOpenAIError(payload, response.status));
  }

  const outputText = extractOutputText(payload);
  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON for the review report: ${error.message}`);
  }
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI returned an empty response.");
  }

  const contentItems = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      contentItems.push(content);
    }
  }

  const refusal = contentItems.find((item) => typeof item.refusal === "string")?.refusal;
  if (refusal) {
    throw new Error(`OpenAI refused the review request: ${refusal}`);
  }

  const text = contentItems
    .filter((item) => typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI returned no review text.");
  }

  return text;
}

function extractOpenAIError(payload, statusCode) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    `OpenAI request failed with status ${statusCode}.`;
  return message;
}

function renderMarkdownReport({
  review,
  model,
  reasoningEffort,
  workspaceRoot,
  relativePaths,
  warnings,
}) {
  const lines = [
    "# Codex Review",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Model: ${model}`,
    `- Reasoning effort: ${reasoningEffort}`,
    `- Workspace root: ${workspaceRoot}`,
    `- Reviewed files: ${relativePaths.length ? relativePaths.join(", ") : "(diff-only review)"}`,
    "",
    "## Summary",
    "",
    review.summary,
    "",
    `Overall risk: ${review.overall_risk}`,
    "",
    "## Findings",
    "",
  ];

  if (!review.findings.length) {
    lines.push("No concrete findings were identified from the supplied evidence.", "");
  } else {
    review.findings.forEach((finding, index) => {
      const lineRange =
        typeof finding.line_end === "number" && finding.line_end !== finding.line_start
          ? `${finding.line_start}-${finding.line_end}`
          : `${finding.line_start}`;

      lines.push(
        `${index + 1}. [${finding.severity}] ${finding.title}`,
        `   - File: ${finding.file}:${lineRange}`,
        `   - Confidence: ${finding.confidence}`,
        `   - Why it matters: ${finding.why_it_matters}`,
        `   - Suggested fix: ${finding.fix_hint}`,
        "",
      );
    });
  }

  lines.push("## Strengths", "");

  if (!review.strengths.length) {
    lines.push("No strengths were highlighted.", "");
  } else {
    review.strengths.forEach((strength) => {
      lines.push(`- ${strength}`);
    });
    lines.push("");
  }

  lines.push("## Warnings", "");

  if (!warnings.length) {
    lines.push("None.");
  } else {
    warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  lines.push("");
  return lines.join("\n");
}

function renderToolSummary({
  review,
  model,
  reasoningEffort,
  relativePaths,
  outputPath,
  warnings,
}) {
  const lines = [
    `Codex review complete with ${model} (${reasoningEffort}).`,
    `Report: ${outputPath}`,
    `Reviewed: ${relativePaths.length ? relativePaths.join(", ") : "(diff-only review)"}`,
    "",
  ];

  if (!review.findings.length) {
    lines.push("No concrete findings were identified.");
  } else {
    lines.push("Findings:");
    review.findings.forEach((finding, index) => {
      const lineRange =
        typeof finding.line_end === "number" && finding.line_end !== finding.line_start
          ? `${finding.line_start}-${finding.line_end}`
          : `${finding.line_start}`;
      lines.push(
        `${index + 1}. [${finding.severity}] ${finding.title} (${finding.file}:${lineRange})`,
      );
    });
  }

  lines.push("", `Summary: ${review.summary}`);

  if (warnings.length) {
    lines.push("", "Warnings:");
    warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  return lines.join("\n");
}

function resolveOutputPath(workspaceRoot, outputPath) {
  if (typeof outputPath === "string" && outputPath.trim()) {
    return path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(workspaceRoot, outputPath);
  }

  return path.resolve(workspaceRoot, DEFAULT_OUTPUT_PATH);
}

function runGit(workspaceRoot, args) {
  const result = spawnSync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function toolError(message) {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
  };
}

function sendResult(id, result) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function sendError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function writeMessage(message) {
  const payload = JSON.stringify(message);

  if (framingMode === "content-length") {
    const contentLength = Buffer.byteLength(payload, "utf8");
    process.stdout.write(`Content-Length: ${contentLength}\r\n\r\n${payload}`);
    return;
  }

  process.stdout.write(`${payload}\n`);
}

function logError(error) {
  console.error(`[${SERVER_NAME}] ${error?.stack || error}`);
}

async function safeStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

function pathExists(targetPath) {
  return existsSync(targetPath);
}

function uniquePaths(paths) {
  return [...new Set(paths)];
}

function trimToLength(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n...[truncated]...`;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}
