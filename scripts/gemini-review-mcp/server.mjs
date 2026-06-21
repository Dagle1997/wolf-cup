#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PDF_EXTRACTOR_SCRIPT = path.join(SERVER_DIR, "extract_pdf.py");

const SERVER_NAME = "gemini_review";
const SERVER_VERSION = "0.1.0";
const DEFAULT_MODEL = process.env.GEMINI_REVIEW_MODEL || "gemini-pro-latest";
const DEFAULT_REASONING_EFFORT = process.env.GEMINI_REVIEW_REASONING_EFFORT || "high";
const DEFAULT_MAX_FILES = clampInteger(process.env.GEMINI_REVIEW_MAX_FILES, 12, 1, 50);
const DEFAULT_MAX_CHARS_PER_FILE = clampInteger(
  process.env.GEMINI_REVIEW_MAX_CHARS_PER_FILE,
  30000,
  1000,
  100000,
);
const DEFAULT_OUTPUT_PATH = "_bmad-output/reviews/gemini-review-latest.md";
const MAX_DIFF_CHARS = 40000;

const TOOL_NAME = "review_code";
const TOOL_DESCRIPTION =
  "Run an external Gemini review on changed code or selected files and return concrete findings.";

const CRITIQUE_TOOL_NAME = "critique_review";
const CRITIQUE_TOOL_DESCRIPTION =
  "Debate mode: critique another reviewer's findings (typically from codex_review). Returns per-finding stances (agree/partial/disagree/theoretical/missing_evidence), any net-new findings Gemini catches that the prior reviewer missed, and a ship/hold/escalate verdict. Use after running review_code on both Codex and Gemini for high-stakes external comms.";
const CRITIQUE_DEFAULT_OUTPUT_PATH = "_bmad-output/reviews/gemini-critique-latest.md";

const SYNTHESIZE_TOOL_NAME = "synthesize_reviews";
const SYNTHESIZE_TOOL_DESCRIPTION =
  "Final stage of the debate ensemble. Takes 2+ prior outputs (reviews and/or critiques) from different reviewers and produces a single unified consensus report: high-confidence findings (where reviewers agreed), divergent findings (where they disagreed and must be resolved), dismissed findings (theoretical/wrong), a prioritized action list, and a ship/hold/escalate verdict with confidence level. Run after review_code (both servers) and critique_review.";
const SYNTHESIZE_DEFAULT_OUTPUT_PATH = "_bmad-output/reviews/gemini-synthesis-latest.md";

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
      description: "Gemini model ID to use for the review (e.g. gemini-2.5-pro, gemini-2.5-flash).",
    },
    reasoning_effort: {
      type: "string",
      enum: ["none", "low", "medium", "high", "xhigh"],
      description:
        "Reasoning effort. Mapped to Gemini thinkingBudget: none=0, low=2048, medium=8192, high=16384, xhigh=32768.",
    },
    output_path: {
      type: "string",
      description:
        "Optional path for the review report. Defaults to _bmad-output/reviews/gemini-review-latest.md.",
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

// Gemini structured-output schema. Uses OpenAPI 3.0 conventions:
// - no `additionalProperties`
// - nullable via `nullable: true` instead of `type: ["x", "null"]`
const REVIEW_RESPONSE_SCHEMA = {
  type: "object",
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
            type: "integer",
            nullable: true,
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
  "You are Gemini acting as a strict, evidence-first code reviewer.",
  "Review only the provided diff and file contents.",
  "Prioritize concrete bugs, regressions, missing validation, security issues, data loss risks, and missing tests.",
  "Avoid style nits unless they would likely cause maintenance or correctness problems.",
  "If no concrete findings are supported by the provided evidence, return an empty findings array.",
  "Use the provided line numbers when you cite files.",
].join(" ");

const REASONING_TO_THINKING_BUDGET = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
};

