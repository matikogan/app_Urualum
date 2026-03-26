import React, {useState} from "react";
import logo from "../logo-urualum.png";
import { useAuth } from "../context/AuthContext"; 
import { auth } from "../firebase"; 
import { signOut } from "firebase/auth";

export default function PortalInicio({ onVerPedidos, onCrearPedido, nombreUsuario, cantidadPedidos }) {
  
  // 2. Nuevo estado para controlar el modal de logout
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // 3. Modificamos la función para que NO use el window.confirm
  const triggerLogoutModal = () => setShowLogoutModal(true);

  return (
    // Agregamos overflow hidden para asegurar que nada se escape de la pantalla
    <div className="container" style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      
      <header className="topbar" style={{ background: 'transparent', border: 'none', flexShrink: 0 }}>
        <div className="topbar-left">
           <span className="pill pill--brand">Urualum B2B</span>
        </div>
        {/* Cambiamos el onClick */}
        <button onClick={triggerLogoutModal} className="btn btn-logout" style={{ margin: 0 }}>
          Cerrar Sesión 🚪
        </button>
      </header>

      {/* Usamos la nueva clase screen-full-height para centrar todo */}
      <div className="screen-full-height" style={{ flex: 1 }}>
        <div className="card portal-card" style={{ width: '100%', border: 'none', boxShadow: 'none' }}>
          
          <div className="portal-logo-container" style={{ marginBottom: '2vh' }}>
            {/* Reducimos un poco el tamaño máximo del logo para móviles */}
            <img src={logo} alt="Urualum" style={{ width: 'clamp(180px, 40vw, 280px)', height: 'auto' }} />
            <p className="portal-subtitle" style={{ fontSize: 'clamp(14px, 2vh, 18px)' }}>Portal de Autogestión</p>
          </div>

          {/* Aplicamos la clase adaptive para el espaciado dinámico de botones */}
          <div className="menu-buttons-adaptive" style={{ margin: '0 auto' }}>
            <button 
              onClick={onCrearPedido} 
              className="btn btn--success-solid btn-big-adaptive btn--elevated"
            >
              <span className="btn-icon">🛒</span> 
              NUEVO PEDIDO
            </button>

            <button 
              onClick={onVerPedidos} 
              className="btn btn--brand-solid btn-big-adaptive btn--elevated"
            >
              <span className="btn-icon">📦</span> 
              MIS PEDIDOS ({cantidadPedidos})
            </button>
          </div>

          <div className="section" style={{ marginTop: '3vh' }}>
            <small className="muted" style={{ fontSize: 'clamp(12px, 1.5vh, 14px)' }}>
              Sesión iniciada como: <br/>
              <strong style={{ color: 'var(--brand)' }}>{nombreUsuario}</strong>
            </small>
          </div>
        </div>
      </div>
      {/* 4. MODAL DE CONFIRMACIÓN DE CERRAR SESIÓN */}
      {showLogoutModal && (
        <div className="modal-backdrop">
            <div className="modal-card modal text-center">
                <h3 className="modal-title">¿Cerrar sesión?</h3>
                <p className="muted">
                    Vas a salir de tu cuenta de <strong>Urualum B2B</strong>.
                </p>
                <div className="product-actions" style={{ marginTop: '20px' }}>
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