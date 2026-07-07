import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Setup from "./pages/Setup";
import HostRoom from "./pages/HostRoom";
import PlayerJoin from "./pages/PlayerJoin";
import PlayerRoom from "./pages/PlayerRoom";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/host/:code" element={<HostRoom />} />
        <Route path="/join/:code" element={<PlayerJoin />} />
        <Route path="/join/:code/:side" element={<PlayerJoin />} />
        <Route path="/play/:code" element={<PlayerRoom />} />
      </Routes>
    </BrowserRouter>
  );
}
