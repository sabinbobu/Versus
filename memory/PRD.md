# Versus — Product Requirements & Progress

## Problem Statement
Real-time multiplayer party quiz (Kahoot-style). 2 players or 2 teams battle head-to-head.
Host screen (laptop/TV) shows questions/timers/reveals/leaderboards/podium; players answer on
phones after joining via QR/room code. Questions AI-generated live on any topic. No accounts.

## Tech / Architecture
- React (CRA) + FastAPI + MongoDB. Tailwind, framer-motion, canvas-confetti, qrcode.react, lucide-react.
- Real-time: FastAPI native WebSockets (`/api/ws/{code}`) with 1s polling fallback + auto-reconnect.
- Server-authoritative state machine in `game_engine.py`; answer timing measured server-side.
- AI generation: GPT-5.5 via Emergent Universal LLM key (`question_gen.py`), strict JSON validation,
  fallback bank of 100 MCQs (50 EN + 50 RO) in `fallback_bank.py`.
- Player identity via token in localStorage (`versus_{code}`) for reconnect. No auth.

## User Personas
- Host: runs the game on a big screen. - Players: join on phones, tap color/shape answers.

## Core Requirements (static)
- Modes 1v1 / Team. Topic, difficulty, #questions (5/10/15), time (10/15/20/30s), language EN/RO.
- Lobby split A(cyan)/B(magenta), QR codes, room code, live players, captain sets team name.
- Game loop: PREVIEW 3s / ACTIVE / REVEAL 5s / LEADERBOARD 4s -> Podium.
- Scoring: correct=500+round(500*(1-t/T)); streak +100 from 3rd consecutive, cap +300; team=avg of members.
- Tiebreaker: lower cumulative response time, then sudden death. Host Pause/Resume/Skip.
- Answer identity = color + shape (colorblind-safe). Rematch (fresh, no repeats) / New Game.

## Implemented (2026-06 / from-scratch MVP, TESTED 100%)
- Full end-to-end flow: Landing -> Setup -> Lobby -> game loop -> Podium -> Rematch/New Game.
- WebSocket real-time + polling fallback + reconnect + backend heartbeat auto-resume on empty side.
- AI question generation (GPT-5.5) with validation + fallback bank; served-hash dedup for rematch.
- Scoring engine, streaks, team averaging, tiebreaker + sudden death, host controls, disconnect handling.
- Design: dark violet->cyan aesthetic, Unbounded/Outfit fonts, confetti podium.

## Backlog / Next
- P1: Sound effects (tick/sting/fanfare) — deferred (user chose skip for v1).
- P2: Replace alert() with toast component on host; skip-question toast UX.
- P2: Opt into React Router v7 future flags to silence console warnings.
- P2: Persist running-game state to Mongo for full server-restart resilience (currently in-memory).
