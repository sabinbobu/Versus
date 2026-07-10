import React, { useState } from "react";
import { Loader2, Play, BookOpen, Zap, Brain, User, Users } from "lucide-react";

const TYPES = [
  { id: "quiz", label: "Quiz", Icon: BookOpen },
  { id: "reaction", label: "Reaction", Icon: Zap },
  { id: "memory", label: "Memory", Icon: Brain },
];

function Pill({ active, onClick, children, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`px-4 py-2 rounded-xl font-bold border transition-all ${active ? "bg-gradient-to-r from-violet-600 to-cyan-400 text-black border-transparent" : "bg-white/5 border-white/10 text-white/70"}`}>
      {children}
    </button>
  );
}

export default function GameSettingsForm({ initial = {}, showMode = false, busy = false, submitLabel, onSubmit }) {
  const [gameType, setGameType] = useState(initial.gameType || "quiz");
  const [mode, setMode] = useState(initial.mode || "1v1");
  const [topic, setTopic] = useState(initial.gameType === "quiz" ? (initial.topic || "") : "");
  const [difficulty, setDifficulty] = useState(initial.difficulty || "mixed");
  const [num, setNum] = useState(initial.num || 10);
  const [tpq, setTpq] = useState(initial.tpq || 15);
  const [language, setLanguage] = useState(initial.language || "en");
  const isQuiz = gameType === "quiz";
  const isMemory = gameType === "memory";

  const submit = () => {
    onSubmit({ gameType, topic, difficulty, num, tpq, language, mode });
  };

  return (
    <div>
      <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Game Type</label>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {TYPES.map((t) => {
          const Icon = t.Icon;
          const active = gameType === t.id;
          return (
            <button key={t.id} data-testid={`settingsform-type-${t.id}`} onClick={() => setGameType(t.id)}
              className={`flex flex-col items-center gap-1 py-4 rounded-2xl border transition-all ${active ? "border-cyan-400 bg-cyan-400/10" : "border-white/10 bg-white/5"}`}>
              <Icon size={22} className={active ? "text-cyan-400" : "text-white/60"} />
              <span className="text-sm font-bold">{t.label}</span>
            </button>
          );
        })}
      </div>

      {showMode && (
        <div className="mb-5">
          <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Mode</label>
          <div className="grid grid-cols-2 gap-3">
            <button data-testid="settingsform-mode-1v1" onClick={() => setMode("1v1")}
              className={`flex items-center gap-2 justify-center py-4 rounded-2xl border font-bold transition-all ${mode === "1v1" ? "border-cyan-400 bg-cyan-400/10" : "border-white/10 bg-white/5"}`}>
              <User size={18} /> 1 vs 1
            </button>
            <button data-testid="settingsform-mode-team" onClick={() => setMode("team")}
              className={`flex items-center gap-2 justify-center py-4 rounded-2xl border font-bold transition-all ${mode === "team" ? "border-pink-400 bg-pink-500/10" : "border-white/10 bg-white/5"}`}>
              <Users size={18} /> Team vs Team
            </button>
          </div>
        </div>
      )}

      {isQuiz && (
        <div className="mb-5">
          <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Topic</label>
          <input data-testid="settingsform-topic" value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. movie soundtracks" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-cyan-400" />
        </div>
      )}

      {(isQuiz || isMemory) && (
        <div className="mb-5">
          <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Difficulty</label>
          <div className="flex flex-wrap gap-2">
            {["easy", "medium", "hard", "mixed"].map((d) => (
              <Pill key={d} testid={`settingsform-diff-${d}`} active={difficulty === d} onClick={() => setDifficulty(d)}>{d[0].toUpperCase() + d.slice(1)}</Pill>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">{isQuiz ? "Questions" : "Rounds"}</label>
        <div className="flex gap-2">
          {[5, 10, 15].map((n) => <Pill key={n} testid={`settingsform-num-${n}`} active={num === n} onClick={() => setNum(n)}>{n}</Pill>)}
        </div>
      </div>

      {!isMemory && (
        <div className="mb-6">
          <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Time per {isQuiz ? "question" : "round"}</label>
          <div className="flex gap-2">
            {[10, 15, 20, 30].map((t) => <Pill key={t} testid={`settingsform-tpq-${t}`} active={tpq === t} onClick={() => setTpq(t)}>{t}s</Pill>)}
          </div>
        </div>
      )}

      {isQuiz && (
        <div className="mb-6">
          <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-2">Language</label>
          <div className="flex gap-2">
            <Pill testid="settingsform-lang-en" active={language === "en"} onClick={() => setLanguage("en")}>English</Pill>
            <Pill testid="settingsform-lang-ro" active={language === "ro"} onClick={() => setLanguage("ro")}>Română</Pill>
          </div>
        </div>
      )}

      <button data-testid="settingsform-submit" disabled={busy} onClick={submit}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-2xl py-4 hover:scale-[1.01] active:scale-95 transition-transform disabled:opacity-60">
        {busy ? <Loader2 className="animate-spin" /> : <Play />} {submitLabel}
      </button>
    </div>
  );
}
