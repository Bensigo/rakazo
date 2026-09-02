import { Trans, useLingui } from "@lingui/react/macro";
import type { ComputerStatus } from "@rakazo/contracts";
import { useState } from "react";
import { rpc } from "../../lib/rpc";

/** Compact Teach a task control for the live computer overlay (not the agent sidepanel). */
export function TeachComputerOverlayControl({
  botId,
  computer,
  busy: busyProp,
  onRefresh,
}: {
  botId: string;
  computer: ComputerStatus | null;
  busy?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(busyProp) || localBusy;
  // Hide only for desktop-host bots. Null computer still shows the control so teaching can boot.
  if (computer?.kind === "desktop") return null;

  async function startTeaching() {
    if (!goal.trim() || busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      await rpc.computer.boot({ botId });
      await rpc.skills.start({ botId, goal: goal.trim() });
      setGoalOpen(false);
      setGoal("");
      try {
        await onRefresh();
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : t`Recording may have started, but the view could not refresh`,
        );
        setGoalOpen(true);
      }
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : t`Could not start teaching`,
      );
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="pointer-events-auto absolute top-3 end-3 z-10 flex max-w-[min(360px,calc(100%-1.5rem))] flex-col items-end gap-2">
      {goalOpen ? (
        <div className="w-[min(360px,100%)] rounded-[12px] border border-[#26262A] bg-[#121214]/90 px-3 py-3 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-sm">
          <label htmlFor="teach-goal-input" className="text-[13px] text-[#85858A]">
            <Trans>What result will you demonstrate?</Trans>
          </label>
          <textarea
            id="teach-goal-input"
            data-testid="teach-goal-input"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-[10px] border border-[#26262A] bg-[#0E0E10] px-3 py-2 text-[14px] text-[#ECECEE] outline-none"
            placeholder={t`Export this week's list from the CRM and drop it in the shared folder`}
          />
          {error ? (
            <div role="alert" className="mt-2 text-[13px] text-[#FCA5A5]">
              {error}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !goal.trim()}
              onClick={() => void startTeaching()}
              className="rounded-[11px] bg-[#F1F1EF] px-4 py-2 text-[14px] text-[#17171A] disabled:opacity-40"
            >
              {busy ? <Trans>Starting…</Trans> : <Trans>Start recording</Trans>}
            </button>
            <button
              type="button"
              onClick={() => {
                setGoalOpen(false);
                setError(null);
              }}
              className="rounded-[11px] border border-[#26262A] px-4 py-2 text-[14px] text-[#ECECEE]"
            >
              <Trans>Cancel</Trans>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="teach-start-button"
          aria-label={t`Teach a task`}
          disabled={busy}
          onClick={() => {
            setError(null);
            setGoalOpen(true);
          }}
          className="flex items-center gap-2 rounded-[10px] border border-[#2A2A2E] bg-[#141417]/92 px-3 py-2 text-[13.5px] text-[#ECECEE] shadow-[0_8px_24px_rgba(0,0,0,.35)] backdrop-blur-sm hover:bg-[#1A1A1E] disabled:opacity-40"
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-[#ECECEE]"
          />
          <Trans>Teach a task</Trans>
          <span aria-hidden className="text-[12px] leading-none text-[#85858A]">
            ↗
          </span>
        </button>
      )}
    </div>
  );
}
