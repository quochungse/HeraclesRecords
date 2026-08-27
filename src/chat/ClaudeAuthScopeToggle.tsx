import { Laptop, ShieldCheck } from "lucide-react";

/**
 * Picks which credential store Claude Code runs against: the machine-wide login
 * shared with the user's terminal, or a CorosLink-only one.
 *
 * Shown both in Settings and on the sign-in gate, because the choice decides
 * where a sign-in lands and is easiest to get wrong right before signing in.
 */
export function ClaudeAuthScopeToggle({
  appScoped,
  disabled,
  onChange
}: {
  appScoped: boolean;
  disabled?: boolean;
  onChange: (appScoped: boolean) => void;
}) {
  // Re-picking the active side would trigger a needless save and status re-read.
  const select = (next: boolean) => {
    if (next !== appScoped) onChange(next);
  };

  return (
    <div
      className="chat-auth-scope-switch"
      role="group"
      aria-label="Claude credentials"
    >
      <button
        type="button"
        className={appScoped ? "" : "is-active"}
        aria-pressed={!appScoped}
        disabled={disabled}
        onClick={() => select(false)}
      >
        <Laptop size={14} aria-hidden="true" />
        Your device Claude
      </button>
      <button
        type="button"
        className={appScoped ? "is-active" : ""}
        aria-pressed={appScoped}
        disabled={disabled}
        onClick={() => select(true)}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        CorosLink-only Claude login
      </button>
    </div>
  );
}
