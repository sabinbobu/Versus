import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { http } from "../lib/api";
import { Users, User, Sparkles, ArrowLeft, Loader2, BookOpen, Zap, Brain, Waypoints, Crosshair, Swords } from "lucide-react";

const TOPICS = ["90s pop music", "World geography", "Champions League history", "Space & astronomy", "Movie villains", "Food & cuisine"];

const GAME_TYPES = [
  { id: "quiz", label: "Quiz", Icon: BookOpen, desc: "AI trivia on any topic" },
  { id: "reaction", label: "Reaction", Icon: Zap, desc: "Tap the shape that lights up" },
  { id: "memory", label: "Memory", Icon: Brain, desc: "Flip & match the pairs" },
  { id: "sequence", label: "Sequence", Icon: Waypoints, desc: "Repeat the growing pattern" },
  { id: "grid", label: "Grid Hunt", Icon: Crosshair, desc: "Whack the moles, dodge bombs" },
  { id: "tap", label: "Tap Battle", Icon: Swords, desc: "Tug of war — mash faster!" },
];

// Which settings each game type exposes.
const CAPS = {
  quiz: { topic: true, difficulty: true, tpq: true, language: true },
  reaction: { topic: false, difficulty: false, tpq: true, language: false },
  memory: { topic: false, difficulty: true, tpq: false, language: false },
  sequence: { topic: false, difficulty: false, tpq: false, language: false },
  grid: { topic: false, difficulty: false, tpq: false, language: false },
  tap: { topic: false, difficulty: false, tpq: false, language: false },
};

function Pill({ active, onClick, children, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`px-5 py-3 rounded-2xl font-bold transition-all border ${
        active
          ? "bg-gradient-to-r from-violet-600 to-cyan-400 text-black border-transparent scale-105"
          : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export default function Setup() {
  const nav = useNavigate();
  const [gameType, setGameType] = useState("quiz");
  const [mode, setMode] = useState("1v1");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("mixed");
  const [num, setNum] = useState(10);
  const [tpq, setTpq] = useState(15);
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);

  const openLobby = async () => {
    setLoading(true);
    try {
      const r = await http.post("/rooms", {
        mode, game_type: gameType, topic: topic || "General knowledge", difficulty,
        num_questions: num, time_per_question: tpq, language,
      });
      nav(`/host/${r.data.code}`);
    } catch (e) {
      setLoading(false);
      alert("Could not create the game. Try again.");
    }
  };

  const isQuiz = gameType === "quiz";
  const caps = CAPS[gameType] || CAPS.quiz;

  return (
    <div className="min-h-[100svh] grid-bg px-6 py-10 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <button onClick={() => nav("/")} className="flex items-center gap-2 text-white/50 hover:text-white mb-6 text-sm uppercase tracking-widest">
          <ArrowLeft size={16} /> Back
        </button>

        <h1 className="text-4xl sm:text-5xl font-black font-heading mb-2 gradient-text">Game Setup</h1>
        <p className="text-white/50 mb-10">Configure the battle. Questions generate while you fill the lobby.</p>

        <div className="space-y-8">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">Game Type</label>
            <div className="grid grid-cols-3 gap-3">
              {GAME_TYPES.map((g) => {
                const Icon = g.Icon;
                const active = gameType === g.id;
                return (
                  <button key={g.id} data-testid={`gametype-${g.id}-btn`} onClick={() => setGameType(g.id)}
                    className={`flex flex-col items-center gap-2 py-5 px-2 rounded-2xl border transition-all ${active ? "border-cyan-400 bg-cyan-400/10 scale-[1.02]" : "border-white/10 bg-white/5"}`}>
                    <Icon size={26} className={active ? "text-cyan-400" : "text-white/60"} />
                    <span className="font-bold text-sm">{g.label}</span>
                    <span className="text-[10px] text-white/40 text-center leading-tight">{g.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">Mode</label>
            <div className="grid grid-cols-2 gap-4">
              <button data-testid="mode-1v1-btn" onClick={() => setMode("1v1")}
                className={`flex items-center gap-3 justify-center py-5 rounded-2xl border font-bold transition-all ${mode === "1v1" ? "border-cyan-400 bg-cyan-400/10 scale-[1.02]" : "border-white/10 bg-white/5"}`}>
                <User /> 1 vs 1
              </button>
              <button data-testid="mode-team-btn" onClick={() => setMode("team")}
                className={`flex items-center gap-3 justify-center py-5 rounded-2xl border font-bold transition-all ${mode === "team" ? "border-sideb bg-pink-500/10 scale-[1.02]" : "border-white/10 bg-white/5"}`}>
                <Users /> Team vs Team
              </button>
            </div>
          </div>

          {caps.topic && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">Topic</label>
              <input data-testid="topic-input" value={topic} onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. 90s pop music, world geography…"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg outline-none focus:border-cyan-400 mb-3" />
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((t) => (
                  <button key={t} data-testid={`topic-chip-${t}`} onClick={() => setTopic(t)}
                    className="text-sm px-3 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white transition-colors">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {caps.difficulty && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">
                Difficulty{gameType === "memory" && " (sets grid size)"}
              </label>
              <div className="flex flex-wrap gap-3">
                {["easy", "medium", "hard", "mixed"].map((d) => (
                  <Pill key={d} testid={`difficulty-${d}`} active={difficulty === d} onClick={() => setDifficulty(d)}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </Pill>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">{isQuiz ? "Questions" : "Rounds"}</label>
            <div className="flex gap-3">
              {[5, 10, 15].map((n) => (
                <Pill key={n} testid={`num-${n}`} active={num === n} onClick={() => setNum(n)}>{n}</Pill>
              ))}
            </div>
          </div>

          {caps.tpq && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">
                {isQuiz ? "Time per question" : "Time per round"}
              </label>
              <div className="flex gap-3">
                {[10, 15, 20, 30].map((t) => (
                  <Pill key={t} testid={`tpq-${t}`} active={tpq === t} onClick={() => setTpq(t)}>{t}s</Pill>
                ))}
              </div>
            </div>
          )}

          {caps.language && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] font-bold text-white/50 block mb-3">Language</label>
              <div className="flex gap-3">
                <Pill testid="lang-en" active={language === "en"} onClick={() => setLanguage("en")}>English</Pill>
                <Pill testid="lang-ro" active={language === "ro"} onClick={() => setLanguage("ro")}>Română</Pill>
              </div>
            </div>
          )}

          <button data-testid="open-lobby-btn" disabled={loading} onClick={openLobby}
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-2xl py-5 text-lg hover:scale-[1.01] active:scale-95 transition-transform disabled:opacity-60">
            {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {loading ? "Creating…" : "Open Lobby"}
          </button>
        </div>
      </div>
    </div>
  );
}
