import React, { useEffect, useRef, useState } from "react";
import { FACES } from "./Faces";
import { HelpCircle } from "lucide-react";

// Flip-and-match memory board played locally on the phone.
// Calls onComplete(mistakes) once when all pairs are matched.
export default function MemoryBoard({ deck, disabled, onComplete }) {
  const [flipped, setFlipped] = useState([]); // currently face-up (unmatched)
  const [matched, setMatched] = useState([]); // permanently matched indices
  const [mistakes, setMistakes] = useState(0);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(false);
  const pairs = deck.length / 2;
  const cols = deck.length <= 8 ? 4 : 4;

  useEffect(() => {
    if (!doneRef.current && matched.length === deck.length && deck.length > 0) {
      doneRef.current = true;
      onComplete(mistakes);
    }
  }, [matched, deck.length, mistakes, onComplete]);

  const flip = (i) => {
    if (disabled || busy) return;
    if (matched.includes(i) || flipped.includes(i)) return;
    if (flipped.length === 0) {
      setFlipped([i]);
    } else if (flipped.length === 1) {
      const first = flipped[0];
      const next = [first, i];
      setFlipped(next);
      if (deck[first] === deck[i]) {
        setTimeout(() => {
          setMatched((m) => [...m, first, i]);
          setFlipped([]);
        }, 250);
      } else {
        setBusy(true);
        setMistakes((m) => m + 1);
        setTimeout(() => {
          setFlipped([]);
          setBusy(false);
        }, 700);
      }
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto" data-testid="memory-board">
      <div className="flex justify-between text-xs uppercase tracking-widest text-white/40 mb-3 px-1">
        <span>Matched {matched.length / 2}/{pairs}</span>
        <span data-testid="memory-mistakes">Misses {mistakes}</span>
      </div>
      <div className={`grid gap-2 grid-cols-${cols}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {deck.map((faceId, i) => {
          const isUp = flipped.includes(i) || matched.includes(i);
          const face = FACES[faceId % FACES.length];
          const Icon = face.Icon;
          return (
            <button
              key={i}
              data-testid={`memory-card-${i}`}
              onClick={() => flip(i)}
              disabled={disabled}
              className={`aspect-square rounded-xl flex items-center justify-center transition-all duration-200 ${
                isUp ? "scale-100" : "active:scale-95"
              } ${matched.includes(i) ? "opacity-60" : ""}`}
              style={{
                background: isUp ? face.color : "#161627",
                border: isUp ? "none" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {isUp ? <Icon size={30} color="#05050A" strokeWidth={2.5} /> : <HelpCircle size={26} className="text-white/20" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
