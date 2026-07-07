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

## Update (2026-06) — Reaction + Memory modes added (TESTED 100%)
- Game Type selector on Setup: Quiz / Reaction / Memory (topic+language shown for Quiz only;
  time-per-round hidden for Memory; difficulty drives Memory grid size).
- REACTION (whack-a-mole): server lights a random shape among 4 after a random delay; tap it fast.
  False start (tap before light) or wrong shape = 0. Points 500-1000 by reaction speed from light-on.
  Generated locally (no LLM). Sudden-death for non-quiz games = instant reaction round.
- MEMORY (flip-and-match): server deals a shared shuffled deck (easy=4/medium=6/hard=8 pairs);
  played on the phone (MemoryBoard). Completion time measured server-side; mistakes reduce points (-25 each).
  Non-finishers score 0. Generated locally (no LLM).
- Both reuse PREVIEW/ACTIVE/REVEAL/LEADERBOARD/Podium, streaks, team averaging, tiebreaker.
- Backend: game_engine.py score_question dispatch by type; _active_reaction light timing; submit_memory;
  serialize reaction target/reaction_live + memory deck. server.py: game_type + POST /rooms/{code}/memory + WS 'memory'.
- Tests: /app/backend/tests/test_new_modes.py (8/8). Frontend Reaction & Memory E2E reach podium.

## Backlog / Next (updated)
- P1: Sound effects (tick/sting/fanfare) — still deferred.
- P2: Optional cost-saver for Quiz (cache pack / cheaper model like gpt-5.4-mini).
- P2: Skip currently voids the round (0 pts) by design — consider skip-to-reveal to preserve answers.
- P2: Router v7 future flags to silence console warnings; replace alert() with toast.
