import React, { useState, useEffect } from "react";
import {
  collection, query, where, onSnapshot, addDoc,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useNavigate } from "react-router-dom";

function fmtFecha(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("es-UY", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function etiquetaDias(ts) {
  if (!ts?.toDate) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = ts.toDate();
  fecha.setHours(0, 0, 0, 0);
  const diff = Math.round((fecha - hoy) / (1000 * 60 * 60 * 24));
  if (diff === 0)  return { label: "Hoy",           color: "#dc2626", bg: "#fee2e2" };
  if (diff === 1)  return { label: "Mañana",         color: "#b45309", bg: "#fef3c7" };
  if (diff === -1) return { label: "Ayer",           color: "#64748b", bg: "#f1f5f9" };
  if (diff > 1)    return { label: `En ${diff} días`, color: "#1d4ed8", bg: "#eff6ff" };
  return { label: `Hace ${Math.abs(diff)} días`,     color: "#94a3b8", bg: "#f8fafc" };
}

export default function GestionCamiones() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [camiones,    setCamiones]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [guardando,   setGuardando]   = useState(false);
  const [verPasados,  setVerPasados]  = useState(false);

  const deposito = profile?.deposito || null;

  // ── Listener de camiones del depósito ────────────────────
  useEffect(() => {
    if (!deposito) { setLoading(false); return; }
    const q = query(
      collection(db, "camiones"),
      where("deposito", "==", deposito),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ma = a.fechaSalida?.seconds ?? 0;
          const mb = b.fechaSalida?.seconds ?? 0;
          return ma - mb;
        });
      setCamiones(docs);
      setLoading(false);
    });
    return () => unsub();
  }, [deposito]);

  // ── Crear camión ──────────────────────────────────────────
  async function crearCamion() {
    if (!descripcion.trim() || !fechaSalida) return;
    setGuardando(true);
    try {
      const [y, m, d] = fechaSalida.split("-").map(Number);
      const fechaDate = new Date(y, m - 1, d, 0, 0, 0);
      await addDoc(collection(db, "camiones"), {
        descripcion: descripcion.trim(),
        fechaSalida: Timestamp.fromDate(fechaDate),
        deposito,
        estado:     "ACTIVO",
        creadoAt:   serverTimestamp(),
        creadoPor:  profile?.uid || null,
      });
      setShowForm(false);
      setDescripcion("");
      setFechaSalida("");
    } finally {
      setGuardando(false);
    }
  }

  // ── Separar próximos / pasados ────────────────────────────
  const hoyMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const proximos = camiones.filter(c => {
    const ms = c.fechaSalida?.seconds ? c.fechaSalida.seconds * 1000 : 0;
    return ms >= hoyMs;
  });
  const pasados = camiones.filter(c => {
    const ms = c.fechaSalida?.seconds ? c.fechaSalida.seconds * 1000 : 0;
    return ms < hoyMs;
  }).reverse();

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="container" style={{ paddingBottom: "80px" }}>

      {/* Header */}
      <header className="topbar card" style={{ marginBottom: "16px" }}>
        <button onClick={() => navigate("/")} className="btn btn--ghost btn-sm">
          ⬅ Volver
        </button>
        <div>
          <h1 className="h1" style={{ margin: 0, fontSize: "17px" }}>🚚 Camiones</h1>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            {deposito || "Sin depósito"}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn btn--primary btn-sm">
          + Nuevo
        </button>
      </header>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>Cargando…</div>
      ) : (
        <>
          {/* ── Próximos / actuales ── */}
          {proximos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 20px", color: "#94a3b8" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>🚚</div>
              <strong style={{ color: "#334155", display: "block", fontSize: "16px", marginBottom: "6px" }}>
                No hay camiones programados
              </strong>
              <span style={{ fontSize: "13px" }}>
                Tocá <strong>+ Nuevo</strong> para programar una salida
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {proximos.map(c => {
                const etiq = etiquetaDias(c.fechaSalida);
                const esHoy = etiq?.label === "Hoy";
                return (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/encargado/camiones/${c.id}`)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: esHoy ? "#fefce8" : "#fff",
                      border: `1.5px solid ${esHoy ? "#fde68a" : "#e2e8f0"}`,
                      borderRadius: "12px", padding: "16px 18px",
                      cursor: "pointer", textAlign: "left", width: "100%",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a" }}>
                        🚚 {c.descripcion}
                      </div>
                      <div style={{ fontSize: "13px", color: "#64748b", marginTop: "3px" }}>
                        {fmtFecha(c.fechaSalida)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      {etiq && (
                        <span style={{
                          fontSize: "12px", fontWeight: 700,
                          background: etiq.bg, color: etiq.color,
                          padding: "4px 12px", borderRadius: "20px",
                        }}>
                          {etiq.label}
                        </span>
                      )}
                      <span style={{ fontSize: "18px", color: "#94a3b8" }}>›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Historial de pasados ── */}
          {pasados.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <button
                onClick={() => setVerPasados(v => !v)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "13px", color: "#64748b", padding: "4px 0",
                  display: "flex", alignItems: "center", gap: "6px",
                }}
              >
                <span>{verPasados ? "▾" : "▸"}</span>
                Historial de salidas ({pasados.length})
              </button>

              {verPasados && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                  {pasados.map(c => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/encargado/camiones/${c.id}`)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        background: "#f8fafc", border: "1.5px solid #e2e8f0",
                        borderRadius: "10px", padding: "12px 14px",
                        cursor: "pointer", textAlign: "left", width: "100%", opacity: 0.85,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "#334155" }}>
                          🚚 {c.descripcion}
                        </div>
                        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                          {fmtFecha(c.fechaSalida)}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: "#94a3b8" }}>Ver →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Modal: nuevo camión ── */}
      {showForm && (
        <div
          onClick={() => setShowForm(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 1000, display: "flex", alignItems: "flex-end",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", width: "100%",
              borderRadius: "16px 16px 0 0", padding: "24px 20px 32px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>🚚 Nuevo camión</h3>
              <button
                onClick={() => setShowForm(false)}
                style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "5px" }}>
                  Descripción (destino o nombre)
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej: Rivera, Artigas, Norte..."
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "5px" }}>
                  Fecha de salida
                </label>
                <input
                  type="date"
                  className="input"
                  value={fechaSalida}
                  onChange={e => setFechaSalida(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>

              <button
                onClick={crearCamion}
                disabled={guardando || !descripcion.trim() || !fechaSalida}
                className="btn btn--primary"
                style={{ width: "100%", padding: "14px", fontSize: "15px", fontWeight: 700, marginTop: "4px" }}
              >
                {guardando ? "Creando…" : "Crear camión"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
