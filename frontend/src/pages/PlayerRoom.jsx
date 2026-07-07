import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadPlayer, http } from "../lib/api";
import { useRoomState } from "../lib/useRoomState";
import { ShapeIcon, ANSWERS } from "../components/Shapes";
import MemoryBoard from "../components/MemoryBoard";
import { Check, Loader2, Trophy, Wifi, WifiOff, Brain } from "lucide-react";

const SIDE_COLOR = { A: "#06B6D4", B: "#EC4899" };

function allPlayersSorted(state) {
  const list = [];
  ["A", "B"].forEach((s) => (state.sides[s]?.players || []).forEach((p) => list.push({ ...p, side: s })));
  list.sort((a, b) => b.total - a.total);
  return list;
}

export default function PlayerRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const me = loadPlayer(code);
  const { state, connected, sendAnswer } = useRoomState(code, "player", me?.token);
  const [myChoice, setMyChoice] = useState(null);

  useEffect(() => {
    if (!me?.token) nav(`/join/${code}`);
  }, [me, code, nav]);

  useEffect(() => { setMyChoice(null); }, [state?.current_index, state?.phase === "preview"]);

  const tap = (i) => { setMyChoice(i); sendAnswer(i); };
  const memoryDone = useCallback((mistakes) => {
    http.post(`/rooms/${code}/memory`, { token: me?.token, mistakes }).catch(() => {});
  }, [code, me]);

  const myId = me?.id;
  const mySide = me?.side;
  const accent = SIDE_COLOR[mySide] || "#7c3aed";

  const locked = useMemo(() => state?.answered_ids?.includes(myId), [state, myId]);
  const myResult = state?.results?.[myId];
  const rank = useMemo(() => {
    if (!state) return null;
    const list = allPlayersSorted(state);
    const idx = list.findIndex((p) => p.id === myId);
    return idx >= 0 ? idx + 1 : null;
  }, [state, myId]);

  if (!state) {
    return <Wrap accent={accent}><Loader2 className="animate-spin" size={40} /></Wrap>;
  }

  const phase = state.phase;
  const myName = me?.name;
  const qtype = state.question?.type || state.game_type || "quiz";
  const reactionLive = state.question?.reaction_live;
  const target = state.question?.target;

  return (
    <div className="min-h-[100svh] flex flex-col" style={{ background: `radial-gradient(circle at 50% 0%, ${accent}22, #05050A 55%)` }}>
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <span className="font-bold truncate max-w-[50%]" data-testid="player-name">{myName}</span>
        <span className="px-3 py-1 rounded-full font-black text-black text-xs" style={{ background: accent }}>
          {state.sides[mySide]?.name || `Side ${mySide}`}
        </span>
        <span className="text-white/40">{connected ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
      </div>

      <div className="flex-1 flex flex-col p-4" data-testid="player-stage">
        {(phase === "lobby") && (
          <Center>
            <div className="text-6xl mb-4"><Check size={64} color={accent} /></div>
            <h2 className="text-3xl font-black font-heading mb-2">You're in!</h2>
            <p className="text-white/50">Watch the big screen. Waiting for the game to start…</p>
          </Center>
        )}

        {phase === "preview" && (
          <Center>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-3">Question {state.question?.number}</p>
            <h2 className="text-4xl font-black font-heading animate-pulse">Get ready…</h2>
          </Center>
        )}

        {(phase === "active" || phase === "sudden_death") && qtype === "quiz" && (
          locked ? (
            <Center>
              <div className="w-28 h-28 rounded-3xl flex items-center justify-center mb-5" style={{ background: ANSWERS[myChoice ?? 0]?.color }}>
                <ShapeIcon index={myChoice ?? 0} size={64} />
              </div>
              <h2 className="text-3xl font-black font-heading mb-1" data-testid="answer-locked">Answer locked</h2>
              <p className="text-white/50">Look up at the big screen 👀</p>
            </Center>
          ) : (
            <div className="flex flex-col gap-4 flex-1 justify-center" data-testid="answer-buttons">
              {phase === "sudden_death" && <p className="text-center font-black text-yellow-400 uppercase tracking-widest mb-1">Sudden Death!</p>}
              {ANSWERS.map((a, i) => (
                <button key={i} data-testid={`answer-btn-${i}`} onClick={() => tap(i)}
                  className="w-full flex-1 max-h-40 rounded-3xl flex items-center justify-center active:scale-95 transition-transform shadow-[0_6px_0_rgba(0,0,0,0.5)] active:shadow-none active:translate-y-1"
                  style={{ background: a.color }}>
                  <ShapeIcon index={i} size={72} />
                </button>
              ))}
            </div>
          )
        )}

        {(phase === "active" || phase === "sudden_death") && qtype === "reaction" && (
          locked ? (
            <Center>
              <div className="w-28 h-28 rounded-3xl flex items-center justify-center mb-5" style={{ background: ANSWERS[myChoice ?? 0]?.color }}>
                <ShapeIcon index={myChoice ?? 0} size={64} />
              </div>
              <h2 className="text-3xl font-black font-heading mb-1" data-testid="answer-locked">Locked in!</h2>
              <p className="text-white/50">Look up at the big screen 👀</p>
            </Center>
          ) : (
            <div className="flex flex-col gap-4 flex-1 justify-center" data-testid="reaction-buttons">
              <p className={`text-center font-black uppercase tracking-widest mb-1 ${reactionLive ? "text-green-400 animate-pulse" : "text-white/40"}`}>
                {reactionLive ? "⚡ TAP IT NOW!" : "Wait for the light…"}
              </p>
              {ANSWERS.map((a, i) => {
                const isTarget = reactionLive && i === target;
                return (
                  <button key={i} data-testid={`reaction-btn-${i}`} onClick={() => tap(i)}
                    className={`w-full flex-1 max-h-40 rounded-3xl flex items-center justify-center transition-all active:scale-95 ${isTarget ? "scale-105 animate-pulse" : ""}`}
                    style={{
                      background: isTarget ? a.color : "#12121f",
                      boxShadow: isTarget ? `0 0 40px ${a.color}` : "inset 0 0 0 1px rgba(255,255,255,0.06)",
                    }}>
                    {isTarget && <ShapeIcon index={i} size={72} />}
                  </button>
                );
              })}
            </div>
          )
        )}

        {phase === "active" && qtype === "memory" && (
          locked ? (
            <Center>
              <Brain size={64} className="text-green-400 mb-4" />
              <h2 className="text-3xl font-black font-heading mb-1" data-testid="memory-done">Solved!</h2>
              <p className="text-white/50">Waiting for the round to end…</p>
            </Center>
          ) : (
            <div className="flex-1 flex flex-col justify-center">
              <MemoryBoard deck={state.question?.deck || []} onComplete={memoryDone} />
            </div>
          )
        )}

        {(phase === "reveal") && (
          <Center>
            {myResult ? (() => {
              const good = myResult.correct;
              let title;
              let sub = null;
              if (qtype === "reaction") {
                title = myResult.false_start ? "Too early! 🚫" : good ? "Nailed it! ⚡" : "Missed";
              } else if (qtype === "memory") {
                title = good ? "Solved! 🧠" : "Time's up";
                if (good) sub = `${myResult.mistakes ?? 0} misses`;
              } else {
                title = good ? "Correct!" : "Wrong";
              }
              return (
                <>
                  <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-5 ${good ? "bg-green-500/20" : "bg-red-500/20"}`}>
                    <h2 className="text-5xl">{good ? "✓" : "✕"}</h2>
                  </div>
                  <h2 className={`text-4xl font-black font-heading mb-2 ${good ? "text-green-400" : "text-red-400"}`} data-testid="player-result">{title}</h2>
                  <p className="text-2xl font-bold mb-1">+{myResult.points} pts</p>
                  {sub && <p className="text-white/50">{sub}</p>}
                  {rank && <p className="text-white/50">Rank #{rank} of {allPlayersSorted(state).length}</p>}
                </>
              );
            })() : (
              <>
                <h2 className="text-3xl font-black font-heading text-white/60 mb-2" data-testid="player-result">
                  {qtype === "memory" ? "Time's up" : qtype === "reaction" ? "No tap" : "No answer"}
                </h2>
                <p className="text-white/40">0 pts this round</p>
              </>
            )}
          </Center>
        )}

        {phase === "leaderboard" && (
          <Center>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-3">Standings</p>
            {rank && <h2 className="text-6xl font-black font-heading gradient-text mb-2" data-testid="player-rank">#{rank}</h2>}
            <p className="text-xl">{state.sides[mySide]?.total} team pts</p>
          </Center>
        )}

        {phase === "podium" && (
          <Center>
            <Trophy size={64} className={state.podium?.winner === mySide ? "text-yellow-400" : "text-white/40"} />
            <h2 className="text-4xl font-black font-heading my-3" data-testid="player-podium">
              {state.podium?.winner === mySide ? "You won! 🎉" : state.podium?.winner === "tie" ? "It's a tie!" : "Good game!"}
            </h2>
            {rank && <p className="text-white/60 text-xl">You finished #{rank}</p>}
            <p className="text-white/40 mt-4 text-sm">Watch the big screen for the podium.</p>
          </Center>
        )}
      </div>
    </div>
  );
}

function Center({ children }) {
  return <div className="flex-1 flex flex-col items-center justify-center text-center animate-pop-in">{children}</div>;
}
function Wrap({ children, accent }) {
  return <div className="min-h-[100svh] flex items-center justify-center" style={{ background: `radial-gradient(circle at 50% 0%, ${accent}22, #05050A 55%)` }}>{children}</div>;
}
