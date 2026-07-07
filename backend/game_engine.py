"""Server-authoritative game engine for Versus."""
import asyncio
import time
import uuid
import random
import string
import logging
from statistics import mean

import question_gen

logger = logging.getLogger("versus.engine")

PREVIEW_S = 3
REVEAL_S = 5
LEADERBOARD_S = 4
SUDDEN_DEATH_S = 15

SIDE_COLORS = {"A": "#06B6D4", "B": "#EC4899"}


def now_ms() -> int:
    return int(time.time() * 1000)


def gen_code() -> str:
    return "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=5))


class Room:
    def __init__(self, code, mode, topic, difficulty, num_questions,
                 time_per_question, language):
        self.code = code
        self.mode = mode  # "1v1" | "team"
        self.topic = topic
        self.difficulty = difficulty
        self.num_questions = num_questions
        self.time_per_question = time_per_question
        self.language = language

        self.status = "lobby"          # lobby | playing | finished
        self.phase = "lobby"           # lobby|preview|active|reveal|leaderboard|sudden_death|podium
        self.questions = []
        self.questions_ready = False
        self.generating = True

        # sides -> {name, players: {token: player}}
        self.sides = {
            "A": {"name": None, "players": {}},
            "B": {"name": None, "players": {}},
        }

        self.current_index = -1
        self.phase_ends_at = 0
        self.remaining_ms = 0
        self.paused = False
        self.active_start_ms = 0
        self.empty_side = None
        self.winner = None
        self.tiebreaker = None
        self.sudden_death_winner = None

        self.answers = {}       # qi -> {token: {choice,time_ms,correct,points}}
        self.q_points = {}      # qi -> {token: points}
        self.scored_indices = set()
        self.streaks = {}
        self.best_streak = {}
        self.resp_time = {}     # token -> total ms (answered)
        self.answered_count = {}
        self.served_hashes = set()

        self.connections = {}   # ws -> {role, token}
        self.task = None
        self.skip_flag = False
        self.created_at = now_ms()

    # ---- player helpers ----
    def all_players(self):
        out = {}
        for s in ("A", "B"):
            out.update(self.sides[s]["players"])
        return out

    def side_of(self, token):
        for s in ("A", "B"):
            if token in self.sides[s]["players"]:
                return s
        return None

    def connected_players(self):
        return {t: p for t, p in self.all_players().items() if p["connected"]}

    def unique_name(self, side, base):
        base = base.strip()[:15] or "Player"
        existing = {p["name"].lower() for p in self.all_players().values()}
        if base.lower() not in existing:
            return base
        i = 2
        while f"{base} {i}".lower() in existing:
            i += 1
        return f"{base} {i}"

    # ---- scoring ----
    def player_total(self, token):
        return sum(self.q_points.get(qi, {}).get(token, 0) for qi in self.scored_indices)

    def side_members(self, side):
        return list(self.sides[side]["players"].keys())

    def side_total(self, side):
        members = self.side_members(side)
        if not members:
            return 0
        if self.mode == "team":
            total = 0
            for qi in self.scored_indices:
                pts = [self.q_points.get(qi, {}).get(t, 0) for t in members]
                if pts:
                    total += round(mean(pts))
            if self.sudden_death_winner == side:
                total += 1
            return total
        return sum(self.player_total(t) for t in members)

    def side_resp_time(self, side):
        return sum(self.resp_time.get(t, 0) for t in self.side_members(side))

    def score_question(self, qi):
        q = self.questions[qi]
        ci = q["correct_index"]
        T = self.time_per_question
        ans = self.answers.get(qi, {})
        self.q_points.setdefault(qi, {})
        for token in self.all_players().keys():
            a = ans.get(token)
            if a and a["choice"] == ci:
                t = min(max(a["time_ms"] / 1000.0, 0.0), T)
                base = 500 + round(500 * (1 - t / T))
                self.streaks[token] = self.streaks.get(token, 0) + 1
                s = self.streaks[token]
                bonus = min(300, (s - 2) * 100) if s >= 3 else 0
                pts = base + bonus
                a["correct"] = True
            else:
                self.streaks[token] = 0
                pts = 0
                if a:
                    a["correct"] = False
            if a:
                a["points"] = pts
                self.resp_time[token] = self.resp_time.get(token, 0) + a["time_ms"]
            self.q_points[qi][token] = pts
            self.best_streak[token] = max(self.best_streak.get(token, 0),
                                          self.streaks.get(token, 0))
        self.scored_indices.add(qi)
        self.served_hashes.add(q["hash"])

    # ---- serialization ----
    def _side_payload(self, s):
        players = []
        for token, p in self.sides[s]["players"].items():
            players.append({
                "id": p["id"],
                "name": p["name"],
                "connected": p["connected"],
                "is_captain": p["is_captain"],
                "total": self.player_total(token),
            })
        players.sort(key=lambda x: -x["total"])
        return {
            "name": self.sides[s]["name"],
            "color": SIDE_COLORS[s],
            "players": players,
            "total": self.side_total(s),
        }

    def serialize(self):
        reveal_phase = self.phase in ("reveal", "leaderboard", "podium")
        show_q = self.phase in ("active", "reveal", "leaderboard", "sudden_death")
        data = {
            "code": self.code,
            "mode": self.mode,
            "topic": self.topic,
            "difficulty": self.difficulty,
            "language": self.language,
            "status": self.status,
            "phase": self.phase,
            "questions_ready": self.questions_ready,
            "generating": self.generating,
            "num_questions": self.num_questions,
            "total_questions": len(self.questions),
            "time_per_question": self.time_per_question,
            "current_index": self.current_index,
            "phase_ends_at": self.phase_ends_at,
            "remaining_ms": self.remaining_ms,
            "paused": self.paused,
            "empty_side": self.empty_side,
            "sides": {s: self._side_payload(s) for s in ("A", "B")},
        }

        qi = self.current_index
        if 0 <= qi < len(self.questions) and self.phase != "lobby":
            q = self.questions[qi]
            qobj = {
                "number": qi + 1,
                "category": q["category"],
                "difficulty": q["difficulty"],
            }
            if show_q or self.phase == "sudden_death":
                qobj["question"] = q["question"]
                qobj["options"] = q["options"]
            if reveal_phase:
                qobj["correct_index"] = q["correct_index"]
                qobj["explanation"] = q["explanation"]
            data["question"] = qobj

            ans = self.answers.get(qi, {})
            id_of = {t: p["id"] for t, p in self.all_players().items()}
            data["answered_ids"] = [id_of[t] for t in ans.keys() if t in id_of]
            data["connected_count"] = len(self.connected_players())

            if reveal_phase:
                dist = [0, 0, 0, 0]
                results = {}
                for t, a in ans.items():
                    if 0 <= a["choice"] < 4:
                        dist[a["choice"]] += 1
                    if t in id_of:
                        results[id_of[t]] = {
                            "choice": a["choice"],
                            "correct": a.get("correct", False),
                            "points": a.get("points", 0),
                            "time_ms": a["time_ms"],
                        }
                data["distribution"] = dist
                data["results"] = results
                fastest = None
                for t, a in ans.items():
                    if a.get("correct") and t in id_of:
                        if fastest is None or a["time_ms"] < fastest["time_ms"]:
                            fastest = {"id": id_of[t],
                                       "name": self.all_players()[t]["name"],
                                       "time_ms": a["time_ms"]}
                data["fastest"] = fastest

        if self.phase == "podium":
            data["podium"] = self._podium_payload()
        return data

    def _podium_payload(self):
        players = []
        total_q = len(self.scored_indices) or 1
        for token, p in self.all_players().items():
            answered = [self.answers.get(qi, {}).get(token) for qi in self.scored_indices]
            answered = [a for a in answered if a]
            correct = sum(1 for a in answered if a.get("correct"))
            times = [a["time_ms"] for a in answered]
            players.append({
                "id": p["id"],
                "name": p["name"],
                "side": self.side_of(token),
                "total": self.player_total(token),
                "accuracy": round(100 * correct / total_q),
                "avg_time_ms": round(mean(times)) if times else 0,
                "best_streak": self.best_streak.get(token, 0),
            })
        players.sort(key=lambda x: -x["total"])
        return {
            "winner": self.winner,
            "tiebreaker": self.tiebreaker,
            "sides": {s: self._side_payload(s) for s in ("A", "B")},
            "players": players,
        }


