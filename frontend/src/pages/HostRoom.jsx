import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { http } from "../lib/api";
import { useRoomState, useTick } from "../lib/useRoomState";
import { ShapeIcon, ANSWERS } from "../components/Shapes";
import { playSound, unlockAudio } from "../lib/sounds";
import GameSettingsForm from "../components/GameSettingsForm";
import { Play, Pause, SkipForward, Loader2, Trophy, Zap, Crown, Users, Brain, Star, X, Sparkles, Flame, Swords, Waypoints, Crosshair } from "lucide-react";

const SIDE_COLOR = { A: "#06B6D4", B: "#EC4899" };

function useCountdown(state) {
  useTick(100);
  if (!state) return { sec: 0, frac: 0 };
  const fallback = { preview: 3000, active: (state.time_per_question || 15) * 1000, reveal: 5000, leaderboard: 4000, sudden_death: 15000 };
  const total = state.phase_total_ms || fallback[state.phase] || 1000;
  let remaining = state.paused ? state.remaining_ms : Math.max(0, state.phase_ends_at - Date.now());
  remaining = Math.min(remaining, total);
  return { sec: Math.ceil(remaining / 1000), frac: Math.max(0, remaining / total) };
}

export default function HostRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const { state, redirectTo } = useRoomState(code, "host", null);

  useEffect(() => {
    if (redirectTo) nav(`/host/${redirectTo}`);
  }, [redirectTo, nav]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("click", unlock, { once: true });
    return () => document.removeEventListener("click", unlock);
  }, []);

  const cmd = (path) => http.post(`/rooms/${code}/${path}`).catch((e) => {
    if (e?.response?.data?.detail) alert(e.response.data.detail);
  });

  if (!state) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-cyan-400" size={48} /></div>;
  }

  const phase = state.phase;

  return (
    <div className="min-h-screen w-full grid-bg relative overflow-hidden">
      {state.status === "lobby" && <Lobby state={state} code={code} cmd={cmd} />}
      {phase === "preview" && <Preview state={state} />}
      {(phase === "active" || phase === "sudden_death") && <Active state={state} cmd={cmd} />}
      {phase === "reveal" && <RevealDispatch state={state} cmd={cmd} />}
      {phase === "leaderboard" && <Leaderboard state={state} cmd={cmd} />}
      {phase === "podium" && <Podium state={state} code={code} cmd={cmd} nav={nav} />}

      {state.empty_side && state.status === "playing" && <EmptyOverlay state={state} code={code} />}
    </div>
  );
}

function RevealDispatch({ state, cmd }) {
  const qtype = state.question?.type || state.game_type;
  if (qtype === "memory") return <MemoryReveal state={state} cmd={cmd} />;
  if (qtype === "reaction") return <ReactionReveal state={state} cmd={cmd} />;
  if (qtype === "tap") return <TapReveal state={state} cmd={cmd} />;
  if (qtype === "sequence" || qtype === "grid") return <RoundReveal state={state} cmd={cmd} />;
  return <Reveal state={state} cmd={cmd} />;
}

function HostControls({ state, cmd }) {
  return (
    <div className="fixed top-5 right-5 z-30 flex gap-3">
      {state.paused ? (
        <CtrlBtn testid="resume-btn" onClick={() => cmd("resume")} icon={<Play size={18} />}>Resume</CtrlBtn>
      ) : (
        <CtrlBtn testid="pause-btn" onClick={() => cmd("pause")} icon={<Pause size={18} />}>Pause</CtrlBtn>
      )}
      <CtrlBtn testid="skip-btn" onClick={() => cmd("skip")} icon={<SkipForward size={18} />}>Skip</CtrlBtn>
    </div>
  );
}
function CtrlBtn({ children, onClick, icon, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 font-bold text-sm uppercase tracking-widest transition-colors">
      {icon}{children}
    </button>
  );
}

function SideName(state, s) {
  return state.sides[s]?.name || `Side ${s}`;
}

