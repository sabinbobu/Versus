import { useEffect, useRef, useState, useCallback } from "react";
import { http, wsUrl } from "./api";

// Real-time room state via WebSocket, with automatic 1s polling fallback.
export function useRoomState(code, role, token) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const gotMsgRef = useRef(false);

  useEffect(() => {
    if (!code) return;
    let alive = true;

    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await http.get(`/rooms/${code}/state`, { params: token ? { token } : {} });
          if (alive) setState(r.data);
        } catch (e) {}
      };
      tick();
      pollRef.current = setInterval(tick, 1000);
    };

    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    let ws;
    try {
      ws = new WebSocket(wsUrl(code, role, token));
      wsRef.current = ws;
      ws.onopen = () => { if (alive) setConnected(true); };
      ws.onmessage = (e) => {
        gotMsgRef.current = true;
        stopPoll();
        try {
          const data = JSON.parse(e.data);
          if (alive && !data.error) setState(data);
        } catch {}
      };
      ws.onclose = () => { if (alive) { setConnected(false); startPoll(); } };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {
      startPoll();
    }

    const safety = setTimeout(() => { if (!gotMsgRef.current) startPoll(); }, 2500);

    return () => {
      alive = false;
      clearTimeout(safety);
      stopPoll();
      try { ws && ws.close(); } catch {}
    };
  }, [code, role, token]);

  const sendAnswer = useCallback((choice) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1 && token) {
      ws.send(JSON.stringify({ type: "answer", choice }));
    } else {
      http.post(`/rooms/${code}/answer`, { token, choice }).catch(() => {});
    }
  }, [code, token]);

  return { state, connected, sendAnswer };
}

// Local countdown ticker for smooth timer rendering.
export function useTick(intervalMs = 100) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
