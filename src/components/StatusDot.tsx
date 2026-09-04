/** The small filled circle used by connection chips and pills. */
export function StatusDot({ connected }: { connected: boolean }) {
  return <span className={connected ? "status-dot connected" : "status-dot"} />;
}
