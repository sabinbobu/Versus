"""Backend tests for two NEW features: Master player + Persistent Session (reconfigure).

Covers:
- POST /rooms/{code}/join returns is_master=true for the first player, false for subsequent
- GET /rooms/{code}/state exposes sides[x].players[].is_master and can_start flag
- POST /rooms/{code}/reconfigure keeps players+master, resets scores, regenerates questions
- POST /rooms/{code}/start works after reconfigure with preserved players
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


# ---------- Master flag ----------
class TestMasterFlag:
    def test_first_joiner_is_master_second_is_not(self, s):
        code = _create(s)  # reaction: instant ready
        _wait_ready(s, code)
        # First on side A -> master
        a = _join(s, code, "A", "Alpha")
        assert a["is_master"] is True
        assert a["is_captain"] is True
        # Second player on side B -> not master
        b = _join(s, code, "B", "Bravo")
        assert b["is_master"] is False
        assert b["is_captain"] is True  # captain of side B, but not master
        # Third player joining side A -> not master, not captain
        c = _join(s, code, "A", "Charlie")
        assert c["is_master"] is False
        assert c["is_captain"] is False

    def test_state_reflects_is_master(self, s):
        code = _create(s)
        _wait_ready(s, code)
        a = _join(s, code, "A", "Alpha")
        b = _join(s, code, "B", "Bravo")
        st = _state(s, code)
        players_a = st["sides"]["A"]["players"]
        players_b = st["sides"]["B"]["players"]
        # exactly one master overall
        masters = [p for p in players_a + players_b if p.get("is_master")]
        assert len(masters) == 1
        assert masters[0]["id"] == a["id"]
        for p in players_b:
            assert p["is_master"] is False

    def test_first_joiner_on_side_b_becomes_master(self, s):
        """Master = first player to join the ROOM, regardless of side."""
        code = _create(s)
        _wait_ready(s, code)
        first = _join(s, code, "B", "FirstOnB")
        assert first["is_master"] is True
        second = _join(s, code, "A", "SecondOnA")
        assert second["is_master"] is False


# ---------- can_start flag ----------
class TestCanStartFlag:
    def test_can_start_false_when_one_side_empty(self, s):
        code = _create(s)
        _wait_ready(s, code)
        st = _state(s, code)
        assert st["can_start"] is False  # no players
        _join(s, code, "A", "OnlyA")
        st = _state(s, code)
        assert st["can_start"] is False  # side B empty

    def test_can_start_true_when_both_sides_and_ready(self, s):
        code = _create(s)
        _wait_ready(s, code)
        _join(s, code, "A", "P1")
        _join(s, code, "B", "P2")
        st = _state(s, code)
        assert st["can_start"] is True
        assert st["questions_ready"] is True


# ---------- Reconfigure (persistent session) ----------
class TestReconfigure:
    def test_reconfigure_preserves_players_and_master(self, s):
        # Start with reaction
        code = _create(s, game_type="reaction", num_questions=5,
                       time_per_question=10)
        _wait_ready(s, code)
        a = _join(s, code, "A", "MasterA")
        b = _join(s, code, "B", "PlayerB")
        assert a["is_master"] is True

        # Move it into playing so we have some state to reset
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200
        time.sleep(1.5)  # let it enter preview/active

        # Reconfigure to memory + new params
        body = {
            "game_type": "memory",
            "topic": "n/a",
            "difficulty": "easy",
            "num_questions": 5,
            "time_per_question": 15,
            "language": "en",
        }
        r = s.post(f"{API}/rooms/{code}/reconfigure", json=body, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # Wait for regen (memory = instant)
        _wait_ready(s, code, timeout=30)
        st = _state(s, code)

        # Room reset to lobby and new game type applied
        assert st["status"] == "lobby"
        assert st["phase"] == "lobby"
        assert st["game_type"] == "memory"
        assert st["difficulty"] == "easy"
        assert st["num_questions"] == 5
        assert st["time_per_question"] == 15

        # Players preserved
        names_a = {p["name"] for p in st["sides"]["A"]["players"]}
        names_b = {p["name"] for p in st["sides"]["B"]["players"]}
        assert "MasterA" in names_a
        assert "PlayerB" in names_b

        # Master still set (same player)
        masters = [p for p in st["sides"]["A"]["players"]
                   + st["sides"]["B"]["players"] if p.get("is_master")]
        assert len(masters) == 1
        assert masters[0]["name"] == "MasterA"
        assert masters[0]["id"] == a["id"]

        # Scores reset
        for side in ("A", "B"):
            for p in st["sides"][side]["players"]:
                assert p["total"] == 0

    def test_start_works_after_reconfigure(self, s):
        code = _create(s, game_type="reaction")
        _wait_ready(s, code)
        _join(s, code, "A", "MA")
        _join(s, code, "B", "PB")
        # First game start
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200
        time.sleep(1.0)

        # Reconfigure to memory
        body = {"game_type": "memory", "topic": "n/a", "difficulty": "easy",
                "num_questions": 5, "time_per_question": 15, "language": "en"}
        r = s.post(f"{API}/rooms/{code}/reconfigure", json=body, timeout=15)
        assert r.status_code == 200
        _wait_ready(s, code, timeout=30)

        # Start again - should work because players + questions preserved
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # Verify we entered playing
        deadline = time.time() + 10
        entered = False
        while time.time() < deadline:
            st = _state(s, code)
            if st["status"] == "playing" and st["phase"] in (
                    "preview", "active"):
                entered = True
                break
            time.sleep(0.3)
        assert entered, "Game did not start after reconfigure"

    def test_reconfigure_missing_room_404(self, s):
        r = s.post(f"{API}/rooms/ZZZZZ/reconfigure",
                   json={"game_type": "reaction", "topic": "x",
                         "difficulty": "easy", "num_questions": 5,
                         "time_per_question": 10, "language": "en"},
                   timeout=10)
        assert r.status_code == 404
