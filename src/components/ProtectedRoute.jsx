// src/components/ProtectedRoute.jsx
import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "context/AuthContext";

export default function ProtectedRoute() {
  const { user, loading } = useAuth(); // 👈 loading es clave

  if (loading) {
    // mientras Firebase resuelve la sesión
    return <div style={{ padding: 20 }}>Cargando sesión…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />; // deja pasar a las rutas hijas
}
