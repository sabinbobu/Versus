import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

from game_engine import Engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("versus")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

engine = Engine(db=db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await db.rooms.create_index("expire_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning(f"index create failed: {e}")
    yield
    client.close()


app = FastAPI(lifespan=lifespan)
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateRoom(BaseModel):
    mode: str = "1v1"
    topic: str = "General knowledge"
    difficulty: str = "mixed"
    num_questions: int = 10
    time_per_question: int = 15
    language: str = "en"


class JoinRoom(BaseModel):
    side: str
    name: str
    token: str | None = None
    team_name: str | None = None


class Answer(BaseModel):
    token: str
    choice: int


@api.get("/")
async def root():
    return {"app": "Versus", "status": "ok"}


@api.post("/rooms")
async def create_room(body: CreateRoom):
    mode = body.mode if body.mode in ("1v1", "team") else "1v1"
    num = body.num_questions if body.num_questions in (5, 10, 15) else 10
    tpq = body.time_per_question if body.time_per_question in (10, 15, 20, 30) else 15
    lang = body.language if body.language in ("en", "ro") else "en"
    diff = body.difficulty if body.difficulty in ("easy", "medium", "hard", "mixed") else "mixed"
    room = engine.create_room(
        mode=mode, topic=(body.topic or "General knowledge").strip()[:80],
        difficulty=diff, num_questions=num, time_per_question=tpq, language=lang)
    return {"code": room.code}


@api.get("/rooms/{code}/state")
async def get_state(code: str, token: str | None = None):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    if token:
        await engine.heartbeat(room, token)
    return room.serialize()


@api.get("/rooms/{code}")
async def get_room(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    return room.serialize()


@api.post("/rooms/{code}/join")
async def join_room(code: str, body: JoinRoom):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    player, side = engine.join(room, body.side, body.name, body.token, body.team_name)
    if player is None:
        raise HTTPException(409, "Game already in progress")
    await engine.broadcast(room)
    return {
        "token": player["token"],
        "id": player["id"],
        "name": player["name"],
        "side": side,
        "is_captain": player["is_captain"],
    }


@api.post("/rooms/{code}/start")
async def start_game(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    if not engine.can_start(room):
        raise HTTPException(400, "Each side needs at least one player and questions must be ready")
    ok = await engine.start(room)
    if not ok:
        raise HTTPException(400, "Cannot start")
    return {"ok": True}


@api.post("/rooms/{code}/pause")
async def pause_game(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    await engine.pause(room)
    return {"ok": True}


@api.post("/rooms/{code}/resume")
async def resume_game(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    await engine.resume(room)
    return {"ok": True}


@api.post("/rooms/{code}/skip")
async def skip_question(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    await engine.skip(room)
    return {"ok": True}


@api.post("/rooms/{code}/answer")
async def answer(code: str, body: Answer):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    ok = await engine.submit_answer(room, body.token, body.choice)
    return {"accepted": ok}


@api.post("/rooms/{code}/rematch")
async def rematch(code: str):
    room = engine.get(code)
    if not room:
        raise HTTPException(404, "Room not found")
    await engine.rematch(room)
    return {"ok": True}


@app.websocket("/api/ws/{code}")
async def ws_endpoint(ws: WebSocket, code: str, role: str = "player", token: str | None = None):
    await ws.accept()
    room = engine.get(code)
    if not room:
        await ws.send_json({"error": "room_not_found"})
        await ws.close()
        return
    await engine.connect(room, ws, role, token)
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "answer" and token:
                await engine.submit_answer(room, token, msg.get("choice"))
    except WebSocketDisconnect:
        await engine.disconnect(room, ws)
    except Exception:
        await engine.disconnect(room, ws)


app.include_router(api)
