import React, { useEffect, useRef, useState } from "react";
import { ANSWERS, ShapeIcon } from "./Shapes";

const FLASH_ON_MS = 450;
const FLASH_GAP_MS = 150;
const NEXT_LEVEL_DELAY_MS = 500;

// Simon-style growing pattern game played locally on the phone.
// Calls onLevel(level) each time a level is cleared (drives live host progress),
// and onDone(reachedLevel) once when the run ends (wrong tap or time up).
export default function SequenceBoard({ sequence, durationMs, onLevel, onDone }) {
  const [level, setLevel] = useState(1);
  const [showingPad, setShowingPad] = useState(-1);
  const [phase, setPhase] = useState("showing"); // "showing" | "input" | "over"
  const [input, setInput] = useState([]);
  const doneRef = useRef(false);
  const levelRef = useRef(1);

  const finish = (reached) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("over");
    onDone(reached);
  };

  useEffect(() => {
    if (!durationMs) return;
    const t = setTimeout(() => finish(Math.max(0, levelRef.current - 1)), durationMs);
    return () => clearTimeout(t);
  }, [durationMs]);

  useEffect(() => {
    if (phase !== "showing") return;
    let cancelled = false;
    setInput([]);
    let i = 0;
    const step = () => {
      if (cancelled) return;
      if (i >= level) {
        setShowingPad(-1);
        setPhase("input");
        return;
      }
      setShowingPad(sequence[i]);
      setTimeout(() => {
        if (cancelled) return;
        setShowingPad(-1);
        setTimeout(() => {
          if (cancelled) return;
          i += 1;
          step();
        }, FLASH_GAP_MS);
      }, FLASH_ON_MS);
    };
    step();
    return () => { cancelled = true; };
  }, [phase, level, sequence]);

  const tap = (pad) => {
    if (phase !== "input" || doneRef.current) return;
    const idx = input.length;
    if (sequence[idx] !== pad) {
      finish(Math.max(0, level - 1));
      return;
    }
    const nextInput = [...input, pad];
    setInput(nextInput);
    if (nextInput.length === level) {
      onLevel(level);
      levelRef.current = level + 1;
      if (level >= sequence.length) {
        finish(level);
        return;
      }
      setTimeout(() => {
        setLevel((l) => l + 1);
        setPhase("showing");
      }, NEXT_LEVEL_DELAY_MS);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto" data-testid="sequence-board">
      <div className="text-center text-xs uppercase tracking-widest text-white/40 mb-3">
        {phase === "showing" ? "Watch…" : phase === "input" ? "Your turn!" : "Game over"}
        <span className="mx-2">·</span>
        <span data-testid="sequence-level">Level {level}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {ANSWERS.map((a, i) => {
          const lit = showingPad === i;
          return (
            <button
              key={i}
              data-testid={`sequence-pad-${i}`}
              onClick={() => tap(i)}
              disabled={phase !== "input"}
              className={`aspect-square rounded-2xl flex items-center justify-center transition-all duration-100 ${lit ? "scale-105" : "active:scale-95"}`}
              style={{
                background: lit ? a.color : "#161627",
                boxShadow: lit ? `0 0 30px ${a.color}` : "inset 0 0 0 1px rgba(255,255,255,0.08)",
              }}
            >
              {lit && <ShapeIcon index={i} size={40} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