const CRITIQUE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    review_request: {
      type: "string",
      description:
        "The original review request context (what was being reviewed, acceptance criteria, focus areas).",
    },
    prior_review: {
      type: "string",
      description:
        "Full text of the prior reviewer's report (typically the contents of _bmad-output/reviews/codex-review-latest.md or a paste of their findings).",
    },
    prior_reviewer: {
      type: "string",
      description:
        "Label for the prior reviewer (e.g. 'gpt-5.2', 'claude', 'human-josh'). Used in the output report header.",
    },
    workspace_root: {
      type: "string",
      description:
        "Absolute or relative path to the project root. Defaults to the current working directory.",
    },
    paths: {
      type: "array",
      description:
        "Optional files or directories to include as evidence for the critique. Relative paths are resolved from workspace_root.",
      items: { type: "string" },
    },
    diff: {
      type: "string",
      description: "Optional unified diff or change summary to include as evidence.",
    },
    model: {
      type: "string",
      description: "Gemini model ID to use for the critique.",
    },
    reasoning_effort: {
      type: "string",
      enum: ["none", "low", "medium", "high", "xhigh"],
      description:
        "Reasoning effort. Mapped to Gemini thinkingBudget: none=0, low=2048, medium=8192, high=16384, xhigh=32768.",
    },
    output_path: {
      type: "string",
      description:
        "Optional path for the critique report. Defaults to _bmad-output/reviews/gemini-critique-latest.md.",
    },
    include_git_changes: {
      type: "boolean",
      description:
        "When true and no paths are provided, include files currently changed in git status as evidence.",
    },
    include_git_diff: {
      type: "boolean",
      description:
        "When true, include a focused git diff for the selected files as evidence.",
    },
    max_files: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Maximum number of evidence files to include.",
    },
    max_chars_per_file: {
      type: "integer",
      minimum: 1000,
      maximum: 100000,
      description: "Maximum characters to read from each evidence file.",
    },
  },
  required: ["review_request", "prior_review"],
};

// Gemini critique-response schema. Uses OpenAPI 3.0 conventions:
// no additionalProperties; nullable: true instead of type: ["x", "null"].
const CRITIQUE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    overall_agreement: {
      type: "string",
      enum: ["high", "partial", "low"],
    },
    verdict: {
      type: "string",
      enum: ["ship", "hold", "escalate"],
    },
    critiques: {
      type: "array",
      items: {
        type: "object",
        properties: {
          of_finding: { type: "string" },
          stance: {
            type: "string",
            enum: ["agree", "partial", "disagree", "theoretical", "missing_evidence"],
          },
          reasoning: { type: "string" },
        },
        required: ["of_finding", "stance", "reasoning"],
      },
    },
    additional_findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          title: { type: "string" },
          file: { type: "string" },
          line_start: { type: "integer" },
          line_end: { type: "integer", nullable: true },
          why_it_matters: { type: "string" },
          fix_hint: { type: "string" },
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
          "why_it_matters",
          "fix_hint",
          "confidence",
        ],
      },
    },
    consensus_recommendations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "summary",
    "overall_agreement",
    "verdict",
    "critiques",
    "additional_findings",
    "consensus_recommendations",
  ],
};

const SYNTHESIZE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    review_request: {
      type: "string",
      description: "The original review request context being synthesized across.",
    },
    prior_outputs: {
      type: "array",
      minItems: 2,
      description:
        "Two or more prior outputs to synthesize. Each is a labeled report from a reviewer or critique step.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: {
            type: "string",
            description: "Label identifying the source — e.g. 'codex-review', 'gemini-review', 'codex-critique-of-gemini', 'human-josh'.",
          },
          content: {
            type: "string",
            description: "Full text of the report.",
          },
        },
        required: ["source", "content"],
      },
    },
    workspace_root: { type: "string" },
    paths: { type: "array", items: { type: "string" } },
    diff: { type: "string" },
    model: { type: "string" },
    reasoning_effort: {
      type: "string",
      enum: ["none", "low", "medium", "high", "xhigh"],
    },
    output_path: { type: "string" },
    include_git_changes: { type: "boolean" },
    include_git_diff: { type: "boolean" },
    max_files: { type: "integer", minimum: 1, maximum: 50 },
    max_chars_per_file: { type: "integer", minimum: 1000, maximum: 100000 },
  },
  required: ["review_request", "prior_outputs"],
};

