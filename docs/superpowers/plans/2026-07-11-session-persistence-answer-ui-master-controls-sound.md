# Session persistence, answer UI, master phone controls, and sound effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Master spin up a brand-new room from their phone with connected players auto-following (no rescanning); show answer text on colored quiz buttons on player phones; give the Master phone-based Rematch/New Game/New Room controls at the podium; add big-screen sound cues for the first two answers of a round and the final 3 seconds of the timer.

**Architecture:** Backend gets one new `Engine.new_room()` method and one new `POST /rooms/{code}/new-room` endpoint that creates a fresh room and re-registers currently-connected players into it, then flags the old room's next broadcast with a `new_room` field. Frontend's `useRoomState` hook watches for that field and auto-navigates connected clients. A new shared `GameSettingsForm` component de-duplicates the settings form between the existing big-screen modal and a new phone-based podium sheet. Answer-text rendering and sound effects are additive, localized changes to existing components.

**Tech Stack:** FastAPI + Python (backend/game_engine.py, backend/server.py), React + React Router (frontend), no new dependencies.

## Global Constraints

- Follow the spec exactly: `docs/superpowers/specs/2026-07-11-session-persistence-answer-ui-master-controls-sound-design.md`
- New Room auto-follow only applies to players connected (`p["connected"] is True`) at the moment the Master submits the New Room form — no offline resurrection.
- Reaction-mode and memory-mode answer visuals are unchanged — only quiz-mode phone buttons gain text.
- All new sounds play on the big screen (`HostRoom.jsx`) only — never on `PlayerRoom.jsx`.
- No new backend auth/token model — `/new-room` follows the same trust model as the existing host-only endpoints (`/pause`, `/skip`, `/rematch`): no token required, frontend only exposes the action to the master's own client.
- Sound asset files (`answer1.mp3`, `answer2.mp3`, `tick.mp3`) are not provided in this plan — the code must work correctly (no crash, no console error surfaced to the user) when the files are absent.

---

## Task 1: Backend — `Engine.new_room()` and `POST /rooms/{code}/new-room`

**Files:**
- Modify: `backend/game_engine.py` (add `new_room` method to `Engine` class, add `new_room_code`/`new_room_tokens` fields to `Room.__init__`, extend `serialize()`)
- Modify: `backend/server.py` (add `NewRoom` request model, add `POST /rooms/{code}/new-room` route)
- Test: `backend/tests/test_new_room.py`

**Interfaces:**
- Consumes: `Room.all_players()` (dict `token -> player`), `Room.side_of(token)` (returns `"A"`/`"B"`/`None`), `Engine.create_room(**kw)` (returns `Room`), `Engine.join(room, side, name, token=None, team_name=None)` (returns `(player_dict, side)`), `Engine.broadcast(room)` (async, sends `room.serialize()` to all connections).
- Produces: `Engine.new_room(old_room, *, mode, game_type, topic, difficulty, num_questions, time_per_question, language) -> Room` (async). Sets `old_room.new_room_code` and `old_room.new_room_tokens` (dict `old_token -> new_token`, only for players who were connected). `Room.serialize()` includes `"new_room": {"code": ..., "tokens": {...}}` when `self.new_room_code` is set; omits the key entirely otherwise (frontend must check for key presence, not truthiness of a null).

- [ ] **Step 1: Add `new_room_code`/`new_room_tokens` fields to `Room.__init__`**

In `backend/game_engine.py`, inside `Room.__init__` (starts at line 32), add after the `self.created_at = now_ms()` line (line 84):

```python
        self.created_at = now_ms()
        self.new_room_code = None
        self.new_room_tokens = {}
```

- [ ] **Step 2: Extend `Room.serialize()` to expose `new_room`**

In `backend/game_engine.py`, inside `serialize()` (starts at line 206), right before the final `return data` (line 299), add:

```python
        if self.new_room_code:
            data["new_room"] = {"code": self.new_room_code, "tokens": self.new_room_tokens}

        return data
```

Remove the old bare `return data` line — replace it with the block above (the `if` block plus the `return data`).

- [ ] **Step 3: Write the failing backend test for `new_room`**

Create `backend/tests/test_new_room.py`:

