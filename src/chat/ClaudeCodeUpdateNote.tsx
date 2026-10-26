import { CircleArrowUp } from "lucide-react";
import type { ClaudeCodeUpdate } from "./coachProviders";
import { t } from "../i18n/core";
import { renderRich } from "../i18n/useI18n";

/** The notice itself, worded once for every screen that shows it. */
export function ClaudeCodeUpdateNote({ update }: { update: ClaudeCodeUpdate }) {
  return (
    <p className="coach-analysis-banner" role="status">
      <CircleArrowUp size={15} aria-hidden="true" />
      <span>
        {renderRich(t("chat.models.claudeUpdate", { latest: update.latest, installed: update.installed }), {
          b: (chunk) => <strong>{chunk}</strong>,
          code: (chunk) => <code>{chunk}</code>
        })}
      </span>
    </p>
  );
}

