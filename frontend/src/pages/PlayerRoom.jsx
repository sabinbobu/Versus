import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadPlayer, savePlayer, http } from "../lib/api";
import { useRoomState } from "../lib/useRoomState";
import { ShapeIcon, ANSWERS } from "../components/Shapes";
import MemoryBoard from "../components/MemoryBoard";
import GameSettingsForm from "../components/GameSettingsForm";
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
  const { state, connected, sendAnswer, redirectTo, newTokenForMe } = useRoomState(code, "player", me?.token);
  const [myChoice, setMyChoice] = useState(null);

  useEffect(() => {
    if (!me?.token) nav(`/join/${code}`);
  }, [me, code, nav]);

  const followedRef = useRef(false);
  useEffect(() => {
    if (followedRef.current) return;
    if (redirectTo && newTokenForMe && me) {
      followedRef.current = true;
      savePlayer(redirectTo, { token: newTokenForMe, id: me.id, side: me.side, name: me.name, is_master: me.is_master });
      nav(`/play/${redirectTo}`);
    }
  }, [redirectTo, newTokenForMe, me, nav]);

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
  const myPlayer = useMemo(() => (state ? allPlayersSorted(state).find((p) => p.id === myId) : null), [state, myId]);
  const isMaster = myPlayer?.is_master ?? me?.is_master ?? false;
  const startGame = useCallback(() => {
    http.post(`/rooms/${code}/start`).catch((e) => alert(e?.response?.data?.detail || "Cannot start yet"));
  }, [code]);
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
            {isMaster ? (
              <>
                <p className="text-white/50 mb-6">You're the <span className="text-yellow-400 font-bold">Master</span> — start when everyone's ready.</p>
                <button data-testid="player-start-btn" disabled={!state.can_start} onClick={startGame}
                  className="flex items-center justify-center gap-2 w-full max-w-xs py-5 rounded-2xl font-black uppercase tracking-widest text-black active:scale-95 transition-transform disabled:opacity-50"
                  style={{ background: state.can_start ? "linear-gradient(90deg,#7c3aed,#06b6d4)" : "#333" }}>
                  {state.questions_ready ? "Start Game" : "Preparing…"}
                </button>
                {!state.can_start && state.questions_ready && (
                  <p className="text-white/40 text-sm mt-3">Waiting for at least 1 player on each side…</p>
                )}
              </>
            ) : (
              <p className="text-white/50">Watch the big screen. Waiting for the Master to start…</p>
            )}
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
                  className="w-full flex-1 max-h-40 rounded-3xl flex flex-col items-center justify-center gap-1 px-3 active:scale-95 transition-transform shadow-[0_6px_0_rgba(0,0,0,0.5)] active:shadow-none active:translate-y-1"
                  style={{ background: a.color }}>
                  <ShapeIcon index={i} size={40} />
                  {state.question?.options?.[i] && (
                    <span data-testid={`answer-btn-text-${i}`} className="font-black text-sm sm:text-base leading-tight text-center line-clamp-2" style={{ color: a.text }}>
                      {state.question.options[i]}
                    </span>
                  )}
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
            {isMaster ? (
              <MasterPodiumActions code={code} state={state} nav={nav} me={me} />
            ) : (
              <p className="text-white/40 mt-4 text-sm">Watch the big screen for the podium.</p>
            )}
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

function MasterPodiumActions({ code, state, nav, me }) {
  const [sheet, setSheet] = useState(null); // null | "newgame" | "newroom"
  const [busy, setBusy] = useState(false);

  const rematch = () => {
    http.post(`/rooms/${code}/rematch`).catch((e) => alert(e?.response?.data?.detail || "Could not start a rematch"));
  };

  const submitNewGame = async (values) => {
    setBusy(true);
    try {
      await http.post(`/rooms/${code}/reconfigure`, {
        game_type: values.gameType, topic: values.topic || "General knowledge", difficulty: values.difficulty,
        num_questions: values.num, time_per_question: values.tpq, language: values.language,
      });
      setSheet(null);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      alert("Could not start a new game. Try again.");
    }
  };

  const submitNewRoom = async (values) => {
    setBusy(true);
    try {
      const r = await http.post(`/rooms/${code}/new-room`, {
        mode: values.mode, game_type: values.gameType,
        topic: values.topic || "General knowledge", difficulty: values.difficulty,
        num_questions: values.num, time_per_question: values.tpq, language: values.language,
        token: me?.token,
      });
      if (r.data.token && me) {
        savePlayer(r.data.code, { token: r.data.token, id: me.id, side: me.side, name: me.name, is_master: me.is_master });
      }
      nav(`/play/${r.data.code}`);
    } catch (e) {
      setBusy(false);
      alert("Could not create a new room. Try again.");
    }
  };

  return (
    <div className="w-full max-w-xs mt-6 space-y-3">
      <button data-testid="master-rematch-btn" onClick={rematch}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black uppercase tracking-widest text-black active:scale-95 transition-transform"
        style={{ background: "linear-gradient(90deg,#7c3aed,#06b6d4)" }}>
        Rematch
      </button>
      <button data-testid="master-newgame-btn" onClick={() => setSheet("newgame")}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black uppercase tracking-widest bg-white/10 active:scale-95 transition-transform">
        New Game
      </button>
      <button data-testid="master-newroom-btn" onClick={() => setSheet("newroom")}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black uppercase tracking-widest bg-white/10 active:scale-95 transition-transform">
        New Room
      </button>

      {sheet && (
        <div className="fixed inset-0 z-50 bg-[#05050A] overflow-y-auto p-6" data-testid={`master-sheet-${sheet}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black font-heading gradient-text">
              {sheet === "newgame" ? "New Game · Same Players" : "New Room · Fresh Code"}
            </h2>
            <button data-testid="master-sheet-close" onClick={() => setSheet(null)} className="text-white/40 hover:text-white text-2xl leading-none">×</button>
          </div>
          {sheet === "newroom" && (
            <p className="text-white/40 text-xs mb-5">Connected players carry over automatically — no need to rescan.</p>
          )}
          <GameSettingsForm
            initial={{
              gameType: state.game_type || "quiz",
              mode: state.mode || "1v1",
              topic: state.game_type === "quiz" ? state.topic : "",
              difficulty: state.difficulty || "mixed",
              num: state.num_questions || 10,
              tpq: state.time_per_question || 15,
              language: state.language || "en",
            }}
            showMode={sheet === "newroom"}
            busy={busy}
            submitLabel={sheet === "newgame" ? "Back to Lobby" : "Create Room"}
            onSubmit={sheet === "newgame" ? submitNewGame : submitNewRoom}
          />
        </div>
      )}
    </div>
  );
}
