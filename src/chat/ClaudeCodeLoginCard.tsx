import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Terminal, X } from "lucide-react";
import type { ClaudeCodeStatus } from "../../electron/types";
import type { HeraclesRecordsApi } from "../heraclesrecords-api";
import { t } from "../i18n/core";

const STATUS_POLL_INTERVAL_MS = 3_000;

/**
 * Drives `claude auth login` from inside the app.
 *
 * Sign-in can land two ways and the card must not depend on guessing which:
 * Claude's hosted callback shows a code to paste, but the CLI can also finish on
 * its own. So the card watches the CLI process, polls the sign-in status while
 * it waits, and re-checks the moment the window regains focus — which is exactly
 * when the athlete comes back from the browser.
 */
export function ClaudeCodeLoginCard({
  api,
  disabled,
  onSignedIn,
  onError
}: {
  api: HeraclesRecordsApi | undefined;
  disabled?: boolean;
  onSignedIn: (status: ClaudeCodeStatus) => void;
  onError: (message: string | null) => void;
}) {
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mounted = useRef(true);
  // Whichever path notices the sign-in first wins; the other must stay quiet.
  const finished = useRef(false);
  // Held in refs so the polling effect is not torn down every parent render.
  const callbacks = useRef({ onSignedIn, onError });
  callbacks.current = { onSignedIn, onError };

  // The body must re-arm the flag: StrictMode runs mount → cleanup → mount in
  // development, and a cleanup-only effect leaves this false for good, which
  // silently aborted every sign-in right after it started.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = () => {
    if (!mounted.current) return;
    setPending(false);
    setCode("");
    setSubmitting(false);
  };

  // Poll while a sign-in is outstanding, and check immediately whenever the
  // window becomes active again after the browser round trip.
  useEffect(() => {
    if (!pending || !api) return;

    let stopped = false;
    const check = async () => {
      if (stopped || finished.current) return;
      try {
        const status = await api.getClaudeCodeStatus();
        if (stopped || finished.current || !status.authenticated) return;
        finished.current = true;
        // Release the CLI process; nothing is waiting on its code prompt now.
        void api.cancelClaudeCodeLogin();
        reset();
        callbacks.current.onSignedIn(status);
      } catch {
        // Keep waiting: a failed probe says nothing about the sign-in.
      }
    };

    // Probe once straight away so a stall is visible without a 3s wait.
    void check();
    const timer = setInterval(() => void check(), STATUS_POLL_INTERVAL_MS);
    const onActive = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, api]);

  const start = async () => {
    if (!api || starting) return;
    finished.current = false;
    setStarting(true);
    setCode("");
    onError(null);
    try {
      // Claude Code opens the sign-in page itself; opening it here too would
      // give the athlete two tabs.
      await api.startClaudeCodeLogin();
      if (!mounted.current) return;
      setPending(true);
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : t("chat.claude.failed")
      );
      return;
    } finally {
      setStarting(false);
    }

    // A running dev build whose preload predates this method would otherwise
    // throw an opaque error here. The status poll above finishes the sign-in
    // without it, so treat the process watch as optional.
    if (typeof api.awaitClaudeCodeLogin !== "function") return;
    try {
      const status = await api.awaitClaudeCodeLogin();
      if (!mounted.current || finished.current) return;
      finished.current = true;
      reset();
      if (status.authenticated) {
        callbacks.current.onSignedIn(status);
      } else {
        // The sign-in ended without credentials — leaving the spinner up here is
        // what made a failed attempt look like a hung one.
        callbacks.current.onError(
          t("chat.claude.incomplete")
        );
      }
    } catch (caught) {
      if (!mounted.current || finished.current) return;
      reset();
      onError(
        caught instanceof Error ? caught.message : t("chat.claude.failed")
      );
    }
  };

  const submit = async () => {
    if (!api || submitting || !code.trim()) return;
    setSubmitting(true);
    onError(null);
    try {
      // Completion is reported by the pending wait or the poll above.
      await api.submitClaudeCodeLoginCode(code.trim());
    } catch (caught) {
      if (mounted.current) setSubmitting(false);
      onError(
        caught instanceof Error ? caught.message : t("chat.claude.failed")
      );
    }
  };

  const cancel = () => {
    finished.current = true;
    void api?.cancelClaudeCodeLogin();
    reset();
    onError(null);
  };

  if (!pending) {
    return (
      <button
        type="button"
        className="chat-local-action primary"
        onClick={() => void start()}
        disabled={starting || disabled || !api}
      >
        {starting ? (
          <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
        ) : (
          <Terminal size={14} aria-hidden="true" />
        )}
        {t("chat.claude.signIn")}
      </button>
    );
  }

  return (
    <div className="chat-claude-login-flow">
      <div className="chat-claude-login-flow-header">
        <strong>
          <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
          {submitting ? t("chat.claude.signingIn") : t("chat.claude.finishTitle")}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t("chat.claude.cancelAria")}
          onClick={cancel}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <p className="chat-settings-copy">{t("chat.claude.approve")}</p>
      <button
        type="button"
        className="chat-local-action"
        onClick={() => void api?.openClaudeCodeLoginUrl()}
      >
        <ExternalLink size={14} aria-hidden="true" />
        {t("chat.claude.openHere")}
      </button>
      <label className="chat-local-field">
        <span>{t("chat.claude.code")}</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder={t("chat.claude.codePh")}
          spellCheck={false}
        />
      </label>
      <div className="chat-local-actions">
        <button
          type="button"
          className="chat-local-action primary"
          onClick={() => void submit()}
          disabled={submitting || !code.trim()}
        >
          {submitting ? (
            <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
          ) : (
            <Terminal size={14} aria-hidden="true" />
          )}
          {t("chat.claude.finish")}
        </button>
        <button type="button" className="chat-local-action" onClick={cancel}>
          <X size={14} aria-hidden="true" />
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
