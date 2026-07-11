"use client";

// The Timer page's hero: idle state is a task combobox + Start button;
// running state is a big ticking readout, the task name, and Stop. The
// readout continues from the task's recorded total (taskRecordedSecs,
// v3.2.1) so resuming a multi-session task doesn't restart at 0:00:00; the
// current session's own elapsed time is shown in the subtitle when a
// recorded total is included.

import { useEffect, useState } from "react";
import { formatHms } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { TaskCombobox } from "./TaskCombobox";

export function TimerBar({
  running,
  taskInput,
  onTaskInputChange,
  onStart,
  onStop,
  starting,
  stopping,
  error,
}: {
  running: TimeEntry | null;
  taskInput: string;
  onTaskInputChange: (value: string) => void;
  onStart: () => void;
  onStop: () => void;
  starting: boolean;
  stopping: boolean;
  error: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const startedAtMs = new Date(running.startedAt).getTime();
    function tick() {
      setElapsed((Date.now() - startedAtMs) / 1000);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  if (running) {
    const recorded = running.taskRecordedSecs ?? 0;
    return (
      <div className="timer-bar">
        <div className="timer-running">
          <div className="timer-elapsed">{formatHms(recorded + elapsed)}</div>
          <div className="timer-info">
            <div className="timer-project mono">{running.taskName}</div>
            <div className="timer-note">
              {recorded > 0 ? `Running… · this session ${formatHms(elapsed)}` : "Running…"}
            </div>
          </div>
          <button type="button" className="btn-danger" onClick={onStop} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="timer-bar">
      <div className="timer-idle">
        <TaskCombobox
          value={taskInput}
          onChange={onTaskInputChange}
          onSubmit={() => {
            if (taskInput.trim().length > 0) onStart();
          }}
          disabled={starting}
          autoFocus
        />
        <button
          type="button"
          className="btn-primary"
          onClick={onStart}
          disabled={starting || taskInput.trim().length === 0}
        >
          {starting ? "Starting…" : "Start"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