// Gemini synthesis-response schema. OpenAPI 3.0: no additionalProperties; nullable: true.
const SYNTHESIZE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    executive_summary: { type: "string" },
    verdict: {
      type: "string",
      enum: ["ship", "hold", "escalate"],
    },
    confidence_level: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    high_confidence_findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          file: { type: "string" },
          summary: { type: "string" },
          sources_agreeing: {
            type: "array",
            items: { type: "string" },
          },
          recommended_action: { type: "string" },
        },
        required: ["title", "severity", "file", "summary", "sources_agreeing", "recommended_action"],
      },
    },
    divergent_findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          positions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                stance: { type: "string" },
                reasoning: { type: "string" },
              },
              required: ["source", "stance", "reasoning"],
            },
          },
          synthesizer_lean: { type: "string" },
        },
        required: ["title", "summary", "positions", "synthesizer_lean"],
      },
    },
    dismissed_findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          raised_by: { type: "string" },
          dismissal_reason: {
            type: "string",
            enum: ["theoretical", "missing_evidence", "disagreed_with_justification", "duplicate"],
          },
          reasoning: { type: "string" },
        },
        required: ["title", "raised_by", "dismissal_reason", "reasoning"],
      },
    },
    prioritized_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            enum: ["must_fix_before_send", "should_fix", "optional"],
          },
          action: { type: "string" },
        },
        required: ["priority", "action"],
      },
    },
    open_questions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "executive_summary",
    "verdict",
    "confidence_level",
    "high_confidence_findings",
    "divergent_findings",
    "dismissed_findings",
    "prioritized_actions",
    "open_questions",
  ],
};

const SYNTHESIZE_SYSTEM_PROMPT = [
  "You are Gemini acting as a tribunal synthesizer at the end of a multi-model debate.",
  "Multiple reviewers (and possibly critiques of those reviews) have produced reports on the same material; those reports are in the user message, each labeled with a source.",
  "Your job is NOT to add new reviewing — it is to consolidate what's already on the table into a single decision-ready output.",
  "Produce:",
  "  - executive_summary: 2-4 sentences. What is being decided, and what is your verdict.",
  "  - verdict: ship | hold | escalate. Ship = safe with at most low-priority cleanups. Hold = must-fix items exist. Escalate = needs human/lawyer/auditor judgment.",
  "  - confidence_level: how confident the synthesizer is in the verdict given reviewer agreement and evidence strength.",
  "  - high_confidence_findings: findings raised by 2+ reviewers, or raised by one and affirmed by a critique. List sources_agreeing.",
  "  - divergent_findings: findings where reviewers disagreed. Quote positions and offer a synthesizer_lean if one side is more defensible.",
  "  - dismissed_findings: findings raised but dismissed for clear reason (theoretical, missing evidence, refuted by critique, duplicate).",
  "  - prioritized_actions: concrete pre-send/pre-merge actions. Use must_fix_before_send sparingly.",
  "  - open_questions: items the synthesizer cannot resolve from the supplied evidence.",
  "Be decisive. If reviewers agreed, say so explicitly. If they disagreed, take a lean and explain it — don't hide behind 'both have merit'.",
  "Cite source labels in your reasoning so claims can be traced.",
].join(" ");

