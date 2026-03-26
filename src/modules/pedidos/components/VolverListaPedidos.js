import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

/**
 * Botón reutilizable para volver a la lista de pedidos.
 * - Si no pasás `to`, deduce por rol:
 *    Encargado  -> /pedidos
 *    Operario   -> /pedidos-operario
 * Props opcionales:
 *  - to: string (ruta destino, por si querés forzar otra)
 *  - label: string (texto del botón)
 *  - replace: boolean (default false)
 *  - state: any (obj opcional para pasar state en navigate)
 */
export default function VolverListaPedidos({ to, label = "Volver a pedidos", replace = false, state, fallbackBack = true, }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth() || {};

  // Deducción de ruta por rol si no vino `to`
  const role = String(profile?.role || profile?.rol || "").toLowerCase();
  const autoTo =
    role === "encargado" || role === "admin"
      ? "/pedidos"
      : role === "operario"
      ? "/pedidos-operario"
      : "/pedidos";

  const destino = to || autoTo;

  const handleClick = (e) => {
    e.preventDefault();

    // Si ya estás parado en la ruta destino, hacé un replace para evitar push duplicado
    if (location.pathname === destino) {
      navigate(destino, { replace: true, state });
      return;
    }

    try {
      navigate(destino, { replace, state });
    } catch {
      // Como último recurso, volver atrás en el historial
      if (fallbackBack) navigate(-1);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="btn btn--ghost"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid #ddd",
        background: "#fff",
        cursor: "pointer",
        marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>←</span>
      <span>{label}</span>
    </button>
  );
}
