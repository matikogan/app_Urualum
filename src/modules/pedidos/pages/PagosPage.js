/**
 * PagosPage — gestión de pagos de pedidos despachados.
 *
 * Lee la colección `pagos`.
 * Soporta pagos con múltiples tramos y pagos delegados a R8.
 * Tabs: Pendientes / Registrados.
 */

import { useState, useEffect, useMemo } from "react";
import {
  collection, onSnapshot, query,
  orderBy, doc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { useNavigate } from "react-router-dom";
import PagoModal, { resumenPago, resumenTramos, METODOS_PAGO } from "../components/PagoModal";

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

function formatFecha(ts) {
  if (!ts) return "—";
  const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Normaliza un documento de pagos al array de tramos, con compat para el formato antiguo */
function getTramos(p) {
  if (Array.isArray(p.pagos) && p.pagos.length > 0) return p.pagos;
  if (p.pago?.metodo) return [p.pago]; // compat formato antiguo
  return [];
}

function totalTramos(tramos) {
  return tramos.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
}

// ─────────────────────────────────────────────────────────────
//  Tarjeta de pago individual
// ─────────────────────────────────────────────────────────────

function PagoCard({ pago, onMarcarRegistrado, onEditar, isRegistrado }) {
  const tramos  = getTramos(pago);
  const esR8    = pago.pagoOrigen === "R8" && tramos.length === 0;
  const resumen = resumenTramos(tramos);
  const total   = totalTramos(tramos);

  return (
    <div style={{
      background: "#fff",
      border: `1.5px solid ${isRegistrado ? "#bbf7d0" : esR8 ? "#bfdbfe" : "#e2e8f0"}`,
      borderRadius: "12px",
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      {/* Cabecera */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0f172a" }}>
              #{pago.numero || pago.pedidoId}
            </span>
            {pago.deposito && (
              <span style={{
                fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px",
                borderRadius: "999px", background: "#eff6ff", color: "#1d4ed8",
                border: "1px solid #bfdbfe",
              }}>
                {pago.deposito}
              </span>
            )}
            {tramos.length > 1 && (
              <span style={{
                fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px",
                borderRadius: "999px", background: "#faf5ff", color: "#7c3aed",
                border: "1px solid #ede9fe",
              }}>
                {tramos.length} tramos
              </span>
            )}
          </div>
          <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pago.cliente || "—"}
          </p>
        </div>

        {/* Badge estado */}
        {isRegistrado ? (
          <span style={{
            fontSize: "0.72rem", fontWeight: 700, padding: "4px 10px",
            borderRadius: "999px", background: "#f0fdf4", color: "#15803d",
            border: "1px solid #bbf7d0", flexShrink: 0,
          }}>
            ✓ Registrado
          </span>
        ) : esR8 ? (
          <span style={{
            fontSize: "0.72rem", fontWeight: 700, padding: "4px 10px",
            borderRadius: "999px", background: "#eff6ff", color: "#1d4ed8",
            border: "1px solid #bfdbfe", flexShrink: 0,
          }}>
            💼 En R8
          </span>
        ) : (
          <span style={{
            fontSize: "0.72rem", fontWeight: 700, padding: "4px 10px",
            borderRadius: "999px", background: "#fffbeb", color: "#b45309",
            border: "1px solid #fde68a", flexShrink: 0,
          }}>
            Pendiente
          </span>
        )}
      </div>

      {/* Detalle del pago */}
      {esR8 ? (
        <div style={{
          background: "#eff6ff", borderRadius: "8px",
          padding: "9px 12px",
          fontSize: "0.82rem", color: "#1d4ed8", fontWeight: 600,
        }}>
          💼 Pago gestionado en R8 — pendiente de completar
        </div>
      ) : tramos.length > 0 ? (
        <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "9px 12px" }}>
          {tramos.map((t, i) => {
            const meta = METODOS_PAGO.find(m => m.id === t.metodo);
            const r = resumenPago(t);
            return (
              <div key={i} style={{ fontSize: "0.82rem", color: "#334155", fontWeight: 600, marginBottom: i < tramos.length - 1 ? "4px" : 0 }}>
                {tramos.length > 1 && <span style={{ color: "#7c3aed", fontWeight: 700 }}>T{i + 1} · </span>}
                {meta?.icon} {r || "—"}
              </div>
            );
          })}
          {tramos.length > 1 && (
            <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #e2e8f0", fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>
              Total: $ {total.toLocaleString("es-AR")}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          background: "#fef2f2", borderRadius: "8px",
          padding: "9px 12px",
          fontSize: "0.82rem", color: "#dc2626", fontWeight: 600,
        }}>
          Sin datos de pago
        </div>
      )}

      {/* Meta */}
      <div style={{ display: "flex", gap: "16px", fontSize: "0.72rem", color: "#94a3b8" }}>
        <span>Despachado {formatFecha(pago.creadoAt)}</span>
        {isRegistrado && pago.pagoRegistradoAt && (
          <span>Registrado {formatFecha(pago.pagoRegistradoAt)}</span>
        )}
        {pago.metodoEntrega && <span>🚚 {pago.metodoEntrega}</span>}
      </div>

      {/* Acciones */}
      {!isRegistrado && (
        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <button
            onClick={() => onMarcarRegistrado(pago)}
            style={{
              flex: 2, padding: "9px 16px",
              background: "#0f172a", color: "#fff",
              border: "none", borderRadius: "8px",
              fontSize: "0.84rem", fontWeight: 700, cursor: "pointer",
            }}
          >
            ✓ Marcar registrado
          </button>
          <button
            onClick={() => onEditar(pago)}
            style={{
              flex: 1, padding: "9px 16px",
              background: "#fff", color: "#475569",
              border: "1.5px solid #e2e8f0", borderRadius: "8px",
              fontSize: "0.84rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            {esR8 ? "💼 Completar" : "✏️ Editar"}
          </button>
        </div>
      )}
      {isRegistrado && (
        <button
          onClick={() => onEditar(pago)}
          style={{
            padding: "7px 14px", marginTop: "2px",
            background: "#fff", color: "#64748b",
            border: "1px solid #e2e8f0", borderRadius: "8px",
            fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          ✏️ Editar pago
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PagosPage
// ─────────────────────────────────────────────────────────────

export default function PagosPage() {
  const { profile } = useAuth();
  const { toast }   = useApp();
  const navigate    = useNavigate();

  const [pagos, setPagos]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState("PENDIENTE");
  const [searchQ, setSearchQ]   = useState("");
  const [editando, setEditando] = useState(null);
  const [marking, setMarking]   = useState(null);

  useEffect(() => {
    const q = query(collection(db, "pagos"), orderBy("creadoAt", "desc"));
    const unsub = onSnapshot(
      q,
      snap => { setPagos(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      err  => { console.error("[PagosPage] error:", err); setLoading(false); }
    );
    return () => unsub();
  }, []);

  async function handleMarcarRegistrado(pago) {
    setMarking(pago.id);
    try {
      const nombreUsuario = profile?.nombre || profile?.displayName || null;
      await updateDoc(doc(db, "pagos", pago.id), {
        pagoEstado:              "REGISTRADO",
        pagoRegistradoAt:        serverTimestamp(),
        pagoRegistradoPorNombre: nombreUsuario,
      });
      toast.success("Pago marcado como registrado");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo actualizar");
    } finally {
      setMarking(null);
    }
  }

  const nq = norm(searchQ);

  const filtrados = useMemo(() => {
    return pagos.filter(p => {
      if (p.pagoEstado !== tab) return false;
      if (!nq) return true;
      const tramos = getTramos(p);
      return (
        norm(p.numero).includes(nq)   ||
        norm(p.pedidoId).includes(nq) ||
        norm(p.cliente).includes(nq)  ||
        tramos.some(t => norm(t.metodo).includes(nq))
      );
    });
  }, [pagos, tab, nq]);

  const countPendientes  = pagos.filter(p => p.pagoEstado === "PENDIENTE").length;
  const countRegistrados = pagos.filter(p => p.pagoEstado === "REGISTRADO").length;
  // Cuántos pendientes son de R8 (sin datos)
  const countR8 = pagos.filter(p => p.pagoEstado === "PENDIENTE" && p.pagoOrigen === "R8" && getTramos(p).length === 0).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: "none", border: "1px solid #e2e8f0", borderRadius: "8px",
            padding: "6px 12px", fontSize: "0.82rem", color: "#64748b",
            cursor: "pointer", flexShrink: 0,
          }}
        >
          ← Volver
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>
            💰 Pagos
          </h1>
          <p style={{ margin: "1px 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
            Datos de pago registrados al despachar
          </p>
        </div>

        <input
          type="search"
          placeholder="Buscar por # pedido, cliente…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          style={{
            padding: "8px 13px", borderRadius: "8px",
            border: "1.5px solid #e2e8f0", fontSize: "0.84rem",
            background: "#f8fafc", outline: "none",
            width: "220px", flexShrink: 0,
          }}
        />
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid #e2e8f0",
        background: "#fff", padding: "0 20px", gap: "4px",
      }}>
        {[
          { id: "PENDIENTE",  label: "Pendientes",  count: countPendientes },
          { id: "REGISTRADO", label: "Registrados", count: countRegistrados },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "11px 16px", border: "none",
              borderBottom: tab === t.id ? "2.5px solid #0f172a" : "2.5px solid transparent",
              background: "none",
              fontSize: "0.84rem", fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#0f172a" : "#64748b",
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{
                background: tab === t.id
                  ? (t.id === "PENDIENTE" ? "#fef3c7" : "#dcfce7")
                  : "#f1f5f9",
                color: tab === t.id
                  ? (t.id === "PENDIENTE" ? "#92400e" : "#15803d")
                  : "#64748b",
                fontSize: "0.68rem", fontWeight: 700,
                padding: "1px 7px", borderRadius: "999px",
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
        {/* Badge R8 pendientes */}
        {tab === "PENDIENTE" && countR8 > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <span style={{
              fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px",
              borderRadius: "999px", background: "#eff6ff", color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}>
              💼 {countR8} en R8 sin completar
            </span>
          </div>
        )}
      </div>

      {/* Lista */}
      <div style={{
        flex: 1, padding: "16px 20px",
        maxWidth: "860px", width: "100%", margin: "0 auto",
        boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: "10px",
      }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: "0.9rem" }}>
            Cargando pagos…
          </div>
        ) : filtrados.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: "0.9rem" }}>
            {searchQ
              ? "Sin resultados para esa búsqueda."
              : tab === "PENDIENTE"
                ? "No hay pagos pendientes de registrar."
                : "No hay pagos registrados aún."}
          </div>
        ) : (
          filtrados.map(pago => (
            <PagoCard
              key={pago.id}
              pago={pago}
              isRegistrado={tab === "REGISTRADO"}
              onMarcarRegistrado={p => { if (!marking) handleMarcarRegistrado(p); }}
              onEditar={p => setEditando(p)}
            />
          ))
        )}
      </div>

      {/* Modal de edición / completado */}
      {editando && (
        <PagoModal
          pedidoId={editando.id}
          pedidoInfo={{
            numero:        editando.numero,
            cliente:       editando.cliente,
            deposito:      editando.deposito,
            metodoEntrega: editando.metodoEntrega,
          }}
          pagosActuales={getTramos(editando)}
          historial={editando.pagoHistorial || []}
          mandatory={false}
          onClose={() => setEditando(null)}
          onSaved={() => setEditando(null)}
        />
      )}
    </div>
  );
}