const CRITIQUE_SYSTEM_PROMPT = [
  "You are Gemini acting as a second-opinion reviewer in a debate.",
  "Another reviewer has produced a review of the same material; that review is in the user message.",
  "For each finding the prior reviewer raised, take an explicit stance:",
  "  - agree: real risk, holds up under scrutiny against the evidence.",
  "  - partial: the underlying concern is real but the framing, severity, or remediation is off.",
  "  - disagree: not actually a risk in this context; explain what they missed.",
  "  - theoretical: a legal/discovery framing without concrete operational risk. Note this when the cost of mitigating is higher than the marginal risk reduction.",
  "  - missing_evidence: prior reviewer asserted something the supplied evidence does not support.",
  "Then list any additional findings the prior reviewer missed (use the same finding schema).",
  "Finally, provide a verdict:",
  "  - ship: safe to send/merge as-is or with the critique-flagged tightenings.",
  "  - hold: do not send/merge until findings are addressed.",
  "  - escalate: this needs a third opinion (human, lawyer, or another model).",
  "Be direct. Do not capitulate to the prior reviewer just to avoid conflict — if a finding is theoretical or wrong, say so with reasoning.",
  "If the prior reviewer was substantially correct, say that explicitly and keep the critiques short.",
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
          {
            name: CRITIQUE_TOOL_NAME,
            description: CRITIQUE_TOOL_DESCRIPTION,
            inputSchema: CRITIQUE_INPUT_SCHEMA,
          },
          {
            name: SYNTHESIZE_TOOL_NAME,
            description: SYNTHESIZE_TOOL_DESCRIPTION,
            inputSchema: SYNTHESIZE_INPUT_SCHEMA,
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

  let toolResult;
  if (name === TOOL_NAME) {
    toolResult = await reviewCode(args);
  } else if (name === CRITIQUE_TOOL_NAME) {
    toolResult = await critiqueReview(args);
  } else if (name === SYNTHESIZE_TOOL_NAME) {
    toolResult = await synthesizeReviews(args);
  } else {
    toolResult = toolError(`Unknown tool: ${name}`);
  }

  sendResult(message.id, toolResult);
}

async function reviewCode(args) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    return toolError(
      "GEMINI_API_KEY is not set. Set it before launching Claude Code so gemini_review can call the Gemini API. Get a free key at https://aistudio.google.com/apikey.",
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

  const review = await callGemini({
    apiKey,
    model,
    reasoningEffort,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    requestText,
    schema: REVIEW_RESPONSE_SCHEMA,
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

async function critiqueReview(args) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    return toolError(
      "GEMINI_API_KEY is not set. Set it before launching Claude Code so gemini_review can call the Gemini API.",
    );
  }

  const reviewRequest =
    typeof args.review_request === "string" ? args.review_request.trim() : "";
  if (!reviewRequest) {
    return toolError("review_request is required.");
  }

  const priorReview = typeof args.prior_review === "string" ? args.prior_review.trim() : "";
  if (!priorReview) {
    return toolError("prior_review is required (paste the prior reviewer's report text).");
  }

  const priorReviewer =
    typeof args.prior_reviewer === "string" && args.prior_reviewer.trim()
      ? args.prior_reviewer.trim()
      : "unknown";

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
  const outputPath = resolveOutputPath(workspaceRoot, args.output_path, CRITIQUE_DEFAULT_OUTPUT_PATH);
  const requestedPaths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string" && value.trim())
    : [];
  const includeGitChanges = args.include_git_changes === true;
  const includeGitDiff = args.include_git_diff === true;

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

  const requestText = buildCritiqueRequest({
    reviewRequest,
    priorReview,
    priorReviewer,
    workspaceRoot,
    files: fileContext.files,
    diffText,
    warnings,
  });

  const critique = await callGemini({
    apiKey,
    model,
    reasoningEffort,
    systemPrompt: CRITIQUE_SYSTEM_PROMPT,
    requestText,
    schema: CRITIQUE_RESPONSE_SCHEMA,
  });

  const markdown = renderCritiqueMarkdownReport({
    critique,
    priorReviewer,
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
        text: renderCritiqueToolSummary({
          critique,
          priorReviewer,
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

async function synthesizeReviews(args) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) {
    return toolError(
      "GEMINI_API_KEY is not set. Set it before launching Claude Code so gemini_review can call the Gemini API.",
    );
  }

  const reviewRequest =
    typeof args.review_request === "string" ? args.review_request.trim() : "";
  if (!reviewRequest) {
    return toolError("review_request is required.");
  }

  if (!Array.isArray(args.prior_outputs) || args.prior_outputs.length < 2) {
    return toolError("prior_outputs must be an array of at least 2 reviewer reports.");
  }

  const priorOutputs = args.prior_outputs
    .filter(
      (entry) =>
        entry &&
        typeof entry.source === "string" &&
        entry.source.trim() &&
        typeof entry.content === "string" &&
        entry.content.trim(),
    )
    .map((entry) => ({ source: entry.source.trim(), content: entry.content.trim() }));

  if (priorOutputs.length < 2) {
    return toolError(
      "prior_outputs must contain at least 2 entries with non-empty source and content fields.",
    );
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
  const outputPath = resolveOutputPath(workspaceRoot, args.output_path, SYNTHESIZE_DEFAULT_OUTPUT_PATH);
  const requestedPaths = Array.isArray(args.paths)
    ? args.paths.filter((value) => typeof value === "string" && value.trim())
    : [];
  const includeGitChanges = args.include_git_changes === true;
  const includeGitDiff = args.include_git_diff === true;

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

  const requestText = buildSynthesisRequest({
    reviewRequest,
    priorOutputs,
    workspaceRoot,
    files: fileContext.files,
    diffText,
    warnings,
  });

  const synthesis = await callGemini({
    apiKey,
    model,
    reasoningEffort,
    systemPrompt: SYNTHESIZE_SYSTEM_PROMPT,
    requestText,
    schema: SYNTHESIZE_RESPONSE_SCHEMA,
  });

  const markdown = renderSynthesisMarkdownReport({
    synthesis,
    priorOutputs,
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
        text: renderSynthesisToolSummary({
          synthesis,
          priorOutputs,
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

function buildSynthesisRequest({
  reviewRequest,
  priorOutputs,
  workspaceRoot,
  files,
  diffText,
  warnings,
}) {
  const sections = [
    "Original review request:",
    reviewRequest.trim(),
    "",
    `Workspace root: ${workspaceRoot}`,
    "",
    `Prior outputs to synthesize (${priorOutputs.length}):`,
  ];

  priorOutputs.forEach((entry, index) => {
    sections.push(
      "",
      `--- Source ${index + 1} of ${priorOutputs.length}: ${entry.source} ---`,
      "```markdown",
      entry.content,
      "```",
    );
  });

  if (diffText) {
    sections.push("", "Git diff (evidence):", "```diff", diffText, "```");
  }

  for (const file of files) {
    sections.push(
      "",
      `File (evidence): ${file.relativePath}`,
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

function renderSynthesisMarkdownReport({
  synthesis,
  priorOutputs,
  model,
  reasoningEffort,
  workspaceRoot,
  relativePaths,
  warnings,
}) {
  const lines = [
    "# Gemini Synthesis (Debate Tribunal)",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Synthesized sources: ${priorOutputs.map((p) => p.source).join(", ")}`,
    `- Model: ${model}`,
    `- Reasoning effort: ${reasoningEffort}`,
    `- Workspace root: ${workspaceRoot}`,
    `- Evidence files: ${relativePaths.length ? relativePaths.join(", ") : "(prior outputs only)"}`,
    "",
    "## Verdict",
    "",
    `**${synthesis.verdict.toUpperCase()}** — confidence: ${synthesis.confidence_level}`,
    "",
    "## Executive summary",
    "",
    synthesis.executive_summary,
    "",
    "## High-confidence findings (consensus)",
    "",
  ];

  if (!synthesis.high_confidence_findings.length) {
    lines.push("No high-confidence findings.", "");
  } else {
    synthesis.high_confidence_findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. [${finding.severity}] ${finding.title}`,
        `   - File: ${finding.file}`,
        `   - Affirming sources: ${finding.sources_agreeing.join(", ")}`,
        `   - Summary: ${finding.summary}`,
        `   - Recommended action: ${finding.recommended_action}`,
        "",
      );
    });
  }

  lines.push("## Divergent findings (need resolution)", "");

  if (!synthesis.divergent_findings.length) {
    lines.push("No divergence — reviewers agreed.", "");
  } else {
    synthesis.divergent_findings.forEach((finding, index) => {
      lines.push(`${index + 1}. ${finding.title}`, `   - ${finding.summary}`, "   - Positions:");
      finding.positions.forEach((position) => {
        lines.push(`     - **${position.source}** (${position.stance}): ${position.reasoning}`);
      });
      lines.push(`   - Synthesizer lean: ${finding.synthesizer_lean}`, "");
    });
  }

  lines.push("## Dismissed findings", "");

  if (!synthesis.dismissed_findings.length) {
    lines.push("No findings dismissed.", "");
  } else {
    synthesis.dismissed_findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. ${finding.title}`,
        `   - Raised by: ${finding.raised_by}`,
        `   - Dismissal reason: ${finding.dismissal_reason}`,
        `   - Reasoning: ${finding.reasoning}`,
        "",
      );
    });
  }

  lines.push("## Prioritized actions", "");

  if (!synthesis.prioritized_actions.length) {
    lines.push("No actions required.", "");
  } else {
    synthesis.prioritized_actions.forEach((entry, index) => {
      lines.push(`${index + 1}. [${entry.priority}] ${entry.action}`);
    });
    lines.push("");
  }

  lines.push("## Open questions (for human judgment)", "");

  if (!synthesis.open_questions.length) {
    lines.push("None.", "");
  } else {
    synthesis.open_questions.forEach((question) => {
      lines.push(`- ${question}`);
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

function renderSynthesisToolSummary({
  synthesis,
  priorOutputs,
  model,
  reasoningEffort,
  relativePaths,
  outputPath,
  warnings,
}) {
  const lines = [
    `Gemini synthesis complete with ${model} (${reasoningEffort}).`,
    `Verdict: ${synthesis.verdict.toUpperCase()} (confidence: ${synthesis.confidence_level})`,
    `Sources: ${priorOutputs.map((p) => p.source).join(", ")}`,
    `Report: ${outputPath}`,
    `Evidence: ${relativePaths.length ? relativePaths.join(", ") : "(prior outputs only)"}`,
    "",
    `Executive summary: ${synthesis.executive_summary}`,
    "",
  ];

  if (synthesis.high_confidence_findings.length) {
    lines.push("High-confidence findings:");
    synthesis.high_confidence_findings.forEach((finding, index) => {
      lines.push(`${index + 1}. [${finding.severity}] ${finding.title}`);
    });
    lines.push("");
  }

  if (synthesis.divergent_findings.length) {
    lines.push("Divergent findings (need resolution):");
    synthesis.divergent_findings.forEach((finding, index) => {
      lines.push(`${index + 1}. ${finding.title}`);
    });
    lines.push("");
  }

  if (synthesis.prioritized_actions.length) {
    lines.push("Actions:");
    synthesis.prioritized_actions.forEach((entry, index) => {
      lines.push(`${index + 1}. [${entry.priority}] ${entry.action}`);
    });
    lines.push("");
  }

  if (synthesis.open_questions.length) {
    lines.push("Open questions:");
    synthesis.open_questions.forEach((q) => {
      lines.push(`- ${q}`);
    });
  }

  if (warnings.length) {
    lines.push("", "Warnings:");
    warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  return lines.join("\n");
}

function buildCritiqueRequest({
  reviewRequest,
  priorReview,
  priorReviewer,
  workspaceRoot,
  files,
  diffText,
  warnings,
}) {
  const sections = [
    "Original review request:",
    reviewRequest.trim(),
    "",
    `Workspace root: ${workspaceRoot}`,
    "",
    `Prior reviewer: ${priorReviewer}`,
    "",
    "Prior review (this is what you are critiquing):",
    "```markdown",
    priorReview.trim(),
    "```",
  ];

  if (diffText) {
    sections.push("", "Git diff (evidence):", "```diff", diffText, "```");
  }

  for (const file of files) {
    sections.push(
      "",
      `File (evidence): ${file.relativePath}`,
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

function renderCritiqueMarkdownReport({
  critique,
  priorReviewer,
  model,
  reasoningEffort,
  workspaceRoot,
  relativePaths,
  warnings,
}) {
  const lines = [
    "# Gemini Critique",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Critiquing: ${priorReviewer}`,
    `- Model: ${model}`,
    `- Reasoning effort: ${reasoningEffort}`,
    `- Workspace root: ${workspaceRoot}`,
    `- Evidence files: ${relativePaths.length ? relativePaths.join(", ") : "(prior review only)"}`,
    "",
    "## Verdict",
    "",
    `**${critique.verdict.toUpperCase()}** — overall agreement: ${critique.overall_agreement}`,
    "",
    "## Summary",
    "",
    critique.summary,
    "",
    "## Critiques of prior findings",
    "",
  ];

  if (!critique.critiques.length) {
    lines.push("Prior reviewer raised no findings to critique.", "");
  } else {
    critique.critiques.forEach((entry, index) => {
      lines.push(
        `${index + 1}. [${entry.stance}] ${entry.of_finding}`,
        `   - Reasoning: ${entry.reasoning}`,
        "",
      );
    });
  }

  lines.push("## Additional findings (Gemini caught, prior reviewer missed)", "");

  if (!critique.additional_findings.length) {
    lines.push("No additional findings.", "");
  } else {
    critique.additional_findings.forEach((finding, index) => {
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

  lines.push("## Consensus recommendations", "");

  if (!critique.consensus_recommendations.length) {
    lines.push("None.", "");
  } else {
    critique.consensus_recommendations.forEach((rec) => {
      lines.push(`- ${rec}`);
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

function renderCritiqueToolSummary({
  critique,
  priorReviewer,
  model,
  reasoningEffort,
  relativePaths,
  outputPath,
  warnings,
}) {
  const lines = [
    `Gemini critique of ${priorReviewer} complete with ${model} (${reasoningEffort}).`,
    `Verdict: ${critique.verdict.toUpperCase()} (agreement: ${critique.overall_agreement})`,
    `Report: ${outputPath}`,
    `Evidence: ${relativePaths.length ? relativePaths.join(", ") : "(prior review only)"}`,
    "",
  ];

  if (critique.critiques.length) {
    lines.push("Stances on prior findings:");
    critique.critiques.forEach((entry, index) => {
      lines.push(`${index + 1}. [${entry.stance}] ${entry.of_finding}`);
    });
    lines.push("");
  }

  if (critique.additional_findings.length) {
    lines.push("Additional findings (prior reviewer missed):");
    critique.additional_findings.forEach((finding, index) => {
      const lineRange =
        typeof finding.line_end === "number" && finding.line_end !== finding.line_start
          ? `${finding.line_start}-${finding.line_end}`
          : `${finding.line_start}`;
      lines.push(`${index + 1}. [${finding.severity}] ${finding.title} (${finding.file}:${lineRange})`);
    });
    lines.push("");
  }

  lines.push(`Summary: ${critique.summary}`);

  if (warnings.length) {
    lines.push("", "Warnings:");
    warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
  }

  return lines.join("\n");
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

    const snippet = await readTextSnippet(absolutePath, maxCharsPerFile, workspaceRoot);
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

async function readTextSnippet(filePath, maxChars, workspaceRoot) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    const extracted = extractPdfText(filePath, workspaceRoot);
    if (extracted == null) {
      return null;
    }
    if (extracted.length <= maxChars) {
      return { text: extracted, truncated: false };
    }
    return {
      text: `${extracted.slice(0, maxChars)}\n...[truncated]...`,
      truncated: true,
    };
  }

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

function extractPdfText(pdfPath, workspaceRoot) {
  const candidates = resolvePythonCandidates(workspaceRoot);
  for (const pythonPath of candidates) {
    const result = spawnSync(pythonPath, [PDF_EXTRACTOR_SCRIPT, pdfPath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status === 0) {
      return result.stdout || "";
    }
    if (result.status !== 2) {
      return null;
    }
  }
  return null;
}

function resolvePythonCandidates(workspaceRoot) {
  const candidates = [];
  if (process.env.GEMINI_REVIEW_PYTHON) {
    candidates.push(process.env.GEMINI_REVIEW_PYTHON);
  }
  if (process.env.CODEX_REVIEW_PYTHON) {
    candidates.push(process.env.CODEX_REVIEW_PYTHON);
  }
  const venvBases = [
    path.join(workspaceRoot, "db_toolkit", "venv"),
    path.join(workspaceRoot, "db_toolkit", ".venv"),
  ];
  for (const base of venvBases) {
    const winPython = path.join(base, "Scripts", "python.exe");
    const unixPython = path.join(base, "bin", "python");
    if (existsSync(winPython)) candidates.push(winPython);
    if (existsSync(unixPython)) candidates.push(unixPython);
  }
  candidates.push(process.platform === "win32" ? "python" : "python3");
  return candidates;
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

async function callGemini({ apiKey, model, reasoningEffort, systemPrompt, requestText, schema }) {
  const thinkingBudget =
    REASONING_TO_THINKING_BUDGET[reasoningEffort] ?? REASONING_TO_THINKING_BUDGET.high;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: requestText }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      thinkingConfig: {
        thinkingBudget,
      },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractGeminiError(payload, response.status));
  }

  const outputText = extractGeminiOutputText(payload);
  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON for the review report: ${error.message}`);
  }
}

function extractGeminiOutputText(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Gemini returned an empty response.");
  }

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!candidates.length) {
    const blockReason = payload.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini blocked the prompt: ${blockReason}`);
    }
    throw new Error("Gemini returned no candidates.");
  }

  const candidate = candidates[0];
  const finishReason = candidate.finishReason;
  if (finishReason && !["STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"].includes(finishReason)) {
    throw new Error(`Gemini finished with reason ${finishReason}.`);
  }

  const parts = candidate.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no review text.");
  }

  return text;
}

function extractGeminiError(payload, statusCode) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    `Gemini request failed with status ${statusCode}.`;
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
    "# Gemini Review",
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
    `Gemini review complete with ${model} (${reasoningEffort}).`,
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

function resolveOutputPath(workspaceRoot, outputPath, defaultPath = DEFAULT_OUTPUT_PATH) {
  if (typeof outputPath === "string" && outputPath.trim()) {
    return path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(workspaceRoot, outputPath);
  }

  return path.resolve(workspaceRoot, defaultPath);
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
