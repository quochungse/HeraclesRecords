import { Laptop, ShieldCheck } from "lucide-react";

/**
 * Picks which credential store Claude Code runs against: a Heracles
 * Records-only one, or the machine-wide login shared with the user's terminal.
 *
 * The app-scoped side leads because it is the default (`useAppScopedAuth`
 * defaults to true) and the safer of the two — picking the other one puts a
 * sign-in on top of whatever login the terminal is already using.
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
        className={appScoped ? "is-active" : ""}
        aria-pressed={appScoped}
        disabled={disabled}
        onClick={() => select(true)}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        Heracles Records-only Claude login
      </button>
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
    </div>
  );
}
