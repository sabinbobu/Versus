import React, { useEffect, useRef, useState } from "react";
import { Bomb } from "lucide-react";

// Whack-a-mole board played locally on the phone, driven by a server-generated
// event script shared by both players (same script = fair race).
// Calls onHit(hitsSoFar) live and onComplete(hits, bombs) once the script ends.
export default function GridBoard({ script, onHit, onComplete }) {
  const [live, setLive] = useState({}); // cell -> { bomb }
  const [hits, setHits] = useState(0);
  const [bombs, setBombs] = useState(0);
  const hitsRef = useRef(0);
  const bombsRef = useRef(0);
  const struckRef = useRef(new Set());
  const doneRef = useRef(false);

  useEffect(() => {
    const timers = [];
    script.forEach((ev, i) => {
      const onTimer = setTimeout(() => {
        setLive((m) => ({ ...m, [ev.cell]: { bomb: ev.bomb, key: i } }));
      }, ev.at_ms);
      const offTimer = setTimeout(() => {
        setLive((m) => {
          const next = { ...m };
          if (next[ev.cell]?.key === i) delete next[ev.cell];
          return next;
        });
      }, ev.at_ms + ev.ttl_ms);
      timers.push(onTimer, offTimer);
    });
    const lastEnd = script.length ? Math.max(...script.map((e) => e.at_ms + e.ttl_ms)) : 0;
    const finishTimer = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onComplete(hitsRef.current, bombsRef.current);
    }, lastEnd + 100);
    timers.push(finishTimer);
    return () => timers.forEach(clearTimeout);
  }, [script]);

  const whack = (cell) => {
    const cur = live[cell];
    if (!cur || struckRef.current.has(cur.key)) return;
    struckRef.current.add(cur.key);
    setLive((m) => {
      const next = { ...m };
      delete next[cell];
      return next;
    });
    if (cur.bomb) {
      bombsRef.current += 1;
      setBombs(bombsRef.current);
    } else {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      onHit(hitsRef.current);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto" data-testid="grid-board">
      <div className="flex justify-between text-xs uppercase tracking-widest text-white/40 mb-3 px-1">
        <span data-testid="grid-hits">Hits {hits}</span>
        <span data-testid="grid-bombs">Bombs {bombs}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 16 }, (_, cell) => {
          const cur = live[cell];
          return (
            <button
              key={cell}
              data-testid={`grid-cell-${cell}`}
              onClick={() => whack(cell)}
              className={`aspect-square rounded-xl flex items-center justify-center transition-all duration-100 ${cur ? "scale-105 active:scale-90" : ""}`}
              style={{
                background: cur ? (cur.bomb ? "#FF3366" : "#00FF66") : "#161627",
                boxShadow: cur ? `0 0 20px ${cur.bomb ? "#FF3366" : "#00FF66"}` : "inset 0 0 0 1px rgba(255,255,255,0.08)",
              }}
            >
              {cur?.bomb && <Bomb size={22} color="#05050A" strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