```python
"""Backend tests for the New Room feature: Master creates a fresh room from
their phone, and currently-connected players are automatically re-registered
into it (same side, same name, new per-room token) without re-scanning a QR
code.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get(
    "REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"


@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _create(sess, **overrides):
    body = {
        "mode": "1v1",
        "game_type": "reaction",
        "topic": "General knowledge",
        "difficulty": "easy",
        "num_questions": 5,
        "time_per_question": 10,
        "language": "en",
    }
    body.update(overrides)
    r = sess.post(f"{API}/rooms", json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["code"]


def _state(sess, code):
    r = sess.get(f"{API}/rooms/{code}/state", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _wait_ready(sess, code, timeout=45):
    end = time.time() + timeout
    while time.time() < end:
        st = _state(sess, code)
        if st.get("questions_ready"):
            return st
        time.sleep(0.5)
    pytest.fail(f"Room {code} not ready within {timeout}s")


def _join(sess, code, side, name):
    r = sess.post(f"{API}/rooms/{code}/join",
                  json={"side": side, "name": name}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _new_room_body(**overrides):
    body = {
        "mode": "1v1",
        "game_type": "reaction",
        "topic": "General knowledge",
        "difficulty": "easy",
        "num_questions": 5,
        "time_per_question": 10,
        "language": "en",
    }
    body.update(overrides)
    return body


class TestNewRoom:
    def test_new_room_creates_fresh_code(self, s):
        code = _create(s)
        _wait_ready(s, code)
        _join(s, code, "A", "MasterA")

        r = s.post(f"{API}/rooms/{code}/new-room", json=_new_room_body(), timeout=15)
        assert r.status_code == 200, r.text
        new_code = r.json()["code"]
        assert new_code != code
        assert len(new_code) == 5

    def test_connected_players_carried_into_new_room_same_side(self, s):
        code = _create(s)
        _wait_ready(s, code)
        a = _join(s, code, "A", "MasterA")
        b = _join(s, code, "B", "PlayerB")
        # both players are "connected" immediately after join (join() sets connected=True)

        r = s.post(f"{API}/rooms/{code}/new-room", json=_new_room_body(), timeout=15)
        assert r.status_code == 200, r.text
        new_code = r.json()["code"]

        _wait_ready(s, new_code)
        new_st = _state(s, new_code)
        names_a = {p["name"] for p in new_st["sides"]["A"]["players"]}
        names_b = {p["name"] for p in new_st["sides"]["B"]["players"]}
        assert "MasterA" in names_a
        assert "PlayerB" in names_b

    def test_master_flag_preserved_in_new_room(self, s):
        code = _create(s)
        _wait_ready(s, code)
        a = _join(s, code, "A", "MasterA")
        _join(s, code, "B", "PlayerB")

        r = s.post(f"{API}/rooms/{code}/new-room", json=_new_room_body(), timeout=15)
        new_code = r.json()["code"]
        _wait_ready(s, new_code)
        new_st = _state(s, new_code)

        masters = [p for p in new_st["sides"]["A"]["players"] + new_st["sides"]["B"]["players"]
                   if p.get("is_master")]
        assert len(masters) == 1
        assert masters[0]["name"] == "MasterA"

    def test_old_room_state_exposes_new_room_code_and_token_map(self, s):
        code = _create(s)
        _wait_ready(s, code)
        a = _join(s, code, "A", "MasterA")
        b = _join(s, code, "B", "PlayerB")

        r = s.post(f"{API}/rooms/{code}/new-room", json=_new_room_body(), timeout=15)
        new_code = r.json()["code"]

        old_st = _state(s, code)
        assert old_st["new_room"]["code"] == new_code
        assert a["token"] in old_st["new_room"]["tokens"]
        assert b["token"] in old_st["new_room"]["tokens"]
        # token map values are usable to fetch the new room's state via token heartbeat
        new_token_for_a = old_st["new_room"]["tokens"][a["token"]]
        assert isinstance(new_token_for_a, str) and new_token_for_a != a["token"]

    def test_new_room_applies_new_settings(self, s):
        code = _create(s, game_type="reaction")
        _wait_ready(s, code)
        _join(s, code, "A", "MasterA")

        body = _new_room_body(game_type="memory", num_questions=5, time_per_question=15)
        r = s.post(f"{API}/rooms/{code}/new-room", json=body, timeout=15)
        new_code = r.json()["code"]
        _wait_ready(s, new_code)
        new_st = _state(s, new_code)
        assert new_st["game_type"] == "memory"
        assert new_st["time_per_question"] == 15

    def test_new_room_missing_old_room_404(self, s):
        r = s.post(f"{API}/rooms/ZZZZZ/new-room", json=_new_room_body(), timeout=10)
        assert r.status_code == 404
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd backend
REACT_APP_BACKEND_URL=http://localhost:8000 .venv/bin/python -m pytest tests/test_new_room.py -v
```

Expected: FAIL — `404 Not Found` on `POST /rooms/{code}/new-room` since the route doesn't exist yet (test asserts `status_code == 200`).

- [ ] **Step 5: Implement `Engine.new_room()` in `backend/game_engine.py`**

Add this method to the `Engine` class, immediately after the existing `reconfigure` method (which ends around line 656-660 — find the end of `reconfigure` by locating the next `async def` after line 622, and insert before it):

```python
    async def new_room(self, old_room, *, mode, game_type, topic, difficulty,
                        num_questions, time_per_question, language):
        """Create a brand-new room and carry over currently-connected players
        (same side, same name) under fresh per-room tokens, so they don't need
        to re-scan a QR code. Only players connected at call time are carried."""
        new_room_obj = self.create_room(
            mode=mode, game_type=game_type, topic=topic, difficulty=difficulty,
            num_questions=num_questions, time_per_question=time_per_question,
            language=language)

        token_map = {}
        # Master first, so they retain is_master in the new room too.
        old_master_token = old_room.master_token
        ordered_tokens = [old_master_token] if old_master_token else []
        ordered_tokens += [t for t in old_room.all_players().keys() if t != old_master_token]

        for old_token in ordered_tokens:
            p = old_room.all_players().get(old_token)
            if not p or not p.get("connected"):
                continue
            side = old_room.side_of(old_token)
            new_player, _ = self.join(new_room_obj, side, p["name"])
            token_map[old_token] = new_player["token"]

        old_room.new_room_code = new_room_obj.code
        old_room.new_room_tokens = token_map
        await self.broadcast(old_room)
        return new_room_obj
```

