import crypto from "node:crypto";
import type {
  ChatToolPolicy,
  CoachInputChoice,
  CoachInputPrompt,
  CorosMcpTool
} from "./types";

export const CHAT_INTERACTION_TOOL_NAMES = ["request_coach_input"] as const;

export type ChatInteractionToolName =
  (typeof CHAT_INTERACTION_TOOL_NAMES)[number];

export function isChatInteractionTool(
  name: string
): name is ChatInteractionToolName {
  return (CHAT_INTERACTION_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * How many questions one turn may ask. They arrive as one card the athlete
 * answers together, and their answers go back in one turn (`toWireMessages`).
 */
export const MAX_COACH_QUESTIONS = 3;

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "One concise question for the athlete."
    },
    choices: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      description: "Two to five distinct answers, recommended choice first.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Short button label, ideally under 45 characters."
          },
          description: {
            type: "string",
            description: "Optional one-sentence consequence or tradeoff."
          },
          response: {
            type: "string",
            description:
              "Optional complete answer to send back. Defaults to the label."
          }
        },
        required: ["label"]
      }
    },
    allow_custom: {
      type: "boolean",
      description:
        "Whether the athlete may type a different answer. Defaults to true."
    }
  },
  required: ["question", "choices"]
};

export function getChatInteractionTools(): CorosMcpTool[] {
  return [
    {
      name: "request_coach_input",
      description:
        "Ask the athlete one to three questions using clickable choices: things only they know, or " +
        "choices that are theirs. Use this instead of asking a question only in prose. Put every question " +
        "in this one call, the most important first, and the recommended choice first in each. Call it at " +
        "most once per response, then stop and wait for the athlete's next message.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: MAX_COACH_QUESTIONS,
            description: "One to three questions, the most important first.",
            items: QUESTION_SCHEMA
          }
        },
        required: ["questions"]
      }
    }
  ];
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

export function buildCoachInputPrompt(
  args: Record<string, unknown>,
  promptId = crypto.randomUUID()
): CoachInputPrompt {
  const question = cleanText(args.question, 500);
  if (!question) {
    throw new Error("request_coach_input requires a question.");
  }

  const rawChoices = Array.isArray(args.choices) ? args.choices : [];
  const choices: CoachInputChoice[] = [];
  const seenLabels = new Set<string>();
  for (const [index, rawChoice] of rawChoices.entries()) {
    if (!rawChoice || typeof rawChoice !== "object" || Array.isArray(rawChoice)) {
      continue;
    }
    const source = rawChoice as Record<string, unknown>;
    const label = cleanText(source.label, 80);
    const normalizedLabel = label.toLocaleLowerCase();
    if (!label || seenLabels.has(normalizedLabel)) {
      continue;
    }
    seenLabels.add(normalizedLabel);
    const description = cleanText(source.description, 240);
    const response = cleanText(source.response, 500) || label;
    choices.push({
      id: `choice-${index + 1}`,
      label,
      ...(description ? { description } : {}),
      response
    });
    if (choices.length === 5) break;
  }

  if (choices.length < 2) {
    throw new Error("request_coach_input requires at least two distinct choices.");
  }

  return {
    promptId,
    question,
    choices,
    allowCustom: args.allow_custom !== false
  };
}

/**
 * An analysis run has nobody watching, so the question cannot block the turn.
 * The prompt is still emitted and persisted — the athlete can answer it later
 * from the transcript — but the model is told to assume and carry on.
 */
export const NO_ATHLETE_AVAILABLE_RESPONSE =
  "No athlete is available; state your assumption and continue.";

/**
 * Every question of one call, each its own prompt. A call in the shape this
 * tool had before it took several questions — `question` and `choices` at the
 * top — is still one question. More than the limit is refused whole, so the
 * model asks again with the ones that matter rather than losing the last.
 */
export function buildCoachInputPrompts(args: Record<string, unknown>): CoachInputPrompt[] {
  const questions = Array.isArray(args.questions) ? args.questions : args.question !== undefined ? [args] : [];
  if (questions.length === 0) {
    throw new Error("request_coach_input requires at least one question.");
  }
  if (questions.length > MAX_COACH_QUESTIONS) {
    throw new Error(
      `request_coach_input asks at most ${MAX_COACH_QUESTIONS} questions at once; ask again with the ones that matter most.`
    );
  }
  return questions.map((question) =>
    buildCoachInputPrompt(
      question && typeof question === "object" && !Array.isArray(question)
        ? (question as Record<string, unknown>)
        : {}
    )
  );
}

export function handleChatInteractionTool(
  name: ChatInteractionToolName,
  args: Record<string, unknown>,
  onCoachPrompt?: (prompt: CoachInputPrompt) => void,
  toolPolicy: ChatToolPolicy = "interactive"
): string {
  if (name !== "request_coach_input") {
    throw new Error(`Unsupported Coach interaction tool: ${name}`);
  }
  const prompts = buildCoachInputPrompts(args);
  for (const prompt of prompts) onCoachPrompt?.(prompt);
  const promptIds = prompts.map((prompt) => prompt.promptId);
  if (toolPolicy === "read-only") {
    return JSON.stringify({
      ok: true,
      prompt_ids: promptIds,
      status: "no_athlete_available",
      action: NO_ATHLETE_AVAILABLE_RESPONSE
    });
  }
  return JSON.stringify({
    ok: true,
    prompt_ids: promptIds,
    status: "waiting_for_athlete",
    action:
      "The choices are visible to the athlete. End this response now and wait for their next message."
  });
}