function Lobby({ state, code, cmd }) {
  const origin = window.location.origin;
  const canStart = state.sides.A.players.length >= 1 && state.sides.B.players.length >= 1 && state.questions_ready;

  const SideCol = ({ s }) => {
    const color = SIDE_COLOR[s];
    const players = state.sides[s].players;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative"
        style={{ background: `radial-gradient(circle at 50% 30%, ${color}22, transparent 70%)` }}>
        <h2 className="text-3xl font-black font-heading mb-6" style={{ color }} data-testid={`side-${s}-name`}>
          {SideName(state, s)}
        </h2>
        <div className="bg-white p-4 rounded-2xl mb-4">
          <QRCodeCanvas value={`${origin}/join/${code}/${s}`} size={180} data-testid={`qr-${s}`} />
        </div>
        <div className="text-center mb-6">
          <span className="text-2xl font-black tracking-[0.3em]">{code}</span>
          <span className="ml-2 px-2 py-1 rounded-lg font-black text-black" style={{ background: color }}>{s}</span>
        </div>
        <div className="w-full max-w-xs space-y-2" data-testid={`side-${s}-players`}>
          {players.length === 0 && <p className="text-center text-white/30 italic">Waiting for players…</p>}
          {players.map((p) => (
            <div key={p.id} className={`flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 ${!p.connected ? "opacity-40" : ""}`}>
              {p.is_master && <Star size={14} className="text-yellow-400 fill-yellow-400" />}
              {p.is_captain && <Crown size={14} className="text-yellow-400" />}
              <span className="font-semibold">{p.name}</span>
              {p.is_master && <span className="ml-auto text-[10px] uppercase tracking-widest text-yellow-400/70">Master</span>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="text-center pt-8">
        <h1 className="text-2xl font-black font-heading gradient-text uppercase tracking-widest">Versus Lobby</h1>
        <p className="text-white/40 text-sm mt-1">{state.mode === "team" ? "Team vs Team" : "1 vs 1"} · {(state.game_type || "quiz")[0].toUpperCase() + (state.game_type || "quiz").slice(1)}{state.game_type === "quiz" ? ` · ${state.topic}` : ""} · {state.num_questions} {state.game_type === "quiz" ? "questions" : "rounds"}</p>
      </div>
      <div className="flex-1 flex">
        <SideCol s="A" />
        <div className="w-px bg-white/10" />
        <SideCol s="B" />
      </div>
      <div className="flex justify-center pb-10">
        <button data-testid="start-game-btn" disabled={!canStart} onClick={() => cmd("start")}
          className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-full px-12 py-5 text-lg hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 disabled:hover:scale-100">
          {!state.questions_ready ? <><Loader2 className="animate-spin" /> Preparing questions…</>
            : <><Play /> Start Game</>}
        </button>
      </div>
    </div>
  );
}

function Preview({ state }) {
  const { sec } = useCountdown(state);
  const questionNumber = state.question?.number;
  const roundPlayedRef = useRef(null);

  useEffect(() => {
    if (questionNumber && roundPlayedRef.current !== questionNumber) {
      roundPlayedRef.current = questionNumber;
      playSound("round");
    }
  }, [questionNumber]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      {state.question?.double_points && (
        <div className="flex items-center gap-2 px-6 py-2 rounded-full bg-yellow-400/15 border border-yellow-400/40 text-yellow-300 font-black uppercase tracking-widest mb-6 animate-pulse" data-testid="double-points-banner">
          <Sparkles size={18} /> Double Points!
        </div>
      )}
      <p className="text-2xl uppercase tracking-[0.4em] text-white/40 mb-4">Question {state.question?.number} / {state.total_questions}</p>
      <p className="text-xl font-bold text-cyan-400 mb-10">{state.question?.category}</p>
      <div className="text-[16vw] font-black font-heading gradient-text animate-pop-in" key={sec} data-testid="preview-countdown">{sec}</div>
      <p className="text-white/40 uppercase tracking-widest mt-6">Get ready</p>
    </div>
  );
}

function TimerFooter({ state }) {
  const { sec, frac } = useCountdown(state);
  const questionNumber = state.question?.number;
  const tickedRef = useRef(null);

  useEffect(() => {
    const inTimedPhase = state.phase === "active" || state.phase === "sudden_death";
    if (inTimedPhase && sec === 3 && tickedRef.current !== questionNumber) {
      tickedRef.current = questionNumber;
      playSound("tick");
    }
    if (!inTimedPhase) {
      tickedRef.current = null;
    }
  }, [sec, state.phase, questionNumber]);

  return (
    <>
      <div className="w-full h-5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-100 ease-linear"
          style={{ width: `${frac * 100}%`, background: sec <= 5 ? "#FF3366" : "linear-gradient(90deg,#7c3aed,#06b6d4)" }} />
      </div>
      <p className="text-center text-4xl font-black font-heading mt-4">{state.paused ? "PAUSED" : sec}</p>
    </>
  );
}

function ActiveHeader({ state }) {
  const q = state.question || {};
  const answered = state.answered_ids?.length || 0;
  const totalConn = state.connected_count || 0;
  return (
    <div className="flex items-center justify-between mb-6">
      <span className="text-white/40 uppercase tracking-widest font-bold">
        {state.phase === "sudden_death" ? "Sudden Death" : `${q.category} · ${q.number}/${state.total_questions}`}
      </span>
      <span className="text-white/40 uppercase tracking-widest font-bold" data-testid="answered-count">{answered}/{totalConn} answered</span>
    </div>
  );
}

function Active({ state, cmd }) {
  const qtype = state.question?.type || state.game_type || "quiz";
  const answeredCount = state.answered_ids?.length || 0;
  const questionNumber = state.question?.number;
  const prevCountRef = useRef(0);
  const prevQuestionRef = useRef(null);

  useEffect(() => {
    if (prevQuestionRef.current !== questionNumber) {
      prevQuestionRef.current = questionNumber;
      prevCountRef.current = 0;
    }
    if (answeredCount > prevCountRef.current) {
      const prev = prevCountRef.current;
      if (prev < 1 && answeredCount >= 1) playSound("answer1");
      if (prev < 2 && answeredCount >= 2) playSound("answer2");
      prevCountRef.current = answeredCount;
    }
  }, [answeredCount, questionNumber]);

  if (qtype === "reaction") return <ReactionActive state={state} cmd={cmd} />;
  if (qtype === "memory") return <MemoryActive state={state} cmd={cmd} />;
  if (qtype === "sequence") return <SequenceActive state={state} cmd={cmd} />;
  if (qtype === "grid") return <GridActive state={state} cmd={cmd} />;
  if (qtype === "tap") return <TapActive state={state} cmd={cmd} />;
  return <QuizActive state={state} cmd={cmd} />;
}

function StreakStrip({ state }) {
  const streakers = [];
  ["A", "B"].forEach((s) => (state.sides[s]?.players || []).forEach((p) => {
    if ((p.streak || 0) >= 2) streakers.push({ ...p, side: s });
  }));
  if (streakers.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 justify-center mb-6" data-testid="streak-strip">
      {streakers.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/15 border border-orange-400/30">
          <Flame size={16} className="text-orange-400" />
          <span className="font-bold text-sm" style={{ color: SIDE_COLOR[p.side] }}>{p.name}</span>
          <span className="text-orange-300 font-black text-sm">×{p.streak}</span>
        </div>
      ))}
    </div>
  );
}

function QuizActive({ state, cmd }) {
  const q = state.question || {};
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <ActiveHeader state={state} />
      {q.double_points && (
        <div className="flex justify-center mb-4">
          <div className="flex items-center gap-2 px-5 py-1.5 rounded-full bg-yellow-400/15 border border-yellow-400/40 text-yellow-300 font-black uppercase tracking-widest text-sm animate-pulse" data-testid="double-points-banner">
            <Sparkles size={16} /> Double Points!
          </div>
        </div>
      )}
      <StreakStrip state={state} />
      <div className="flex-1 flex items-center justify-center">
        <h2 className="text-[3.5vw] leading-tight text-center max-w-6xl font-black font-heading" data-testid="host-question">{q.question}</h2>
      </div>
      <div className="grid grid-cols-2 gap-6 mb-8">
        {(q.options || []).map((opt, i) => (
          <div key={i} data-testid={`host-option-${i}`}
            className="h-28 flex items-center gap-5 px-8 rounded-2xl font-bold text-2xl"
            style={{ background: ANSWERS[i].color, color: ANSWERS[i].text }}>
            <ShapeIcon index={i} size={40} />
            <span>{opt}</span>
          </div>
        ))}
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function ReactionActive({ state, cmd }) {
  const q = state.question || {};
  const live = q.reaction_live;
  const target = q.target;
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <ActiveHeader state={state} />
      <div className="flex-1 flex flex-col items-center justify-center">
        <h2 className={`text-[4vw] font-black font-heading mb-10 ${live ? "text-green-400 animate-pulse" : "text-white/40"}`} data-testid="host-question">
          {live ? "GO! TAP IT!" : "Wait for the light…"}
        </h2>
        <div className="grid grid-cols-2 gap-8 w-full max-w-3xl">
          {ANSWERS.map((a, i) => {
            const isTarget = live && i === target;
            const isDecoy = !live && i === q.decoy;
            return (
              <div key={i} data-testid={`reaction-cell-${i}`}
                className={`h-40 rounded-3xl flex items-center justify-center transition-all ${isTarget ? "scale-105 animate-pulse" : ""}`}
                style={{ background: isTarget ? a.color : isDecoy ? a.color + "4D" : "#12121f", boxShadow: isTarget ? `0 0 60px ${a.color}` : "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
                {isTarget && <ShapeIcon index={i} size={64} />}
              </div>
            );
          })}
        </div>
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function MemoryActive({ state, cmd }) {
  const done = new Set(state.answered_ids || []);
  const progress = state.progress || {};
  const totalPairs = state.question?.pairs || 1;
  const players = [];
  ["A", "B"].forEach((s) => state.sides[s].players.forEach((p) => players.push({ ...p, side: s })));
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <ActiveHeader state={state} />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Brain size={72} className="text-violet-400 mb-4" />
        <h2 className="text-[3vw] font-black font-heading mb-10 text-center" data-testid="host-question">Match the pairs on your phone!</h2>
        <div className="grid grid-cols-2 gap-6 w-full max-w-4xl">
          {players.map((p) => {
            const solved = done.has(p.id);
            const matchedPairs = Math.min(totalPairs, progress[p.id] || 0);
            return (
              <div key={p.id} className="flex flex-col gap-3 px-6 py-4 rounded-2xl border" data-testid={`memory-player-${p.id}`}
                style={{ borderColor: SIDE_COLOR[p.side] + "55", background: SIDE_COLOR[p.side] + "11" }}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xl">{p.name}</span>
                  {solved
                    ? <span className="font-black text-green-400 uppercase tracking-widest">Solved ✓</span>
                    : <span className="text-white/40 uppercase tracking-widest text-sm">{matchedPairs}/{totalPairs} pairs</span>}
                </div>
                <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${((solved ? totalPairs : matchedPairs) / totalPairs) * 100}%`, background: SIDE_COLOR[p.side] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function SequenceActive({ state, cmd }) {
  const done = new Set(state.answered_ids || []);
  const progress = state.progress || {};
  const players = [];
  ["A", "B"].forEach((s) => state.sides[s].players.forEach((p) => players.push({ ...p, side: s })));
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <ActiveHeader state={state} />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Waypoints size={72} className="text-violet-400 mb-4" />
        <h2 className="text-[3vw] font-black font-heading mb-10 text-center" data-testid="host-question">Repeat the pattern on your phone!</h2>
        <div className="grid grid-cols-2 gap-6 w-full max-w-4xl">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-6 py-4 rounded-2xl border" data-testid={`sequence-player-${p.id}`}
              style={{ borderColor: SIDE_COLOR[p.side] + "55", background: SIDE_COLOR[p.side] + "11" }}>
              <span className="font-bold text-xl">{p.name}</span>
              {done.has(p.id)
                ? <span className="font-black text-red-400 uppercase tracking-widest">Out ✗</span>
                : <span className="text-white/40 uppercase tracking-widest">Level {progress[p.id] || 0}</span>}
            </div>
          ))}
        </div>
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function GridActive({ state, cmd }) {
  const done = new Set(state.answered_ids || []);
  const progress = state.progress || {};
  const players = [];
  ["A", "B"].forEach((s) => state.sides[s].players.forEach((p) => players.push({ ...p, side: s })));
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <ActiveHeader state={state} />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Crosshair size={72} className="text-violet-400 mb-4" />
        <h2 className="text-[3vw] font-black font-heading mb-10 text-center" data-testid="host-question">Whack the lit cells on your phone!</h2>
        <div className="grid grid-cols-2 gap-6 w-full max-w-4xl">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-6 py-4 rounded-2xl border" data-testid={`grid-player-${p.id}`}
              style={{ borderColor: SIDE_COLOR[p.side] + "55", background: SIDE_COLOR[p.side] + "11" }}>
              <span className="font-bold text-xl">{p.name}</span>
              {done.has(p.id)
                ? <span className="font-black text-green-400 uppercase tracking-widest">Done ✓</span>
                : <span className="text-white/40 uppercase tracking-widest">{progress[p.id] || 0} hits</span>}
            </div>
          ))}
        </div>
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function TapActive({ state, cmd }) {
  const totals = state.tap_totals || { A: 0, B: 0 };
  const sum = totals.A + totals.B || 1;
  const pct = 50 + 50 * (totals.A - totals.B) / sum;
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <div className="flex items-center justify-between mb-6">
        <span className="text-white/40 uppercase tracking-widest font-bold">Tap Battle</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-10">
        <Swords size={72} className="text-violet-400 animate-pulse" />
        <div className="flex items-center gap-8 w-full max-w-3xl">
          <span className="text-5xl font-black font-heading" style={{ color: SIDE_COLOR.A }} data-testid="tap-total-a">{totals.A}</span>
          <div className="flex-1 h-8 rounded-full bg-white/10 overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 transition-all duration-150" style={{ width: `${pct}%`, background: SIDE_COLOR.A }} />
            <div className="absolute inset-y-0 right-0 transition-all duration-150" style={{ width: `${100 - pct}%`, background: SIDE_COLOR.B }} />
            <div className="absolute inset-y-0 w-1 bg-white/60" style={{ left: "50%" }} />
          </div>
          <span className="text-5xl font-black font-heading" style={{ color: SIDE_COLOR.B }} data-testid="tap-total-b">{totals.B}</span>
        </div>
        <p className="text-white/40 uppercase tracking-widest">MASH!</p>
      </div>
      <TimerFooter state={state} />
    </div>
  );
}

function MemoryReveal({ state, cmd }) {
  const results = state.results || {};
  const players = [];
  ["A", "B"].forEach((s) => state.sides[s].players.forEach((p) => players.push({ ...p, side: s })));
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <h2 className="text-4xl font-black font-heading text-center gradient-text mb-3 uppercase tracking-widest">Round Results</h2>
      {state.fastest && (
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/30" data-testid="fastest-player">
            <Zap size={18} className="text-yellow-400" />
            <span className="font-bold">Fastest solver: {state.fastest.name} ({(state.fastest.time_ms / 1000).toFixed(1)}s)</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
        {["A", "B"].map((s) => (
          <div key={s}>
            <h4 className="font-black text-2xl mb-3" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</h4>
            <div className="space-y-2">
              {state.sides[s].players.map((p) => {
                const r = results[p.id];
                return (
                  <div key={p.id} className="flex items-center justify-between px-5 py-3 rounded-2xl bg-white/5">
                    <span className="font-bold">{p.name}</span>
                    {r?.done
                      ? <span className="text-green-400 font-bold">{(r.time_ms / 1000).toFixed(1)}s · {r.mistakes} miss · +{r.points}</span>
                      : <span className="text-red-400 font-bold">Time's up · +0</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReactionReveal({ state, cmd }) {
  const results = state.results || {};
  let fastestSide = null;
  let fastestMs = Infinity;
  ["A", "B"].forEach((s) => {
    state.sides[s].players.forEach((p) => {
      const r = results[p.id];
      if (r?.correct && r.time_ms < fastestMs) {
        fastestMs = r.time_ms;
        fastestSide = s;
      }
    });
  });
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <h2 className="text-4xl font-black font-heading text-center gradient-text mb-3 uppercase tracking-widest">Round Results</h2>
      {state.fastest && (
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/30" data-testid="fastest-player">
            <Zap size={18} className="text-yellow-400" />
            <span className="font-bold">Fastest: {state.fastest.name} ({state.fastest.time_ms}ms)</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
        {["A", "B"].map((s) => (
          <div key={s} className={fastestSide === s ? "rounded-2xl ring-2 ring-yellow-400/40 p-2 -m-2" : ""}>
            <h4 className="font-black text-2xl mb-3" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</h4>
            <div className="space-y-2">
              {state.sides[s].players.map((p) => {
                const r = results[p.id];
                let label;
                if (!r) label = <span className="text-white/40 font-bold">No tap · +0</span>;
                else if (r.false_start) label = <span className="text-red-400 font-bold">False start · +0</span>;
                else if (r.correct) label = <span className="text-green-400 font-bold">{r.time_ms}ms · +{r.points}</span>;
                else label = <span className="text-red-400 font-bold">Missed · +0</span>;
                return (
                  <div key={p.id} className="flex items-center justify-between px-5 py-3 rounded-2xl bg-white/5">
                    <span className="font-bold">{p.name}</span>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoundReveal({ state, cmd }) {
  const qtype = state.question?.type;
  const results = state.results || {};
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <h2 className="text-4xl font-black font-heading text-center gradient-text mb-3 uppercase tracking-widest">Round Results</h2>
      {state.fastest && (
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/30" data-testid="fastest-player">
            <Zap size={18} className="text-yellow-400" />
            <span className="font-bold">Fastest: {state.fastest.name} ({(state.fastest.time_ms / 1000).toFixed(1)}s)</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
        {["A", "B"].map((s) => (
          <div key={s}>
            <h4 className="font-black text-2xl mb-3" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</h4>
            <div className="space-y-2">
              {state.sides[s].players.map((p) => {
                const r = results[p.id];
                let label;
                if (!r) label = <span className="text-red-400 font-bold">No run · +0</span>;
                else if (qtype === "sequence") label = <span className="text-green-400 font-bold">Level {r.reached ?? 0} · +{r.points}</span>;
                else label = <span className="text-green-400 font-bold">{r.hits ?? 0} hits · {r.bombs ?? 0} bombs · +{r.points}</span>;
                return (
                  <div key={p.id} className="flex items-center justify-between px-5 py-3 rounded-2xl bg-white/5">
                    <span className="font-bold">{p.name}</span>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TapReveal({ state, cmd }) {
  const totals = state.tap_totals || { A: 0, B: 0 };
  const sum = totals.A + totals.B || 1;
  const pct = 50 + 50 * (totals.A - totals.B) / sum;
  const results = state.results || {};
  const winnerSide = totals.A === totals.B ? null : totals.A > totals.B ? "A" : "B";
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <h2 className="text-4xl font-black font-heading text-center gradient-text mb-8 uppercase tracking-widest">Round Results</h2>
      <div className="flex items-center gap-8 w-full max-w-3xl mx-auto mb-10">
        <span className="text-5xl font-black font-heading" style={{ color: SIDE_COLOR.A }}>{totals.A}</span>
        <div className="flex-1 h-8 rounded-full bg-white/10 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: SIDE_COLOR.A }} />
          <div className="absolute inset-y-0 right-0" style={{ width: `${100 - pct}%`, background: SIDE_COLOR.B }} />
        </div>
        <span className="text-5xl font-black font-heading" style={{ color: SIDE_COLOR.B }}>{totals.B}</span>
      </div>
      {winnerSide && (
        <p className="text-center font-black uppercase tracking-widest mb-8" style={{ color: SIDE_COLOR[winnerSide] }}>
          {SideName(state, winnerSide)} wins the tug of war!
        </p>
      )}
      <div className="grid grid-cols-2 gap-8 max-w-5xl mx-auto w-full">
        {["A", "B"].map((s) => (
          <div key={s}>
            <h4 className="font-black text-2xl mb-3" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</h4>
            <div className="space-y-2">
              {state.sides[s].players.map((p) => {
                const r = results[p.id];
                return (
                  <div key={p.id} className="flex items-center justify-between px-5 py-3 rounded-2xl bg-white/5">
                    <span className="font-bold">{p.name}</span>
                    <span className="text-green-400 font-bold">{r?.taps ?? 0} taps · +{r?.points ?? 0}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Reveal({ state, cmd }) {
  const q = state.question || {};
  const ci = q.correct_index;
  const dist = state.distribution || [0, 0, 0, 0];
  const maxD = Math.max(1, ...dist);
  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <div className="flex-1 flex flex-col items-center justify-center max-w-6xl mx-auto w-full">
        <h2 className="text-[3vw] leading-tight text-center font-black font-heading mb-8">{q.question}</h2>

        <div className="grid grid-cols-2 gap-5 w-full mb-6">
          {(q.options || []).map((opt, i) => {
            const correct = i === ci;
            return (
              <motion.div key={i} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: correct ? 1.03 : 1, opacity: correct ? 1 : 0.35 }}
                data-testid={`reveal-option-${i}`}
                className="h-24 flex items-center justify-between px-6 rounded-2xl font-bold text-xl relative"
                style={{ background: ANSWERS[i].color, color: ANSWERS[i].text, boxShadow: correct ? "0 0 40px rgba(0,255,102,0.6)" : "none" }}>
                <div className="flex items-center gap-4"><ShapeIcon index={i} size={32} /><span>{opt}</span></div>
                <div className="flex items-center gap-3">
                  {correct && <span className="text-3xl">✓</span>}
                  <span className="text-lg opacity-70">{dist[i]}</span>
                  <div className="w-16 h-3 rounded-full bg-black/20 overflow-hidden">
                    <div className="h-full bg-black/50" style={{ width: `${(dist[i] / maxD) * 100}%` }} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {q.explanation && <p className="text-white/60 text-lg text-center mb-4 max-w-3xl" data-testid="reveal-explanation">{q.explanation}</p>}
        {state.fastest && (
          <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-yellow-400/10 border border-yellow-400/30" data-testid="fastest-player">
            <Zap size={18} className="text-yellow-400" />
            <span className="font-bold">Fastest: {state.fastest.name} ({(state.fastest.time_ms / 1000).toFixed(1)}s)</span>
          </div>
        )}

        {state.mode === "team" && (
          <div className="flex gap-8 mt-8 w-full max-w-4xl">
            {["A", "B"].map((s) => (
              <div key={s} className="flex-1">
                <h4 className="font-black mb-2" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</h4>
                <div className="space-y-1">
                  {state.sides[s].players.map((p) => {
                    const r = state.results?.[p.id];
                    return (
                      <div key={p.id} className="flex justify-between text-sm px-3 py-1 rounded-lg bg-white/5">
                        <span>{p.name}</span>
                        <span className={r?.correct ? "text-green-400" : "text-red-400"}>{r ? `+${r.points}` : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ state, cmd }) {
  const players = useMemo(() => {
    const list = [];
    ["A", "B"].forEach((s) => state.sides[s].players.forEach((p) => list.push({ ...p, side: s })));
    return list.sort((a, b) => b.total - a.total);
  }, [state]);

  return (
    <div className="min-h-screen flex flex-col p-10">
      <HostControls state={state} cmd={cmd} />
      <h2 className="text-4xl font-black font-heading text-center gradient-text mb-10 uppercase tracking-widest">Leaderboard</h2>

      <div className="flex gap-8 justify-center mb-10">
        {["A", "B"].map((s) => (
          <div key={s} className="flex-1 max-w-md text-center rounded-3xl p-8 border"
            style={{ borderColor: SIDE_COLOR[s] + "55", background: SIDE_COLOR[s] + "11" }} data-testid={`lb-side-${s}`}>
            <p className="font-black text-2xl mb-2" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</p>
            <motion.p key={state.sides[s].total} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-6xl font-black font-heading">
              {state.sides[s].total}
            </motion.p>
          </div>
        ))}
      </div>

      <div className="max-w-2xl w-full mx-auto space-y-3">
        {players.map((p, i) => (
          <motion.div key={p.id} layout transition={{ duration: 0.7, ease: "easeInOut" }}
            className="flex items-center gap-4 px-5 py-3 rounded-2xl bg-white/5 border-l-4"
            style={{ borderColor: SIDE_COLOR[p.side] }}>
            <span className="text-2xl font-black w-8 text-white/40">{i + 1}</span>
            <span className="flex-1 font-bold text-lg flex items-center gap-2">
              {p.name}
              {(p.streak || 0) >= 2 && (
                <span className="flex items-center gap-0.5 text-orange-400 text-sm font-black">
                  <Flame size={14} />×{p.streak}
                </span>
              )}
            </span>
            <span className="text-2xl font-black font-heading">{p.total}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Podium({ state, code, cmd, nav }) {
  const fired = useRef(false);
  const podium = state.podium || {};
  const winner = podium.winner;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const end = Date.now() + 2500;
    const frame = () => {
      confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ["#06B6D4", "#EC4899", "#7c3aed"] });
      confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ["#06B6D4", "#EC4899", "#FFD700"] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  const winnerLabel = winner === "tie" ? "It's a tie!" : `${SideName(state, winner)} wins!`;
  const players = podium.players || [];
  const [showNew, setShowNew] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);

  return (
    <div className="min-h-screen flex flex-col items-center p-10 overflow-y-auto no-scrollbar">
      <Trophy size={72} className="text-yellow-400 mb-4 animate-pop-in" />
      <h1 className="text-6xl font-black font-heading mb-2 gradient-text text-center" data-testid="podium-winner">{winnerLabel}</h1>
      {podium.tiebreaker && podium.tiebreaker !== "score" && (
        <p className="text-white/40 uppercase tracking-widest text-sm mb-6">Won on {podium.tiebreaker.replace("_", " ")}</p>
      )}

      <div className="flex gap-10 my-8">
        {["A", "B"].map((s) => (
          <div key={s} className="text-center">
            <p className="font-black text-xl" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)}</p>
            <p className="text-5xl font-black font-heading">{podium.sides?.[s]?.total ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="max-w-2xl w-full space-y-3 mb-10">
        {players.map((p, i) => (
          <div key={p.id} className="flex items-center gap-4 px-5 py-3 rounded-2xl bg-white/5 border-l-4" style={{ borderColor: SIDE_COLOR[p.side] }}>
            <span className="text-xl font-black w-6 text-white/40">{i + 1}</span>
            <div className="flex-1">
              <p className="font-bold">{p.name}</p>
              <p className="text-xs text-white/40">Acc {p.accuracy}% · Avg {(p.avg_time_ms / 1000).toFixed(1)}s · Best streak {p.best_streak}</p>
            </div>
            <span className="text-2xl font-black font-heading">{p.total}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 justify-center">
        <button data-testid="rematch-btn" onClick={() => cmd("rematch")}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-full px-8 py-4 hover:scale-105 active:scale-95 transition-transform">
          <Zap /> Rematch
        </button>
        <button data-testid="new-game-btn" onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 font-black uppercase tracking-widest rounded-full px-8 py-4 transition-colors">
          <Users /> New Game
        </button>
        <button data-testid="new-room-btn" onClick={() => setShowNewRoom(true)}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 font-black uppercase tracking-widest rounded-full px-8 py-4 transition-colors">
          <Sparkles /> New Room
        </button>
        <button data-testid="exit-btn" onClick={() => nav("/setup")}
          className="flex items-center gap-2 text-white/40 hover:text-white/70 font-bold uppercase tracking-widest rounded-full px-6 py-4 transition-colors">
          Fresh Room
        </button>
      </div>
      <p className="text-white/30 text-xs mt-4 text-center max-w-md">
        Rematch &amp; New Game keep the same players — no need to scan the QR codes again.
      </p>

      {showNew && <NewGameOverlay state={state} code={code} onClose={() => setShowNew(false)} />}
      {showNewRoom && <NewRoomOverlay state={state} code={code} nav={nav} onClose={() => setShowNewRoom(false)} />}
    </div>
  );
}

function NewGameOverlay({ state, code, onClose }) {
  const [busy, setBusy] = useState(false);

  const submit = async (values) => {
    setBusy(true);
    try {
      await http.post(`/rooms/${code}/reconfigure`, {
        game_type: values.gameType, topic: values.topic || "General knowledge", difficulty: values.difficulty,
        num_questions: values.num, time_per_question: values.tpq, language: values.language,
      });
      onClose();
    } catch (e) {
      setBusy(false);
      alert("Could not start a new game. Try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6" data-testid="newgame-overlay">
      <div className="bg-[#0A0A14] border border-white/10 rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black font-heading gradient-text">New Game · Same Players</h2>
          <button data-testid="newgame-close" onClick={onClose} className="text-white/40 hover:text-white"><X /></button>
        </div>
        <GameSettingsForm
          initial={{
            gameType: state.game_type || "quiz",
            topic: state.game_type === "quiz" ? state.topic : "",
            difficulty: state.difficulty || "mixed",
            num: state.num_questions || 10,
            tpq: state.time_per_question || 15,
            language: state.language || "en",
          }}
          showMode={false}
          busy={busy}
          submitLabel="Back to Lobby"
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

function NewRoomOverlay({ state, code, nav, onClose }) {
  const [busy, setBusy] = useState(false);

  const submit = async (values) => {
    setBusy(true);
    try {
      const r = await http.post(`/rooms/${code}/new-room`, {
        mode: values.mode, game_type: values.gameType,
        topic: values.topic || "General knowledge", difficulty: values.difficulty,
        num_questions: values.num, time_per_question: values.tpq, language: values.language,
      });
      nav(`/host/${r.data.code}`);
    } catch (e) {
      setBusy(false);
      alert("Could not create a new room. Try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6" data-testid="newroom-overlay">
      <div className="bg-[#0A0A14] border border-white/10 rounded-3xl p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black font-heading gradient-text">New Room · Fresh Code</h2>
          <button data-testid="newroom-close" onClick={onClose} className="text-white/40 hover:text-white"><X /></button>
        </div>
        <p className="text-white/40 text-xs mb-5">Connected players carry over automatically — no need to rescan.</p>
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
          showMode={true}
          busy={busy}
          submitLabel="Create Room"
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

function EmptyOverlay({ state, code }) {
  const s = state.empty_side;
  const origin = window.location.origin;
  return (
    <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center" data-testid="empty-side-overlay">
      <h2 className="text-4xl font-black font-heading mb-2" style={{ color: SIDE_COLOR[s] }}>{SideName(state, s)} is empty!</h2>
      <p className="text-white/50 mb-6">Game paused. Rejoin to continue.</p>
      <div className="bg-white p-4 rounded-2xl">
        <QRCodeCanvas value={`${origin}/join/${code}/${s}`} size={200} />
      </div>
      <p className="mt-4 text-xl font-black tracking-[0.3em]">{code} · {s}</p>
    </div>
  );
}
