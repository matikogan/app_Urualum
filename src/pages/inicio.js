import React from "react";
import { useAuth } from "context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Inicio() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const name =
    profile?.nombre || user?.displayName || user?.email?.split("@")[0] || "Usuario";

return (
    <div className="container">
      {/* Saludo arriba */}
      <h1 className="h1" style={{ marginTop: "32px", textAlign: "center" }}>
        Bienvenido, 
      </h1>
      <h2 className="h2" style={{ marginTop: "0px", textAlign: "center", fontWeight:"400"}}>{name}</h2>

      {/* Botones centrados */}
      <div className="menu-buttons-center">
        <button className="btn btn--primary btn-big btn--elevated"  onClick={() => navigate("/factura")}>
          <span className="btn-icon">📦</span>
          Recepción de importación
        </button>

        <button className="btn btn--outline btn-big btn--elevated" onClick={() => navigate("/pedidos")}>
          <span className="btn-icon">🚚</span>
          Preparar pedido / Despacho
        </button>
      </div>
    </div>
  );
}