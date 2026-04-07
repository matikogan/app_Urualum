// src/components/ProtectedRoute.jsx
import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "context/AuthContext";

export default function ProtectedRoute({ roles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 20 }}>Cargando sesión…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && roles.length > 0 && !roles.includes(profile?.rol)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
