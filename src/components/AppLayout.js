// src/components/AppLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import TopBar from "components/TopBar";

export default function AppLayout() {
  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      <TopBar />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <Outlet />
      </main>
    </div>
  );
}
