# Session persistence, answer UI, phone master controls, and sound effects

Date: 2026-07-11
Status: Approved

## Summary

Four features for the Versus party-quiz app:

1. Players stay logged in across brand-new rooms the Master creates from their phone (not just Rematch/New Game in the same room, which already works).
2. Quiz answer buttons on player phones show the answer text on the colored square, alongside the existing shape icon.
3. The Master can trigger Rematch, New Game, or New Room — and fill in the full settings form — from their own phone, not just the big screen.
4. Sound effects on the big screen (host view) for: first player's answer, second player's answer, and the final 3 seconds of the countdown.

## Context

- Rooms are identified by a `code`; players are identified by a room-scoped `token` stored in `localStorage` under `versus_{code}`. Rematch/New Game (`/rematch`, `/reconfigure`) already reuse the same room code, so existing tokens keep working — this part already satisfies "no rescanning" and needs no change.
- There is no persistence today when the Master creates a **new room** (new `code`) — that's currently only reachable via the "Fresh Room" button, which sends the Master to `/setup` and produces a room with zero players; everyone has to rescan.
- The Master is the first player ever to join a room (`is_master: first_ever` in `game_engine.join`). Only one Master per room.
- `useRoomState` (frontend/src/lib/useRoomState.js) receives one full `room.serialize()` JSON payload per WebSocket message — there is no separate event-type channel today.
- The big screen (`HostRoom.jsx`) already renders quiz answer option text next to the icon (`QuizActive`, lines 190-197) — feature 2 is phone-only.
- Reaction-mode questions have no answer text (`options` doesn't exist for them) — feature 2 must not touch reaction mode.

## Feature 1 + 3: Master-driven New Room with auto-follow, and phone-based setup form

### New Room endpoint

Add `POST /rooms/{code}/new-room` to `backend/server.py`, reusing the same `Reconfigure`-shaped request body (game_type, topic, difficulty, num_questions, time_per_question, language) plus `mode` (1v1/team, since a genuinely new room can change mode — matching what `/rooms` already accepts).

Behavior in `game_engine.py` (new `Engine.new_room(old_room, **settings)` method):

1. Validate the requesting call comes from the room's master (the endpoint takes the old room's `code`; no token is passed today for host-only endpoints like `/pause`/`/skip`, so `new-room` follows the same trust model — the frontend only exposes the button to whichever client believes it's the master, matching existing patterns for pause/skip/rematch).
2. Create the new room via the existing `create_room()` path (fresh code, fresh question generation task).
3. Walk `old_room.all_players()` for every **connected** player (`p["connected"] is True`). For each:
   - Determine their side in the old room.
   - Call the new room's join logic directly (bypassing the HTTP `/join` validation) to register them under the same side and the same name, minting a **new token** scoped to the new room. The old master is registered first so they retain `is_master` in the new room too.
   - Build a `token_map: {old_token: new_token}` per connected player.
4. Set `old_room.new_room_code` and `old_room.new_room_tokens` (the `token_map`) as transient fields on the old room object (not persisted beyond this broadcast — they exist only to inform currently-connected clients).
5. Broadcast the old room's serialized state once more; `room.serialize()` includes `new_room: {code, tokens}` when `new_room_code` is set.
6. Return `{code: new_code}` to the caller (the Master's own client uses this directly rather than waiting for its own broadcast).

### Client-side auto-follow

`useRoomState.js`: after setting `state` from an incoming WS message (or poll response), check `data.new_room`. If present and `data.new_room.tokens[token]` exists (this client's old token is in the map), the hook:
- Calls `savePlayer(newCode, { token: newToken, id, side, name, is_master })` (reusing the existing player object shape, side/name/id/is_master carried over from the old `state`).
- Sets a `redirectTo` value in the hook's return object.

`PlayerRoom.jsx` and `HostRoom.jsx`: when `redirectTo` is set, `nav()` to `/play/{newCode}` (players) or `/host/{newCode}` (the master's big-screen tab, if that's where they are). The master's own phone action (below) navigates directly using the endpoint's returned code rather than waiting on the redirect round-trip, since it initiated the call.

Non-master players who are not currently connected (WS closed, phone locked, tab backgrounded) do not get auto-followed — they'll see "Room not found" or a stale lobby if they return to the old code later. This is an accepted limitation: only players actively connected at the moment the Master creates the new room follow automatically. (Matches your answer: "existing players who are still connected auto-follow.")

### Phone-based setup form

Extract the settings form currently inline in `HostRoom.jsx`'s `NewGameOverlay` (topic, difficulty, num questions, time per question, language, game type) into a new shared component `frontend/src/components/GameSettingsForm.jsx`, taking props `{ initial, showMode, onSubmit, submitLabel, busy }`. `showMode` controls whether the 1v1/Team toggle is shown (only for New Room, since New Game/Rematch keep the existing room's mode).

`HostRoom.jsx`'s `NewGameOverlay` becomes a thin wrapper around `GameSettingsForm` (no behavior change, pure refactor).

`PlayerRoom.jsx`, `podium` phase, when `isMaster`: replace the current "Watch the big screen" text with three buttons:
- **Rematch** — `POST /rooms/{code}/rematch`, no form, same as big screen.
- **New Game** — opens `GameSettingsForm` (mode hidden) in a full-screen mobile sheet, submits to `/reconfigure`.
- **New Room** — opens `GameSettingsForm` (mode shown) in a full-screen mobile sheet, submits to `/new-room`; on success, the master's phone navigates to `/play/{newCode}` (they stay on their phone, matching how they got here). A separate big-screen tab, if one is open, follows via the broadcast-based redirect described above and lands on `/host/{newCode}`.

Non-master players in the podium phase keep the existing "Watch the big screen for the podium" messaging — no new actions for them (only the Master drives room transitions).

## Feature 2: Answer text on colored squares (quiz mode, player phones)

`PlayerRoom.jsx`, quiz-mode answer buttons (`answer-buttons` block, currently icon-only):

```jsx
<button ... style={{ background: a.color }}>
  <ShapeIcon index={i} size={40} />
  <span style={{ color: a.text }} className="font-black text-sm sm:text-base leading-tight text-center line-clamp-2 px-2 mt-1">
    {state.question?.options?.[i]}
  </span>
</button>
```

- Icon size reduced from 72 to 40 to make room for text (buttons remain touch-friendly per existing sizing).
- Text uses `ANSWERS[i].text` (existing contrast-safe color) exactly as the big screen already does.
- Reaction-mode buttons (`reaction-buttons` block) are untouched — no `options` array exists for them, so `state.question?.options?.[i]` is naturally `undefined` there too, but we scope the change to only the quiz block to avoid rendering an empty `<span>` in reaction mode.
- Memory mode is unaffected (uses `MemoryBoard`, not these buttons).

## Feature 4: Sound effects (big screen only)

New file `frontend/src/lib/sounds.js`:

```js
const FILES = { answer1: "/sounds/answer1.mp3", answer2: "/sounds/answer2.mp3", tick: "/sounds/tick.mp3" };
const cache = {};
export function playSound(name) {
  if (!FILES[name]) return;
  let audio = cache[name];
  if (!audio) { audio = new Audio(FILES[name]); cache[name] = audio; }
  else { audio.currentTime = 0; }
  audio.play().catch(() => {});
}
```

Assets live in `frontend/public/sounds/{answer1,answer2,tick}.mp3` (user-provided; folder created now, files added later — missing files fail silently via the `.catch()`).

`HostRoom.jsx`, `Active` component (wraps `QuizActive`/`ReactionActive`/`MemoryActive`):
- Add a `useRef` tracking the previous `answered_ids.length` and the current `question.number` (to reset per round).
- On each render where `answered_ids.length` increased from 0→1 within the same question, call `playSound("answer1")`.
- On each render where it increased from 1→2 within the same question, call `playSound("answer2")`.
- Guard resets when `question.number` or `phase` changes (new round starts), so counts don't leak across questions.
- This applies to quiz, reaction, and memory modes alike, since `answered_ids` is populated the same way in all three (memory uses it as "solved" tracking, matching the spirit of "first/second player responds").

Timer sound: reuse the existing `useCountdown(state)` hook already called inside `TimerFooter`/`Active`. Add a `useRef` guarding "already played tick for this question's final 3 seconds." When `sec === 3` and phase is `active` or `sudden_death` and the guard hasn't fired for the current `question.number`, call `playSound("tick")` and set the guard. Reset the guard when `question.number` changes.

No sounds added to `PlayerRoom.jsx` (phones) or to the preview/reveal/leaderboard/podium phases.

## Testing

- Manual QA via `/browse`: create a room, join two players, verify quiz answer buttons show text; trigger New Room from the master's phone with a second connected player and confirm both land in the new room without rescanning; verify Rematch/New Game phone buttons still work; listen for sound triggers (best-effort, since audio files aren't provided yet — verify `playSound` calls fire via console logging during dev, remove before considering the feature complete).
- No automated test suite currently covers frontend behavior (only `backend/tests/*.py` exist) — this spec does not add new backend Python tests beyond manual verification of the `/new-room` endpoint's token-mapping logic, since the existing test style is integration-style hitting the running engine; a `test_new_room.py` mirroring `test_master_reconfigure.py`'s structure will be added during implementation.

## Out of scope

- Persisting player identity across rooms for players who are *not* connected at New-Room time (no offline resurrection).
- Device-level "remember me across any room" profile beyond what already exists (`versus_profile` for name prefill).
- Non-master players getting any podium-phase actions.
- Sound effects on individual phones.
- Any change to reaction-mode or memory-mode answer button visuals.
