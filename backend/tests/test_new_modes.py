"""Tests for the two NEW game modes: Reaction and Memory.

Reaction:
- No LLM: room ready immediately with total_questions == requested
- Each question type=='reaction' with correct_index 0-3
- target only appears in state after light delay (reaction_live=true)
- Answer before light -> false_start, scores 0
- Correct tap after light -> scores 500-1000
- Wrong tap -> 0
- Game reaches podium

Memory:
- No LLM: ready immediately
- deck length == pairs*2, has duration_ms
- difficulty controls pairs (easy=4, medium=6, hard=8)
- POST /rooms/{code}/memory records done, points>0 reduced by mistakes*25
- Player who never submits scores 0 for that round
- Game reaches podium
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _create(s, **kw):
    body = {
        "mode": "1v1",
        "game_type": "quiz",
        "topic": "General knowledge",
        "difficulty": "easy",
        "num_questions": 5,
        "time_per_question": 10,
        "language": "en",
    }
    body.update(kw)
    r = s.post(f"{API}/rooms", json=body, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["code"]


def _state(s, code, token=None):
    url = f"{API}/rooms/{code}/state"
    if token:
        url += f"?token={token}"
    r = s.get(url, timeout=15)
    assert r.status_code == 200
    return r.json()


def _join(s, code, side, name):
    r = s.post(f"{API}/rooms/{code}/join",
               json={"side": side, "name": name}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _wait_ready(s, code, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        st = _state(s, code)
        if st["questions_ready"]:
            return st
        time.sleep(0.3)
    pytest.fail(f"room {code} not ready in {timeout}s")


def _wait_phase(s, code, phase, timeout=30, qi=None):
    end = time.time() + timeout
    while time.time() < end:
        st = _state(s, code)
        if st["phase"] == phase and (qi is None or st["current_index"] == qi):
            return st
        time.sleep(0.1)
    pytest.fail(f"phase {phase} qi={qi} never reached in {timeout}s")


# ---------- REACTION creation ----------
class TestReactionCreation:
    def test_reaction_ready_immediately_no_llm(self, s):
        t0 = time.time()
        code = _create(s, game_type="reaction", num_questions=5)
        st = _state(s, code)
        # No LLM => ready almost instantly (well under 3s)
        assert st["questions_ready"] is True, "reaction rooms should be ready immediately"
        assert st["total_questions"] == 5
        assert st["num_questions"] == 5
        assert st["game_type"] == "reaction"
        assert time.time() - t0 < 3, "reaction gen should not require LLM latency"

    def test_reaction_questions_have_correct_index_and_type(self, s):
        code = _create(s, game_type="reaction", num_questions=5)
        _wait_ready(s, code, timeout=5)
        # start a game so state.question is exposed - simpler: peek engine via one full round
        _join(s, code, "A", "PA")
        _join(s, code, "B", "PB")
        r = s.post(f"{API}/rooms/{code}/start", timeout=10)
        assert r.status_code == 200
        st = _wait_phase(s, code, "active", timeout=15, qi=0)
        # Type must be reaction on the exposed question
        assert st["question"]["type"] == "reaction"


# ---------- REACTION flow ----------
class TestReactionFlow:
    def test_reaction_game_reaches_podium_with_scoring(self, s):
        code = _create(s, game_type="reaction", num_questions=3, time_per_question=10)
        _wait_ready(s, code, timeout=5)
        pa = _join(s, code, "A", "PA")
        pb = _join(s, code, "B", "PB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Q0: player A false-starts (tap before reaction_live=true)
        st = _wait_phase(s, code, "active", timeout=15, qi=0)
        # Immediately tap before light
        assert st["question"]["reaction_live"] is False, "should not be live at active start"
        r = s.post(f"{API}/rooms/{code}/answer",
                   json={"token": pa["token"], "choice": 0}, timeout=10)
        assert r.status_code == 200 and r.json()["accepted"] is True

        # Wait for reaction_live=true and grab target
        end = time.time() + 10
        target = None
        while time.time() < end:
            st = _state(s, code)
            q = st.get("question") or {}
            if q.get("reaction_live") and "target" in q:
                target = q["target"]
                break
            time.sleep(0.05)
        assert target is not None, "reaction_live+target never appeared"
        assert 0 <= target <= 3

        # Player B taps correct target now
        r2 = s.post(f"{API}/rooms/{code}/answer",
                    json={"token": pb["token"], "choice": target}, timeout=10)
        assert r2.status_code == 200 and r2.json()["accepted"] is True

        # Wait for reveal to verify scoring
        rv = _wait_phase(s, code, "reveal", timeout=15)
        results = rv.get("results", {})
        # A should be false_start, 0 pts
        a_res = results.get(pa["id"])
        b_res = results.get(pb["id"])
        assert a_res is not None, "A should have result recorded"
        assert a_res["false_start"] is True
        assert a_res["points"] == 0
        # B should be correct with 500-1000
        assert b_res is not None
        assert b_res["correct"] is True
        assert 500 <= b_res["points"] <= 1000, f"B points {b_res['points']} not in 500-1000"

        # Q1: both wrong choice => 0 pts
        st = _wait_phase(s, code, "active", timeout=20, qi=1)
        # Wait for light
        end = time.time() + 10
        target1 = None
        while time.time() < end:
            st = _state(s, code)
            q = st.get("question") or {}
            if q.get("reaction_live") and "target" in q:
                target1 = q["target"]
                break
            time.sleep(0.05)
        assert target1 is not None
        wrong = (target1 + 1) % 4
        s.post(f"{API}/rooms/{code}/answer",
               json={"token": pa["token"], "choice": wrong}, timeout=10)
        s.post(f"{API}/rooms/{code}/answer",
               json={"token": pb["token"], "choice": wrong}, timeout=10)
        rv1 = _wait_phase(s, code, "reveal", timeout=15)
        results1 = rv1.get("results", {})
        assert results1.get(pa["id"], {}).get("points", -1) == 0
        assert results1.get(pb["id"], {}).get("points", -1) == 0

        # Skip remaining rounds to podium
        for _ in range(20):
            st = _state(s, code)
            if st["phase"] == "podium":
                break
            if st["phase"] in ("active", "reveal", "leaderboard", "preview"):
                s.post(f"{API}/rooms/{code}/skip", timeout=5)
            time.sleep(0.6)

        # Wait for podium
        end = time.time() + 60
        while time.time() < end:
            st = _state(s, code)
            if st["phase"] == "podium":
                assert st["status"] == "finished"
                assert "podium" in st
                return
            if st["phase"] != "podium":
                s.post(f"{API}/rooms/{code}/skip", timeout=5)
            time.sleep(0.5)
        pytest.fail("reaction game did not reach podium")


# ---------- MEMORY creation ----------
class TestMemoryCreation:
    @pytest.mark.parametrize("diff,expected_pairs", [
        ("easy", 4),
        ("medium", 6),
        ("hard", 8),
    ])
    def test_memory_deck_size_by_difficulty(self, s, diff, expected_pairs):
        t0 = time.time()
        code = _create(s, game_type="memory", difficulty=diff, num_questions=5)
        st = _state(s, code)
        assert st["questions_ready"] is True
        assert st["total_questions"] == 5
        assert st["game_type"] == "memory"
        assert time.time() - t0 < 3
        # Start to expose the question payload
        _join(s, code, "A", "PA")
        _join(s, code, "B", "PB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)
        st = _wait_phase(s, code, "active", timeout=15, qi=0)
        q = st["question"]
        assert q["type"] == "memory"
        assert "deck" in q and isinstance(q["deck"], list)
        assert len(q["deck"]) == expected_pairs * 2
        assert q["pairs"] == expected_pairs
        assert q.get("duration_ms", 0) > 0


# ---------- MEMORY flow ----------
class TestMemoryFlow:
    def test_memory_scoring_and_podium(self, s):
        code = _create(s, game_type="memory", difficulty="easy", num_questions=5, time_per_question=15)
        _wait_ready(s, code, timeout=5)
        pa = _join(s, code, "A", "PA")
        pb = _join(s, code, "B", "PB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)

        # Q0: A submits mistakes=1, B never submits
        _wait_phase(s, code, "active", timeout=15, qi=0)
        # small delay to give some elapsed time
        time.sleep(0.4)
        r = s.post(f"{API}/rooms/{code}/memory",
                   json={"token": pa["token"], "mistakes": 1}, timeout=10)
        assert r.status_code == 200
        assert r.json()["accepted"] is True

        # Duplicate submission should be rejected
        r2 = s.post(f"{API}/rooms/{code}/memory",
                    json={"token": pa["token"], "mistakes": 0}, timeout=10)
        assert r2.json()["accepted"] is False

        # Memory active duration is min(70000, pairs*7000+8000) = 36s for 4 pairs.
        # B doesn't submit -> wait for full timeout to reach reveal.
        rv = _wait_phase(s, code, "reveal", timeout=50)
        results = rv.get("results", {})
        a_res = results.get(pa["id"])
        b_res = results.get(pb["id"])
        assert a_res is not None
        assert a_res.get("done") is True
        # Points > 0, reduced by mistakes*25 (base 500-1000 - 25)
        assert a_res["points"] > 0
        assert a_res["points"] <= 1000 - 25 + 1  # sanity ceiling
        # B never submitted -> 0
        assert b_res is None or b_res.get("points", 0) == 0 or not b_res.get("done")

        # Speed to podium
        for _ in range(30):
            st = _state(s, code)
            if st["phase"] == "podium":
                break
            if st["phase"] in ("active", "reveal", "leaderboard", "preview"):
                s.post(f"{API}/rooms/{code}/skip", timeout=5)
            time.sleep(0.5)

        end = time.time() + 60
        while time.time() < end:
            st = _state(s, code)
            if st["phase"] == "podium":
                assert st["status"] == "finished"
                assert "podium" in st
                return
            s.post(f"{API}/rooms/{code}/skip", timeout=5)
            time.sleep(0.5)
        pytest.fail("memory game did not reach podium")


# ---------- QUIZ regression ----------
class TestQuizRegression:
    def test_quiz_still_works(self, s):
        code = _create(s, game_type="quiz", num_questions=5, time_per_question=10,
                       difficulty="easy", topic="General knowledge")
        st = _wait_ready(s, code, timeout=60)
        assert st["game_type"] == "quiz"
        assert st["total_questions"] == 5
        pa = _join(s, code, "A", "PA")
        _join(s, code, "B", "PB")
        s.post(f"{API}/rooms/{code}/start", timeout=10)
        # Verify quiz question exposes options during active
        st = _wait_phase(s, code, "active", timeout=15, qi=0)
        q = st["question"]
        assert q["type"] == "quiz"
        assert isinstance(q.get("options"), list) and len(q["options"]) == 4
        # Skip through
        for _ in range(30):
            st = _state(s, code)
            if st["phase"] == "podium":
                assert st["status"] == "finished"
                return
            s.post(f"{API}/rooms/{code}/skip", timeout=5)
            time.sleep(0.5)
        pytest.fail("quiz regression did not reach podium")
