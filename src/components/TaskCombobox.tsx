"use client";

// Single text input for entering a task (a slug like SLUG-description, or
// free text). Free text is always allowed — the backend find-or-creates and
// validates on save — but while typing we show a debounced autocomplete of
// the current user's previously-used tasks from /api/tasks?q=, navigable
// with the keyboard.

import { useEffect, useRef, useState } from "react";
import { listTasks } from "@/lib/api";
import type { Task } from "@/lib/types";

export function TaskCombobox({
  value,
  onChange,
  onSubmit,
  placeholder = "task or SLUG-description",
  disabled,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter when no suggestion is highlighted (e.g. to trigger Start). */
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Task[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      listTasks(value)
        .then((tasks) => {
          setOptions(tasks);
          setHighlight(-1);
        })
        .catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [value, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function selectOption(name: string) {
    onChange(name);
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (!open || options.length === 0) {
      if (e.key === "Enter") onSubmit?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? options.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && highlight < options.length) {
        selectOption(options[highlight].name);
      } else {
        setOpen(false);
        onSubmit?.();
      }
    }
  }

  return (
    <div className="combobox" ref={containerRef}>
      <input
        id={id}
        type="text"
        className="combobox-input mono"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && options.length > 0 && (
        <ul className="combobox-menu" role="listbox">
          {options.map((task, i) => (
            <li
              key={task.id}
              role="option"
              aria-selected={i === highlight}
              className={i === highlight ? "combobox-option active" : "combobox-option"}
              onMouseDown={(e) => {
                e.preventDefault();
                selectOption(task.name);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {task.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