- [ ] **Step 6: Add the `NewRoom` request model and route in `backend/server.py`**

In `backend/server.py`, add after the `Reconfigure` model (ends at line 80, before the `@api.get("/")` route on line 83):

```python
class NewRoom(BaseModel):
    mode: str = "1v1"
    game_type: str = "quiz"
    topic: str = "General knowledge"
    difficulty: str = "mixed"
    num_questions: int = 10
    time_per_question: int = 15
    language: str = "en"
```

Then add the route after the existing `reconfigure` route (ends at line 218, right before the `@app.websocket("/api/ws/{code}")` line on line 221):

```python
@api.post("/rooms/{code}/new-room")
async def new_room(code: str, body: NewRoom):
    old_room = engine.get(code)
    if not old_room:
        raise HTTPException(404, "Room not found")
    mode = body.mode if body.mode in ("1v1", "team") else "1v1"
    gtype = body.game_type if body.game_type in ("quiz", "reaction", "memory") else "quiz"
    num = body.num_questions if body.num_questions in (5, 10, 15) else 10
    tpq = body.time_per_question if body.time_per_question in (10, 15, 20, 30) else 15
    lang = body.language if body.language in ("en", "ro") else "en"
    diff = body.difficulty if body.difficulty in ("easy", "medium", "hard", "mixed") else "mixed"
    new_room_obj = await engine.new_room(
        old_room, mode=mode, game_type=gtype,
        topic=(body.topic or "General knowledge").strip()[:80],
        difficulty=diff, num_questions=num, time_per_question=tpq, language=lang)
    return {"code": new_room_obj.code}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd backend
REACT_APP_BACKEND_URL=http://localhost:8000 .venv/bin/python -m pytest tests/test_new_room.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 8: Run the full backend suite to check for regressions**

```bash
cd backend
REACT_APP_BACKEND_URL=http://localhost:8000 .venv/bin/python -m pytest tests/ -v
```

Expected: all tests (existing + new) PASS.

- [ ] **Step 9: Restart the backend server to load the new route**

```bash
pkill -f "uvicorn server:app" || true
cd backend && source .venv/bin/activate && uvicorn server:app --host 0.0.0.0 --port 8000 --reload > /tmp/backend.log 2>&1 &
sleep 3
curl -s http://localhost:8000/api/
```

Expected output: `{"app":"Versus","status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git add backend/game_engine.py backend/server.py backend/tests/test_new_room.py
git commit -m "Add POST /rooms/{code}/new-room: master can spin up a new room with connected players carried over"
```

---

## Task 2: Frontend — auto-follow redirect in `useRoomState`

**Files:**
- Modify: `frontend/src/lib/useRoomState.js`
- Modify: `frontend/src/lib/api.js` (no signature change needed — `savePlayer`/`loadPlayer` already generic per-code; confirming no edit required)

**Interfaces:**
- Consumes: `state.new_room` (optional, shape `{code: string, tokens: {[oldToken: string]: string}}`) arriving via the existing WS/poll `state` object. `savePlayer(code, data)` from `frontend/src/lib/api.js` (already exists, signature: `(code: string, data: object) => void`, writes to `localStorage["versus_" + code]`).
- Produces: `useRoomState(code, role, token)` return value gains a new field `redirectTo: string | null` — the new room's code when this client's token was found in `new_room.tokens`, else `null`. Callers (`HostRoom.jsx`, `PlayerRoom.jsx`) must `useEffect` on `redirectTo` and navigate.

- [ ] **Step 1: Add redirect detection logic to `useRoomState`**

Read the current file first:

```bash
cat frontend/src/lib/useRoomState.js
```

In `frontend/src/lib/useRoomState.js`, modify the hook to track `redirectTo`. Replace the full file content with:

```javascript
import { useEffect, useRef, useState, useCallback } from "react";
import { http, wsUrl, savePlayer } from "./api";

// Real-time room state via WebSocket, with automatic 1s polling fallback.
export function useRoomState(code, role, token) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [redirectTo, setRedirectTo] = useState(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const gotMsgRef = useRef(false);
  const followedRef = useRef(false);

  const applyState = useCallback((data) => {
    setState(data);
    if (!followedRef.current && data?.new_room && token) {
      const newToken = data.new_room.tokens?.[token];
      if (newToken) {
        followedRef.current = true;
        const mySide = data.sides?.A?.players?.find((p) => p.token === token)
          ? "A"
          : data.sides?.B?.players?.find((p) => p.token === token)
          ? "B"
          : null;
        // Player payloads in serialize() don't include token/side directly on
        // each player object (see backend/game_engine.py Room._side_payload),
        // so we look up name/id/is_master from the matching id in either side.
        let mine = null;
        for (const s of ["A", "B"]) {
          const found = (data.sides?.[s]?.players || []).find((p) => p.id === undefined);
          if (found) mine = { ...found, side: s };
        }
        savePlayer(data.new_room.code, { token: newToken, side: mySide, __pendingFollow: true });
        setRedirectTo(data.new_room.code);
      }
    }
  }, [token]);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    let reconnectTimer = null;
    let attempts = 0;

    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await http.get(`/rooms/${code}/state`, { params: token ? { token } : {} });
          if (alive) applyState(r.data);
        } catch (e) {}
      };
      tick();
      pollRef.current = setInterval(tick, 1000);
    };
    const stopPoll = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const openWs = () => {
      if (!alive) return;
      let ws;
      try {
        ws = new WebSocket(wsUrl(code, role, token));
      } catch {
        startPoll();
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => { if (alive) { attempts = 0; setConnected(true); } };
      ws.onmessage = (e) => {
        gotMsgRef.current = true;
        stopPoll();
        try {
          const data = JSON.parse(e.data);
          if (alive && !data.error) applyState(data);
        } catch {}
      };
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        startPoll();          // keep state live + act as heartbeat via ?token=
        scheduleReconnect();  // and try to restore the WebSocket
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };

    const scheduleReconnect = () => {
      if (!alive || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(1000 * attempts, 5000);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; openWs(); }, delay);
    };

    openWs();
    const safety = setTimeout(() => { if (!gotMsgRef.current) startPoll(); }, 2500);

    return () => {
      alive = false;
      clearTimeout(safety);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPoll();
      try { wsRef.current && wsRef.current.close(); } catch {}
    };
  }, [code, role, token, applyState]);

  const sendAnswer = useCallback((choice) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1 && token) {
      ws.send(JSON.stringify({ type: "answer", choice }));
    } else {
      http.post(`/rooms/${code}/answer`, { token, choice }).catch(() => {});
    }
  }, [code, token]);

  return { state, connected, sendAnswer, redirectTo };
}

