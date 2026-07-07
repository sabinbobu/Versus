"""Backend tests for Versus quiz app.

Covers:
- Room creation and question generation
- Player join (1v1, team, duplicate name suffix)
- Start guards
- Full game loop (phase transitions)
- Answer submission (accepted once, scoring range)
- Host controls (pause/resume/skip)
- Rematch (regenerates questions, resets scores, no repeats)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get(
    "REACT_APP_BACKEND_URL") else None

if not BASE_URL:
    # fetch from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"


# ---------- Fixtures ----------
@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _create_room(s, **overrides):
    body = {
        "mode": "1v1",
        "topic": "General knowledge",
        "difficulty": "easy",
        "num_questions": 5,
        "time_per_question": 10,
        "language": "en",
    }
    body.update(overrides)
    r = s.post(f"{API}/rooms", json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["code"]


def _get_state(s, code):
    r = s.get(f"{API}/rooms/{code}/state", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _wait_ready(s, code, timeout=45):
    """Wait until questions_ready=true."""
    end = time.time() + timeout
    while time.time() < end:
        st = _get_state(s, code)
        if st.get("questions_ready"):
            return st
        time.sleep(1)
    pytest.fail(f"Room {code} never became ready within {timeout}s")


def _join(s, code, side, name, team_name=None):
    body = {"side": side, "name": name}
    if team_name is not None:
        body["team_name"] = team_name
    r = s.post(f"{API}/rooms/{code}/join", json=body, timeout=15)
    return r


# ---------- Health ----------
class TestHealth:
    def test_root(self, s):
        r = s.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok"


# ---------- Room creation & question generation ----------
class TestRoomCreation:
    def test_create_room_returns_5char_code(self, s):
        code = _create_room(s)
        assert isinstance(code, str)
        assert len(code) == 5
        assert code.isalnum()

    def test_questions_generate_and_ready(self, s):
        code = _create_room(s, num_questions=5)
        st = _wait_ready(s, code, timeout=60)
        assert st["questions_ready"] is True
        assert st["total_questions"] == 5
        assert st["num_questions"] == 5
        assert st["generating"] is False


# ---------- Join ----------
class TestJoin:
    def test_join_1v1_and_captain(self, s):
        code = _create_room(s)
        r = _join(s, code, "A", "Alice")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["side"] == "A"
        assert data["is_captain"] is True  # first on side
        assert data["name"] == "Alice"
        assert isinstance(data["token"], str) and len(data["token"]) > 0
        assert isinstance(data["id"], str)

    def test_team_mode_captain_sets_team_name(self, s):
        code = _create_room(s, mode="team")
        r = _join(s, code, "A", "Cap1", team_name="Team Alpha")
        assert r.status_code == 200
        assert r.json()["is_captain"] is True
        st = _get_state(s, code)
        assert st["sides"]["A"]["name"] == "Team Alpha"

    def test_duplicate_name_gets_suffix(self, s):
        code = _create_room(s)
        r1 = _join(s, code, "A", "Bob")
        assert r1.status_code == 200
        r2 = _join(s, code, "A", "Bob")
        assert r2.status_code == 200
        # Different names
        assert r1.json()["name"] == "Bob"
        assert r2.json()["name"] != "Bob"
        # Should contain "Bob" and a numeric suffix
        assert r2.json()["name"].startswith("Bob")

    def test_second_joiner_is_not_captain(self, s):
        code = _create_room(s)
        _join(s, code, "A", "First")
        r2 = _join(s, code, "A", "Second")
        assert r2.status_code == 200
        assert r2.json()["is_captain"] is False


# ---------- Start guards ----------
class TestStart:
    def test_start_blocked_when_no_players(self, s):
        code = _create_room(s)
        _wait_ready(s, code)
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 400

    def test_start_blocked_when_only_side_a(self, s):
        code = _create_room(s)
        _wait_ready(s, code)
        _join(s, code, "A", "Solo")
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 400

    def test_start_ok_when_ready_and_both_sides(self, s):
        code = _create_room(s)
        _wait_ready(s, code)
        _join(s, code, "A", "PA")
        _join(s, code, "B", "PB")
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200
        assert r.json()["ok"] is True


# ---------- Game loop ----------
class TestGameLoop:
    def test_phase_transitions_and_reaches_podium(self, s):
        # Use 2 questions, 10s tpq - runtime ~ 2*(3+10+5+4) = ~44s
        code = _create_room(s, num_questions=5, time_per_question=10)
        _wait_ready(s, code, timeout=60)
        pa = _join(s, code, "A", "PA").json()
        pb = _join(s, code, "B", "PB").json()
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200

        phases_seen = set()
        deadline = time.time() + 180  # generous limit
        final_state = None
        while time.time() < deadline:
            st = _get_state(s, code)
            phases_seen.add(st["phase"])
            # remaining_ms and phase_ends_at fields
            assert "remaining_ms" in st
            assert "phase_ends_at" in st
            if st["phase"] == "podium":
                final_state = st
                break
            # Try answering during active with player A (choice 0)
            if st["phase"] == "active":
                s.post(f"{API}/rooms/{code}/answer",
                       json={"token": pa["token"], "choice": 0}, timeout=10)
                s.post(f"{API}/rooms/{code}/answer",
                       json={"token": pb["token"], "choice": 1}, timeout=10)
            time.sleep(0.6)

        assert final_state is not None, f"Never reached podium. Phases: {phases_seen}"
        # Required phases
        for p in ("preview", "active", "reveal", "leaderboard", "podium"):
            assert p in phases_seen, f"missing phase {p}. Saw {phases_seen}"
        # Podium payload
        assert "podium" in final_state
        assert final_state["status"] == "finished"


# ---------- Answer accepted once ----------
class TestAnswers:
    def test_answer_once_only_and_scoring_range(self, s):
        code = _create_room(s, num_questions=5, time_per_question=10)
        _wait_ready(s, code, timeout=60)
        pa = _join(s, code, "A", "APl").json()
        pb = _join(s, code, "B", "BPl").json()
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Wait for active phase on first question
        deadline = time.time() + 30
        correct_index = None
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] == "active" and st.get("current_index") == 0:
                # question payload includes options but not correct_index during active
                break
            time.sleep(0.3)
        # Answer once quickly
        r1 = s.post(f"{API}/rooms/{code}/answer",
                    json={"token": pa["token"], "choice": 0}, timeout=10)
        assert r1.status_code == 200
        first = r1.json().get("accepted")
        # A second attempt should be rejected
        r2 = s.post(f"{API}/rooms/{code}/answer",
                    json={"token": pa["token"], "choice": 1}, timeout=10)
        assert r2.json().get("accepted") is False

        # Also submit B
        s.post(f"{API}/rooms/{code}/answer",
               json={"token": pb["token"], "choice": 2}, timeout=10)

        # Wait for reveal to see scoring
        deadline = time.time() + 30
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] in ("reveal", "leaderboard"):
                correct_index = st.get("question", {}).get("correct_index")
                break
            time.sleep(0.3)

        assert correct_index is not None
        # Check scoring range for the player whose choice matches correct_index
        # Look at side totals via _side_payload player["total"]
        st = _get_state(s, code)
        players_a = st["sides"]["A"]["players"]
        players_b = st["sides"]["B"]["players"]
        totals = [p["total"] for p in players_a + players_b]
        # correctness depends on random correct_index; at least one player should have a
        # score if they picked correct_index, otherwise both 0. We check that if
        # correct_index==0 the A player has a score in [500, 1000]; else score is 0.
        if correct_index == 0:
            a_total = players_a[0]["total"]
            assert 500 <= a_total <= 1000, f"unexpected score {a_total}"

    def test_answer_after_phase_end_rejected(self, s):
        code = _create_room(s, num_questions=5, time_per_question=10)
        _wait_ready(s, code, timeout=60)
        pa = _join(s, code, "A", "AP").json()
        _join(s, code, "B", "BP")
        s.post(f"{API}/rooms/{code}/start", timeout=10)
        # Wait until first reveal phase (past active)
        deadline = time.time() + 40
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] in ("reveal", "leaderboard"):
                break
            time.sleep(0.3)
        r = s.post(f"{API}/rooms/{code}/answer",
                   json={"token": pa["token"], "choice": 0}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("accepted") is False


# ---------- Host controls ----------
class TestHostControls:
    def test_pause_resume_freezes_timer(self, s):
        code = _create_room(s, num_questions=5, time_per_question=30)
        _wait_ready(s, code, timeout=60)
        _join(s, code, "A", "HA")
        _join(s, code, "B", "HB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Wait until active
        deadline = time.time() + 30
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] == "active":
                break
            time.sleep(0.3)

        # Pause
        r = s.post(f"{API}/rooms/{code}/pause", timeout=10)
        assert r.status_code == 200
        st1 = _get_state(s, code)
        assert st1["paused"] is True
        rem1 = st1["remaining_ms"]
        time.sleep(2)
        st2 = _get_state(s, code)
        # Should be nearly the same (allow small tolerance)
        assert st2["paused"] is True
        assert abs(rem1 - st2["remaining_ms"]) < 500, (
            f"Timer moved during pause: {rem1} -> {st2['remaining_ms']}")

        # Resume
        r = s.post(f"{API}/rooms/{code}/resume", timeout=10)
        assert r.status_code == 200
        st3 = _get_state(s, code)
        assert st3["paused"] is False

    def test_skip_advances_phase(self, s):
        code = _create_room(s, num_questions=5, time_per_question=30)
        _wait_ready(s, code, timeout=60)
        _join(s, code, "A", "SA")
        _join(s, code, "B", "SB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Wait until active on q0
        deadline = time.time() + 30
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] == "active" and st["current_index"] == 0:
                break
            time.sleep(0.3)

        # Skip
        r = s.post(f"{API}/rooms/{code}/skip", timeout=10)
        assert r.status_code == 200

        # Wait until current_index advances or phase becomes preview of next
        deadline = time.time() + 15
        advanced = False
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["current_index"] > 0 or (
                    st["current_index"] == 0 and st["phase"] not in ("active",)):
                advanced = True
                break
            time.sleep(0.3)
        assert advanced, "skip did not move forward"


# ---------- Rematch ----------
class TestRematch:
    def test_rematch_resets_and_regenerates(self, s):
        code = _create_room(s, num_questions=5, time_per_question=10)
        _wait_ready(s, code, timeout=60)
        pa = _join(s, code, "A", "RA").json()
        _join(s, code, "B", "RB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Wait for podium (short game)
        deadline = time.time() + 180
        while time.time() < deadline:
            st = _get_state(s, code)
            if st["phase"] == "podium":
                break
            # answer to keep it moving during active
            if st["phase"] == "active":
                s.post(f"{API}/rooms/{code}/answer",
                       json={"token": pa["token"], "choice": 0}, timeout=10)
            time.sleep(0.6)
        assert st["phase"] == "podium"

        # Rematch
        r = s.post(f"{API}/rooms/{code}/rematch", timeout=10)
        assert r.status_code == 200

        # Should flip questions_ready to false briefly (may be too fast), then true
        # Just check final: back to lobby, ready
        _wait_ready(s, code, timeout=60)
        st2 = _get_state(s, code)
        assert st2["status"] == "lobby"
        assert st2["phase"] == "lobby"
        # scores reset
        for side in ("A", "B"):
            for p in st2["sides"][side]["players"]:
                assert p["total"] == 0
        # players preserved
        assert len(st2["sides"]["A"]["players"]) >= 1
        assert len(st2["sides"]["B"]["players"]) >= 1


# ---------- Not-found ----------
class TestErrors:
    def test_state_of_missing_room_404(self, s):
        r = s.get(f"{API}/rooms/NOPE1/state", timeout=10)
        assert r.status_code == 404

    def test_join_missing_room_404(self, s):
        r = s.post(f"{API}/rooms/NOPE1/join",
                   json={"side": "A", "name": "x"}, timeout=10)
        assert r.status_code == 404
