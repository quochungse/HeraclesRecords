/**
 * Where a chat tool gets its data, for the source badge under an answer.
 *
 * The badge used to say "MCP" for every tool call, because every call goes out
 * on the stream as `kind: "mcp"` — so a turn that read one activity from the
 * Training Hub API and touched no MCP server at all was labelled an MCP turn,
 * and the athlete could not tell a local read from a network one.
 *
 * - `db`    — read from this machine's own store (SQLite and the caches on it).
 * - `coros` — a request the app makes itself to the COROS Training Hub API.
 * - `mcp`   — a tool of a connected MCP server. Its name carries the server
 *             prefix (`coros__querySleepData`, see `mcpToolNames`).
 *
 * Free of imports so the renderer can read it, and keyed by tool name rather
 * than carried on the stream, so transcripts saved before it existed label
 * themselves correctly too.
 */
export type ChatToolSource = "db" | "coros" | "mcp";

/**
 * Every local tool by where it reads from. `null` is a tool that reads nothing:
 * the coach's question card and the two draft previews, which the app builds
 * from what the model sent. They stay off the badge, which is about where the
 * answer's data came from.
 *
 * `get_sleep_summary` is `db` for its usual path, the Sleep screen's cache;
 * a fill for last night and a `night` HRV detail do go through COROS MCP.
 *
 * `test:chat-tool-sources` fails on a local tool missing here, because an
 * unlisted name falls through to the MCP label.
 */
export const LOCAL_CHAT_TOOL_SOURCES: ReadonlyMap<string, Exclude<ChatToolSource, "mcp"> | null> =
  new Map<string, Exclude<ChatToolSource, "mcp"> | null>([
    ["list_recent_activities", "coros"],
    ["get_activity_detail", "coros"],
    ["get_fitness_trends", "coros"],
    ["get_training_zones", "coros"],
    // The name `get_training_zones` replaced; stored transcripts still carry it.
    ["get_hr_zone_summary", "coros"],
    ["get_sleep_summary", "db"],
    ["list_scheduled_workouts", "coros"],
    ["search_coros_exercises", "coros"],
    ["upload_training_plan", "coros"],
    ["delete_workout", "coros"],
    ["draft_workout", null],
    ["draft_training_plan", null],
    ["request_coach_input", null]
  ]);

/**
 * The source a tool reads from, or null for one that reads nothing. Anything
 * that is not a local tool is an MCP server's — which is also what every tool
 * was labelled before, so a name from an older build keeps its old label.
 */
export function chatToolSource(name: string): ChatToolSource | null {
  const local = LOCAL_CHAT_TOOL_SOURCES.get(name);
  return local === undefined ? "mcp" : local;
}

export interface ChatToolSourceGroup {
  source: ChatToolSource;
  label: string;
  tools: string[];
}

const SOURCE_LABELS: Record<ChatToolSource, string> = {
  db: "DB",
  coros: "Coros",
  mcp: "MCP"
};

/** Nearest first: what never left the machine, then COROS, then MCP servers. */
const SOURCE_ORDER: readonly ChatToolSource[] = ["db", "coros", "mcp"];

/** The tools a turn called, grouped by source in that order, each named once. */
export function groupChatToolsBySource(tools: readonly string[]): ChatToolSourceGroup[] {
  const groups = new Map<ChatToolSource, Set<string>>();
  for (const tool of tools) {
    const source = tool ? chatToolSource(tool) : null;
    if (!source) continue;
    const names = groups.get(source) ?? new Set<string>();
    names.add(tool);
    groups.set(source, names);
  }
  return SOURCE_ORDER.flatMap((source) => {
    const names = groups.get(source);
    return names ? [{ source, label: SOURCE_LABELS[source], tools: [...names] }] : [];
  });
}