// Local countdown ticker for smooth timer rendering.
export function useTick(intervalMs = 100) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
```

**Important correction before moving on:** the `_side_payload` serializer in `backend/game_engine.py` (lines 187-204) does **not** include `token` on the player objects sent to the client — only `id`, `name`, `connected`, `is_captain`, `is_master`, `total`. So `data.sides.A.players.find((p) => p.token === token)` in the snippet above can never match; the frontend does not have a way to map its own `token` to a side/player object from `state` alone. The client already knows its own `side` from `loadPlayer(code)` (saved at join time) — use that instead of trying to re-derive it from `state`.

Rewrite `applyState` to use the locally-known side/name from the player object already in localStorage for the **old** code, not from `state`:

```javascript
  const applyState = useCallback((data) => {
    setState(data);
    if (!followedRef.current && data?.new_room && token) {
      const newToken = data.new_room.tokens?.[token];
      if (newToken) {
        followedRef.current = true;
        setRedirectTo(data.new_room.code);
        // Caller (HostRoom/PlayerRoom) is responsible for calling
        // savePlayer(newCode, {...}) with the full player object it already
        // has locally (name/side/id/is_master), using `newToken` for the
        // token field, then navigating. This hook only detects the
        // transition and hands back the new code + new token.
      }
    }
  }, [token]);
```

Since the hook doesn't have direct access to the full locally-saved player object (that lives in `loadPlayer(code)`, called by the page components, not by this hook), expose the mapped new token too. Update the return value:

```javascript
  return { state, connected, sendAnswer, redirectTo, newTokenForMe: redirectTo ? state?.new_room?.tokens?.[token] : null };
```

Final version of the relevant parts of `frontend/src/lib/useRoomState.js` — replace the whole file with:

```javascript
import { useEffect, useRef, useState, useCallback } from "react";
import { http, wsUrl } from "./api";

// Real-time room state via WebSocket, with automatic 1s polling fallback.
export function useRoomState(code, role, token) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [redirectTo, setRedirectTo] = useState(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const gotMsgRef = useRef(false);
  const followedRef = useRef(false);

  const applyState = useCallback((data) => {
    setState(data);
    if (!followedRef.current && data?.new_room && token) {
      const newToken = data.new_room.tokens?.[token];
      if (newToken) {
        followedRef.current = true;
        setRedirectTo(data.new_room.code);
      }
    }
  }, [token]);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    let reconnectTimer = null;
    let attempts = 0;

    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await http.get(`/rooms/${code}/state`, { params: token ? { token } : {} });
          if (alive) applyState(r.data);
        } catch (e) {}
      };
      tick();
      pollRef.current = setInterval(tick, 1000);
    };
    const stopPoll = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const openWs = () => {
      if (!alive) return;
      let ws;
      try {
        ws = new WebSocket(wsUrl(code, role, token));
      } catch {
        startPoll();
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => { if (alive) { attempts = 0; setConnected(true); } };
      ws.onmessage = (e) => {
        gotMsgRef.current = true;
        stopPoll();
        try {
          const data = JSON.parse(e.data);
          if (alive && !data.error) applyState(data);
        } catch {}
      };
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        startPoll();          // keep state live + act as heartbeat via ?token=
        scheduleReconnect();  // and try to restore the WebSocket
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };

    const scheduleReconnect = () => {
      if (!alive || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(1000 * attempts, 5000);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; openWs(); }, delay);
    };

    openWs();
    const safety = setTimeout(() => { if (!gotMsgRef.current) startPoll(); }, 2500);

    return () => {
      alive = false;
      clearTimeout(safety);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPoll();
      try { wsRef.current && wsRef.current.close(); } catch {}
    };
  }, [code, role, token, applyState]);

  const sendAnswer = useCallback((choice) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1 && token) {
      ws.send(JSON.stringify({ type: "answer", choice }));
    } else {
      http.post(`/rooms/${code}/answer`, { token, choice }).catch(() => {});
    }
  }, [code, token]);

  const newTokenForMe = redirectTo && token ? state?.new_room?.tokens?.[token] : null;

  return { state, connected, sendAnswer, redirectTo, newTokenForMe };
}

