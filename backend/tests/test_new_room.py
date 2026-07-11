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

    def test_new_room_echoes_callers_new_token(self, s):
        """When the caller passes their own token, the response returns that
        caller's freshly-minted token for the new room, so the master's phone
        can savePlayer() before navigating (no rescan for the master itself)."""
        code = _create(s)
        _wait_ready(s, code)
        a = _join(s, code, "A", "MasterA")
        _join(s, code, "B", "PlayerB")

        body = _new_room_body()
        body["token"] = a["token"]
        r = s.post(f"{API}/rooms/{code}/new-room", json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        new_code = data["code"]

        # The echoed token matches this caller's entry in the old room's token map.
        old_st = _state(s, code)
        assert data["token"] == old_st["new_room"]["tokens"][a["token"]]
        assert data["token"] != a["token"]

        # And it is a real, usable player in the new room on the same side.
        _wait_ready(s, new_code)
        new_st = _state(s, new_code)
        masters = [p for p in new_st["sides"]["A"]["players"] if p.get("is_master")]
        assert len(masters) == 1 and masters[0]["name"] == "MasterA"

    def test_new_room_token_null_when_no_caller_token(self, s):
        """No caller token supplied -> response 'token' is null (host big-screen
        path, which uses no localStorage, relies on this being absent/null)."""
        code = _create(s)
        _wait_ready(s, code)
        _join(s, code, "A", "MasterA")

        r = s.post(f"{API}/rooms/{code}/new-room", json=_new_room_body(), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["token"] is None
