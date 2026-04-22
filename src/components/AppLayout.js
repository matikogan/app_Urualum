// src/components/AppLayout.jsx
import React from "react";
import { Outlet } from "react-router-dom";
import TopBar from "components/TopBar";

export default function AppLayout() {
  return (
    <div style={{ minHeight: "100vh", background: "#fafafa" }}>
      <TopBar />
      {/* Sin maxWidth ni padding — cada página gestiona su propio layout */}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
