// src/components/TopBar.jsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "context/AuthContext";
import { signOut } from "firebase/auth";
import { auth } from "firebase.js";
import logo from "../logo-urualum.png";


export default function TopBar() {
  const { user, profile } = useAuth();
  const name =
    profile?.nombre || user?.displayName || user?.email?.split("@")[0] || "Usuario";
  const role = profile?.role || profile?.rol || "—";

  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const handleLogout = async () => {
    try { await signOut(auth); } 
    catch (e) { alert(e?.message || "No se pudo cerrar sesión"); }
  };

  // cerrar al clickear fuera
  useEffect(() => {
    const onDocClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <header className="topbar">
      {/* Izquierda: botón Usuario/Perfil */}
      <div className="topbar-left" ref={menuRef}>
        <button
          className="btn btn--secondary userbadge"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {/* 👇 Icono de perfil */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="userbadge-icon"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="7" r="5" />
            <path d="M4 22c0-4 4-7 8-7s8 3 8 7" />
          </svg>
        </button>

        {open && (
          <div className="menu">
            <div className="menu-item">
              <div className="menu-title">{name}</div>
              <div className="menu-sub">Tipo de usuario: <strong>{role}</strong></div>
            </div>
            <hr className="menu-divider" />
            <button className="menu-action" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        )}
      </div>

      {/* Derecha: logo grande */}
      <div className="brand-right" title="URUALUM">
        <img src={logo} alt="URUALUM" />
      </div>
    </header>
  );
}
