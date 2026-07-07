import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Swords, ArrowRight, Zap } from "lucide-react";

export default function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState("");

  return (
    <div className="min-h-[100svh] grid-bg flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-40"
        style={{ backgroundImage: "radial-gradient(circle at 50% 0%, rgba(124,58,237,0.25), transparent 55%)" }} />

      <div className="relative z-10 flex flex-col items-center text-center max-w-3xl animate-pop-in">
        <div className="flex items-center gap-3 mb-6 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-xl">
          <Zap size={16} className="text-cyan-400" />
          <span className="text-xs uppercase tracking-[0.3em] font-bold text-white/70">Real-time party quiz</span>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <Swords size={56} className="text-sideb" strokeWidth={2.5} />
          <h1 className="text-7xl sm:text-8xl font-black tracking-tighter font-heading gradient-text">VERSUS</h1>
        </div>

        <p className="text-lg sm:text-2xl text-white/60 mb-12 max-w-xl">
          Two players. Two teams. One screen. Battle head-to-head on any topic — questions generated live.
        </p>

        <button
          data-testid="create-game-btn"
          onClick={() => nav("/setup")}
          className="group flex items-center gap-3 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-full px-10 py-5 text-lg hover:scale-105 active:scale-95 transition-transform shadow-[0_0_40px_rgba(124,58,237,0.4)]"
        >
          Create Game
          <ArrowRight className="group-hover:translate-x-1 transition-transform" />
        </button>

        <div className="mt-14 flex items-center gap-3">
          <input
            data-testid="join-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="ROOM CODE"
            className="w-40 text-center tracking-[0.3em] font-bold uppercase bg-white/5 border border-white/15 rounded-full px-4 py-3 outline-none focus:border-cyan-400"
          />
          <button
            data-testid="join-code-btn"
            disabled={code.length < 4}
            onClick={() => nav(`/join/${code}`)}
            className="rounded-full px-6 py-3 font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors"
          >
            Join
          </button>
        </div>
      </div>

      <div className="absolute bottom-6 text-white/30 text-xs uppercase tracking-[0.3em]">
        One laptop · Two phones · Zero setup
      </div>
    </div>
  );
}
