// src/modules/pedidos/pages/EtiquetasSeleccion.js
//
// Paso 1 del módulo "Etiquetas": el encargado de R8 ve los pedidos
// pendientes directo del informe de Finnegans (última semana) y
// selecciona los que va a cargar en el camión/gira para imprimirles etiquetas.
//
// Los pedidos seleccionados se agrupan en una "carga" (ej. "Camión Maldonado"),
// que después se puede retomar para agregar más pedidos o para controlar
// la carga escaneando los QR.
//
// No se usan los estados internos de la app (todavía) — se consulta
// directo a Finnegans para no depender del flujo de preparación.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { fetchPedidosPendientesUltimaSemana } from "../services/etiquetasFinnegans";
import { listarCargas, crearCarga } from "../services/etiquetasFS";

export default function EtiquetasSeleccion() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seleccionados, setSeleccionados] = useState(new Set());

  const [cargas, setCargas] = useState([]);
  const [loadingCargas, setLoadingCargas] = useState(true);
  const [cargaActiva, setCargaActiva] = useState(null); // { id: string|null, nombre: string, itemsExistentes? }
  const [nombreNuevaCarga, setNombreNuevaCarga] = useState("");

  useEffect(() => {
    const deposito = profile?.deposito || "R8";
    let cancelado = false;
    setLoading(true);
    fetchPedidosPendientesUltimaSemana({ deposito })
      .then((items) => {
        if (cancelado) return;
        setPedidos(items);
      })
      .catch((e) => {
        console.error("[EtiquetasSeleccion] error trayendo pedidos de Finnegans", e);
        if (!cancelado) setError(e);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => { cancelado = true; };
  }, [profile?.deposito]);

  useEffect(() => {
    let cancelado = false;
    setLoadingCargas(true);
    listarCargas()
      .then((items) => {
        if (!cancelado) setCargas(items.filter((c) => !c.completa));
      })
      .finally(() => {
        if (!cancelado) setLoadingCargas(false);
      });
    return () => { cancelado = true; };
  }, []);

  // Si venimos del "Control de carga" con "+ Agregar pedidos a esta carga",
  // abrimos directo esa carga para seleccionar los pedidos nuevos.
  useEffect(() => {
    const abrir = state?.abrirCarga;
    if (abrir?.id) {
      setCargaActiva({ id: abrir.id, nombre: abrir.nombre, itemsExistentes: abrir.items || [] });
    }
  }, [state]);

  function toggle(id) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function crearNuevaCarga() {
    const nombre = nombreNuevaCarga.trim();
    if (!nombre) return;
    setCargaActiva({ id: null, nombre });
  }

  function elegirCargaExistente(carga) {
    setCargaActiva({ id: carga.id, nombre: carga.nombre, itemsExistentes: carga.items || [] });
  }

  function cancelarCarga() {
    setCargaActiva(null);
    setNombreNuevaCarga("");
    setSeleccionados(new Set());
  }

  async function continuar() {
    const items = pedidos.filter((p) => seleccionados.has(p.id));
    if (items.length === 0 || !cargaActiva) return;

    let cargaId = cargaActiva.id;
    if (!cargaId) {
      cargaId = await crearCarga(cargaActiva.nombre);
    }
    navigate("/encargado/etiquetas/carga", {
      state: { items, carga: { id: cargaId, nombre: cargaActiva.nombre } },
    });
  }

  // IDs de pedidos que ya están en la carga activa (para no volver a seleccionarlos)
  const idsEnCargaActiva = new Set((cargaActiva?.itemsExistentes || []).map((it) => it.pedidoId));

  return (
    <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={volverStyle}>← Volver</button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>🏷️ Etiquetas</h2>
        <button onClick={() => navigate("/encargado/etiquetas/historial")} style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
          📋 Historial
        </button>
      </div>

      {/* === Cargas en curso === */}
      {!cargaActiva && (
        <>
          <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: "#64748b" }}>
            Cargas en curso. Tocá una para agregarle pedidos, o abrí el control para escanear lo que falta.
          </p>

          {loadingCargas ? (
            <p style={{ color: "#94a3b8" }}>Cargando cargas…</p>
          ) : cargas.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
              {cargas.map((c) => {
                const bultosTotal = (c.items || []).reduce((acc, it) => acc + (Number(it.bultos) || 1), 0);
                const escaneados = (c.escaneados || []).length;
                return (
                  <div
                    key={c.id}
                    style={{
                      border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "10px 12px",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>📦 {c.nombre}</div>
                      <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                        {(c.items || []).length} pedido(s) · {escaneados}/{bultosTotal} bultos cargados
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => elegirCargaExistente(c)} style={chipBtn("#15803d")}>+ Pedidos</button>
                      <button onClick={() => navigate("/encargado/etiquetas/control", { state: { cargaId: c.id } })} style={chipBtn("#2563eb")}>
                        Control
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Nueva carga */}
          <div style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "10px 12px", marginBottom: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a", marginBottom: "6px" }}>
              + Nueva carga
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={nombreNuevaCarga}
                onChange={(e) => setNombreNuevaCarga(e.target.value)}
                placeholder="Ej: Camión Maldonado"
                style={inputStyle}
              />
              <button onClick={crearNuevaCarga} disabled={!nombreNuevaCarga.trim()} style={chipBtn(nombreNuevaCarga.trim() ? "#15803d" : "#cbd5e1")}>
                Crear
              </button>
            </div>
          </div>
        </>
      )}

      {/* === Selección de pedidos === */}
      {cargaActiva && (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderRadius: "10px", background: "#f0fdf4", border: "1.5px solid #86efac",
            marginBottom: "12px",
          }}>
            <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#15803d" }}>📦 {cargaActiva.nombre}</span>
            <button onClick={cancelarCarga} style={{ background: "none", border: "none", color: "#64748b", fontSize: "0.8rem", cursor: "pointer" }}>
              Cambiar
            </button>
          </div>

          <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "#64748b" }}>
            Pedidos pendientes en Finnegans de la última semana. Marcá los que vas a
            cargar en esta carga.
          </p>

          {loading ? (
            <p style={{ color: "#94a3b8" }}>Cargando pedidos desde Finnegans…</p>
          ) : error ? (
            <p style={{ color: "#b91c1c" }}>Error consultando Finnegans: {error.message || String(error)}</p>
          ) : pedidos.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No hay pedidos pendientes en la última semana.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {pedidos.map((p) => {
                const yaEnCarga = idsEnCargaActiva.has(p.id);
                const checked = seleccionados.has(p.id);
                return (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      border: `1.5px solid ${checked ? "#86efac" : "#e2e8f0"}`,
                      background: yaEnCarga ? "#f8fafc" : checked ? "#f0fdf4" : "#fff",
                      borderRadius: "10px",
                      cursor: yaEnCarga ? "default" : "pointer",
                      opacity: yaEnCarga ? 0.6 : 1,
                    }}
                  >
                    <input type="checkbox" checked={checked} disabled={yaEnCarga} onChange={() => toggle(p.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>
                        #{p.numero || p.id}
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.cliente || "—"}
                      </div>
                    </div>
                    {yaEnCarga ? (
                      <span style={{ fontSize: "0.7rem", color: "#15803d", flexShrink: 0, fontWeight: 600 }}>Ya en la carga</span>
                    ) : p.metodoEntrega && (
                      <span style={{ fontSize: "0.7rem", color: "#64748b", flexShrink: 0 }}>
                        {p.metodoEntrega}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ position: "sticky", bottom: 0, paddingTop: "16px", background: "#fff" }}>
            <button
              onClick={continuar}
              disabled={seleccionados.size === 0}
              style={chipBtnWide(seleccionados.size === 0 ? "#cbd5e1" : "#15803d")}
            >
              Continuar ({seleccionados.size})
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const volverStyle = {
  background: "none", border: "none", color: "#15803d", fontWeight: 600,
  fontSize: "0.85rem", padding: 0, marginBottom: "12px", cursor: "pointer",
};

const inputStyle = {
  flex: 1, padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e2e8f0",
  fontSize: "0.88rem", boxSizing: "border-box",
};

function chipBtn(bg) {
  return {
    padding: "8px 14px", borderRadius: "8px", border: "none", background: bg,
    color: "#fff", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", whiteSpace: "nowrap",
  };
}

function chipBtnWide(bg) {
  return {
    width: "100%", padding: "12px", borderRadius: "10px", border: "none", background: bg,
    color: "#fff", fontWeight: 700, fontSize: "0.95rem", cursor: bg === "#cbd5e1" ? "default" : "pointer",
  };
}
