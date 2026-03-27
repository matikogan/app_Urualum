import React, { useState } from "react";
import logo from "../../../logo-urualum.png";
import { useAuth } from "context/AuthContext";
import { auth } from "../../../firebase";
import { signOut } from "firebase/auth";

export default function PortalInicio({
  onVerPedidos,
  onCrearPedido,
  nombreUsuario,
  cantidadPedidos,
  pedidosUrgentes = 0,   // C2: pedidos PREPARADO o ERROR_STOCK
}) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // C1: primera palabra del nombre para el saludo
  const primerNombre = nombreUsuario?.split(" ")[0] || nombreUsuario || "cliente";

  return (
    // C1: portal-fullscreen usa 100svh (iOS-safe) en lugar de 100vh
    <div className="portal-fullscreen">

      <header className="topbar" style={{ background: "transparent", border: "none", flexShrink: 0 }}>
        <div className="topbar-left">
          <span className="pill pill--brand">Urualum B2B</span>
        </div>
        <button onClick={() => setShowLogoutModal(true)} className="btn btn-logout" style={{ margin: 0 }}>
          Cerrar Sesión 🚪
        </button>
      </header>

      {/* screen-full-height ahora usa flex: 1 (sin altura fija) */}
      <div className="screen-full-height">
        <div className="card portal-card" style={{ width: "100%", border: "none", boxShadow: "none" }}>

          <div className="portal-logo-container" style={{ marginBottom: "2vh" }}>
            <img src={logo} alt="Urualum" style={{ width: "clamp(160px, 38vw, 260px)", height: "auto" }} />
            {/* C1: saludo personalizado reemplaza "Portal de Autogestión" */}
            <p className="portal-subtitle" style={{ fontSize: "clamp(14px, 2vh, 18px)", marginTop: "8px" }}>
              ¡Hola, <strong>{primerNombre}</strong>! 👋
            </p>
          </div>

          <div className="menu-buttons-adaptive" style={{ margin: "0 auto" }}>
            <button
              onClick={onCrearPedido}
              className="btn btn--success-solid btn-big-adaptive btn--elevated"
            >
              <span className="btn-icon">🛒</span>
              NUEVO PEDIDO
            </button>

            {/* C2: wrapper relativo para posicionar el badge de urgencia */}
            <div className="btn-pedidos-wrapper">
              <button
                onClick={onVerPedidos}
                className="btn btn--brand-solid btn-big-adaptive btn--elevated"
                style={{ width: "100%" }}
              >
                <span className="btn-icon">📦</span>
                MIS PEDIDOS ({cantidadPedidos})
              </button>
              {/* Badge pulsante cuando hay pedidos que necesitan atención */}
              {pedidosUrgentes > 0 && (
                <span className="urgencia-badge">{pedidosUrgentes}</span>
              )}
            </div>
          </div>

          {/* Texto de alerta debajo del botón */}
          {pedidosUrgentes > 0 && (
            <p style={{ fontSize: "12px", color: "#e53935", fontWeight: 600, marginTop: "8px", textAlign: "center" }}>
              {pedidosUrgentes === 1
                ? "Tenés 1 pedido que requiere tu atención"
                : `Tenés ${pedidosUrgentes} pedidos que requieren tu atención`}
            </p>
          )}
        </div>
      </div>

      {/* Modal de confirmación de logout */}
      {showLogoutModal && (
        <div className="modal-backdrop">
          <div className="modal-card modal text-center">
            <h3 className="modal-title">¿Cerrar sesión?</h3>
            <p className="muted">
              Vas a salir de tu cuenta de <strong>Urualum B2B</strong>.
            </p>
            <div className="product-actions" style={{ marginTop: "20px" }}>
              <button
                className="btn btn--danger btn--full"
                onClick={async () => {
                  await signOut(auth);
                  setShowLogoutModal(false);
                }}
              >
                Salir ahora
              </button>
              <button
                className="btn btn--ghost btn--full"
                onClick={() => setShowLogoutModal(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
