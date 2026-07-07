# Versus — Test Credentials

No authentication in this app (no accounts, no login). Rooms are ephemeral.

- Create a game as HOST at `/` → Create Game → Setup → Open Lobby (redirects to `/host/{CODE}`).
- Players JOIN via `/join/{CODE}/{A|B}` (QR encodes this URL) or manual room code on landing.
- Player identity token is stored in `localStorage` key `versus_{CODE}` for reconnection.
