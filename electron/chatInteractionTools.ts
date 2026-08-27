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

export function getChatInteractionTools(): CorosMcpTool[] {
  return [
    {
      name: "request_coach_input",
      description:
        "Pause and ask the athlete one necessary clarifying question using clickable choices. " +
        "Use this instead of asking a question only in prose. Put the recommended choice first. " +
        "Call it at most once per response, then stop and wait for the athlete's next message.",
      inputSchema: {
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
 * An automation run has nobody watching, so the question cannot block the turn.
 * The prompt is still emitted and persisted — the athlete can answer it later
 * from the transcript — but the model is told to assume and carry on.
 */
export const NO_ATHLETE_AVAILABLE_RESPONSE =
  "No athlete is available; state your assumption and continue.";

export function handleChatInteractionTool(
  name: ChatInteractionToolName,
  args: Record<string, unknown>,
  onCoachPrompt?: (prompt: CoachInputPrompt) => void,
  toolPolicy: ChatToolPolicy = "interactive"
): string {
  if (name !== "request_coach_input") {
    throw new Error(`Unsupported Coach interaction tool: ${name}`);
  }
  const prompt = buildCoachInputPrompt(args);
  onCoachPrompt?.(prompt);
  if (toolPolicy === "read-only") {
    return JSON.stringify({
      ok: true,
      prompt_id: prompt.promptId,
      status: "no_athlete_available",
      action: NO_ATHLETE_AVAILABLE_RESPONSE
    });
  }
  return JSON.stringify({
    ok: true,
    prompt_id: prompt.promptId,
    status: "waiting_for_athlete",
    action:
      "The choices are visible to the athlete. End this response now and wait for their next message."
  });
}
