import React from "react";
import { useNavigate } from "react-router-dom";
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
export default function VolverListaPedidos({ to, label = "Volver a pedidos", replace = false, state }) {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const defaultTo = React.useMemo(() => {
    if (to) return to;
    if (profile?.role === "Encargado") return "/pedidos";
    if (profile?.role?.toLowerCase() === "operario") return "/pedidos-operario";
    return "/pedidos"; // fallback seguro
  }, [to, profile]);

  return (
    <button
      onClick={() => navigate(defaultTo, { replace, state })}
      title="Volver a la lista de pedidos"
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
