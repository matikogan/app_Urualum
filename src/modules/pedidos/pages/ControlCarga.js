import React, { useState, useEffect, useRef } from "react";
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { AGENCIAS } from "../services/parseDescripcionPedido";

// ── Helpers ───────────────────────────────────────────────
function startOfDay(d = new Date()) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(s);
}

function startOfWeek() {
  const d = new Date();
  const day = d.getDay(); // 0=dom
  const diff = day === 0 ? -6 : 1 - day; // lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function fmtHora(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
}

// ── Tarjeta de pedido individual ─────────────────────────
function PedidoCard({ p, onCargadoOk, onDiscrepancia }) {
  const [showForm, setShowForm] = useState(false);
  const [realPaquetes, setRealPaquetes] = useState("");
  const [realBultos, setRealBultos]   = useState("");
  const [nota, setNota]               = useState("");
  const [saving, setSaving]           = useState(false);

  const estado = p.cargaEstado;
  const esCargado     = estado === "CARGADO";
  const esDiscrepancia = estado === "DISCREPANCIA";

  async function guardarDiscrepancia() {
    if (!realPaquetes && !realBultos) return;
    setSaving(true);
    await onDiscrepancia(p.id, {
      paquetes: Number(realPaquetes) || 0,
      bultos:   Number(realBultos)   || 0,
      nota: nota.trim() || null,
    });
    setSaving(false);
    setShowForm(false);
  }

  return (
    <div style={{
      background: esCargado ? "#f0fdf4" : esDiscrepancia ? "#fff7ed" : "#fff",
      border: "1.5px solid",
      borderColor: esCargado ? "#86efac" : esDiscrepancia ? "#fed7aa" : "#e2e8f0",
      borderRadius: "12px",
      padding: "14px 16px",
      transition: "all 0.2s",
    }}>
      {/* Fila principal */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "14px", color: "#0f172a" }}>
              {p.numero || p.id}
            </span>
            {p.despachadoAt && (
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                {fmtHora(p.despachadoAt)}
              </span>
            )}
          </div>
          <div style={{ fontSize: "13px", color: "#334155", marginTop: "2px", fontWeight: 500 }}>
            {p.cliente}
          </div>
          {/* Paquetes y bultos esperados */}
          <div style={{ display: "flex", gap: "12px", marginTop: "6px" }}>
            <span style={{
              fontSize: "13px", fontWeight: 700,
              color: esDiscrepancia && p.cargaReal?.paquetes !== p.paquetes ? "#dc2626" : "#0f172a",
            }}>
              📦 {p.paquetes ?? "—"} paq.
              {esDiscrepancia && p.cargaReal?.paquetes != null && p.cargaReal.paquetes !== p.paquetes && (
                <span style={{ color: "#dc2626", marginLeft: "4px" }}>→ real: {p.cargaReal.paquetes}</span>
              )}
            </span>
            <span style={{
              fontSize: "13px", fontWeight: 700,
              color: esDiscrepancia && p.cargaReal?.bultos !== p.bultos ? "#dc2626" : "#0f172a",
            }}>
              📫 {p.bultos ?? "—"} btos.
              {esDiscrepancia && p.cargaReal?.bultos != null && p.cargaReal.bultos !== p.bultos && (
                <span style={{ color: "#dc2626", marginLeft: "4px" }}>→ real: {p.cargaReal.bultos}</span>
              )}
            </span>
          </div>
          {esDiscrepancia && p.cargaDiscrepanciaNota && (
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#92400e", fontStyle: "italic" }}>
              "{p.cargaDiscrepanciaNota}"
            </p>
          )}
        </div>

        {/* Acciones */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
          {esCargado ? (
            <span style={{
              fontSize: "13px", fontWeight: 700, color: "#166534",
              background: "#dcfce7", border: "1px solid #86efac",
              borderRadius: "8px", padding: "6px 12px",
            }}>
              ✓ Cargado
            </span>
          ) : esDiscrepancia ? (
            <span style={{
              fontSize: "13px", fontWeight: 700, color: "#92400e",
              background: "#fef3c7", border: "1px solid #fde68a",
              borderRadius: "8px", padding: "6px 10px",
            }}>
              ⚠️ Diferencia
            </span>
          ) : (
            <>
              <button
                onClick={() => onCargadoOk(p.id)}
                style={{
                  padding: "9px 16px", fontSize: "14px", fontWeight: 700,
                  background: "#16a34a", color: "#fff",
                  border: "none", borderRadius: "9px", cursor: "pointer",
                  minWidth: "80px",
                }}
              >
                ✓ OK
              </button>
              <button
                onClick={() => setShowForm(f => !f)}
                style={{
                  padding: "7px 10px", fontSize: "12px", fontWeight: 600,
                  background: showForm ? "#fff7ed" : "#fff",
                  color: "#b45309",
                  border: "1.5px solid #fed7aa",
                  borderRadius: "9px", cursor: "pointer",
                }}
              >
                ⚠️ Diferencia
              </button>
            </>
          )}
        </div>
      </div>

      {/* Formulario de discrepancia */}
      {showForm && !esCargado && !esDiscrepancia && (
        <div style={{
          marginTop: "12px",
          paddingTop: "12px",
          borderTop: "1px solid #fed7aa",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>
                Paquetes reales (esperado: {p.paquetes ?? "?"})
              </label>
              <input
                type="number" min="0"
                className="input"
                style={{ fontSize: "15px", fontWeight: 700, textAlign: "center" }}
                value={realPaquetes}
                onChange={e => setRealPaquetes(e.target.value)}
                placeholder={p.paquetes ?? "0"}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", display: "block", marginBottom: "3px" }}>
                Bultos reales (esperado: {p.bultos ?? "?"})
              </label>
              <input
                type="number" min="0"
                className="input"
                style={{ fontSize: "15px", fontWeight: 700, textAlign: "center" }}
                value={realBultos}
                onChange={e => setRealBultos(e.target.value)}
                placeholder={p.bultos ?? "0"}
              />
            </div>
          </div>
          <input
            type="text"
            className="input"
            placeholder="Nota (ej: faltaba 1 paquete, se avisó al vendedor)"
            value={nota}
            onChange={e => setNota(e.target.value)}
            style={{ fontSize: "13px" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setShowForm(false)}
              className="btn btn--ghost"
              style={{ flex: 1 }}
            >
              Cancelar
            </button>
            <button
              onClick={guardarDiscrepancia}
              disabled={saving || (!realPaquetes && !realBultos)}
              className="btn btn--danger"
              style={{ flex: 2 }}
            >
              {saving ? "Guardando…" : "Confirmar diferencia"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────
export default function ControlCarga() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  const [pedidos, setPedidos]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (msg, tipo = "ok") => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3000);
  };

  const depositoUsuario = profile?.deposito || null;

  // ── Suscripción: despachados con metodo AGENCIA (filtros fecha y depósito en cliente)
  useEffect(() => {
    const desde = startOfWeek(); // Timestamp
    const q = query(
      collection(db, "pedidos_despachados"),
      where("metodoEntrega", "==", "AGENCIA"),
    );
    const unsub = onSnapshot(q, snap => {
      const desdeMs = desde.toMillis();
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => {
          const at = p.despachadoAt;
          if (!at) return true;
          const ms = at?.seconds ? at.seconds * 1000 : new Date(at).getTime();
          if (ms < desdeMs) return false;
          // Filtrar por depósito del encargado
          if (depositoUsuario && p.deposito && p.deposito !== depositoUsuario) return false;
          return true;
        });
      setPedidos(docs);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Marcar cargado OK ────────────────────────────────────
  async function marcarCargadoOk(pedidoId) {
    try {
      await updateDoc(doc(db, "pedidos_despachados", pedidoId), {
        cargaEstado: "CARGADO",
        cargadoAt:   serverTimestamp(),
        cargadoPor:  profile?.uid || null,
      });
    } catch (e) {
      showToast("Error al guardar", "error");
    }
  }

  // ── Marcar discrepancia ──────────────────────────────────
  async function marcarDiscrepancia(pedidoId, { paquetes, bultos, nota }) {
    try {
      await updateDoc(doc(db, "pedidos_despachados", pedidoId), {
        cargaEstado:           "DISCREPANCIA",
        cargaReal:             { paquetes, bultos },
        cargaDiscrepanciaNota: nota || null,
        cargadoAt:             serverTimestamp(),
        cargadoPor:            profile?.uid || null,
      });
      showToast("Diferencia registrada. Avisá al vendedor.", "warn");
    } catch (e) {
      showToast("Error al guardar", "error");
    }
  }

  // ── Agrupar por agencia en orden fijo ────────────────────
  const agenciaOrder = Object.fromEntries(AGENCIAS.map(a => [a.nombre, a.orden]));

  const hoy = startOfDay();
  const pedidosHoy    = pedidos.filter(p => p.despachadoAt?.seconds >= hoy.seconds);
  const pedidosPendientes = pedidos.filter(p =>
    p.despachadoAt?.seconds < hoy.seconds && p.cargaEstado !== "CARGADO"
  );

  // Solo mostrar pedidos de hoy + pendientes de días anteriores
  const pedidosMostrar = [...pedidosHoy, ...pedidosPendientes];

  const porAgencia = {};
  for (const p of pedidosMostrar) {
    const ag = p.agencia || "SIN ASIGNAR";
    if (!porAgencia[ag]) porAgencia[ag] = [];
    porAgencia[ag].push(p);
  }

  const agenciasOrdenadas = Object.keys(porAgencia).sort((a, b) => {
    const oa = agenciaOrder[a] ?? 99;
    const ob = agenciaOrder[b] ?? 99;
    return oa - ob;
  });

  // Totales globales
  const totalPedidos = pedidosMostrar.length;
  const totalCargados = pedidosMostrar.filter(p => p.cargaEstado === "CARGADO").length;
  const totalDiscrepancias = pedidosMostrar.filter(p => p.cargaEstado === "DISCREPANCIA").length;
  const todoCargado = totalPedidos > 0 && (totalCargados + totalDiscrepancias) === totalPedidos;

  // ── Función imprimir manifiesto ──────────────────────────
  function imprimirManifiesto() {
    window.print();
  }

  if (loading) return (
    <div className="container screen-center">⏳ Cargando pedidos de agencia…</div>
  );

  return (
    <div className="container" style={{ paddingBottom: "80px" }}>

      {/* Toast */}
      {toastMsg && (
        <div className="toast" style={{
          background: toastMsg.tipo === "ok" ? "var(--ok)" : toastMsg.tipo === "warn" ? "#f59e0b" : "var(--error)",
        }}>
          {toastMsg.msg}
        </div>
      )}

      {/* ── Header ── */}
      <header className="topbar card" style={{ marginBottom: "16px" }} id="control-header">
        <button onClick={() => navigate("/")} className="btn btn--ghost btn-sm">
          ⬅ Volver
        </button>
        <div>
          <h1 className="h1" style={{ margin: 0, fontSize: "17px" }}>🚛 Control de Carga</h1>
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            {new Date().toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {totalPedidos > 0 && (
            <span className={`pill ${todoCargado ? "pill--ok" : "pill--warn"}`}>
              {totalCargados}/{totalPedidos} cargados
            </span>
          )}
          {totalDiscrepancias > 0 && (
            <span className="pill pill--error">{totalDiscrepancias} diferencia{totalDiscrepancias > 1 ? "s" : ""}</span>
          )}
          <button
            onClick={imprimirManifiesto}
            className="btn btn--ghost btn-sm"
            title="Imprimir manifiesto"
          >
            🖨️
          </button>
        </div>
      </header>

      {/* ── Sin pedidos ── */}
      {totalPedidos === 0 && (
        <div style={{ textAlign: "center", padding: "64px 20px", color: "#94a3b8" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>📭</div>
          <strong style={{ color: "#334155", display: "block", fontSize: "16px", marginBottom: "6px" }}>
            No hay pedidos de agencia para hoy
          </strong>
          <span style={{ fontSize: "13px" }}>
            Los pedidos despachados con agencia aparecerán acá
          </span>
        </div>
      )}

      {/* ── Pedidos pendientes de días anteriores ── */}
      {pedidosPendientes.length > 0 && (
        <div style={{
          background: "#fff7ed", border: "1.5px solid #fed7aa",
          borderRadius: "10px", padding: "10px 14px", marginBottom: "16px",
          fontSize: "13px", color: "#92400e",
        }}>
          ⚠️ Hay <strong>{pedidosPendientes.length} pedido{pedidosPendientes.length > 1 ? "s" : ""}</strong> de días anteriores sin cargar incluidos abajo.
        </div>
      )}

      {/* ── Secciones por agencia ── */}
      <div id="manifiesto-contenido" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {agenciasOrdenadas.map(agNombre => {
          const peds = porAgencia[agNombre];
          const cargados = peds.filter(p => p.cargaEstado === "CARGADO").length;
          const discrepancias = peds.filter(p => p.cargaEstado === "DISCREPANCIA").length;
          const listos = cargados + discrepancias;
          const todoListo = listos === peds.length;
          const ag = AGENCIAS.find(a => a.nombre === agNombre);

          // Totales por agencia
          const totalPaq = peds.reduce((s, p) => s + (Number(p.paquetes) || 0), 0);
          const totalBto = peds.reduce((s, p) => s + (Number(p.bultos) || 0), 0);

          return (
            <div key={agNombre} className="card" style={{ padding: 0, overflow: "hidden" }}>
              {/* Header de agencia */}
              <div style={{
                padding: "12px 16px",
                background: todoListo ? "#f0fdf4" : "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: "15px", color: "#0f172a" }}>
                    {ag ? `${ag.orden}. ${agNombre}` : agNombre}
                  </span>
                  <span style={{
                    marginLeft: "10px", fontSize: "12px", color: "#64748b",
                  }}>
                    📦 {totalPaq} paq. · 📫 {totalBto} btos.
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span style={{
                    fontSize: "12px", fontWeight: 600,
                    color: todoListo ? "#166534" : "#64748b",
                    background: todoListo ? "#dcfce7" : "#f1f5f9",
                    padding: "3px 10px", borderRadius: "20px",
                  }}>
                    {todoListo ? "✓ Completo" : `${listos}/${peds.length}`}
                  </span>
                </div>
              </div>

              {/* Tarjetas de pedidos */}
              <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {peds.map(p => (
                  <PedidoCard
                    key={p.id}
                    p={p}
                    onCargadoOk={marcarCargadoOk}
                    onDiscrepancia={marcarDiscrepancia}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Botón cerrar carga ── */}
      {todoCargado && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          padding: "16px 20px",
          background: "rgba(255,255,255,0.95)",
          borderTop: "1px solid #e2e8f0",
          backdropFilter: "blur(8px)",
        }}>
          <button
            onClick={imprimirManifiesto}
            className="btn btn--primary"
            style={{ width: "100%", padding: "14px", fontSize: "15px", fontWeight: 700 }}
          >
            🖨️ Imprimir manifiesto de carga
          </button>
        </div>
      )}

      {/* ── Estilos de impresión ── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #manifiesto-contenido, #manifiesto-contenido * { visibility: visible; }
          #control-header { visibility: visible !important; }
          #manifiesto-contenido {
            position: absolute; left: 0; top: 60px;
            width: 100%; padding: 0 20px;
          }
          #control-header {
            position: absolute; top: 0; left: 0; right: 0;
            box-shadow: none !important;
            padding: 8px 20px;
          }
          .btn { display: none !important; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  );
}
