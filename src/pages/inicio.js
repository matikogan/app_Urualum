import React from "react";
import { useAuth } from "context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Inicio() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const name =
    profile?.nombre || user?.displayName || user?.email?.split("@")[0] || "Usuario";

  // NUEVO: centralizamos la navegación según rol
  const handlePrepDespacho = () => {
    const role = profile?.role;

    if (role === "ventas") {
      // vista exclusiva de ventas: pedidos CONTROLADO
      navigate("/ventas/para-despachar");
      return;
    }

    if (role === "operario") {
      // misma ruta que ya usás para operario
      navigate("/operario/asignados");
      return;
    }

    // encargado (u otros): lista general de pedidos
    navigate("/pedidos");
  };

  return (
    <div className="container">
      {/* Saludo arriba */}
      <h1 className="h1" style={{ marginTop: "32px", textAlign: "center" }}>
        Bienvenido,
      </h1>
      <h2 className="h2" style={{ marginTop: "0px", textAlign: "center", fontWeight: "400" }}>
        {name}
      </h2>

      {/* Botones centrados */}
      <div className="menu-buttons-center">
        <button
          className="btn btn--primary btn-big btn--elevated"
          onClick={() => navigate("/factura")}
        >
          <span className="btn-icon">📦</span>
          Recepción de importación
        </button>

        {/* AHORA usa handlePrepDespacho */}
        <button
          className="btn btn--outline btn-big btn--elevated"
          onClick={handlePrepDespacho}
        >
          <span className="btn-icon">🚚</span>
          Preparar pedido / Despacho
        </button>
      </div>
    </div>
  );
}