// Local countdown ticker for smooth timer rendering.
export function useTick(intervalMs = 100) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
```

- [ ] **Step 2: No automated frontend test exists in this repo — verify manually with a quick Node syntax check**

```bash
cd frontend
node -e "require('@babel/core').transformFileSync('src/lib/useRoomState.js', {presets: ['react-app']})" 2>&1 | head -20 || echo "babel check skipped (no babel CLI configured standalone) — will verify via dev server compile in Task 5"
```

This step is a best-effort syntax sanity check; the authoritative verification is the CRA dev server compiling without error, done in Task 5's manual QA pass. Do not block on this step if the command errors out due to missing standalone babel config — proceed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/useRoomState.js
git commit -m "useRoomState: detect new_room broadcast and expose redirectTo + newTokenForMe"
```

---

## Task 3: Frontend — extract `GameSettingsForm`, wire New Room into `HostRoom.jsx`

**Files:**
- Create: `frontend/src/components/GameSettingsForm.jsx`
- Modify: `frontend/src/pages/HostRoom.jsx` (replace `NewGameOverlay`'s inline form with `GameSettingsForm`; add "New Room" button and handler in `Podium`)

**Interfaces:**
- Consumes: nothing new from other tasks (self-contained UI extraction).
- Produces: `GameSettingsForm` component, props:
  - `initial: { gameType, topic, difficulty, num, tpq, language, mode }` (all optional, sensible defaults applied inside)
  - `showMode: boolean` — whether to render the 1v1/Team toggle
  - `busy: boolean` — disables the submit button
  - `submitLabel: React.ReactNode` — button contents
  - `onSubmit: (values: { gameType, topic, difficulty, num, tpq, language, mode }) => void`
  - Later tasks (Task 4) import this same component with `showMode={true}` for the New Room phone sheet.

- [ ] **Step 1: Read the current `NewGameOverlay` and `Podium` in full for exact extraction boundaries**

```bash
grep -n "function NewGameOverlay\|function Podium\|function EmptyOverlay" frontend/src/pages/HostRoom.jsx
```

Expected: `function NewGameOverlay` at line 480, `function Podium` at line 406, `function EmptyOverlay` at line 595 (from earlier exploration — confirm line numbers didn't shift since exploration).

- [ ] **Step 2: Create `frontend/src/components/GameSettingsForm.jsx`**

```jsx
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
```

- [ ] **Step 3: Replace `NewGameOverlay`'s inline form in `frontend/src/pages/HostRoom.jsx` with `GameSettingsForm`**

Add the import at the top of `frontend/src/pages/HostRoom.jsx` (after line 9, the `lucide-react` import):

```javascript
import GameSettingsForm from "../components/GameSettingsForm";
```

Replace the entire `NewGameOverlay` function (currently lines 480-593) with:

```jsx
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
```

This drops the old `data-testid="newgame-type-*"`, `newgame-topic`, `newgame-diff-*`, `newgame-num-*`, `newgame-tpq-*`, `newgame-lang-*`, `newgame-confirm` test IDs in favor of the shared `settingsform-*` IDs from `GameSettingsForm`. There is no existing automated test suite referencing these test IDs (confirmed: only `backend/tests/*.py` exist, no frontend test files), so this is safe.

- [ ] **Step 4: Add a "New Room" button and handler to `Podium` in `frontend/src/pages/HostRoom.jsx`**

Find the `Podium` function's button row (originally around lines 457-470, may have shifted slightly from the `NewGameOverlay` edit above but stays after it in the file — search for it):

```bash
grep -n 'data-testid="rematch-btn"\|data-testid="new-game-btn"\|data-testid="exit-btn"' frontend/src/pages/HostRoom.jsx
```

Replace the block containing those three buttons (currently):

```jsx
      <div className="flex flex-wrap gap-4 justify-center">
        <button data-testid="rematch-btn" onClick={() => cmd("rematch")}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-cyan-400 text-black font-black uppercase tracking-widest rounded-full px-8 py-4 hover:scale-105 active:scale-95 transition-transform">
          <Zap /> Rematch
        </button>
        <button data-testid="new-game-btn" onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 font-black uppercase tracking-widest rounded-full px-8 py-4 transition-colors">
          <Users /> New Game
        </button>
        <button data-testid="exit-btn" onClick={() => nav("/setup")}
          className="flex items-center gap-2 text-white/40 hover:text-white/70 font-bold uppercase tracking-widest rounded-full px-6 py-4 transition-colors">
          Fresh Room
        </button>
      </div>
```

with (adds a `New Room` button that opens a new overlay reusing `GameSettingsForm`, and keeps `Fresh Room` as-is since it's a distinct "wipe everything, back to /setup" action not covered by this feature):

```jsx
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
```

Add `Sparkles` to the `lucide-react` import at the top of the file (line 9), changing:

```javascript
import { Play, Pause, SkipForward, Loader2, Trophy, Zap, Crown, Users, Brain, Star, BookOpen, X } from "lucide-react";
```

to:

```javascript
import { Play, Pause, SkipForward, Loader2, Trophy, Zap, Crown, Users, Brain, Star, BookOpen, X, Sparkles } from "lucide-react";
```

Add the `showNewRoom` state declaration next to the existing `showNew` declaration inside `Podium` (find `const [showNew, setShowNew] = useState(false);` — it's right after the `players` line, around where `Podium` builds its render):

```jsx
  const [showNew, setShowNew] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
```

Add the new overlay render right after `{showNew && <NewGameOverlay state={state} code={code} onClose={() => setShowNew(false)} />}` (near the end of `Podium`'s JSX, before its closing `</div>`):

```jsx
      {showNew && <NewGameOverlay state={state} code={code} onClose={() => setShowNew(false)} />}
      {showNewRoom && <NewRoomOverlay state={state} code={code} nav={nav} onClose={() => setShowNewRoom(false)} />}
```

- [ ] **Step 5: Add the `NewRoomOverlay` component to `frontend/src/pages/HostRoom.jsx`**

Add this new function right after `NewGameOverlay` (which now ends where Step 3's replacement ends):

```jsx
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
```

- [ ] **Step 6: Wire the `redirectTo` auto-navigation into `HostRoom`'s top-level component**

`HostRoom` (the top-level default export, lines 23-50) currently calls `const { state } = useRoomState(code, "host", null);`. The big-screen host tab should also follow when a **different** client (a player's phone) triggers `/new-room` (per spec: "the master's phone navigates directly... a separate big-screen tab, if one is open, follows via the broadcast-based redirect"). Update:

```jsx
export default function HostRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const { state, redirectTo } = useRoomState(code, "host", null);

  useEffect(() => {
    if (redirectTo) nav(`/host/${redirectTo}`);
  }, [redirectTo, nav]);

  const cmd = (path) => http.post(`/rooms/${code}/${path}`).catch((e) => {
    if (e?.response?.data?.detail) alert(e.response.data.detail);
  });

  if (!state) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-cyan-400" size={48} /></div>;
  }
```

(This inserts a `useEffect` call right after the `useRoomState` destructuring; `useEffect` is already imported at the top of the file per line 1.)

Note: the host role connects with `token=null`, so `data.new_room.tokens[token]` can never match for the host WS connection (since `null` is never a key in the token map) — `redirectTo` will never fire from the `applyState` logic in Task 2 for the host tab. Fix this in `useRoomState.js`: the host should follow whenever `new_room` appears at all, regardless of token match. Revisit Task 2's `applyState`:

```javascript
  const applyState = useCallback((data) => {
    setState(data);
    if (!followedRef.current && data?.new_room) {
      if (role === "host") {
        followedRef.current = true;
        setRedirectTo(data.new_room.code);
        return;
      }
      const newToken = data.new_room.tokens?.[token];
      if (newToken) {
        followedRef.current = true;
        setRedirectTo(data.new_room.code);
      }
    }
  }, [token, role]);
```

Go back to `frontend/src/lib/useRoomState.js` and apply this corrected `applyState` (replacing the version written in Task 2 Step 1's final file).

- [ ] **Step 7: Verify the dev server compiles**

```bash
cd frontend
# Frontend dev server should already be running per prior session state; if not:
# PORT=3002 BROWSER=none npm start > /tmp/frontend.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
tail -30 /tmp/frontend.log 2>/dev/null | grep -i "error\|fail" || echo "no compile errors found in recent log"
```

Expected: `200` and no compile errors in the log.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/GameSettingsForm.jsx frontend/src/pages/HostRoom.jsx frontend/src/lib/useRoomState.js
git commit -m "Extract GameSettingsForm, add New Room button + overlay to Podium, wire redirectTo for host auto-follow"
```

---

## Task 4: Frontend — Master phone controls at podium in `PlayerRoom.jsx`

**Files:**
- Modify: `frontend/src/pages/PlayerRoom.jsx`

**Interfaces:**
- Consumes: `GameSettingsForm` from Task 3 (`frontend/src/components/GameSettingsForm.jsx`), `useRoomState`'s `redirectTo`/`newTokenForMe` from Task 2, `savePlayer`/`loadPlayer` from `frontend/src/lib/api.js`.
- Produces: no new exports — this is a leaf page component.

- [ ] **Step 1: Import `GameSettingsForm` and `savePlayer`**

At the top of `frontend/src/pages/PlayerRoom.jsx`, change line 3 from:

```javascript
import { loadPlayer, http } from "../lib/api";
```

to:

```javascript
import { loadPlayer, savePlayer, http } from "../lib/api";
```

Add a new import after line 6 (`import MemoryBoard from "../components/MemoryBoard";`):

```javascript
import GameSettingsForm from "../components/GameSettingsForm";
```

- [ ] **Step 2: Destructure `redirectTo` and `newTokenForMe`, wire auto-follow**

In `PlayerRoom`'s function body, change line 22 from:

```javascript
  const { state, connected, sendAnswer } = useRoomState(code, "player", me?.token);
```

to:

```javascript
  const { state, connected, sendAnswer, redirectTo, newTokenForMe } = useRoomState(code, "player", me?.token);
```

Add a new `useEffect` right after the existing one on line 25-27 (`useEffect(() => { if (!me?.token) nav(`/join/${code}`); }, [me, code, nav]);`):

```jsx
  useEffect(() => {
    if (redirectTo && newTokenForMe && me) {
      savePlayer(redirectTo, { token: newTokenForMe, id: me.id, side: me.side, name: me.name, is_master: me.is_master });
      nav(`/play/${redirectTo}`);
    }
  }, [redirectTo, newTokenForMe, me, nav]);
```

- [ ] **Step 3: Add Master podium actions**

Find the `podium` phase block (currently lines 216-225):

```jsx
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
```

Replace with:

```jsx
        {phase === "podium" && (
          <Center>
            <Trophy size={64} className={state.podium?.winner === mySide ? "text-yellow-400" : "text-white/40"} />
            <h2 className="text-4xl font-black font-heading my-3" data-testid="player-podium">
              {state.podium?.winner === mySide ? "You won! 🎉" : state.podium?.winner === "tie" ? "It's a tie!" : "Good game!"}
            </h2>
            {rank && <p className="text-white/60 text-xl">You finished #{rank}</p>}
            {isMaster ? (
              <MasterPodiumActions code={code} state={state} nav={nav} />
            ) : (
              <p className="text-white/40 mt-4 text-sm">Watch the big screen for the podium.</p>
            )}
          </Center>
        )}
```

- [ ] **Step 4: Add the `MasterPodiumActions` component**

Add this new component at the bottom of `frontend/src/pages/PlayerRoom.jsx`, after the existing `Wrap` function (the last function in the file):

```jsx
function MasterPodiumActions({ code, state, nav }) {
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
      });
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
```

- [ ] **Step 5: Verify the dev server compiles and manually smoke-test**

```bash
cd frontend
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
```

Expected: `200`. Then use the `/browse` skill to walk through: create a room, join two players, play a full quiz round to reach podium, verify (as the master's simulated phone tab) the Rematch/New Game/New Room buttons render and New Room's form submits successfully producing a new code.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PlayerRoom.jsx
git commit -m "PlayerRoom: master gets Rematch/New Game/New Room controls at podium, players auto-follow into new rooms"
```

---

## Task 5: Frontend — answer text on colored quiz buttons (player phones)

**Files:**
- Modify: `frontend/src/pages/PlayerRoom.jsx`

**Interfaces:**
- Consumes: `state.question.options` (array of 4 strings, already present in the `state` payload during `active`/`sudden_death` phase for quiz — confirmed via `backend/game_engine.py` `serialize()` line 259: `qobj["options"] = q["options"]` when `show_q` is true).
- Produces: no new exports.

- [ ] **Step 1: Locate the quiz answer-buttons block**

```bash
grep -n 'data-testid="answer-buttons"' frontend/src/pages/PlayerRoom.jsx
```

Expected: line 114 (from earlier exploration).

- [ ] **Step 2: Add answer text to the quiz answer buttons**

Find this block (currently lines 114-124):

```jsx
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
```

Replace with:

```jsx
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
```

Note: the reaction-mode block (`data-testid="reaction-buttons"`, lines 137-155 in the original file) is untouched — it has its own separate JSX and never reads `state.question.options`, so no accidental leakage occurs there.

- [ ] **Step 3: Check `line-clamp-2` utility is available (Tailwind plugin)**

```bash
grep -n "line-clamp\|@tailwindcss/line-clamp" frontend/tailwind.config.js frontend/package.json
```

If `line-clamp-2` is used elsewhere already in the codebase or the `@tailwindcss/line-clamp` plugin is listed, no action needed. If neither is found, Tailwind CSS v3.3+ ships `line-clamp` utilities in core (no plugin required) — check the installed Tailwind version:

```bash
grep '"tailwindcss"' frontend/package.json
```

If the version is `^3.4.x` (per `frontend/package.json` from earlier exploration: `"tailwindcss": "^3.4.13"`), `line-clamp-2` works out of the box with no config change. No action required.

- [ ] **Step 4: Verify visually**

```bash
cd frontend
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
```

Use `/browse` to join a quiz-mode game as a player on a phone-sized viewport, reach the `active` phase, and screenshot the answer buttons to confirm text renders legibly on each color without overflowing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PlayerRoom.jsx
git commit -m "PlayerRoom: show answer text on colored quiz answer buttons"
```

---

## Task 6: Frontend — sound effects on the big screen

**Files:**
- Create: `frontend/src/lib/sounds.js`
- Create: `frontend/public/sounds/.gitkeep` (placeholder so the empty directory is tracked; actual `.mp3` files are user-provided later and excluded from this task)
- Modify: `frontend/src/pages/HostRoom.jsx` (wire `playSound` calls into `Active`)

**Interfaces:**
- Consumes: `state.answered_ids` (array of player ids who've answered the current question, from `backend/game_engine.py` `serialize()` line 267), `state.question.number` (1-indexed question number), `state.phase` (`"active"` | `"sudden_death"` | other), the existing `useCountdown(state)` hook already defined in `HostRoom.jsx` (returns `{sec, frac}`).
- Produces: `playSound(name: "answer1" | "answer2" | "tick") => void`, exported from `frontend/src/lib/sounds.js`. Silently no-ops if the file is missing or playback is blocked by the browser.

- [ ] **Step 1: Create the sounds helper**

```bash
mkdir -p frontend/public/sounds
touch frontend/public/sounds/.gitkeep
```

Create `frontend/src/lib/sounds.js`:

```javascript
const FILES = {
  answer1: "/sounds/answer1.mp3",
  answer2: "/sounds/answer2.mp3",
  tick: "/sounds/tick.mp3",
};

const cache = {};

// Plays a short SFX by name. Safe to call even if the audio file hasn't been
// added yet (frontend/public/sounds/*.mp3 are provided by the user) — a
// missing file or browser autoplay block both fail silently, never throwing
// or logging to the console in a way that would alarm the user.
export function playSound(name) {
  const src = FILES[name];
  if (!src) return;
  let audio = cache[name];
  if (!audio) {
    audio = new Audio(src);
    cache[name] = audio;
  } else {
    audio.currentTime = 0;
  }
  audio.play().catch(() => {});
}
```

- [ ] **Step 2: Wire answer-count sounds into `Active` in `frontend/src/pages/HostRoom.jsx`**

Add the import near the top of the file (after line 8, `import { ShapeIcon, ANSWERS } from "../components/Shapes";`):

```javascript
import { playSound } from "../lib/sounds";
```

Find the `Active` component (currently lines 173-178):

```jsx
function Active({ state, cmd }) {
  const qtype = state.question?.type || state.game_type || "quiz";
  if (qtype === "reaction") return <ReactionActive state={state} cmd={cmd} />;
  if (qtype === "memory") return <MemoryActive state={state} cmd={cmd} />;
  return <QuizActive state={state} cmd={cmd} />;
}
```

Replace with a version that tracks answered-count transitions per question and plays the answer sounds, then delegates to the existing sub-components unchanged:

```jsx
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
      if (prevCountRef.current === 0 && answeredCount >= 1) playSound("answer1");
      else if (prevCountRef.current === 1 && answeredCount >= 2) playSound("answer2");
      prevCountRef.current = answeredCount;
    }
  }, [answeredCount, questionNumber]);

  if (qtype === "reaction") return <ReactionActive state={state} cmd={cmd} />;
  if (qtype === "memory") return <MemoryActive state={state} cmd={cmd} />;
  return <QuizActive state={state} cmd={cmd} />;
}
```

`useRef` and `useEffect` are already imported at the top of `HostRoom.jsx` (line 1: `import React, { useEffect, useMemo, useRef, useState } from "react";`), so no import changes are needed for this step.

- [ ] **Step 3: Wire the final-3-seconds timer sound**

`TimerFooter` (currently lines 146-157) already has access to `state` and calls `useCountdown(state)` internally:

```jsx
function TimerFooter({ state }) {
  const { sec, frac } = useCountdown(state);
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
```

Replace it with:

```jsx
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
```

This fires `playSound("tick")` exactly once per question, the first render where `sec` reads `3` during `active`/`sudden_death`, and resets the guard whenever the phase leaves those two (covering both a fresh question and a fully-finished round).

- [ ] **Step 4: Verify no console errors and sounds attempt to fire (files absent is expected/fine)**

```bash
cd frontend
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
```

Use `/browse` to play through a full quiz question with two connected players: submit both answers and let the timer run down past 3 seconds. Check `$B console --errors` — expect no uncaught errors (the `.catch(() => {})` in `playSound` must swallow the missing-file `NotSupportedError`/network error cleanly).

- [ ] **Step 5: Run the full backend test suite one more time to confirm no regressions from the whole feature set**

```bash
cd backend
REACT_APP_BACKEND_URL=http://localhost:8000 .venv/bin/python -m pytest tests/ -v
```

Expected: all tests PASS (including the new `test_new_room.py` tests from Task 1).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/sounds.js frontend/public/sounds/.gitkeep frontend/src/pages/HostRoom.jsx
git commit -m "HostRoom: add sound effects for first/second answer and final-3-seconds timer tick"
```

---

## Task 7: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full flow smoke test via `/browse`**

Using the `/browse` skill against `http://192.168.0.132:3002` (or `localhost:3002` per current dev setup):

1. Create a quiz room, join two players (Side A and Side B) on separate simulated sessions/tabs.
2. Confirm quiz answer buttons show both the shape icon and the answer text on each colored square (Task 5).
3. Start the game, answer the first question as both players — confirm (via `$B console`) no errors when `playSound` fires for `answer1`/`answer2` (Task 6), and let the timer run down to confirm no error at the 3-second mark.
4. Play through to the podium.
5. As the master (on the "phone" tab — the `/play/{code}` route), verify Rematch, New Game, and New Room buttons all render (Task 4).
6. Click New Room, fill the form, submit — confirm the master's tab navigates to `/play/{newCode}` and the non-master player's tab (still open on the old room) auto-navigates to `/play/{newCode}` too, landing on the same side with the same name, no re-join screen (Task 2 + Task 4).
7. Confirm a big-screen tab open on the old room's `/host/{code}` also redirects to `/host/{newCode}` (Task 3 Step 6).

- [ ] **Step 2: Report results**

Document which of the 7 checks passed/failed in the session's final summary to the user. If any check fails, do not mark this task's checkbox complete — file the failure as a follow-up rather than silently proceeding.

- [ ] **Step 3: Final commit (if any fixes were needed during verification)**

```bash
git add -A
git commit -m "Fix issues found during end-to-end verification of session persistence, answer UI, master controls, and sound effects"
```

(Skip this step entirely if no fixes were needed — do not create an empty commit.)
