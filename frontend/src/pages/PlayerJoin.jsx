import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { http, savePlayer, loadPlayer } from "../lib/api";
import { Loader2, ArrowRight } from "lucide-react";

const SIDE_COLOR = { A: "#06B6D4", B: "#EC4899" };

export default function PlayerJoin() {
  const { code, side: sideParam } = useParams();
  const nav = useNavigate();
  const [room, setRoom] = useState(null);
  const [side, setSide] = useState(sideParam || null);
  const [name, setName] = useState(() => {
    try { return JSON.parse(localStorage.getItem("versus_profile") || "{}").name || ""; } catch { return ""; }
  });
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const existing = loadPlayer(code);
    if (existing?.token) { nav(`/play/${code}`); return; }
    http.get(`/rooms/${code}`).then((r) => setRoom(r.data)).catch(() => setError("Room not found."));
  }, [code, nav]);

  if (error) {
    return <Centered><p className="text-2xl font-bold text-white/70" data-testid="join-error">{error}</p></Centered>;
  }
  if (!room) {
    return <Centered><Loader2 className="animate-spin text-cyan-400" size={40} /></Centered>;
  }
  if (room.status !== "lobby") {
    return <Centered><p className="text-3xl font-black font-heading text-white/70" data-testid="game-in-progress">Game in progress</p></Centered>;
  }

  const isTeam = room.mode === "team";
  const sideEmpty = side ? (room.sides[side]?.players?.length || 0) === 0 : false;
  const willBeCaptain = isTeam && sideEmpty;
  const accent = side ? SIDE_COLOR[side] : "#7c3aed";

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await http.post(`/rooms/${code}/join`, {
        side, name: name.trim(),
        team_name: willBeCaptain ? teamName.trim() : undefined,
      });
      localStorage.setItem("versus_profile", JSON.stringify({ name: r.data.name }));
      savePlayer(code, { token: r.data.token, id: r.data.id, side: r.data.side, name: r.data.name, is_master: r.data.is_master });
      nav(`/play/${code}`);
    } catch (e) {
      setBusy(false);
      setError(e?.response?.data?.detail || "Could not join.");
    }
  };

  return (
    <div className="min-h-[100svh] flex flex-col px-6 py-10" style={{ background: side ? `radial-gradient(circle at 50% 0%, ${accent}22, #05050A 60%)` : "#05050A" }}>
      <div className="text-center mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Room</p>
        <p className="text-3xl font-black font-heading tracking-widest">{code}</p>
      </div>

      {!side && (
        <div className="flex-1 flex flex-col justify-center gap-5">
          <p className="text-center text-white/60 uppercase tracking-[0.2em] text-sm mb-2">Pick your side</p>
          {["A", "B"].map((s) => (
            <button key={s} data-testid={`pick-side-${s}`} onClick={() => setSide(s)}
              className="w-full py-8 rounded-3xl font-black text-3xl font-heading text-black active:scale-95 transition-transform"
              style={{ background: SIDE_COLOR[s] }}>
              {room.sides[s]?.name || `Side ${s}`}
            </button>
          ))}
        </div>
      )}

      {side && (
        <div className="flex-1 flex flex-col justify-center gap-5 max-w-md w-full mx-auto">
          <div className="text-center">
            <span className="inline-block px-4 py-2 rounded-full font-black text-black" style={{ background: accent }}>
              {room.sides[side]?.name || `Side ${side}`}
            </span>
          </div>

          {willBeCaptain && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-white/40 block mb-2">Team name (you're the captain!)</label>
              <input data-testid="team-name-input" value={teamName} onChange={(e) => setTeamName(e.target.value.slice(0, 20))}
                placeholder="Name your team" maxLength={20}
                className="w-full bg-white/5 border border-white/15 rounded-2xl px-5 py-4 text-lg outline-none focus:border-white/40" />
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-white/40 block mb-2">Your name</label>
            <input data-testid="player-name-input" value={name} onChange={(e) => setName(e.target.value.slice(0, 15))}
              placeholder="Enter your name" maxLength={15} autoFocus
              className="w-full bg-white/5 border border-white/15 rounded-2xl px-5 py-4 text-lg outline-none focus:border-white/40" />
          </div>

          {error && <p className="text-red-400 text-sm" data-testid="join-submit-error">{error}</p>}

          <button data-testid="join-submit-btn" disabled={busy || !name.trim()} onClick={submit}
            className="w-full flex items-center justify-center gap-2 py-5 rounded-2xl font-black uppercase tracking-widest text-black active:scale-95 transition-transform disabled:opacity-50"
            style={{ background: accent }}>
            {busy ? <Loader2 className="animate-spin" /> : <>Join <ArrowRight /></>}
          </button>
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return <div className="min-h-[100svh] flex items-center justify-center px-6 text-center">{children}</div>;
}
