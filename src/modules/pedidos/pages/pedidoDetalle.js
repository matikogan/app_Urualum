import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { getPedido, asignarOperario, updateEstado, cancelarPedido } from "../services/pedidosFS";
import { ESTADOS } from "../services/estados";
import { getFlag } from "../services/featureFlags";
import { db } from "../../../firebase";
import { doc, getDoc, updateDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import { getCatalogoByCodUru } from "../services/catalogo";
import VolverListaPedidos from "../components/VolverListaPedidos";

import QrScanner from "components/QrScanner";        
import PackConfirmModal from "../components/PackConfirmModal";
import PackErrorModal from "../components/PackErrorModal";
import { actualizarMovimientosStockSueltas, confirmarPedidoConStock } from "../services/stockTiras";

import { useNavigate, useLocation } from "react-router-dom";
import { despacharPedido } from "../services/despachoFS";

import ConfirmarDespacho from "./confirmarDespacho";




// — util: sanitiza a “código URU”
function toURUCode(value) {
  const s = String(value ?? "").trim();
  const mNum = s.match(/\b\d{7,}\b/);
  if (mNum) return mNum[0];
  return s.split(/\s+/)[0].replace(/[^\w-]/g, "");
}

// Categorías del operario — singular y plural para compatibilidad con Firestore
const CAT_OPERARIO = ["PERFIL ALUMINIO", "PERFILES ALUMINIO", "KITS"];

// Normaliza categoría: usa "padre" cuando categoria es genérica o vacía
function getCategoriaEnc(uru, catalogoMap) {
  const doc = catalogoMap?.[uru];
  const cat = (doc?.categoria || "").toUpperCase().trim();
  const padre = (doc?.padre || "").toUpperCase().trim();
  if (cat && cat !== "SIN_CATEGORIA") return cat;
  return padre;
}

// Divide los productos en grupos
function splitPorCategoria(productos, catalogoMap) {
  const operario = [];
  const encargado = [];

  productos.forEach((it, i) => {
    const raw = it.cod || it.descripcion || it.desc || "";
    const uru = raw.match(/\b\d{7,}\b/)?.[0] || raw.split(" ")[0];
    const cat = getCategoriaEnc(uru, catalogoMap);

    if (CAT_OPERARIO.includes(cat)) operario.push({ it, uru, cat });
    else encargado.push({ it, uru, cat });
  });

  return { operario, encargado };
}


function EncPreparacionPanel({
  pedido,
  productos,
  catalogIndex,
  onClose,
  onPreparacionFinalizada,
  btnFinalizarLabel,
  onReportarError,
}) {
  // ── Estado ────────────────────────────────────────────────────
  const [checks, setChecks]               = React.useState({});
  const [modBannerDismissed, setModBannerDismissed] = React.useState(false);
  const [showErrPanel, setShowErrPanel]   = React.useState(false);
  const [errProductos, setErrProductos]   = React.useState([]);
  const [expandedProdKey, setExpandedProdKey] = React.useState(null);
  const [pendingTipo, setPendingTipo]     = React.useState(null);
  const [pendingCant, setPendingCant]     = React.useState("");
  const [savingErr, setSavingErr]         = React.useState(false);

  // ── Helpers ───────────────────────────────────────────────────
  const toURU = v => String(v || "").match(/\d{6,}/)?.[0] || String(v || "");

  const needMap = React.useMemo(() => {
    const map = {};
    (productos || []).forEach((it, i) => {
      const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
      map[`${uru}-${i}`] = Number(it.cantidad || it.cant || it.qty || 0);
    });
    return map;
  }, [productos]);

  const totalItems   = Object.keys(needMap).length;
  const checkedCount = Object.values(checks).filter(Boolean).length;
  const allChecked   = totalItems > 0 && checkedCount === totalItems;
  const progreso     = totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0;

  // ── Pre-tildar ítems que ya estaban preparados antes de la modificación ──
  React.useEffect(() => {
    if (!pedido?.modificacionInfo || !pedido?.itemsPreparados || !productos) return;
    const preparados = pedido.itemsPreparados;
    const nextChecks = {};
    (productos || []).forEach((it, i) => {
      const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
      if (!uru) return;
      const snap = preparados[uru];
      if (!snap) return; // producto nuevo → no pre-tildar
      const oldQty = Number(snap.cant) || 0;
      const newQty = Number(it.cantidad || it.cant || it.qty || 0);
      if (oldQty >= newQty) nextChecks[`${uru}-${i}`] = true;
    });
    setChecks(nextChecks);
    setModBannerDismissed(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id, pedido?.modificacionInfo]);

  // ── Mapa de modificaciones por código ────────────────────────
  const modInfo = pedido?.modificacionInfo;
  const addedSet   = React.useMemo(() => new Set((modInfo?.addedItems   || []).map(x => x.cod)), [modInfo]);
  const changedMap = React.useMemo(() => {
    const m = {};
    (modInfo?.changedItems || []).forEach(x => { m[x.cod] = x; });
    return m;
  }, [modInfo]);

  const marcarTodo = () => {
    const next = {};
    (productos || []).forEach((it, i) => {
      const uru = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
      next[`${uru}-${i}`] = true;
    });
    setChecks(next);
  };

  // ── Render de cada producto ───────────────────────────────────
  function renderProducto(it, i) {
    const uru     = toURU(it.cod || it.codigo || it.codigoURU || it.desc || it.descripcion || "");
    const key     = `${uru}-${i}`;
    const cat     = catalogIndex?.[uru];
    const nombre  = cat?.customerNo || it.descripcion || it.desc || it.nombre || uru;
    const color   = cat?.finish || cat?.color || "";
    const checked = !!checks[key];
    const need    = needMap[key] || 0;

    // Badge de modificación
    let modBadge = null;
    if (addedSet.has(uru)) {
      modBadge = { label: "NUEVO", bg: "#dcfce7", color: "#15803d" };
    } else if (changedMap[uru]) {
      const diff = changedMap[uru].cantAhora - changedMap[uru].cantAntes;
      modBadge = diff > 0
        ? { label: `+${diff} más`, bg: "#fef3c7", color: "#b45309" }
        : { label: `${diff} menos`, bg: "#fee2e2", color: "#dc2626" };
    }

    return (
      <button
        key={key}
        type="button"
        onClick={() => setChecks(prev => ({ ...prev, [key]: !prev[key] }))}
        style={{
          display: "flex", alignItems: "center", gap: 14,
          width: "100%", textAlign: "left",
          background: checked ? "#f0fdf4" : "#fff",
          border: `1.5px solid ${checked ? "#86efac" : modBadge ? "#fde68a" : "#e2e8f0"}`,
          borderRadius: 16, padding: "14px 16px",
          cursor: "pointer", transition: "all 0.15s ease",
          boxShadow: checked ? "none" : "0 1px 4px rgba(0,0,0,0.06)",
        }}
      >
        {/* Indicador circular */}
        <div style={{
          flexShrink: 0, width: 30, height: 30, borderRadius: "50%",
          border: `2px solid ${checked ? "#16a34a" : "#cbd5e1"}`,
          background: checked ? "#16a34a" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s ease",
        }}>
          {checked && (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7L5.5 10L11.5 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>

        {/* Info producto */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <p style={{
              margin: 0, fontSize: "0.92rem", fontWeight: 600,
              color: checked ? "#15803d" : "#1e293b",
              textDecoration: checked ? "line-through" : "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {nombre}
            </p>
            {modBadge && (
              <span style={{
                fontSize: "0.62rem", fontWeight: 800,
                padding: "2px 7px", borderRadius: 999,
                background: modBadge.bg, color: modBadge.color,
                letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0,
              }}>
                {modBadge.label}
              </span>
            )}
          </div>
          {color && (
            <p style={{ margin: "2px 0 0", fontSize: "0.74rem", color: "#94a3b8" }}>{color}</p>
          )}
        </div>

        {/* Cantidad */}
        <div style={{
          flexShrink: 0,
          background: checked ? "#dcfce7" : "#f1f5f9",
          color: checked ? "#15803d" : "#475569",
          fontWeight: 700, fontSize: "0.88rem",
          padding: "5px 11px", borderRadius: 8,
          transition: "all 0.15s ease",
        }}>
          ×{need}
        </div>
      </button>
    );
  }

  // ── Render principal ──────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Barra de progreso sticky */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "#fff",
        borderBottom: "1px solid #f1f5f9",
        padding: "12px 16px 10px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569" }}>
            {allChecked
              ? "✓ Todos los productos cargados"
              : `${checkedCount} de ${totalItems} productos`}
          </span>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: allChecked ? "#16a34a" : "#3b82f6" }}>
            {progreso}%
          </span>
        </div>
        <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 999,
            background: allChecked ? "#16a34a" : "#3b82f6",
            width: `${progreso}%`,
            transition: "width 0.3s ease, background 0.3s ease",
          }} />
        </div>
      </div>

      {/* Banner de modificación */}
      {modInfo && !modBannerDismissed && (() => {
        const items = [
          ...(modInfo.addedItems   || []).map(x => ({ tipo: "add", label: `+ ${x.nombre} ×${x.cant}` })),
          ...(modInfo.removedItems || []).map(x => ({ tipo: "del", label: `− ${x.nombre} (eliminado)` })),
          ...(modInfo.changedItems || []).map(x => ({ tipo: "chg", label: `↕ ${x.nombre}: ${x.cantAntes} → ${x.cantAhora}` })),
        ];
        return (
          <div style={{ margin: "12px 16px 0", background: "#fff7ed", border: "1.5px solid #f97316", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: "1.3rem", lineHeight: 1.2, flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "0.9rem", color: "#9a3412" }}>
                  Pedido modificado en Finnegans
                </p>
                <p style={{ margin: "0 0 8px", fontSize: "0.79rem", color: "#c2410c" }}>
                  Los ítems ya preparados están pre-tildados. Revisá los cambios:
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                  {items.map((it, idx) => (
                    <li key={idx} style={{
                      fontSize: "0.79rem", fontWeight: 600,
                      color: it.tipo === "add" ? "#15803d" : it.tipo === "del" ? "#dc2626" : "#b45309",
                    }}>
                      {it.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setModBannerDismissed(true)}
              style={{
                marginTop: 12, width: "100%", padding: "9px",
                background: "#fed7aa", border: "none", borderRadius: 10,
                fontWeight: 700, fontSize: "0.84rem", color: "#9a3412", cursor: "pointer",
              }}
            >
              Entendido
            </button>
          </div>
        );
      })()}

      {/* Lista de productos */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {(productos || []).length === 0 ? (
          <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0" }}>Sin productos</p>
        ) : (
          (productos || []).map((it, i) => renderProducto(it, i))
        )}

        {/* Marcar todo — solo si quedan pendientes */}
        {totalItems > 0 && !allChecked && (
          <button
            type="button"
            onClick={marcarTodo}
            style={{
              width: "100%", padding: "10px",
              background: "transparent", border: "1.5px dashed #cbd5e1",
              borderRadius: 12, color: "#64748b",
              fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            Marcar todos como cargados
          </button>
        )}
      </div>

      {/* Espaciador para barra fija */}
      <div style={{ height: 100 }} />

      {/* ── Barra fija inferior ───────────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", borderTop: "1px solid #e2e8f0",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.08)",
        padding: "12px 16px 20px",
        display: "flex", flexDirection: "column", gap: 8,
        zIndex: 50,
      }}>
        <button
          type="button"
          disabled={!allChecked}
          onClick={onPreparacionFinalizada}
          style={{
            width: "100%", padding: "15px", borderRadius: 14, border: "none",
            background: allChecked ? "#16a34a" : "#e2e8f0",
            color: allChecked ? "#fff" : "#94a3b8",
            fontWeight: 700, fontSize: "1rem",
            cursor: allChecked ? "pointer" : "not-allowed",
            transition: "all 0.2s ease",
          }}
        >
          {allChecked
            ? `✓ ${btnFinalizarLabel || "Pedido completado"}`
            : `Faltan ${totalItems - checkedCount} producto${totalItems - checkedCount !== 1 ? "s" : ""}`}
        </button>

        {onReportarError && (
          <button
            type="button"
            onClick={() => setShowErrPanel(true)}
            style={{
              background: "none", border: "none", color: "#ef4444",
              fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
              padding: "2px 0", textAlign: "center",
            }}
          >
            ⚠️ Hay un problema con este pedido
          </button>
        )}
      </div>

      {/* ── Overlay: reportar error ──────────────────────────── */}
      {showErrPanel && (
        <div
          onClick={() => { setShowErrPanel(false); setErrProductos([]); setExpandedProdKey(null); setPendingTipo(null); setPendingCant(""); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "flex-end" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#fff", width: "100%", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px" }}
          >
            <div style={{ width: 36, height: 4, background: "#e2e8f0", borderRadius: 999, margin: "0 auto 18px" }} />
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>⚠️ Reportar problema</h3>
            <p style={{ margin: "0 0 16px", fontSize: "0.82rem", color: "#64748b" }}>
              Seleccioná los productos con problema. Ventas será notificado.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {(productos || []).map((it, idx) => {
                const nombre  = it.descripcion || it.desc || it.nombre || it.cod || it.codigo || "—";
                const cant    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                const cod     = it.cod || it.codigo || it.codigoURU || "";
                const prodKey = `${cod}-${idx}`;
                const confirmed  = errProductos.find(p => p.key === prodKey);
                const isExpanded = expandedProdKey === prodKey;
                const SHORT = { sin_stock: "Sin stock", danado: "Dañado", hay_menos: "Hay menos" };
                return (
                  <div key={prodKey}>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmed) {
                          setErrProductos(prev => prev.filter(p => p.key !== prodKey));
                          if (isExpanded) setExpandedProdKey(null);
                        } else if (isExpanded) {
                          setExpandedProdKey(null); setPendingTipo(null); setPendingCant("");
                        } else {
                          setExpandedProdKey(prodKey); setPendingTipo(null); setPendingCant("");
                        }
                      }}
                      style={{
                        width: "100%", textAlign: "left", padding: "10px 12px",
                        borderRadius: confirmed || isExpanded ? "10px 10px 0 0" : 10,
                        cursor: "pointer", fontFamily: "inherit",
                        border: confirmed ? "1.5px solid #ea580c" : isExpanded ? "1.5px solid #f97316" : "1.5px solid #e2e8f0",
                        background: confirmed || isExpanded ? "#fff7ed" : "#f8fafc",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: confirmed ? 700 : 500, color: confirmed ? "#9a3412" : "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {nombre}
                      </span>
                      <span style={{ fontSize: "0.78rem", color: "#94a3b8", flexShrink: 0 }}>x{cant}</span>
                      {confirmed ? (
                        <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#ea580c", color: "#fff", flexShrink: 0, whiteSpace: "nowrap" }}>
                          {confirmed.tipo === "hay_menos" && confirmed.cant ? `Hay menos (${confirmed.cant})` : SHORT[confirmed.tipo] || confirmed.tipo} ✕
                        </span>
                      ) : (
                        <span style={{ color: isExpanded ? "#f97316" : "#94a3b8", fontSize: "0.9rem", flexShrink: 0 }}>{isExpanded ? "▲" : "+"}</span>
                      )}
                    </button>
                    {isExpanded && !confirmed && (
                      <div style={{ border: "1.5px solid #f97316", borderTop: "none", borderRadius: "0 0 10px 10px", background: "#fff7ed", padding: 12 }}>
                        <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#c2410c", textTransform: "uppercase", letterSpacing: "0.05em" }}>¿Cuál es el problema?</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {[
                            { id: "sin_stock", label: "No hay stock",           icon: "❌" },
                            { id: "danado",    label: "Está dañado / abollado", icon: "💢" },
                            { id: "hay_menos", label: "Hay menos de lo pedido", icon: "📉" },
                          ].map(op => (
                            <button key={op.id} type="button"
                              onClick={() => { setPendingTipo(op.id); if (op.id !== "hay_menos") setPendingCant(""); }}
                              style={{
                                width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                                border: pendingTipo === op.id ? "1.5px solid #dc2626" : "1.5px solid #fdba74",
                                background: pendingTipo === op.id ? "#fef2f2" : "#fff",
                                display: "flex", alignItems: "center", gap: 8,
                              }}
                            >
                              <span>{op.icon}</span>
                              <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: pendingTipo === op.id ? 700 : 500, color: pendingTipo === op.id ? "#991b1b" : "#475569" }}>{op.label}</span>
                              {pendingTipo === op.id && <span>✓</span>}
                            </button>
                          ))}
                        </div>
                        {pendingTipo === "hay_menos" && (
                          <div style={{ marginTop: 10 }}>
                            <p style={{ margin: "0 0 4px", fontSize: "0.7rem", fontWeight: 700, color: "#c2410c", textTransform: "uppercase" }}>¿Cuántas hay? (opcional)</p>
                            <input type="number" min="0" value={pendingCant} onChange={e => setPendingCant(e.target.value)} placeholder="0"
                              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #fdba74", borderRadius: 8, padding: "8px 10px", fontSize: "0.95rem", outline: "none", fontFamily: "inherit" }} />
                          </div>
                        )}
                        <button type="button" disabled={!pendingTipo}
                          onClick={() => {
                            if (!pendingTipo) return;
                            setErrProductos(prev => [...prev, { key: prodKey, cod, nombre, tipo: pendingTipo, cant: pendingCant }]);
                            setExpandedProdKey(null); setPendingTipo(null); setPendingCant("");
                          }}
                          style={{
                            marginTop: 10, width: "100%", padding: 10, borderRadius: 8, border: "none", fontFamily: "inherit",
                            background: pendingTipo ? "#ea580c" : "#e2e8f0",
                            color: pendingTipo ? "#fff" : "#94a3b8",
                            fontWeight: 700, fontSize: "0.88rem",
                            cursor: pendingTipo ? "pointer" : "not-allowed",
                          }}
                        >Confirmar problema →</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowErrPanel(false); setErrProductos([]); setExpandedProdKey(null); setPendingTipo(null); setPendingCant(""); }}
                style={{ flex: 1, padding: 13, borderRadius: 12, border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#64748b", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer" }}>
                Cancelar
              </button>
              <button disabled={savingErr || errProductos.length === 0}
                onClick={async () => {
                  setSavingErr(true);
                  try {
                    await onReportarError({ productos: errProductos });
                    setShowErrPanel(false);
                    setErrProductos([]); setExpandedProdKey(null); setPendingTipo(null); setPendingCant("");
                  } finally { setSavingErr(false); }
                }}
                style={{
                  flex: 2, padding: 13, borderRadius: 12, border: "none",
                  background: savingErr || errProductos.length === 0 ? "#e2e8f0" : "#dc2626",
                  color: savingErr || errProductos.length === 0 ? "#94a3b8" : "#fff",
                  fontWeight: 700, fontSize: "0.9rem",
                  cursor: savingErr || errProductos.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {savingErr ? "Enviando…" : `Reportar${errProductos.length > 0 ? ` (${errProductos.length})` : ""} y notificar`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default function PedidoDetalle() {
  const { haptics, toast } = useApp();
  const { user, profile } = useAuth();

  const role = (profile?.rol || "").toLowerCase();
  const isVentas = role === "ventas";
  const isEncargado = role === "encargado";

  

  const navigate = useNavigate();
  const location = useLocation();
  const [sending, setSending] = useState(false);
    // === Accesorios controlados por el encargado ===
  const [accChecks, setAccChecks] = useState({});


  function handleBack() {
    // Si el usuario es de ventas, forzamos la lista de "CONTROLADOS" de ventas
    if (isVentas) {
      navigate("/ventas/para-despachar", { replace: true });
      return;
    }
    // Para otros roles (encargado/operario), podés ajustar esta ruta si tu app usa otra
    navigate("/encargado/pedidos", { replace: true });
  }



  // id desde la URL (decodificado)
  const { id: encodedId } = useParams();
  const id = decodeURIComponent(encodedId || "");

  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState(null);
  const [lite, setLite] = useState(false);

  // Cuando el encargado se auto-asignó, actúa como operario en prep.
  // (definido después de pedido para evitar temporal dead zone)
  const isSelfAssigned = !!pedido?.operarioId && pedido.operarioId === user?.uid;
  // ISABELA: encargado único que hace todo
  const isIsabela = isEncargado && profile?.deposito === "ISABELA";

  // selector de operario
  const [operarios, setOperarios] = useState([]);
  const [selectedOperario, setSelectedOperario] = useState(null);
  const [loadingOps, setLoadingOps] = useState(false);
  const [saving, setSaving] = useState(false);

  const [bultos, setBultos] = useState(pedido?.bultos || "");
  const [paquetes, setPaquetes] = useState(pedido?.paquetes || "");


  // catálogo enriquecido: { [uru]: { customerNo, finish, ... } }
  const [catalogoMap, setCatalogoMap] = useState({});

  // --- Control de pedido (checklist)
  const [checks, setChecks] = useState({});

  // --- Reporte de error en preparación
  const [showErrForm, setShowErrForm] = useState(false);
  const [detalleErr, setDetalleErr] = useState("");
  const [savingErr, setSavingErr] = useState(false);

  const [cambiandoOperario, setCambiandoOperario] = useState(false);
  const [elevarProblema, setElevarProblema] = useState(false);
  const [notaElevacion, setNotaElevacion] = useState("");
  const [savingProblema, setSavingProblema] = useState(false);
  const [showAnularModal, setShowAnularModal] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");
  const [savingAnulacion, setSavingAnulacion] = useState(false);

  // Estados para el modal de cancelación (ventas)
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelStep, setCancelStep] = useState(1); // 1=elegir motivo, 2=confirmar
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cancelOtroText, setCancelOtroText] = useState("");
  const [canceling, setCanceling] = useState(false);




  // ISABELA + R8: si el pedido está DESPACHADO en la colección pedidos,
  // el encargado va directo al control de entrega.
  const isEncargadoR8 = isEncargado && profile?.deposito === "R8";
  useEffect(() => {
    if ((isIsabela || isEncargadoR8) && pedido?.estado === "DESPACHADO") {
      navigate(`/encargado/entrega/${id}`, { replace: true });
    }
  }, [isIsabela, isEncargadoR8, pedido?.estado, id, navigate]);

  // resetear checks cuando cambia el pedido
  useEffect(() => {
    setChecks({});
  }, [id, pedido?.numero, Array.isArray(pedido?.productos) ? pedido.productos.length : 0]);

  function toggleCheck(key) {
    setChecks(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const totalProductos = Array.isArray(pedido?.productos) ? pedido.productos.length : 0;
  const checkedCount = useMemo(() => Object.values(checks).filter(Boolean).length, [checks]);
  const allChecked = totalProductos > 0 && checkedCount === totalProductos;

  async function guardarBultosYPaquetes() {
    try {
      const docRef = doc(db, "pedidos", id);
      await updateDoc(docRef, {
        bultos: Number(bultos),
        paquetes: Number(paquetes),
      });
      toast.success("Datos guardados");
    } catch (e) {
      console.error("Error guardando bultos/paquetes", e);
      toast.error("No se pudieron guardar los datos");
    }
  }


  // confirmar control → pasa a CONTROLADO
  async function anularPedido() {
    if (!motivoAnulacion.trim()) return;
    try {
      setSavingAnulacion(true);
      await updateDoc(doc(db, "pedidos", id), {
        estado: "ANULADO",
        anuladoAt: serverTimestamp(),
        anuladoMotivo: motivoAnulacion.trim(),
        anuladoOrigen: "encargado-manual",
        anuladoPor: profile?.uid || null,
        updatedAt: serverTimestamp(),
      });
      toast.success("Pedido anulado");
      setShowAnularModal(false);
      navigate("/pedidos");
    } catch (e) {
      console.error(e);
      toast.error("Error al anular el pedido");
    } finally {
      setSavingAnulacion(false);
    }
  }

  async function handleCancelar() {
    const motivo = cancelMotivo === "Otro" ? cancelOtroText.trim() : cancelMotivo;
    if (!motivo) return;
    setCanceling(true);
    try {
      await updateDoc(doc(db, "pedidos", id), {
        estado: "CANCELADO",
        cancelMotivo: motivo,
        canceladoPor: user?.uid || null,
        canceladoPorNombre: profile?.nombre || user?.displayName || user?.email || null,
        canceladoAt: serverTimestamp(),
        canceladoDesdeEstado: pedido?.estado || null,
        updatedAt: serverTimestamp(),
        [`timestamps.CANCELADO`]: serverTimestamp(),
      });
      haptics?.success?.();
      toast.success("Pedido cancelado");
      setShowCancelModal(false);
      navigate("/ventas/pipeline");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo cancelar: " + (e?.message || "Error desconocido"));
    } finally {
      setCanceling(false);
    }
  }

  async function confirmControl() {
  try {
    await updateDoc(doc(db, "pedidos", id), {
      prepAccesoriosOk: true,
    });

    await updateEstado(id, ESTADOS.CONTROLADO);
    toast.success("Pedido controlado");
  } catch (e) {
    toast.error(e.message);
  }
}


  async function submitErrorPreparacion(productosConError) {
    if (!Array.isArray(productosConError) || productosConError.length === 0) {
      toast.error("Seleccioná al menos un producto con error.");
      return;
    }
    try {
      setSavingErr(true);
      const TIPO_LABELS = { sin_stock: "No hay stock", danado: "Está dañado / abollado", hay_menos: "Hay menos de lo pedido" };
      const detalleText = productosConError.map(p => {
        const label = TIPO_LABELS[p.tipo] || p.tipo;
        const cantStr = p.tipo === "hay_menos" && p.cant ? ` (disponibles: ${p.cant})` : "";
        return `• ${p.nombre}: ${label}${cantStr}`;
      }).join("\n");

      const respNombre = profile?.nombre || user?.displayName || user?.email || "—";
      const prodsClean = productosConError.map(({ key, ...rest }) => rest); // quitar key interna

      await addDoc(collection(db, "errores_preparacion"), {
        pedidoId: id,
        numero: pedido.numero || null,
        cliente: pedido.cliente || null,
        deposito: pedido.deposito || null,
        responsableUid: user?.uid || null,
        responsableNombre: respNombre,
        estadoPedido: pedido.estado || null,
        finFecha: pedido.finFecha || null,
        metodoEntrega: pedido.metodoEntrega || null,
        detalle: detalleText,
        errorProductos: prodsClean,
        errorProductoCod: prodsClean[0]?.cod || null,
        errorProductoNombre: prodsClean[0]?.nombre || null,
        fechaReporte: serverTimestamp(),
      });

      await updateEstado(id, ESTADOS.CON_ERROR, {
        errorDetalle: detalleText,
        errorProductos: prodsClean,
        errorProductoCod: prodsClean[0]?.cod || null,
        errorProductoNombre: prodsClean[0]?.nombre || null,
      });

      toast.success("Error reportado — ventas fue notificado");
      navigate("/pedidos");
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo registrar el error");
    } finally {
      setSavingErr(false);
    }
  }




  // placeholder para el flujo de incidente (lo conectamos luego)
  function reportarErrorPreparacion() {
    toast.info("Luego conectamos este botón al registro de incidentes.");
  }


  // flag lite (seguro)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await getFlag("MODO_LITE");
        if (!alive) return;
        const parsed = String(v ?? "").toLowerCase().trim() === "true" || v === true;
        setLite(parsed);
      } catch {
        if (alive) setLite(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // cargar pedido — intenta pedidos primero, luego pedidos_despachados y pedidos_entregados
  useEffect(() => {
    let cancelled = false;
    if (!id) { setError("ID inválido"); return; }
    (async () => {
      try {
        let p = await getPedido(id);
        if (!p) {
          // Fallback: buscar en colecciones secundarias (despachados / entregados)
          const [despSnap, entSnap] = await Promise.all([
            getDoc(doc(db, "pedidos_despachados", id)),
            getDoc(doc(db, "pedidos_entregados", id)),
          ]);
          if (entSnap.exists())  p = { id: entSnap.id,  ...entSnap.data(),  _source: "entregados"  };
          else if (despSnap.exists()) p = { id: despSnap.id, ...despSnap.data(), _source: "despachados" };
        }
        if (cancelled) return;
        if (!p) { setError("Pedido no encontrado"); setPedido(null); }
        else { setError(null); setPedido(p); }
      } catch (e) {
        console.error("[PedidoDetalle] getPedido error", e);
        if (!cancelled) setError("Error cargando pedido");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Cargar catálogo para los códigos URU del pedido
  useEffect(() => {
    if (!pedido?.productos || !Array.isArray(pedido.productos)) return;

    const codigos = Array.from(
      new Set(
        pedido.productos
          .map(p => p.cod || p.codigo || p.codigoURU || p.desc || p.descripcion || p.nombre)
          .filter(Boolean)
          .map(toURUCode)
          .filter(Boolean)
      )
    );

    if (codigos.length === 0) { setCatalogoMap({}); return; }

    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          codigos.map(async uru => {
            const doc = await getCatalogoByCodUru(uru);
            return [uru, doc || null];
          })
        );
        if (!cancelled) {
          const map = Object.fromEntries(entries);
          setCatalogoMap(map);
        }
      } catch (e) {
        console.error("[PedidoDetalle] catálogo error", e?.code || e);
        toast.error("No se pudo cargar información del catálogo");
      }
    })();

    return () => { cancelled = true; };
  }, [pedido?.productos, toast]);

  // cargar operarios del depósito del pedido (solo cuando realmente hace falta)
  useEffect(() => {
    // Cargamos la lista SOLO si:
    // 1) hay depósito, 2) el estado requiere asignación, 3) el rol es ENCARGADO
    if (!pedido?.deposito) return;
    if (![ESTADOS.PENDIENTE_ASIGNAR, ESTADOS.ASIGNADO].includes(pedido?.estado)) return;
    if ((profile?.rol || "").toLowerCase() !== "encargado") return;

    let cancelled = false;
    setLoadingOps(true);
    (async () => {
      try {
        // Consultamos ambos campos para compatibilidad con documentos viejos (role) y nuevos (rol)
        const [snapRol, snapRole] = await Promise.all([
          getDocs(query(collection(db, "users"), where("rol", "==", "operario"), where("deposito", "==", pedido.deposito))),
          getDocs(query(collection(db, "users"), where("role", "==", "operario"), where("deposito", "==", pedido.deposito))),
        ]);
        if (cancelled) return;
        const seen = new Set();
        const list = [...snapRol.docs, ...snapRole.docs]
          .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
          .map(d => ({ id: d.id, ...d.data() }));
        setOperarios(list);
        if (pedido.operarioId) {
          const found = list.find(o => o.id === pedido.operarioId);
          if (found) setSelectedOperario({ uid: found.id, nombre: found.nombre || found.email });
        }
      } catch (e) {
        console.error("[PedidoDetalle] cargar operarios error", e);
        if (!cancelled) toast.error("No se pudieron cargar operarios");
      } finally {
        if (!cancelled) setLoadingOps(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pedido?.deposito, pedido?.estado, pedido?.operarioId, profile?.rol, toast]);


  // buscador de operarios
const [searchOp, setSearchOp] = useState("");

const filteredOperarios = useMemo(() => {
  const q = searchOp.trim().toLowerCase();
  if (!q) return operarios;
  return operarios.filter(o => {
    const s = `${o.nombre || ""} ${o.email || ""}`.toLowerCase();
    return s.includes(q);
  });
}, [searchOp, operarios]);


  const puedeAsignarAlguien = useMemo(() => {
    const role = (profile?.rol || "").toLowerCase();
    return role === "encargado"; // solo encargado puede asignar a otros
  }, [profile?.rol]);

  const puedeAutoAsignarse = useMemo(() => {
    const role = (profile?.rol || "").toLowerCase();
    // encargado u operario pueden auto-asignarse si el depósito coincide
    return !!pedido?.deposito && (role === "encargado" || role === "operario") &&
      profile?.deposito === pedido.deposito;
  }, [profile?.rol, profile?.deposito, pedido?.deposito]);

  async function handleConfirmarAsignacion() {
    if (!selectedOperario?.uid) {
      toast.error("Seleccioná un operario");
      return;
    }
    if (!puedeAsignarAlguien) {
      toast.error("No tenés permisos para asignar");
      return;
    }
    try {
      setSaving(true);
      await asignarOperario(id, selectedOperario.uid, selectedOperario.nombre || "Operario");
      await updateEstado(id, ESTADOS.ASIGNADO);
      haptics?.success?.();
      toast.success("Pedido asignado");
      // refrescar local
      setPedido(prev => prev ? {
        ...prev,
        operarioId: selectedOperario.uid,
        operarioNombre: selectedOperario.nombre || "Operario",
        estado: ESTADOS.ASIGNADO
      } : prev);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Error al asignar");
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoAsignarme() {
    if (!puedeAutoAsignarse) {
      toast.error("No podés autoasignarte este pedido");
      return;
    }
    try {
      setSaving(true);
      const nombre = profile?.nombre || user?.displayName || user?.email || "Operario";
      await asignarOperario(id, user.uid, nombre);
      await updateEstado(id, ESTADOS.ASIGNADO);
      haptics?.success?.();
      toast.success("Te asignaste el pedido");
      setPedido(prev => prev ? {
        ...prev,
        operarioId: user.uid,
        operarioNombre: nombre,
        estado: ESTADOS.ASIGNADO
      } : prev);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo auto-asignar");
    } finally {
      setSaving(false);
    }
  }

  // ISABELA: un click → auto-asignar + EN_PREPARACION (salta ASIGNADO)
  async function handleTomarYPreparar() {
    if (!isIsabela) return;
    try {
      setSaving(true);
      const nombre = profile?.nombre || user?.displayName || user?.email || "Encargado";
      await asignarOperario(id, user.uid, nombre);
      await updateEstado(id, ESTADOS.EN_PREPARACION);
      haptics?.success?.();
      toast.success("Pedido tomado — a preparar!");
      setPedido(prev => prev ? {
        ...prev,
        operarioId: user.uid,
        operarioNombre: nombre,
        estado: ESTADOS.EN_PREPARACION,
      } : prev);
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo tomar el pedido");
    } finally {
      setSaving(false);
    }
  }

  async function onComenzar() {
    try {
      setSaving(true);
      await updateEstado(id, ESTADOS.EN_PREPARACION);
      haptics?.success?.();
      toast.success("Preparación iniciada");
      setPedido(prev => prev ? { ...prev, estado: ESTADOS.EN_PREPARACION } : prev);
    } catch (e) {
      toast.error(e.message || "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  }

  async function onFinalizar() {
    try {
      setSaving(true);
      await updateEstado(id, ESTADOS.PREPARADO);
      haptics?.success?.();
      toast.success("Pedido preparado");
      setPedido(prev => prev ? { ...prev, estado: ESTADOS.PREPARADO } : prev);
    } catch (e) {
      toast.error(e.message || "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="p-3 text-red-600">{error}</div>;
  if (!pedido) return <p className="p-3">Cargando…</p>;

  const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

  // ── Helpers de cancelación (ventas) ──────────────────────────────────────
  // Se llaman desde cualquier early-return que ventas pueda ver
  const ESTADOS_NO_CANCELABLES = ["CANCELADO", "ANULADO", "ENTREGADO", "DESPACHADO"];
  const puedeVentasCancelar = isVentas && !ESTADOS_NO_CANCELABLES.includes(pedido?.estado);

  function abrirCancelModal() {
    setCancelStep(1);
    setCancelMotivo("");
    setCancelOtroText("");
    setShowCancelModal(true);
  }

  // Botón trigger pequeño — va en headers
  function renderVentasCancelBtn() {
    if (!puedeVentasCancelar) return null;
    return (
      <button
        type="button"
        onClick={abrirCancelModal}
        style={{
          fontSize: "0.72rem", fontWeight: 600,
          color: "#dc2626", background: "none",
          border: "1.5px solid #fca5a5", borderRadius: "7px",
          padding: "5px 11px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "4px",
          flexShrink: 0, whiteSpace: "nowrap",
          transition: "all 0.12s ease",
        }}
      >
        ✕ Cancelar pedido
      </button>
    );
  }

  // Modal de cancelación 2 pasos
  function renderCancelModal() {
    if (!showCancelModal || !isVentas) return null;

    const MOTIVOS = [
      "El cliente se arrepintió",
      "Producto sin stock",
      "Error en el pedido",
      "Pedido duplicado",
      "Cliente no disponible",
      "Otro",
    ];
    const motivoFinal = cancelMotivo === "Otro" ? cancelOtroText.trim() : cancelMotivo;
    const estadoLabel = {
      PENDIENTE_ASIGNAR: "Pendiente de asignar",
      ASIGNADO: "Asignado a operario",
      EN_PREPARACION: "En preparación",
      PREPARADO: "Preparado",
      CONTROLADO: "Controlado",
      CON_ERROR: "Con error",
      ERROR_CONFIRMADO: "Error confirmado",
    };

    return (
      <div
        onClick={() => setShowCancelModal(false)}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: "#fff", borderRadius: "20px",
            padding: "28px 24px", width: "100%", maxWidth: "480px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
          }}
        >
          {/* Cabecera modal */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {cancelStep === 1 ? "Cancelar pedido" : "Confirmar cancelación"}
              </p>
              <h2 style={{ margin: "3px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>
                #{pedido?.numero || id} — {pedido?.cliente || "—"}
              </h2>
              {pedido?.estado && (
                <span style={{ display: "inline-block", marginTop: "5px", fontSize: "0.7rem", fontWeight: 700, padding: "3px 9px", borderRadius: "999px", background: "#f1f5f9", color: "#64748b" }}>
                  Estado actual: {estadoLabel[pedido.estado] || pedido.estado}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowCancelModal(false)}
              style={{ background: "none", border: "none", fontSize: "1.3rem", color: "#94a3b8", cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}
            >×</button>
          </div>

          {cancelStep === 1 ? (
            /* ── Paso 1: elegir motivo ── */
            <>
              <p style={{ margin: "0 0 14px", fontSize: "0.78rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Motivo de cancelación *
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "16px" }}>
                {MOTIVOS.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCancelMotivo(m)}
                    style={{
                      width: "100%", textAlign: "left", padding: "11px 14px",
                      borderRadius: "10px", cursor: "pointer", fontFamily: "inherit",
                      border: cancelMotivo === m ? "2px solid #dc2626" : "1.5px solid #e2e8f0",
                      background: cancelMotivo === m ? "#fef2f2" : "#f8fafc",
                      color: cancelMotivo === m ? "#dc2626" : "#334155",
                      fontSize: "0.88rem", fontWeight: cancelMotivo === m ? 700 : 500,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      transition: "all 0.1s ease",
                    }}
                  >
                    {m}
                    {cancelMotivo === m && <span style={{ fontSize: "0.9rem", flexShrink: 0 }}>✓</span>}
                  </button>
                ))}
              </div>
              {cancelMotivo === "Otro" && (
                <textarea
                  value={cancelOtroText}
                  onChange={e => setCancelOtroText(e.target.value)}
                  placeholder="Describí el motivo…"
                  autoFocus
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 12px", border: "1.5px solid #e2e8f0",
                    borderRadius: "10px", fontSize: "0.9rem",
                    resize: "none", minHeight: "70px",
                    marginBottom: "14px", fontFamily: "inherit",
                  }}
                />
              )}
              <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontWeight: 600, cursor: "pointer", fontSize: "0.88rem" }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!cancelMotivo || (cancelMotivo === "Otro" && !cancelOtroText.trim())}
                  onClick={() => setCancelStep(2)}
                  style={{
                    flex: 2, padding: "12px", borderRadius: "10px", border: "none",
                    background: (cancelMotivo && (cancelMotivo !== "Otro" || cancelOtroText.trim())) ? "#dc2626" : "#e2e8f0",
                    color: (cancelMotivo && (cancelMotivo !== "Otro" || cancelOtroText.trim())) ? "#fff" : "#94a3b8",
                    fontWeight: 700, cursor: "pointer", fontSize: "0.88rem",
                    transition: "all 0.1s ease",
                  }}
                >
                  Continuar →
                </button>
              </div>
            </>
          ) : (
            /* ── Paso 2: confirmar ── */
            <>
              {/* Resumen del motivo */}
              <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "12px", padding: "14px 16px", marginBottom: "16px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Motivo seleccionado</p>
                <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>{motivoFinal}</p>
              </div>

              {/* Warning */}
              <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: "12px", padding: "14px 16px", marginBottom: "20px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "1.1rem", flexShrink: 0, lineHeight: 1.4 }}>⚠️</span>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: "0.82rem", fontWeight: 700, color: "#dc2626" }}>
                    Esta acción no se puede deshacer fácilmente
                  </p>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#9a1a1a", lineHeight: 1.5 }}>
                    El pedido quedará cancelado. Si fue un error, solo un <strong>administrador</strong> podrá reactivarlo.
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setCancelStep(1)}
                  style={{ flex: 1, padding: "13px", borderRadius: "10px", border: "1.5px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontWeight: 600, cursor: "pointer", fontSize: "0.88rem" }}
                >
                  ← Volver
                </button>
                <button
                  type="button"
                  onClick={handleCancelar}
                  disabled={canceling}
                  style={{
                    flex: 2, padding: "13px", borderRadius: "10px", border: "none",
                    background: canceling ? "#e2e8f0" : "#dc2626",
                    color: canceling ? "#94a3b8" : "#fff",
                    fontWeight: 700, cursor: canceling ? "not-allowed" : "pointer",
                    fontSize: "0.88rem", boxShadow: canceling ? "none" : "0 2px 10px rgba(220,38,38,0.28)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    transition: "all 0.1s ease",
                  }}
                >
                  {canceling ? (
                    <>
                      <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid #94a3b8", borderTopColor: "transparent", display: "inline-block" }} />
                      Cancelando…
                    </>
                  ) : "✕ Confirmar cancelación"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  // ── Fin helpers de cancelación ────────────────────────────────────────────

  // ── Vista especial PENDIENTE_ASIGNAR para encargado ──────────────────────
  if (pedido.estado === ESTADOS.PENDIENTE_ASIGNAR && !isVentas) {
    const { operario: prodsOperario, encargado: prodsEncargado } = splitPorCategoria(productos, catalogoMap);
    const catalogoListo = Object.keys(catalogoMap).length > 0;

    const getNombre = (it, uru) => {
      const desc = it.descripcion || it.desc || it.nombre || "";
      if (desc) return desc;
      return catalogoMap?.[uru]?.customerNo || uru || "—";
    };
    const getColor = (uru) => catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";

    const formatFecha = (f) => {
      if (!f) return "—";
      // Soporta "YYYY-MM-DD" y "DD/MM/YYYY"
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const ProductRow = ({ it, uru }) => {
      const nombre = getNombre(it, uru);
      const color = getColor(uru);
      const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {nombre}
            </p>
            {color && <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
          </div>
          <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>
            ×{qty}
          </span>
        </div>
      );
    };

    // ── ISABELA: vista simplificada — un solo botón "Tomar y preparar" ──────
    if (isIsabela) {
      return (
        <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>
          <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
            <VolverListaPedidos to="/pedidos" />
            <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <div>
                <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
                <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
              </div>
              <span style={{ flexShrink: 0, background: "#fef3c7", color: "#92400e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>PENDIENTE</span>
            </div>
            <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {pedido.finFecha}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            </div>
          </div>
          <div style={{ padding: "16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Productos · {productos.length} ítem{productos.length !== 1 ? "s" : ""}
            </p>
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "4px 16px", marginBottom: "20px" }}>
              {productos.map((it, i) => {
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                const nombre = it.descripcion || it.desc || it.nombre || it.cod || "—";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <p style={{ flex: 1, margin: 0, fontSize: "0.88rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                    <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              type="button"
              onClick={handleTomarYPreparar}
              disabled={saving}
              style={{ width: "100%", padding: "16px", borderRadius: "14px", border: "none", fontWeight: 700, fontSize: "1.05rem", background: saving ? "#e2e8f0" : "#16a34a", color: saving ? "#94a3b8" : "#fff", cursor: saving ? "not-allowed" : "pointer" }}
            >
              {saving ? "Iniciando…" : "🟢 Comenzar preparación"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef3c7", color: "#92400e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              PENDIENTE
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 16px 0" }}>

          {/* ── Contenido del pedido ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido del pedido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>

          {/* Sección operario */}
          {prodsOperario.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #bfdbfe", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, background: "#dbeafe", color: "#1d4ed8", padding: "3px 8px", borderRadius: "999px", letterSpacing: "0.05em" }}>
                  OPERARIO
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Perfiles y Kits · {prodsOperario.length} ítem{prodsOperario.length !== 1 ? "s" : ""}</span>
              </div>
              {prodsOperario.map(({ it, uru }, i) => (
                <ProductRow key={`op-${uru}-${i}`} it={it} uru={uru} />
              ))}
            </div>
          )}

          {/* Sección encargado */}
          {prodsEncargado.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, background: "#ffedd5", color: "#9a3412", padding: "3px 8px", borderRadius: "999px", letterSpacing: "0.05em" }}>
                  ENCARGADO
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Accesorios / PVC / Otros · {prodsEncargado.length} ítem{prodsEncargado.length !== 1 ? "s" : ""}</span>
              </div>
              {prodsEncargado.map(({ it, uru }, i) => (
                <ProductRow key={`enc-${uru}-${i}`} it={it} uru={uru} />
              ))}
            </div>
          )}

          {/* Si el catálogo no cargó todavía, mostrar todos sin categorizar */}
          {!catalogoListo && productos.length > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "10px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.72rem", color: "#94a3b8" }}>Cargando categorías…</p>
              {productos.map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                return <ProductRow key={i} it={it} uru={uru} />;
              })}
            </div>
          )}

          {productos.length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>Sin productos registrados.</p>
          )}

          {/* ── Asignar operario ── */}
          <p style={{ margin: "18px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Asignar responsable
          </p>

          {loadingOps ? (
            <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Cargando operarios…</p>
          ) : operarios.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", textAlign: "center" }}>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>No hay operarios disponibles para el depósito <strong>{pedido.deposito}</strong>.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
              {operarios
                .slice()
                .sort((a, b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                .map(o => {
                  const selected = selectedOperario?.uid === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedOperario(selected ? null : { uid: o.id, nombre: o.nombre || o.email || "Operario" })}
                      disabled={!puedeAsignarAlguien || saving}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "14px 16px", textAlign: "left", width: "100%",
                        background: selected ? "#eff6ff" : "#fff",
                        border: `1.5px solid ${selected ? "#3b82f6" : "#e2e8f0"}`,
                        borderRadius: "12px", cursor: "pointer",
                        transition: "all 0.15s ease",
                        boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
                      }}
                    >
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                        background: selected ? "#3b82f6" : "#f1f5f9",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.85rem", fontWeight: 700, color: selected ? "#fff" : "#64748b",
                        transition: "all 0.15s ease",
                      }}>
                        {(o.nombre || o.email || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: selected ? "#1d4ed8" : "#1e293b" }}>
                          {o.nombre || o.email}
                        </p>
                        {o.deposito && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>Depósito {o.deposito}</p>}
                      </div>
                      {selected && (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                          <circle cx="9" cy="9" r="9" fill="#3b82f6"/>
                          <path d="M5 9l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
            </div>
          )}

          {/* Auto-asignarme */}
          {puedeAutoAsignarse && (
            <button
              type="button"
              onClick={handleAutoAsignarme}
              disabled={saving}
              style={{
                width: "100%", padding: "12px", marginBottom: "8px",
                background: "transparent", border: "1.5px dashed #cbd5e1",
                borderRadius: "12px", color: "#475569",
                fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              {saving ? "Guardando…" : "Tomarme el pedido yo mismo"}
            </button>
          )}

          {!puedeAsignarAlguien && !puedeAutoAsignarse && (
            <p style={{ fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
              Solo un encargado puede asignar operarios.
            </p>
          )}
        </div>

        {/* ── CTA fijo ── */}
        {puedeAsignarAlguien && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              type="button"
              onClick={handleConfirmarAsignacion}
              disabled={!selectedOperario || saving}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                fontWeight: 700, fontSize: "1rem",
                background: selectedOperario ? "#0f172a" : "#e2e8f0",
                color: selectedOperario ? "#fff" : "#94a3b8",
                cursor: selectedOperario ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
              }}
            >
              {saving ? "Asignando…" : selectedOperario ? `Asignar a ${selectedOperario.nombre}` : "Seleccioná un operario"}
            </button>
          </div>
        )}
      </div>
    );
  }
  // ── Fin vista PENDIENTE_ASIGNAR ──────────────────────────────────────────

  // ── Vista especial ASIGNADO para encargado ───────────────────────────────
  // (Omitir si es autoasignado: cae al main return con botón Comenzar)
  if (pedido.estado === ESTADOS.ASIGNADO && isEncargado && !isSelfAssigned) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    // Tiempo transcurrido desde asignación
    const getElapsedStr = () => {
      const ts = pedido.timestamps?.ASIGNADO;
      if (!ts) return null;
      const asignadoAt = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(asignadoAt)) return null;
      const mins = Math.floor((Date.now() - asignadoAt.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const elapsed = getElapsedStr();

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario sin nombre";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: cambiandoOperario ? "88px" : "24px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dbeafe", color: "#1e40af", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              ASIGNADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Operario asignado ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Responsable de preparación
          </p>

          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0,
                background: "#3b82f6",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem", fontWeight: 700, color: "#fff",
              }}>
                {avatarInitial}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                  {operarioNombre}
                </p>
                {elapsed && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    🕐 Asignado {elapsed}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Resumen del pedido ── */}
          <p style={{ margin: "16px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.slice(0, 5).map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < Math.min(productos.length, 5) - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nombre}
                    </p>
                    <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>
                      ×{qty}
                    </span>
                  </div>
                );
              })
            )}
            {productos.length > 5 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
                y {productos.length - 5} productos más…
              </p>
            )}
          </div>

          {/* ── Cambiar operario ── */}
          {!cambiandoOperario ? (
            <button
              type="button"
              onClick={() => setCambiandoOperario(true)}
              style={{
                width: "100%", padding: "12px", marginBottom: "8px",
                background: "transparent", border: "1.5px dashed #cbd5e1",
                borderRadius: "12px", color: "#475569",
                fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              Cambiar operario
            </button>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  Elegir nuevo operario
                </p>
                <button
                  type="button"
                  onClick={() => { setCambiandoOperario(false); setSelectedOperario(null); }}
                  style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "0.8rem", cursor: "pointer", padding: "4px 8px" }}
                >
                  Cancelar
                </button>
              </div>

              {loadingOps ? (
                <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Cargando operarios…</p>
              ) : operarios.length === 0 ? (
                <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", textAlign: "center" }}>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>No hay operarios disponibles.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
                  {operarios
                    .slice()
                    .sort((a, b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                    .map(o => {
                      const selected = selectedOperario?.uid === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setSelectedOperario(selected ? null : { uid: o.id, nombre: o.nombre || o.email || "Operario" })}
                          disabled={saving}
                          style={{
                            display: "flex", alignItems: "center", gap: "12px",
                            padding: "14px 16px", textAlign: "left", width: "100%",
                            background: selected ? "#eff6ff" : "#fff",
                            border: `1.5px solid ${selected ? "#3b82f6" : "#e2e8f0"}`,
                            borderRadius: "12px", cursor: "pointer",
                            transition: "all 0.15s ease",
                            boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
                          }}
                        >
                          <div style={{
                            width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                            background: selected ? "#3b82f6" : "#f1f5f9",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "0.85rem", fontWeight: 700, color: selected ? "#fff" : "#64748b",
                            transition: "all 0.15s ease",
                          }}>
                            {(o.nombre || o.email || "?")[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: selected ? "#1d4ed8" : "#1e293b" }}>
                              {o.nombre || o.email}
                            </p>
                            {o.deposito && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>Depósito {o.deposito}</p>}
                          </div>
                          {selected && (
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
                              <circle cx="9" cy="9" r="9" fill="#3b82f6"/>
                              <path d="M5 9l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── CTA fijo — confirmar cambio de operario ── */}
        {cambiandoOperario && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              type="button"
              disabled={!selectedOperario || saving}
              onClick={async () => {
                try {
                  setSaving(true);
                  await asignarOperario(id, selectedOperario.uid, selectedOperario.nombre || "Operario");
                  toast.success("Operario reasignado");
                  setPedido(prev => prev ? { ...prev, operarioId: selectedOperario.uid, operarioNombre: selectedOperario.nombre } : prev);
                  setCambiandoOperario(false);
                  setSelectedOperario(null);
                } catch (e) {
                  console.error(e);
                  toast.error("No se pudo reasignar el operario");
                } finally {
                  setSaving(false);
                }
              }}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                fontWeight: 700, fontSize: "1rem",
                background: selectedOperario ? "#0f172a" : "#e2e8f0",
                color: selectedOperario ? "#fff" : "#94a3b8",
                cursor: selectedOperario ? "pointer" : "not-allowed",
                transition: "all 0.2s ease",
              }}
            >
              {saving ? "Guardando…" : selectedOperario ? `Reasignar a ${selectedOperario.nombre}` : "Elegí un operario"}
            </button>
          </div>
        )}
      </div>
    );
  }
  // ── Fin vista ASIGNADO encargado ─────────────────────────────────────────

  // ── Vista ASIGNADO — OPERARIO (mobile-first) ──────────────────────────────
  if (pedido.estado === ESTADOS.ASIGNADO && (!isEncargado || isSelfAssigned) && !isVentas) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    async function onComenzarPreparacion() {
      try {
        setSaving(true);
        await updateEstado(id, ESTADOS.EN_PREPARACION);
        setPedido(prev => prev ? { ...prev, estado: ESTADOS.EN_PREPARACION } : prev);
        toast.success("Preparación iniciada");
      } catch (e) {
        console.error(e);
        toast.error(e?.message || "No se pudo iniciar la preparación");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dbeafe", color: "#1e40af", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              ASIGNADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Tu tarea ── */}
          <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: "14px", padding: "16px 18px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ flexShrink: 0, width: "44px", height: "44px", borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
              📋
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#1e40af" }}>
                Este pedido está asignado a vos
              </p>
              <p style={{ margin: "3px 0 0", fontSize: "0.8rem", color: "#3b82f6" }}>
                {productos.length} producto{productos.length !== 1 ? "s" : ""} para preparar
              </p>
            </div>
          </div>

          {/* ── Productos ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido del pedido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", marginBottom: "12px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, padding: "16px", color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const color  = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                      {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                    </div>
                    <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CTA fijo ── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "14px 16px 24px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 20px rgba(0,0,0,0.08)" }}>
          <button
            type="button"
            onClick={onComenzarPreparacion}
            disabled={saving}
            style={{
              width: "100%", padding: "16px",
              borderRadius: "14px", border: "none",
              fontWeight: 800, fontSize: "1.05rem",
              background: saving ? "#e2e8f0" : "#f59e0b",
              color: saving ? "#94a3b8" : "#fff",
              cursor: saving ? "not-allowed" : "pointer",
              boxShadow: saving ? "none" : "0 4px 16px rgba(245,158,11,0.35)",
              transition: "all 0.15s ease",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            {saving ? (
              <>
                <span style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid #94a3b8", borderTopColor: "transparent", display: "inline-block" }} />
                Iniciando…
              </>
            ) : (
              "🟡 Comenzar preparación"
            )}
          </button>
        </div>
      </div>
    );
  }
  // ── Fin vista ASIGNADO operario ───────────────────────────────────────────

  // ── Vista especial EN_PREPARACION para encargado ─────────────────────────
  // (Omitir si es autoasignado: cae al main return con EncPreparacionPanel)
  if (pedido.estado === ESTADOS.EN_PREPARACION && isEncargado && !isSelfAssigned) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const problema = pedido.problema || null;
    const tieneProblemaActivo = problema && problema.estado === "PENDIENTE";
    const tieneProblemaElevado = problema && problema.estado === "ELEVADO";
    const tieneProblemaRevisado = problema && problema.estado === "REVISADO";

    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const elapsedPrep = getElapsedStr(pedido.timestamps?.EN_PREPARACION || pedido.timestamps?.ASIGNADO);

    async function marcarProblemaRevisado() {
      try {
        setSavingProblema(true);
        await updateDoc(doc(db, "pedidos", pedido.id || id), {
          "problema.estado": "REVISADO",
        });
        setPedido(prev => prev ? { ...prev, problema: { ...prev.problema, estado: "REVISADO" } } : prev);
      } catch (e) {
        toast.error("No se pudo marcar como revisado");
      } finally {
        setSavingProblema(false);
      }
    }

    async function confirmarElevacion() {
      try {
        setSavingProblema(true);
        await updateDoc(doc(db, "pedidos", pedido.id || id), {
          "problema.estado": "ELEVADO",
          "problema.notaEncargado": notaElevacion.trim(),
          "problema.elevadoAt": serverTimestamp(),
        });
        setPedido(prev => prev ? {
          ...prev,
          problema: { ...prev.problema, estado: "ELEVADO", notaEncargado: notaElevacion.trim() },
        } : prev);
        setElevarProblema(false);
        setNotaElevacion("");
        toast.success("Problema elevado al vendedor");
      } catch (e) {
        toast.error("No se pudo elevar el problema");
      } finally {
        setSavingProblema(false);
      }
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: elevarProblema ? "120px" : "24px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef9c3", color: "#854d0e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              EN PREPARACIÓN
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Banner de problema activo ── */}
          {tieneProblemaActivo && (
            <div style={{ background: "#fff7ed", border: "1.5px solid #fb923c", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.92rem", color: "#9a3412" }}>
                  Problema reportado por {problema.reportadoNombre || "el operario"}
                </p>
                <span style={{ marginLeft: "auto", flexShrink: 0, background: problema.tipo === "FALTA_STOCK" ? "#fef2f2" : "#fef3c7", color: problema.tipo === "FALTA_STOCK" ? "#dc2626" : "#92400e", fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {problema.tipo === "FALTA_STOCK" ? "Falta stock" : "Otro"}
                </span>
              </div>
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#7c2d12", fontWeight: 600 }}>
                Producto: {problema.productoNombre || "—"}
              </p>
              {problema.descripcion && (
                <p style={{ margin: "4px 0 12px", fontSize: "0.82rem", color: "#9a3412", fontStyle: "italic" }}>
                  "{problema.descripcion}"
                </p>
              )}

              {!elevarProblema ? (
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={marcarProblemaRevisado}
                    disabled={savingProblema}
                    style={{ flex: 1, padding: "10px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#475569", cursor: "pointer" }}
                  >
                    {savingProblema ? "…" : "Marcar revisado"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setElevarProblema(true)}
                    style={{ flex: 1, padding: "10px", background: "#dc2626", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#fff", cursor: "pointer" }}
                  >
                    Elevar al vendedor
                  </button>
                </div>
              ) : (
                <div>
                  <textarea
                    value={notaElevacion}
                    onChange={e => setNotaElevacion(e.target.value)}
                    placeholder="Agregá una nota para el vendedor (opcional)…"
                    style={{ width: "100%", minHeight: "70px", padding: "10px", border: "1.5px solid #fca5a5", borderRadius: "10px", fontSize: "0.85rem", resize: "none", boxSizing: "border-box", marginBottom: "8px", background: "#fff" }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => { setElevarProblema(false); setNotaElevacion(""); }}
                      style={{ flex: 1, padding: "10px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#475569", cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmarElevacion}
                      disabled={savingProblema}
                      style={{ flex: 1, padding: "10px", background: "#dc2626", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "0.82rem", color: "#fff", cursor: "pointer" }}
                    >
                      {savingProblema ? "Enviando…" : "Confirmar y elevar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Banner problema elevado ── */}
          {tieneProblemaElevado && (
            <div style={{ background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📨</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem", color: "#1e40af" }}>
                  Problema elevado al vendedor
                </p>
                {problema.notaEncargado && (
                  <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#3b82f6", fontStyle: "italic" }}>"{problema.notaEncargado}"</p>
                )}
              </div>
            </div>
          )}

          {/* ── Banner problema revisado ── */}
          {tieneProblemaRevisado && (
            <div style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>✓</span>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem", color: "#64748b" }}>
                  Problema revisado — en seguimiento
                </p>
              </div>
            </div>
          )}

          {/* ── Operario preparando ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Preparando el pedido
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", flexShrink: 0,
                background: "#f59e0b",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem", fontWeight: 700, color: "#fff",
              }}>
                {avatarInitial}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>
                  {operarioNombre}
                </p>
                {elapsedPrep && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                    🕐 Preparando {elapsedPrep}
                  </p>
                )}
              </div>
              <div style={{ flexShrink: 0, width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 0 3px #fef3c7" }} />
            </div>
          </div>

          {/* ── Productos del pedido ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.slice(0, 5).map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                const esProblemático = problema && problema.productoIdx === i;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < Math.min(productos.length, 5) - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: esProblemático ? "#dc2626" : "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {esProblemático && "⚠️ "}{nombre}
                    </p>
                    <span style={{ flexShrink: 0, background: esProblemático ? "#fef2f2" : "#f1f5f9", color: esProblemático ? "#dc2626" : "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>
                      ×{qty}
                    </span>
                  </div>
                );
              })
            )}
            {productos.length > 5 && (
              <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>
                y {productos.length - 5} más…
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
  // ── Fin vista EN_PREPARACION encargado ───────────────────────────────────

  // ── Vista EN_PREPARACION — OPERARIO (mobile-first, usa EncPreparacionPanel) ──
  if (pedido.estado === ESTADOS.EN_PREPARACION && (!isEncargado || isSelfAssigned) && !isVentas) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px", position: "sticky", top: 0, zIndex: 20 }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.25rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef9c3", color: "#854d0e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              EN PREPARACIÓN
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        {/* ── Panel interactivo de preparación ── */}
        <EncPreparacionPanel
          pedido={pedido}
          productos={productos}
          catalogIndex={catalogoMap}
          btnFinalizarLabel={isIsabela ? "Pedido completado" : undefined}
          onReportarError={async ({ productos: prodsError }) => { await submitErrorPreparacion(prodsError); }}
          onPreparacionFinalizada={async () => {
            try {
              const nextEstado = isIsabela ? ESTADOS.CONTROLADO : ESTADOS.PREPARADO;
              await updateEstado(id, nextEstado);
              if (isIsabela) {
                toast.success("Pedido listo para despachar ✓");
                navigate("/pedidos");
              } else {
                setPedido(prev => prev ? { ...prev, estado: nextEstado } : prev);
                toast.success("Pedido preparado ✓");
              }
            } catch (e) {
              toast.error(e?.message || "No se pudo finalizar la preparación");
            }
          }}
        />
      </div>
    );
  }
  // ── Fin vista EN_PREPARACION operario ─────────────────────────────────────

  // ── Vista especial PREPARADO para encargado ──────────────────────────────
  if (pedido.estado === ESTADOS.PREPARADO && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    // Todos los productos requieren verificación explícita del encargado
    const allAccChecked = productos.length === 0 ||
      productos.every((_, i) => !!accChecks[`ctrl-${i}`]);

    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const operarioNombre = pedido.operarioNombre || "Operario";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const elapsedPrep = getElapsedStr(pedido.timestamps?.PREPARADO);

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "88px" }}>

        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dcfce7", color: "#166534", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              PREPARADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {formatFecha(pedido.finFecha)}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
            {pedido.deposito && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🏭 {pedido.deposito}
              </span>
            )}
          </div>
        </div>

        <div style={{ padding: "16px" }}>

          {/* ── Preparado por ── */}
          <p style={{ margin: "0 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Preparado por
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
                {avatarInitial}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>{operarioNombre}</p>
                {elapsedPrep && (
                  <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>✓ Listo {elapsedPrep}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Checklist de control — todos los productos ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Verificar · {productos.length} producto{productos.length !== 1 ? "s" : ""}
            </p>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: allAccChecked ? "#16a34a" : "#3b82f6" }}>
              {productos.filter((_, i) => !!accChecks[`ctrl-${i}`]).length}/{productos.length}
            </span>
          </div>

          {/* Barra de progreso */}
          {productos.length > 0 && (
            <div style={{ height: "4px", background: "#e2e8f0", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
              <div style={{
                height: "100%", borderRadius: "999px",
                background: allAccChecked ? "#16a34a" : "#3b82f6",
                width: `${Math.round((productos.filter((_, i) => !!accChecks[`ctrl-${i}`]).length / productos.length) * 100)}%`,
                transition: "width 0.25s ease, background 0.25s ease",
              }} />
            </div>
          )}

          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", marginBottom: "12px" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, padding: "16px", color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.map((it, i) => {
                const key = `ctrl-${i}`;
                const checked = !!accChecks[key];
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAccChecks(prev => ({ ...prev, [key]: !prev[key] }))}
                    style={{
                      display: "flex", alignItems: "center", gap: "14px",
                      width: "100%", textAlign: "left",
                      padding: "13px 16px",
                      background: checked ? "#f0fdf4" : "#fff",
                      border: "none", cursor: "pointer",
                      borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none",
                      transition: "background 0.12s ease",
                    }}
                  >
                    <div style={{
                      flexShrink: 0, width: "26px", height: "26px", borderRadius: "50%",
                      border: `2px solid ${checked ? "#16a34a" : "#cbd5e1"}`,
                      background: checked ? "#16a34a" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.12s ease",
                    }}>
                      {checked && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        margin: 0, fontSize: "0.88rem", fontWeight: checked ? 400 : 500,
                        color: checked ? "#94a3b8" : "#1e293b",
                        textDecoration: checked ? "line-through" : "none",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        transition: "all 0.12s ease",
                      }}>{nombre}</p>
                      {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                    </div>
                    <span style={{
                      flexShrink: 0, fontWeight: 700, fontSize: "0.82rem",
                      padding: "3px 10px", borderRadius: "8px",
                      background: checked ? "#dcfce7" : "#f1f5f9",
                      color: checked ? "#15803d" : "#475569",
                      transition: "all 0.12s ease",
                    }}>
                      ×{qty}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* ── Datos de preparación ── */}
          <p style={{ margin: "4px 0 10px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Datos de preparación
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>Bultos</label>
                <input
                  type="number" min="0"
                  value={bultos}
                  onChange={e => setBultos(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "1rem", fontWeight: 600, textAlign: "center", boxSizing: "border-box" }}
                  placeholder="0"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: "6px" }}>Paquetes</label>
                <input
                  type="number" min="0"
                  value={paquetes}
                  onChange={e => setPaquetes(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "1rem", fontWeight: 600, textAlign: "center", boxSizing: "border-box" }}
                  placeholder="0"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={guardarBultosYPaquetes}
              style={{ marginTop: "10px", width: "100%", padding: "9px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600, color: "#475569", cursor: "pointer" }}
            >
              Guardar datos
            </button>
          </div>
        </div>

        {/* ── CTA fijo ── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
          {pedido.deposito === "ISABELA" ? (
            // ISABELA: no hay paso de control del encargado — ventas despacha directamente desde PREPARADO
            <div style={{
              background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "14px",
              padding: "14px 16px", textAlign: "center",
            }}>
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#15803d" }}>
                ✅ Pedido listo para despachar
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                El usuario ventas realizará el despacho
              </p>
            </div>
          ) : (
            // R8: el encargado confirma el control antes de que ventas despache
            <>
              {!allAccChecked && productos.length > 0 && (
                <p style={{ margin: "0 0 8px", textAlign: "center", fontSize: "0.78rem", color: "#94a3b8" }}>
                  {(() => { const pend = productos.filter((_, i) => !accChecks[`ctrl-${i}`]).length; return `Verificá ${pend} producto${pend !== 1 ? "s" : ""} pendiente${pend !== 1 ? "s" : ""}`; })()}
                </p>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    setSaving(true);
                    await updateDoc(doc(db, "pedidos", id), { prepAccesoriosOk: true });
                    await updateEstado(id, ESTADOS.CONTROLADO);
                    haptics?.success?.();
                    toast.success("Pedido controlado ✓");
                    setPedido(prev => prev ? { ...prev, estado: ESTADOS.CONTROLADO } : prev);
                  } catch (e) {
                    toast.error("No se pudo confirmar el control");
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={!allAccChecked || saving}
                style={{
                  width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                  fontWeight: 700, fontSize: "1rem",
                  background: allAccChecked ? "#0f172a" : "#e2e8f0",
                  color: allAccChecked ? "#fff" : "#94a3b8",
                  cursor: allAccChecked ? "pointer" : "not-allowed",
                  transition: "all 0.2s ease",
                }}
              >
                {saving ? "Confirmando…" : "✓ Confirmar control"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  // ── Fin vista PREPARADO ───────────────────────────────────────────────────

  // ── Vista CONTROLADO — ENCARGADO (solo info) ─────────────────────────────
  if (pedido.estado === ESTADOS.CONTROLADO && isEncargado) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const operarioNombre = pedido.operarioNombre || "—";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "24px" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#ede9fe", color: "#5b21b6", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
              CONTROLADO
            </span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>
        <div style={{ padding: "16px" }}>
          {/* Estado */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "14px", padding: "14px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.4rem" }}>✅</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#166534" }}>Pedido controlado y listo para despacho</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#16a34a" }}>El equipo de ventas realizará el despacho</p>
            </div>
          </div>
          {/* Preparado por */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Preparado por</p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avatarInitial}</div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: "0.92rem", color: "#0f172a" }}>{operarioNombre}</p>
              {pedido.bultos > 0 && <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📦 {pedido.bultos} bultos</span>}
              {pedido.paquetes > 0 && <span style={{ fontSize: "0.78rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📫 {pedido.paquetes} paquetes</span>}
            </div>
          </div>
          {/* Productos */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}</p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "12px 16px" }}>
            {productos.map((it, i) => {
              const raw = it.cod || it.descripcion || it.desc || "";
              const uru = toURUCode(raw);
              const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
              const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                  <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>×{qty}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  // ── Fin vista CONTROLADO encargado ────────────────────────────────────────

  // ── Vista CON_ERROR — ENCARGADO R8 (revisa y decide antes de escalar a ventas) ──
  if (pedido.estado === ESTADOS.CON_ERROR && isEncargado && pedido.deposito === "R8") {
    const productos  = Array.isArray(pedido.productos) ? pedido.productos : [];
    const errorProds = Array.isArray(pedido.errorProductos) && pedido.errorProductos.length > 0
      ? pedido.errorProductos
      : pedido.errorProductoNombre
        ? [{ cod: pedido.errorProductoCod || null, nombre: pedido.errorProductoNombre, tipo: null }]
        : [];
    const TIPO_LABELS = { sin_stock: "Sin stock", danado: "Dañado / abollado", hay_menos: "Hay menos de lo pedido" };

    async function handleConfirmarError() {
      try {
        setSaving(true);
        await updateEstado(id, ESTADOS.ERROR_CONFIRMADO);
        toast.success("Error confirmado — ventas fue notificado");
      } catch (e) {
        console.error(e);
        toast.error(e?.message || "No se pudo confirmar el error");
      } finally {
        setSaving(false);
      }
    }

    async function handleDevolverPreparacion() {
      try {
        setSaving(true);
        await updateEstado(id, ESTADOS.EN_PREPARACION, {
          errorDetalle: null, errorProductoCod: null,
          errorProductoNombre: null, errorProductos: [],
        });
        toast.success("Pedido devuelto a preparación");
      } catch (e) {
        console.error(e);
        toast.error(e?.message || "No se pudo devolver el pedido");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={() => navigate("/pedidos")}
              style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}>
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.72rem", color: "#94a3b8" }}>Pedido #{pedido.numero || id}</p>
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pedido.cliente || "—"}
              </p>
            </div>
            <span style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: "999px", padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, color: "#c2410c", flexShrink: 0 }}>
              ⚠️ Error · revisar
            </span>
          </div>
        </div>

        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "16px 20px 100px" }}>

          {/* Info básica */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
              <div>
                <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: "#0f172a" }}>#{pedido.numero || id}</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.95rem", color: "#334155" }}>{pedido.cliente || "—"}</p>
              </div>
              {pedido.operarioNombre && (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: "0.68rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Preparado por</p>
                  <p style={{ margin: "2px 0 0", fontSize: "0.85rem", fontWeight: 700, color: "#334155" }}>👤 {pedido.operarioNombre}</p>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {pedido.finFecha}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            </div>
          </div>

          {/* ── Nota del operario ── */}
          {pedido.errorDetalle && (
            <div style={{ background: "#fef3c7", border: "1.5px solid #fde68a", borderRadius: "14px", padding: "14px 16px", marginBottom: "14px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                📝 Nota del operario
              </p>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#78350f", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {pedido.errorDetalle}
              </p>
            </div>
          )}

          {/* ── Lista de productos ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", marginBottom: "14px" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Productos · {productos.length}
              </span>
              {errorProds.length > 0 && (
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c" }}>
                  {errorProds.length} con error
                </span>
              )}
            </div>

            {productos.map((it, i) => {
              const cod     = it.cod || it.codigo || "";
              const nombre  = it.descripcion || it.desc || it.nombre || cod || "—";
              const qty     = it.cant ?? it.cantidad ?? it.qty ?? 0;
              const errInfo = errorProds.find(p => (p.cod && p.cod === cod) || p.nombre === nombre);

              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "12px 16px",
                  borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none",
                  background: errInfo ? "#fff1f2" : "#fff",
                  borderLeft: `4px solid ${errInfo ? "#dc2626" : "transparent"}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: errInfo ? 700 : 400, color: errInfo ? "#991b1b" : "#475569" }}>
                      {nombre}
                    </p>
                  </div>
                  {/* Error label al costado del nombre */}
                  {errInfo?.tipo && (
                    <span style={{
                      flexShrink: 0, fontSize: "0.72rem", fontWeight: 700,
                      color: "#b91c1c", background: "#fee2e2",
                      border: "1px solid #fca5a5",
                      padding: "2px 8px", borderRadius: "999px",
                      whiteSpace: "nowrap",
                    }}>
                      {TIPO_LABELS[errInfo.tipo] || errInfo.tipo}
                      {errInfo.tipo === "hay_menos" && errInfo.cant ? ` (${errInfo.cant})` : ""}
                    </span>
                  )}
                  <span style={{
                    flexShrink: 0, fontWeight: 700, fontSize: "0.82rem",
                    padding: "3px 9px", borderRadius: "8px",
                    background: errInfo ? "#fecaca" : "#f1f5f9",
                    color: errInfo ? "#991b1b" : "#94a3b8",
                  }}>
                    ×{qty}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Botones fijos */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 20px 24px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)", display: "flex", gap: "10px" }}>
          <button
            onClick={handleDevolverPreparacion}
            disabled={saving}
            style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "1.5px solid #e2e8f0", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.9rem", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
          >
            🔄 Devolver a preparación
          </button>
          <button
            onClick={handleConfirmarError}
            disabled={saving}
            style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none", background: saving ? "#e2e8f0" : "#dc2626", color: saving ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 2px 8px rgba(220,38,38,0.3)" }}
          >
            🔴 Confirmar error → ventas
          </button>
        </div>
      </div>
    );
  }
  // ── Fin vista CON_ERROR encargado R8 ─────────────────────────────────────

  // ── Vista CON_ERROR — VENTAS (solo ISABELA: el error va directo a ventas) ──
  if (pedido.estado === ESTADOS.CON_ERROR && isVentas && pedido.deposito === "ISABELA") {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const TIPO_LABELS = { sin_stock: "No hay stock", danado: "Dañado / abollado", hay_menos: "Hay menos de lo pedido" };

    // Usar errorProductos (nuevo) o construir desde campos legacy
    const errorProds = Array.isArray(pedido.errorProductos) && pedido.errorProductos.length > 0
      ? pedido.errorProductos
      : pedido.errorProductoNombre
        ? [{ cod: pedido.errorProductoCod || null, nombre: pedido.errorProductoNombre, tipo: null }]
        : [];

    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      return isNaN(d) ? f : d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
    };

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
        {/* ── Header ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => navigate("/ventas/para-despachar")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}
            >
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.72rem", color: "#94a3b8" }}>
                Pedido #{pedido.numero || id}
              </p>
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pedido.cliente || "—"}
              </p>
            </div>
            <span style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: "999px", padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, color: "#ea580c", flexShrink: 0 }}>
              ⚠️ CON ERROR
            </span>
          </div>
        </div>

        <div style={{ maxWidth: "860px", margin: "0 auto", padding: "20px" }}>

          {/* ── Info del pedido ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px", marginBottom: "16px" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a" }}>
              #{pedido.numero || id}
            </h2>
            <p style={{ margin: "0 0 10px", fontSize: "1rem", color: "#334155" }}>{pedido.cliente || "—"}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
              {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
            </div>
          </div>

          {/* ── Banner de error ── */}
          <div style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: "14px", padding: "16px 20px", marginBottom: "16px" }}>
            <p style={{ margin: "0 0 6px", fontSize: "0.78rem", fontWeight: 700, color: "#ea580c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              ⚠️ Error en preparación
            </p>
            <p style={{ margin: 0, fontSize: "0.88rem", color: "#9a3412", lineHeight: 1.5 }}>
              El encargado detectó problemas con este pedido. Hacé la corrección en Finnegans — cuando se sincronice, el pedido volverá a <strong>Pendiente de preparar</strong> automáticamente.
            </p>
          </div>

          {/* ── Lista de productos ── */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", marginBottom: "16px" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
              </span>
              {errorProds.length > 0 && (
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#ea580c" }}>
                  {errorProds.length} con error
                </span>
              )}
            </div>

            {productos.map((it, i) => {
              const cod = it.cod || it.codigo || it.codigoURU || "";
              const nombre = it.descripcion || it.desc || it.nombre || cod || "—";
              const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
              const errInfo = errorProds.find(p =>
                (p.cod && p.cod === cod) || p.nombre === nombre
              );
              const hasError = !!errInfo;

              return (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: "12px",
                  padding: "12px 16px",
                  borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none",
                  background: hasError ? "#fff7ed" : "#fff",
                  borderLeft: `4px solid ${hasError ? "#ea580c" : "transparent"}`,
                  transition: "background 0.1s",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: hasError ? 700 : 500, color: hasError ? "#9a3412" : "#1e293b" }}>
                      {hasError && <span style={{ marginRight: "4px" }}>⚠️</span>}
                      {nombre}
                    </p>
                    {hasError && errInfo.tipo && (
                      <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#c2410c", fontWeight: 600 }}>
                        {TIPO_LABELS[errInfo.tipo] || errInfo.tipo}
                        {errInfo.tipo === "hay_menos" && errInfo.cant ? ` · disponibles: ${errInfo.cant}` : ""}
                      </p>
                    )}
                    {hasError && !errInfo.tipo && (
                      <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#c2410c", fontStyle: "italic" }}>
                        Producto con error
                      </p>
                    )}
                  </div>
                  <span style={{
                    flexShrink: 0, fontWeight: 700, fontSize: "0.82rem",
                    padding: "3px 9px", borderRadius: "8px",
                    background: hasError ? "#fed7aa" : "#f1f5f9",
                    color: hasError ? "#9a3412" : "#475569",
                  }}>
                    ×{qty}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── Nota del encargado (si hay) ── */}
          {pedido.errorDetalle && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Nota del encargado
              </p>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {pedido.errorDetalle}
              </p>
            </div>
          )}

          {/* ── Cancelar pedido (ventas) ── */}
          {puedeVentasCancelar && (
            <button
              type="button"
              onClick={abrirCancelModal}
              style={{ marginTop: "4px", width: "100%", padding: "11px", borderRadius: "10px", border: "1.5px solid #fca5a5", background: "#fef2f2", color: "#dc2626", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}
            >
              ✕ Cancelar pedido
            </button>
          )}
        </div>

        {renderCancelModal()}
      </div>
    );
  }
  // ── Fin vista CON_ERROR ventas (ISABELA) ──────────────────────────────────

  // ── Vista ERROR_CONFIRMADO — R8 (ventas ve el error confirmado; encargado puede resolver) ──
  if (pedido.estado === ESTADOS.ERROR_CONFIRMADO && pedido.deposito === "R8") {
    const productos  = Array.isArray(pedido.productos) ? pedido.productos : [];
    const errorProds = Array.isArray(pedido.errorProductos) && pedido.errorProductos.length > 0
      ? pedido.errorProductos
      : pedido.errorProductoNombre
        ? [{ cod: pedido.errorProductoCod || null, nombre: pedido.errorProductoNombre, tipo: null }]
        : [];
    const TIPO_LABELS = { sin_stock: "Sin stock", danado: "Dañado / abollado", hay_menos: "Hay menos de lo pedido" };

    async function handleResolverError() {
      try {
        setSaving(true);
        await updateEstado(id, ESTADOS.EN_PREPARACION, {
          errorDetalle: null, errorProductoCod: null,
          errorProductoNombre: null, errorProductos: [],
        });
        toast.success("Pedido devuelto a preparación");
      } catch (e) {
        console.error(e);
        toast.error(e?.message || "No se pudo resolver el error");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => navigate(isVentas ? "/ventas/para-despachar" : "/pedidos")}
              style={{ width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}>
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.72rem", color: "#94a3b8" }}>Pedido #{pedido.numero || id}</p>
              <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pedido.cliente || "—"}
              </p>
            </div>
            <span style={{ background: "#fff1f2", border: "1.5px solid #fca5a5", borderRadius: "999px", padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c", flexShrink: 0 }}>
              🔴 Con error
            </span>
          </div>
        </div>

        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "16px 20px 100px" }}>

          {/* Info básica */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 2px", fontSize: "1.25rem", fontWeight: 800, color: "#0f172a" }}>#{pedido.numero || id}</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.95rem", color: "#334155" }}>{pedido.cliente || "—"}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {pedido.finFecha}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
              {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
            </div>
          </div>

          {/* Banner según rol */}
          {isVentas ? (
            <div style={{ background: "#fff1f2", border: "1.5px solid #fca5a5", borderRadius: "14px", padding: "16px 20px", marginBottom: "14px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "0.78rem", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                🔴 Error confirmado — acción requerida
              </p>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "#7f1d1d", lineHeight: 1.5 }}>
                El encargado confirmó el error. Hacé la corrección en <strong>Finnegans</strong> y avisale al encargado para que devuelva el pedido a preparación.
              </p>
            </div>
          ) : (
            <div style={{ background: "#fff1f2", border: "1.5px solid #fca5a5", borderRadius: "14px", padding: "16px 20px", marginBottom: "14px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "0.78rem", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Esperando corrección de ventas
              </p>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "#7f1d1d", lineHeight: 1.5 }}>
                Ventas está corrigiendo el pedido en Finnegans. Una vez resuelto, usá el botón para devolver al operario.
              </p>
            </div>
          )}

          {/* Nota del encargado */}
          {pedido.errorDetalle && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "14px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Nota del encargado</p>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{pedido.errorDetalle}</p>
            </div>
          )}

          {/* Productos */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Productos · {productos.length}
              </span>
              {errorProds.length > 0 && (
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c", background: "#fff1f2", border: "1px solid #fca5a5", borderRadius: "999px", padding: "2px 8px" }}>
                  {errorProds.length} con error
                </span>
              )}
            </div>
            {productos.map((it, i) => {
              const cod     = it.cod || it.codigo || "";
              const nombre  = it.descripcion || it.desc || it.nombre || cod || "—";
              const qty     = it.cant ?? it.cantidad ?? it.qty ?? 0;
              const errInfo = errorProds.find(p => (p.cod && p.cod === cod) || p.nombre === nombre);
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: "12px",
                  padding: "12px 16px",
                  borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none",
                  background: errInfo ? "#fff1f2" : "#fff",
                  borderLeft: `4px solid ${errInfo ? "#b91c1c" : "transparent"}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: errInfo ? 700 : 500, color: errInfo ? "#7f1d1d" : "#1e293b" }}>
                      {errInfo && <span style={{ marginRight: "4px" }}>🔴</span>}{nombre}
                    </p>
                    {errInfo?.tipo && (
                      <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#b91c1c", fontWeight: 600 }}>
                        {TIPO_LABELS[errInfo.tipo] || errInfo.tipo}
                        {errInfo.tipo === "hay_menos" && errInfo.cant ? ` · disponibles: ${errInfo.cant}` : ""}
                      </p>
                    )}
                  </div>
                  <span style={{ flexShrink: 0, fontWeight: 700, fontSize: "0.82rem", padding: "3px 9px", borderRadius: "8px", background: errInfo ? "#fecaca" : "#f1f5f9", color: errInfo ? "#7f1d1d" : "#475569" }}>
                    ×{qty}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Botón fijo — solo encargado puede resolver */}
        {isEncargado && (
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 20px 24px", background: "#fff", borderTop: "1px solid #e2e8f0", boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <button
              onClick={handleResolverError}
              disabled={saving}
              style={{ width: "100%", padding: "15px", borderRadius: "12px", border: "none", background: saving ? "#e2e8f0" : "#0f172a", color: saving ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: "0.95rem", cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 2px 8px rgba(15,23,42,0.18)" }}
            >
              {saving ? "Procesando…" : "🔄 Devolver a preparación"}
            </button>
          </div>
        )}

        {renderCancelModal()}
      </div>
    );
  }
  // ── Fin vista ERROR_CONFIRMADO R8 ─────────────────────────────────────────

  // ── Vista PREPARADO/CONTROLADO — VENTAS (detalle completo + despacho) ──────
  // ISABELA despacha desde PREPARADO; R8 despacha desde CONTROLADO.
  if ((pedido.estado === ESTADOS.CONTROLADO || pedido.estado === ESTADOS.PREPARADO) && isVentas) {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const getElapsedStr = (ts) => {
      if (!ts) return null;
      const at = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(at)) return null;
      const mins = Math.floor((Date.now() - at.getTime()) / 60000);
      if (mins < 1) return "hace menos de 1 min";
      if (mins < 60) return `hace ${mins} min`;
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `hace ${hrs}h ${rem}min` : `hace ${hrs}h`;
    };
    const { operario: prodsOperario, encargado: prodsEncargado } = splitPorCategoria(productos, catalogoMap);
    const operarioNombre = pedido.operarioNombre || "—";
    const avatarInitial = operarioNombre[0]?.toUpperCase() || "?";
    const preparadoElapsed = getElapsedStr(pedido.timestamps?.PREPARADO);

    // Timeline de estados — simplificado para ISABELA (sin ASIGNADO ni CONTROLADO)
    const esIsabela = pedido.deposito === "ISABELA";
    const timelineEstados = esIsabela
      ? [
          { key: "PENDIENTE_ASIGNAR", label: "Ingresó" },
          { key: "EN_PREPARACION", label: "En preparación" },
          { key: "PREPARADO", label: "Preparado" },
        ]
      : [
          { key: "PENDIENTE_ASIGNAR", label: "Ingresó" },
          { key: "ASIGNADO", label: "Asignado" },
          { key: "EN_PREPARACION", label: "En preparación" },
          { key: "PREPARADO", label: "Preparado" },
          { key: "CONTROLADO", label: "Controlado" },
        ];

    /* ── helper: lista de productos reutilizable ── */
    const ProductList = ({ items, accentBg, accentColor, borderColor }) => (
      <div style={{ background: "#fff", border: `1.5px solid ${borderColor}`, borderRadius: "14px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: `1px solid ${borderColor}` }}>
              <th style={{ padding: "8px 14px", textAlign: "left", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Descripción</th>
              <th style={{ padding: "8px 14px", textAlign: "right", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Cant.</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ it, uru }, i) => {
              const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
              const color = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
              const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
              return (
                <tr key={i} style={{ borderBottom: i < items.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <td style={{ padding: "10px 14px", verticalAlign: "middle" }}>
                    <p style={{ margin: 0, fontWeight: 600, color: "#1e293b" }}>{nombre}</p>
                    {color && <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right", verticalAlign: "middle" }}>
                    <span style={{ background: accentBg, color: accentColor, fontWeight: 700, fontSize: "0.85rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

    return (
      <div style={{ background: "#f1f5f9", minHeight: "100vh" }}>

        {/* ── Header sticky ── */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", gap: "14px" }}>
            <button
              type="button"
              onClick={() => navigate("/ventas/pipeline")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", flexShrink: 0, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem" }}
            >
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "1px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pedido.cliente || "—"}</h1>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", flexShrink: 0 }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🚚 {pedido.metodoEntrega}</span>}
              {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🏭 {pedido.deposito}</span>}
              <span style={{ background: "#ede9fe", color: "#5b21b6", fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", letterSpacing: "0.05em" }}>LISTO P/ DESPACHO</span>
              {renderVentasCancelBtn()}
            </div>
          </div>
        </div>

        {/* ── Layout: main + aside ── */}
        <div style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "24px 24px 40px",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: "24px",
          alignItems: "start",
        }}>

          {/* ════ COLUMNA IZQUIERDA ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Timeline */}
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px" }}>
              <p style={{ margin: "0 0 14px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Estado del pedido</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {timelineEstados.map(({ key, label }, i) => {
                  const ts = pedido.timestamps?.[key];
                  const at = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
                  const done = !!at && !isNaN(at);
                  const isCurrent = key === pedido.estado;
                  return (
                    <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                      {i > 0 && <div style={{ position: "absolute", top: "11px", right: "50%", left: "-50%", height: "2px", background: done ? "#a855f7" : "#e2e8f0", zIndex: 0 }} />}
                      <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: isCurrent ? "#7c3aed" : done ? "#a855f7" : "#e2e8f0", border: `2.5px solid ${isCurrent ? "#7c3aed" : done ? "#a855f7" : "#e2e8f0"}`, zIndex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {done && !isCurrent && <span style={{ fontSize: "0.6rem", color: "#fff" }}>✓</span>}
                      </div>
                      <p style={{ margin: "5px 0 0", fontSize: "0.68rem", fontWeight: isCurrent ? 800 : 500, color: isCurrent ? "#7c3aed" : done ? "#6d28d9" : "#94a3b8", textAlign: "center", lineHeight: 1.2 }}>{label}</p>
                      {done && <p style={{ margin: "2px 0 0", fontSize: "0.6rem", color: "#b8b8cc", textAlign: "center" }}>{at.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Info preparación */}
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px" }}>
              <p style={{ margin: "0 0 14px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Preparación</p>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avatarInitial}</div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>{operarioNombre}</p>
                  {preparadoElapsed && <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>Preparado {preparadoElapsed}</p>}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {[
                  { val: pedido.bultos, label: "Bultos" },
                  { val: pedido.paquetes, label: "Paquetes" },
                  { val: productos.length, label: "Ítems" },
                ].map(({ val, label }) => (
                  <div key={label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px", textAlign: "center" }}>
                    <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#0f172a" }}>{val ?? "—"}</p>
                    <p style={{ margin: "3px 0 0", fontSize: "0.68rem", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Productos — Perfiles/Kits */}
            {prodsOperario.length > 0 && (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Perfiles y kits · {prodsOperario.length} ítem{prodsOperario.length !== 1 ? "s" : ""}
                </p>
                <ProductList items={prodsOperario} accentBg="#dbeafe" accentColor="#1d4ed8" borderColor="#bfdbfe" />
              </div>
            )}

            {/* Productos — Accesorios/Otros */}
            {prodsEncargado.length > 0 && (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Accesorios y otros · {prodsEncargado.length} ítem{prodsEncargado.length !== 1 ? "s" : ""}
                </p>
                <ProductList items={prodsEncargado} accentBg="#ffedd5" accentColor="#c2410c" borderColor="#fed7aa" />
              </div>
            )}

            {/* Sin catálogo: lista genérica */}
            {Object.keys(catalogoMap).length === 0 && productos.length > 0 && (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Productos · {productos.length} ítems
                </p>
                <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <tbody>
                      {productos.map((it, i) => {
                        const raw = it.cod || it.descripcion || it.desc || "";
                        const uru = toURUCode(raw);
                        const nombre = it.descripcion || it.desc || it.nombre || uru || "—";
                        const qty = it.cant ?? it.cantidad ?? it.qty ?? 0;
                        return (
                          <tr key={i} style={{ borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                            <td style={{ padding: "10px 14px", color: "#1e293b", fontWeight: 500 }}>{nombre}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right" }}>
                              <span style={{ background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.85rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ════ COLUMNA DERECHA — aside sticky ════ */}
          <div style={{ position: "sticky", top: "76px", display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* Resumen rápido */}
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 18px" }}>
              <p style={{ margin: "0 0 12px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Resumen</p>
              {[
                { label: "Pedido", value: `#${pedido.numero || id}` },
                { label: "Cliente", value: pedido.cliente || "—" },
                { label: "Método", value: pedido.metodoEntrega || "—" },
                { label: "Depósito", value: pedido.deposito || "—" },
                { label: "Bultos", value: pedido.bultos ?? "—" },
                { label: "Operario", value: operarioNombre },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #f1f5f9", gap: "8px" }}>
                  <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontWeight: 500, flexShrink: 0 }}>{label}</span>
                  <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a", textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>

            {/* CTA: Despachar */}
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 18px" }}>
              <ConfirmarDespacho pedidoId={id} compact />
            </div>

            {/* Cancelar pedido */}
            {puedeVentasCancelar && (
              <button
                type="button"
                onClick={abrirCancelModal}
                style={{
                  width: "100%", padding: "10px", borderRadius: "10px",
                  border: "1.5px solid #fca5a5", background: "#fef2f2",
                  color: "#dc2626", fontSize: "0.82rem", fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✕ Cancelar pedido
              </button>
            )}
          </div>

        </div>{/* fin grid */}

        {renderCancelModal()}
      </div>
    );
  }
  // ── Fin vista CONTROLADO ventas ───────────────────────────────────────────

  // ── Vista ENTREGADO — encargado (mobile/tablet) y ventas (desktop) ─────────
  if (pedido.estado === "ENTREGADO" || pedido._source === "entregados") {
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    const formatFechaHora = (ts) => {
      if (!ts) return "—";
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d)) return "—";
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };

    const estadosTimeline = pedido.deposito === "ISABELA"
      ? ["PENDIENTE_ASIGNAR", "EN_PREPARACION", "CONTROLADO", "DESPACHADO", "ENTREGADO"]
      : ["PENDIENTE_ASIGNAR", "ASIGNADO", "EN_PREPARACION", "PREPARADO", "CONTROLADO", "DESPACHADO", "ENTREGADO"];
    const labelMap = {
      PENDIENTE_ASIGNAR: "Ingresó", ASIGNADO: "Asignado",
      EN_PREPARACION: "Preparando", PREPARADO: "Preparado",
      CONTROLADO: "Controlado", DESPACHADO: "Despachado", ENTREGADO: "Entregado",
    };

    if (isVentas) {
      // ── Desktop-first para ventas ──────────────────────────────────────────
      const operarioNombre = pedido.operarioNombre || "—";
      return (
        <div style={{ background: "#f1f5f9", minHeight: "100vh" }}>
          {/* Header sticky */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", alignItems: "center", gap: "14px" }}>
              <button type="button" onClick={() => navigate("/ventas/pipeline")}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", flexShrink: 0, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem" }}>
                ←
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
                <h1 style={{ margin: "1px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pedido.cliente || "—"}</h1>
              </div>
              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🚚 {pedido.metodoEntrega}</span>}
                {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🏭 {pedido.deposito}</span>}
                <span style={{ background: "#dcfce7", color: "#166534", fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", letterSpacing: "0.05em" }}>✅ ENTREGADO</span>
              </div>
            </div>
          </div>

          <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start" }}>
            {/* Columna principal */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Timeline */}
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 20px" }}>
                <p style={{ margin: "0 0 14px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Recorrido del pedido</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {estadosTimeline.map((key, i) => {
                    const ts = key === "ENTREGADO"
                      ? (pedido.entregadoAt || pedido.timestamps?.[key])
                      : pedido.timestamps?.[key];
                    const at = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
                    const done = !!at && !isNaN(at);
                    const isCurrent = key === "ENTREGADO";
                    return (
                      <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                        {i > 0 && <div style={{ position: "absolute", top: "11px", right: "50%", left: "-50%", height: "2px", background: done ? "#16a34a" : "#e2e8f0", zIndex: 0 }} />}
                        <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: isCurrent ? "#16a34a" : done ? "#86efac" : "#e2e8f0", border: `2.5px solid ${isCurrent ? "#16a34a" : done ? "#86efac" : "#e2e8f0"}`, zIndex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {done && <span style={{ fontSize: "0.58rem", color: isCurrent ? "#fff" : "#166534" }}>✓</span>}
                        </div>
                        <p style={{ margin: "5px 0 0", fontSize: "0.66rem", fontWeight: isCurrent ? 800 : 500, color: isCurrent ? "#166534" : done ? "#16a34a" : "#94a3b8", textAlign: "center", lineHeight: 1.2 }}>{labelMap[key]}</p>
                        {at && !isNaN(at) && <p style={{ margin: "2px 0 0", fontSize: "0.6rem", color: "#b8b8cc", textAlign: "center" }}>{at.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Productos */}
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Productos · {productos.length}</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <tbody>
                    {productos.map((it, i) => {
                      const raw = it.cod || it.descripcion || it.desc || "";
                      const uru = toURUCode(raw);
                      const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                      const color  = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                      const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                      return (
                        <tr key={i} style={{ borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                          <td style={{ padding: "10px 16px", verticalAlign: "middle" }}>
                            <p style={{ margin: 0, fontWeight: 600, color: "#1e293b" }}>{nombre}</p>
                            {color && <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", verticalAlign: "middle" }}>
                            <span style={{ background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: "0.85rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Aside */}
            <div style={{ position: "sticky", top: "76px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Confirmación de entrega */}
              <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "14px", padding: "16px 18px" }}>
                <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: "0.07em" }}>✅ Entregado</p>
                <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#064e3b" }}><strong>Fecha:</strong> {formatFechaHora(pedido.entregadoAt)}</p>
                {pedido.agencia && <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#064e3b" }}><strong>Agencia:</strong> {pedido.agencia}</p>}
              </div>
              {/* Resumen */}
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 18px" }}>
                <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Resumen</p>
                {[
                  { label: "Pedido", value: `#${pedido.numero || id}` },
                  { label: "Cliente", value: pedido.cliente || "—" },
                  { label: "Método", value: pedido.metodoEntrega || "—" },
                  { label: "Depósito", value: pedido.deposito || "—" },
                  { label: "Operario", value: operarioNombre },
                  { label: "Bultos", value: pedido.bultos ?? "—" },
                  { label: "Fecha pedido", value: formatFecha(pedido.finFecha) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid #f1f5f9", gap: "8px" }}>
                    <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontWeight: 500, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0f172a", textAlign: "right" }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Mobile/tablet para encargado ─────────────────────────────────────────
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "24px" }}>
        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#dcfce7", color: "#166534", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>✅ ENTREGADO</span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>

        <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>

          {/* Banner entregado */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: "14px", padding: "16px 18px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={{ fontSize: "1.6rem", flexShrink: 0 }}>✅</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#166534" }}>Pedido entregado</p>
              <p style={{ margin: "3px 0 0", fontSize: "0.8rem", color: "#16a34a" }}>{formatFechaHora(pedido.entregadoAt)}</p>
              {pedido.agencia && <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "#16a34a" }}>📦 Agencia: {pedido.agencia}</p>}
            </div>
          </div>

          {/* Preparado por */}
          {pedido.operarioNombre && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Preparado por</p>
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "14px 16px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                  {pedido.operarioNombre[0]?.toUpperCase() || "?"}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>{pedido.operarioNombre}</p>
                  {(pedido.bultos > 0 || pedido.paquetes > 0) && (
                    <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                      {pedido.bultos > 0 ? `📦 ${pedido.bultos} bultos` : ""}
                      {pedido.bultos > 0 && pedido.paquetes > 0 ? " · " : ""}
                      {pedido.paquetes > 0 ? `📫 ${pedido.paquetes} paquetes` : ""}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Productos */}
          <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}
          </p>
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
            {productos.length === 0 ? (
              <p style={{ margin: 0, padding: "16px", color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
            ) : (
              productos.map((it, i) => {
                const raw = it.cod || it.descripcion || it.desc || "";
                const uru = toURUCode(raw);
                const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                const color  = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: "0.88rem", fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                      {color && <p style={{ margin: "1px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                    </div>
                    <span style={{ flexShrink: 0, background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: "0.82rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }
  // ── Fin vista ENTREGADO ───────────────────────────────────────────────────

  // ── Vista ANULADO ─────────────────────────────────────────────────────────
  if (pedido.estado === "ANULADO") {
    const formatFechaHora = (ts) => {
      if (!ts) return "—";
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d)) return "—";
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "24px" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#fef2f2", color: "#dc2626", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>🚫 ANULADO</span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>

        <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
          <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: "14px", padding: "16px 18px", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.68rem", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.07em" }}>🚫 Pedido anulado</p>
            {pedido.anuladoAt && (
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#9a1a1a" }}>
                <strong>Fecha:</strong> {formatFechaHora(pedido.anuladoAt)}
              </p>
            )}
            {pedido.anuladoMotivo && (
              <div style={{ marginTop: "8px", background: "#fff", border: "1px solid #fca5a5", borderRadius: "10px", padding: "10px 14px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.06em" }}>Motivo</p>
                <p style={{ margin: 0, fontSize: "0.88rem", color: "#7f1d1d", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{pedido.anuladoMotivo}</p>
              </div>
            )}
          </div>

          {productos.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}</p>
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", opacity: 0.7 }}>
                {productos.map((it, i) => {
                  const raw = it.cod || it.descripcion || it.desc || "";
                  const uru = toURUCode(raw);
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                      <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#94a3b8", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>×{qty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  // ── Fin vista ANULADO ─────────────────────────────────────────────────────

  // ── Vista CANCELADO ───────────────────────────────────────────────────────
  if (pedido.estado === "CANCELADO") {
    const formatFechaHora = (ts) => {
      if (!ts) return "—";
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d)) return "—";
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "24px" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
          <VolverListaPedidos to="/pedidos" />
          <div style={{ marginTop: "10px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Pedido #{pedido.numero || id}</p>
              <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>{pedido.cliente || "—"}</h1>
            </div>
            <span style={{ flexShrink: 0, background: "#f5f3ff", color: "#7c3aed", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>✕ CANCELADO</span>
          </div>
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
            {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🚚 {pedido.metodoEntrega}</span>}
            {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>🏭 {pedido.deposito}</span>}
          </div>
        </div>

        <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
          <div style={{ background: "#faf5ff", border: "1.5px solid #d8b4fe", borderRadius: "14px", padding: "16px 18px", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.68rem", fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.07em" }}>✕ Pedido cancelado por ventas</p>
            {(pedido.canceladoAt || pedido.updatedAt) && (
              <p style={{ margin: "0 0 4px", fontSize: "0.85rem", color: "#4c1d95" }}>
                <strong>Fecha:</strong> {formatFechaHora(pedido.canceladoAt || pedido.updatedAt)}
              </p>
            )}
            {pedido.motivoCancelacion && (
              <div style={{ marginTop: "8px", background: "#fff", border: "1px solid #d8b4fe", borderRadius: "10px", padding: "10px 14px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "0.68rem", fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>Motivo</p>
                <p style={{ margin: 0, fontSize: "0.88rem", color: "#4c1d95", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{pedido.motivoCancelacion}</p>
              </div>
            )}
          </div>

          {productos.length > 0 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}</p>
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden", opacity: 0.7 }}>
                {productos.map((it, i) => {
                  const raw = it.cod || it.descripcion || it.desc || "";
                  const uru = toURUCode(raw);
                  const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                  const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                      <p style={{ flex: 1, margin: 0, fontSize: "0.86rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombre}</p>
                      <span style={{ flexShrink: 0, background: "#f1f5f9", color: "#94a3b8", fontWeight: 700, fontSize: "0.82rem", padding: "2px 8px", borderRadius: "8px" }}>×{qty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
  // ── Fin vista CANCELADO ───────────────────────────────────────────────────

  // ── Vista general ventas — estados sin vista dedicada (PENDIENTE, ASIGNADO, EN_PREP) ──
  if (isVentas) {
    const formatFecha = (f) => {
      if (!f) return "—";
      const d = new Date(f);
      if (!isNaN(d)) return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
      return f;
    };
    const ESTADO_INFO = {
      PENDIENTE_ASIGNAR: { label: "Pendiente de asignar",   color: "#94a3b8", bg: "#f8fafc",  border: "#e2e8f0",  icon: "⏳", msg: "El pedido aún no fue asignado a un operario." },
      ASIGNADO:          { label: "Asignado a operario",    color: "#1e40af", bg: "#eff6ff",  border: "#bfdbfe",  icon: "👤", msg: `Asignado a ${pedido.operarioNombre || "operario"}. Esperando inicio de preparación.` },
      EN_PREPARACION:    { label: "En preparación",         color: "#854d0e", bg: "#fefce8",  border: "#fde047",  icon: "🔧", msg: `${pedido.operarioNombre || "El operario"} está preparando el pedido ahora.` },
      CON_ERROR:         { label: "Con error · revisando",  color: "#c2410c", bg: "#fff7ed",  border: "#fed7aa",  icon: "⚠️", msg: "El encargado está revisando un problema antes de escalar." },
    };
    const info = ESTADO_INFO[pedido.estado] || { label: pedido.estado, color: "#64748b", bg: "#f8fafc", border: "#e2e8f0", icon: "📋", msg: "" };

    return (
      <div style={{ background: "#f1f5f9", minHeight: "100vh" }}>

        {/* Header sticky desktop */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", alignItems: "center", gap: "14px" }}>
            <button type="button" onClick={() => navigate("/ventas/pipeline")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", flexShrink: 0, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", cursor: "pointer", fontSize: "1rem" }}>
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Pedido #{pedido.numero || id}
              </p>
              <h1 style={{ margin: "1px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pedido.cliente || "—"}
              </h1>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
              {pedido.finFecha && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>📅 {formatFecha(pedido.finFecha)}</span>}
              {pedido.metodoEntrega && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🚚 {pedido.metodoEntrega}</span>}
              {pedido.deposito && <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "3px 9px" }}>🏭 {pedido.deposito}</span>}
              {renderVentasCancelBtn()}
            </div>
          </div>
        </div>

        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "1fr 280px", gap: "20px", alignItems: "start" }}>

          {/* Columna principal */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* Banner de estado */}
            <div style={{ background: info.bg, border: `1.5px solid ${info.border}`, borderRadius: "14px", padding: "16px 20px", display: "flex", alignItems: "center", gap: "14px" }}>
              <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>{info.icon}</span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.95rem", color: info.color }}>{info.label}</p>
                {info.msg && <p style={{ margin: "3px 0 0", fontSize: "0.8rem", color: info.color, opacity: 0.8 }}>{info.msg}</p>}
              </div>
            </div>

            {/* Productos */}
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Contenido · {productos.length} producto{productos.length !== 1 ? "s" : ""}</span>
              </div>
              {productos.length === 0 ? (
                <p style={{ margin: 0, padding: "16px", color: "#94a3b8", fontSize: "0.85rem" }}>Sin productos registrados.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <tbody>
                    {productos.map((it, i) => {
                      const raw = it.cod || it.descripcion || it.desc || "";
                      const uru = toURUCode(raw);
                      const nombre = it.descripcion || it.desc || it.nombre || catalogoMap?.[uru]?.customerNo || uru || "—";
                      const color  = catalogoMap?.[uru]?.finish || catalogoMap?.[uru]?.color || "";
                      const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
                      return (
                        <tr key={i} style={{ borderBottom: i < productos.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                          <td style={{ padding: "10px 16px", verticalAlign: "middle" }}>
                            <p style={{ margin: 0, fontWeight: 500, color: "#1e293b" }}>{nombre}</p>
                            {color && <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94a3b8" }}>{color}</p>}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", verticalAlign: "middle" }}>
                            <span style={{ background: "#f1f5f9", color: "#475569", fontWeight: 700, fontSize: "0.85rem", padding: "3px 10px", borderRadius: "8px" }}>×{qty}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Aside */}
          <div style={{ position: "sticky", top: "76px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "14px", padding: "16px 18px" }}>
              <p style={{ margin: "0 0 10px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Resumen</p>
              {[
                { label: "Pedido",    value: `#${pedido.numero || id}` },
                { label: "Cliente",   value: pedido.cliente || "—" },
                { label: "Método",    value: pedido.metodoEntrega || "—" },
                { label: "Depósito",  value: pedido.deposito || "—" },
                { label: "Operario",  value: pedido.operarioNombre || "—" },
                { label: "F. pedido", value: formatFecha(pedido.finFecha) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", gap: "8px" }}>
                  <span style={{ fontSize: "0.78rem", color: "#94a3b8", fontWeight: 500, flexShrink: 0 }}>{label}</span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#0f172a", textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
            {/* Cancel CTA en el aside */}
            {puedeVentasCancelar && (
              <button
                type="button"
                onClick={abrirCancelModal}
                style={{
                  width: "100%", padding: "11px", borderRadius: "10px",
                  border: "1.5px solid #fca5a5", background: "#fef2f2",
                  color: "#dc2626", fontSize: "0.85rem", fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✕ Cancelar pedido
              </button>
            )}
          </div>
        </div>

        {renderCancelModal()}
      </div>
    );
  }
  // ── Fin vista general ventas ──────────────────────────────────────────────

  return (
    <div className="p-3 space-y-4">
      {/* Header + volver */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-bold text-xl">
          {pedido.numero || id}
        </h1>
        <VolverListaPedidos className="btn btn--outline btn-sm" to= "/pedidos" />
      </div>

      {/* Detalle general */}
      <div className="card">
        <div className="order-body">
          <div className="order-field">
            <span className="order-label">Fecha (Finnegans)</span>
            <span className="order-value">{pedido.finFecha || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Cliente</span>
            <span className="order-value">{pedido.cliente || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Método de entrega</span>
            <span className="order-value">{pedido.metodoEntrega || "—"}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Depósito</span>
            <span className="order-value">{pedido.deposito || "—"}</span>
          </div>
        </div>
      </div>

      {/* TODO FEATURE: Modificación de pedido preparado
           Permitir al vendedor editar los productos de un pedido que ya está en estado PREPARADO o CONTROLADO.
           Requiere: 1) botón "Modificar pedido" visible solo para ventas y admin,
                     2) modal con lista editable de productos (agregar/quitar/cambiar cant.),
                     3) al guardar: actualizar pedido.productos en Firestore, cambiar estado a EN_PREPARACION
                        si venía de PREPARADO (para re-preparar), y registrar en audit trail (adminOverride).
           Dependencias: canAdminOverride en Firestore rules ya permite cambiar productos.
           Bloquear si el pedido ya está DESPACHADO.
      */}

      {/* Productos (Customer No, Color, Cantidad) — ocultar en EN_PREPARACION para no duplicar */}
        {pedido.estado !== ESTADOS.EN_PREPARACION && (
          <div className="card">
            <div className="subsection-title">
              <span>Productos</span>
              <span className="muted">
                {pedido.estado === ESTADOS.PREPARADO ? `${checkedCount}/${totalProductos}` : totalProductos}
              </span>
            </div>

            <div className="subsection-body">
              {(() => {
                const { operario, encargado } = splitPorCategoria(productos, catalogoMap);

                return (
                  <>
                    {/* === Sección Operario === */}
                    <div className="subsection-title">Perfiles y Kits</div>
                    <div className="product-grid">
                      {operario.map(({ it, uru, cat }, i) => (
                        <div key={`op-${uru}-${i}`} className="card product-card">
                          <div className="product-heading">
                            <span className="product-customer">{catalogoMap?.[uru]?.customerNo || uru}</span>
                            <span className="product-color">{catalogoMap?.[uru]?.finish || "—"}</span>
                            <span className="pill" style={{ marginLeft: "auto" }}>
                              x{it.cant ?? it.cantidad ?? it.qty ?? 0}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* === Sección Encargado === */}
                    <div className="subsection-title">Accesorios / PVC / Vidrios / Refuerzos</div>
                    <div className="product-grid">
                      {encargado.map(({ it, uru, cat }, i) => (
                        <div key={`enc-${uru}-${i}`} className="card product-card">
                          <div className="product-heading">
                            <span className="product-customer">{catalogoMap?.[uru]?.customerNo || uru}</span>
                            <span className="product-color">{catalogoMap?.[uru]?.finish || "—"}</span>
                            <span className="pill" style={{ marginLeft: "auto" }}>
                              x{it.cant ?? it.cantidad ?? it.qty ?? 0}
                            </span>
                          </div>

                          {/* Checkbox del ENCARGADO */}
                          <div className="p-2">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={!!accChecks[`${uru}-${i}`]}
                                onChange={() => {
                                  const key = `${uru}-${i}`;

                                  // actualizamos los checks usados para allChecked
                                  setChecks(prev => ({
                                    ...prev,
                                    [key]: !prev[key],
                                  }));

                                  // mantenemos accChecks para UI del encargado
                                  setAccChecks(prev => ({
                                    ...prev,
                                    [key]: !prev[key],
                                  }));
                                }}
                              />
                              <span className="muted text-sm">Confirmar</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}


              {/* Acciones del control SOLO visibles en PREPARADO */}
              {pedido.estado === ESTADOS.PREPARADO && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="card card--preparacion card--compact card--centrada space-y-2">
                    <div className="subsection-title">
                      <span>Datos de preparación</span>
                    </div>
                    <div className="subsection-body preparacion-fields">
                      <div className="field-group">
                        <label className="order-label">Cantidad de bultos</label>
                        <input
                          type="number"
                          min="0"
                          className="input input--sm"
                          value={bultos}
                          onChange={e => setBultos(e.target.value)}
                        />
                      </div>

                      <div className="field-group">
                        <label className="order-label">Cantidad de paquetes</label>
                        <input
                          type="number"
                          min="0"
                          className="input input--sm"
                          value={paquetes}
                          onChange={e => setPaquetes(e.target.value)}
                        />
                      </div>

                      <button
                        className="btn btn--sm w-full bg-black text-white"
                        onClick={guardarBultosYPaquetes}
                      >
                        Guardar datos
                      </button>
                    </div>
                  </div>


                  <button
                    className="btn bg-black text-white disabled:opacity-60"
                    onClick={confirmControl}
                    disabled={!allChecked || saving}
                  >
                    Confirmar control
                  </button>
                  <button
                    className="btn btn--outline"
                    onClick={() => setShowErrForm(v => !v)}
                  >
                    {showErrForm ? "Cancelar" : "Error en la preparación"}
                  </button>

                  {showErrForm && (
                    <div className="card" style={{ marginTop: 8 }}>
                      <div className="subsection-title"><span>Reportar error</span></div>
                      <div className="subsection-body space-y-2">
                        <p className="text-sm muted">
                          Se guardará el pedido, el responsable y la fecha del reporte.
                        </p>
                        <textarea
                          className="w-full border rounded px-3 py-2"
                          rows={4}
                          placeholder="Describe el error…"
                          value={detalleErr}
                          onChange={(e)=>setDetalleErr(e.target.value)}
                        />
                        <button
                          className="btn w-full bg-black text-white disabled:opacity-60"
                          onClick={submitErrorPreparacion}
                          disabled={savingErr || !detalleErr.trim()}
                        >
                          Guardar reporte
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}




      {/* === Vista según estado === */}

      {/* ASIGNADO: botón para iniciar preparación (operario o encargado autoasignado) */}
      {pedido.estado === ESTADOS.ASIGNADO && pedido.operarioId === user?.uid && (
        <div className="card">
          <div className="subsection-body space-y-3">
            <p className="text-sm muted">
              Sos el responsable de preparar este pedido.
            </p>
            <button
              className="btn bg-black text-white w-full disabled:opacity-60"
              onClick={onComenzar}
              disabled={saving}
            >
              🟡 Comenzar preparación
            </button>
          </div>
        </div>
      )}

      {pedido.estado === ESTADOS.PENDIENTE_ASIGNAR && (
        <div className="space-y-3">
          <div className="card">
            <div className="subsection-title">
              <span>Asignación</span>
            </div>

            <div className="subsection-body space-y-3">
              <p className="text-sm muted">
                Depósito: <b>{pedido.deposito || "—"}</b>. Elegí un responsable para este pedido.
              </p>

              {/* SELECT nativo (grande y tocable) */}
              <label className="order-label" htmlFor="op-select">Operario responsable</label>
              {loadingOps ? (
                <div className="muted">Cargando operarios…</div>
              ) : (
                <select
                  id="op-select"
                  className="w-full border rounded px-3 py-3 text-base"
                  value={selectedOperario?.uid || ""}
                  onChange={(e) => {
                    const uid = e.target.value;
                    const o = operarios.find(x => x.id === uid);
                    setSelectedOperario(uid ? { uid, nombre: (o?.nombre || o?.email || "Operario") } : null);
                  }}
                  disabled={!puedeAsignarAlguien || saving}
                >
                  <option value="">— Seleccionar —</option>
                  {/* agrupado alfabético simple */}
                  {operarios
                    .slice()
                    .sort((a,b) => (a.nombre || a.email || "").localeCompare(b.nombre || b.email || ""))
                    .map(o => (
                      <option key={o.id} value={o.id}>
                        {o.nombre || o.email}
                      </option>
                    ))}
                </select>
              )}

              {/* Resumen de selección */}
              <div className="order-field">
                <span className="order-label">Seleccionado</span>
                <span className="order-value">
                  {selectedOperario?.nombre || "—"}
                </span>
              </div>

              {/* Acciones: apiladas (mobile-first) */}
              <div className="flex flex-col gap-3">
                <button
                  className="btn btn--asignacion-secundaria"
                  onClick={handleAutoAsignarme}
                  disabled={!puedeAutoAsignarse || saving}
                >
                  Auto-asignarme
                </button>

                <button
                  className={`btn btn--asignacion-principal ${(!puedeAsignarAlguien || !selectedOperario || saving) ? "btn-disabled" : ""}`}
                  onClick={handleConfirmarAsignacion}
                  disabled={!puedeAsignarAlguien || !selectedOperario || saving}
                >
                  Confirmar asignación
                </button>
              </div>

              {/* Ayuda contextual */}
              {!puedeAsignarAlguien && (
                <p className="text-xs muted">
                  Solo un <b>encargado</b> puede asignar operarios.
                </p>
              )}
            </div>
          </div>
        </div>
      )}





      {pedido.estado === ESTADOS.EN_PREPARACION && (
        <EncPreparacionPanel
          pedido={pedido}
          productos={productos}
          catalogIndex={catalogoMap}                  // mapa { codUru -> {customerNo, finish, ...} }
          btnFinalizarLabel={isIsabela ? "Pedido completado" : undefined}
          onReportarError={async ({ productos }) => { await submitErrorPreparacion(productos); }}
          onPreparacionFinalizada={async () => {
            try {
              // ISABELA: encargado → salta PREPARADO, va directo a CONTROLADO (listo para despachar)
              const nextEstado = isIsabela ? ESTADOS.CONTROLADO : ESTADOS.PREPARADO;
              await updateEstado(id, nextEstado);
              if (isIsabela) {
                toast.success("Pedido listo para despachar ✓");
                navigate("/pedidos");
              } else {
                setPedido(prev => prev ? { ...prev, estado: nextEstado } : prev);
                toast.success("Pedido preparado");
              }
            } catch (e) {
              toast.error(e?.message || "No se pudo finalizar la preparación");
            }
          }}
        />
      )}




      {pedido.estado === ESTADOS.CONTROLADO && (
        isVentas ? (
          // === CONTROLADO — VENTAS ===
          <div className="card" style={{ padding: "20px 24px" }}>
            <ConfirmarDespacho pedidoId={id} />
          </div>
        ) : (
          // === CONTROLADO — ENCARGADO ===
          <div className="card">
            {isIsabela ? (
              <div style={{ padding: "4px 0" }}>
                <p style={{ margin: "0 0 4px", fontSize: "0.8rem", fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  ✅ Preparado
                </p>
                <p style={{ margin: 0, fontSize: "0.95rem", color: "#475569" }}>
                  Esperando despacho del vendedor.
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-2">
                Estado: <b>CONTROLADO</b>. Listo para despacho.
              </p>
            )}
          </div>
        )
      )}
  


      {pedido.estado === ESTADOS.DESPACHADO && (
        <div className="card">
          <p className="text-sm text-gray-600 mb-2">
            Estado: <b>DESPACHADO</b>. Pedido finalizado.
          </p>
        </div>
      )}

      {/* ── Botón anular — solo encargado, solo pedidos no finalizados ── */}
      {isEncargado && pedido.estado !== ESTADOS.DESPACHADO && pedido.estado !== "ANULADO" && (
        <div style={{ marginTop: "8px", paddingTop: "16px", borderTop: "1px dashed #e2e8f0" }}>
          <button
            onClick={() => { setMotivoAnulacion(""); setShowAnularModal(true); }}
            style={{
              width: "100%", padding: "10px", fontSize: "13px", fontWeight: 600,
              background: "none", border: "1.5px solid #fca5a5", color: "#dc2626",
              borderRadius: "8px", cursor: "pointer",
            }}
          >
            🚫 Anular pedido
          </button>
        </div>
      )}

      {/* ── Modal confirmación anulación ── */}
      {showAnularModal && (
        <div
          onClick={() => setShowAnularModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "#fff", width: "100%", borderRadius: "16px 16px 0 0", padding: "24px 20px" }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: 700, color: "#dc2626" }}>
              🚫 Anular pedido #{pedido.numero || id}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#64748b" }}>
              Esta acción no se puede deshacer. El pedido dejará de aparecer en la lista operativa.
            </p>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
              Motivo de anulación *
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="Ej: Pedido duplicado, cliente canceló, error en el pedido…"
              value={motivoAnulacion}
              onChange={e => setMotivoAnulacion(e.target.value)}
              style={{ fontSize: "14px", resize: "none", marginBottom: "14px" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setShowAnularModal(false)}
                className="btn btn--ghost"
                style={{ flex: 1 }}
              >
                Cancelar
              </button>
              <button
                onClick={anularPedido}
                disabled={savingAnulacion || !motivoAnulacion.trim()}
                className="btn btn--danger"
                style={{ flex: 2 }}
              >
                {savingAnulacion ? "Anulando…" : "Confirmar anulación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