class Engine:
    def __init__(self, db=None):
        self.rooms = {}
        self.db = db

    def create_room(self, **kw):
        code = gen_code()
        while code in self.rooms:
            code = gen_code()
        room = Room(code=code, **kw)
        self.rooms[code] = room
        room.gen_task = asyncio.create_task(self._generate(room))
        return room

    def get(self, code):
        return self.rooms.get(code)

    async def _generate(self, room, exclude=None):
        room.generating = True
        room.questions_ready = False
        try:
            qs = await question_gen.generate_questions(
                room.topic, room.difficulty, room.num_questions,
                room.language, exclude_hashes=exclude or room.served_hashes)
            room.questions = qs
            room.questions_ready = len(qs) >= 1
        except Exception as e:
            logger.error(f"generation error: {e}")
            room.questions_ready = False
        finally:
            room.generating = False
        await self.broadcast(room)

    # ---- connection management ----
    async def connect(self, room, ws, role, token):
        room.connections[ws] = {"role": role, "token": token}
        if role == "player" and token in room.all_players():
            room.all_players()[token]["connected"] = True
            room.empty_side = self._check_empty(room)
        await self.send_state(ws, room)
        await self.broadcast(room)

    async def disconnect(self, room, ws):
        info = room.connections.pop(ws, None)
        if info and info["role"] == "player":
            token = info["token"]
            p = room.all_players().get(token)
            if p:
                p["connected"] = False
            if room.status == "playing":
                empty = self._check_empty(room)
                if empty and not room.empty_side:
                    room.empty_side = empty
                    room.paused = True
        await self.broadcast(room)

    def _check_empty(self, room):
        if room.status != "playing":
            return None
        for s in ("A", "B"):
            members = room.sides[s]["players"]
            if members and not any(p["connected"] for p in members.values()):
                return s
        return None

    async def send_state(self, ws, room):
        try:
            await ws.send_json(room.serialize())
        except Exception:
            pass

    async def broadcast(self, room):
        payload = room.serialize()
        dead = []
        for ws in list(room.connections.keys()):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.connections.pop(ws, None)

    # ---- join ----
    def join(self, room, side, name, token=None, team_name=None):
        if token and token in room.all_players():
            p = room.all_players()[token]
            p["connected"] = True
            return p, room.side_of(token)
        if room.status != "lobby":
            return None, "in_progress"
        side = side if side in ("A", "B") else "A"
        is_captain = len(room.sides[side]["players"]) == 0
        new_token = uuid.uuid4().hex
        uname = room.unique_name(side, name)
        player = {
            "id": uuid.uuid4().hex[:8],
            "token": new_token,
            "name": uname,
            "connected": True,
            "is_captain": is_captain,
        }
        room.sides[side]["players"][new_token] = player
        if room.mode == "team" and is_captain and team_name:
            room.sides[side]["name"] = team_name.strip()[:20]
        return player, side

    # ---- host controls ----
    def can_start(self, room):
        a = len(room.sides["A"]["players"])
        b = len(room.sides["B"]["players"])
        return a >= 1 and b >= 1 and room.questions_ready

    async def start(self, room):
        if room.status != "lobby" or not self.can_start(room):
            return False
        room.status = "playing"
        room.task = asyncio.create_task(self._run(room))
        return True

    async def pause(self, room):
        room.paused = True
        await self.broadcast(room)

    async def resume(self, room):
        if room.empty_side:
            empty = self._check_empty(room)
            room.empty_side = empty
            if empty:
                await self.broadcast(room)
                return
        room.paused = False
        room.phase_ends_at = now_ms() + room.remaining_ms
        await self.broadcast(room)

    async def skip(self, room):
        room.skip_flag = True

    async def submit_answer(self, room, token, choice):
        if room.phase != "active" and room.phase != "sudden_death":
            return False
        if room.paused or room.remaining_ms <= 0:
            return False
        qi = room.current_index
        p = room.all_players().get(token)
        if not p:
            return False
        room.answers.setdefault(qi, {})
        if token in room.answers[qi]:
            return False
        if not isinstance(choice, int) or choice < 0 or choice > 3:
            return False
        t_ms = now_ms() - room.active_start_ms
        room.answers[qi][token] = {"choice": choice, "time_ms": max(0, t_ms)}
        if room.phase == "sudden_death":
            q = room.questions[qi]
            if choice == q["correct_index"] and room.sudden_death_winner is None:
                room.sudden_death_winner = room.side_of(token)
                room.skip_flag = True
        await self.broadcast(room)
        return True

    async def rematch(self, room):
        if room.task and not room.task.done():
            room.task.cancel()
        room.status = "lobby"
        room.phase = "lobby"
        room.current_index = -1
        room.answers = {}
        room.q_points = {}
        room.scored_indices = set()
        room.streaks = {}
        room.best_streak = {}
        room.resp_time = {}
        room.questions = []
        room.questions_ready = False
        room.winner = None
        room.tiebreaker = None
        room.sudden_death_winner = None
        room.empty_side = None
        room.paused = False
        room.gen_task = asyncio.create_task(self._generate(room, exclude=room.served_hashes))
        await self.broadcast(room)

    # ---- phase runner ----
    async def _wait(self, room, seconds, allow_early=False):
        room.remaining_ms = int(seconds * 1000)
        room.phase_ends_at = now_ms() + room.remaining_ms
        await self.broadcast(room)
        while room.remaining_ms > 0:
            await asyncio.sleep(0.1)
            if room.skip_flag:
                return "skip"
            if room.paused:
                continue
            room.remaining_ms -= 100
            if allow_early and self._all_answered(room):
                return "early"
        return "timeout"

    def _all_answered(self, room):
        conn = room.connected_players()
        if not conn:
            return False
        ans = room.answers.get(room.current_index, {})
        return all(t in ans for t in conn.keys())

    async def _run(self, room):
        try:
            while room.current_index + 1 < len(room.questions):
                room.current_index += 1
                room.skip_flag = False

                room.phase = "preview"
                await self._wait(room, PREVIEW_S)
                if room.skip_flag:
                    room.skip_flag = False
                    continue

                room.phase = "active"
                room.answers.setdefault(room.current_index, {})
                room.active_start_ms = now_ms()
                res = await self._wait(room, room.time_per_question, allow_early=True)
                if res == "skip":
                    room.skip_flag = False
                    room.answers[room.current_index] = {}
                    continue

                room.remaining_ms = 0
                room.score_question(room.current_index)

                room.phase = "reveal"
                await self._wait(room, REVEAL_S)

                room.phase = "leaderboard"
                await self._wait(room, LEADERBOARD_S)

            await self._resolve_winner(room)
            room.phase = "podium"
            room.status = "finished"
            room.remaining_ms = 0
            await self.broadcast(room)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"game loop error: {e}")

    async def _resolve_winner(self, room):
        ta = room.side_total("A")
        tb = room.side_total("B")
        if ta != tb:
            room.winner = "A" if ta > tb else "B"
            room.tiebreaker = "score"
            return
        ra = room.side_resp_time("A")
        rb = room.side_resp_time("B")
        if ra != rb:
            room.winner = "A" if ra < rb else "B"
            room.tiebreaker = "response_time"
            return
        # sudden death
        room.tiebreaker = "sudden_death"
        extra = await question_gen.generate_questions(
            room.topic, room.difficulty, 1, room.language,
            exclude_hashes=room.served_hashes)
        if extra:
            room.questions.append(extra[0])
            room.current_index = len(room.questions) - 1
            room.skip_flag = False
            room.phase = "sudden_death"
            room.answers.setdefault(room.current_index, {})
            room.active_start_ms = now_ms()
            await self._wait(room, SUDDEN_DEATH_S, allow_early=True)
            room.remaining_ms = 0
        if room.sudden_death_winner:
            room.winner = room.sudden_death_winner
        else:
            room.winner = "tie"
