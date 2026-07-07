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
    let reconnectTimer = null;
    let attempts = 0;

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
          if (alive && !data.error) setState(data);
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
