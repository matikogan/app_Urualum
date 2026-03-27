import React, { useState, useEffect } from "react";
import {
  collection, query, orderBy, where,
  onSnapshot, doc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { useAuth } from "context/AuthContext";
import { useNavigate } from "react-router-dom";

const ESTADOS_ACTIVOS = ["NUEVO", "EN PREPARACION", "ERROR_STOCK"];
// V8: orden de prioridad para el sort por estado
const ORDEN_ESTADOS = ["NUEVO", "ERROR_STOCK", "EN PREPARACION", "PREPARADO", "ENTREGADO", "CANCELADO"];

// ── Helper: pill de estado ───────────────────────────────────
function EstadoPill({ estado }) {
  const cfg = {
    "NUEVO":          { cls: "pill--brand", label: "NUEVO" },
    "EN PREPARACION": { cls: "pill--warn",  label: "EN PREP." },
    "PREPARADO":      { cls: "pill--ok",    label: "PREPARADO" },
    "ERROR_STOCK":    { cls: "pill--error", label: "ERROR STOCK" },
    "ENTREGADO":      { cls: "pill--info",  label: "ENTREGADO" },
    "CANCELADO":      { cls: "pill--error", label: "CANCELADO" },
  };
  const c = cfg[estado] || { cls: "pill--info", label: estado };
  return <span className={`pill ${c.cls}`} style={{ fontSize: "12px", padding: "4px 8px" }}>{c.label}</span>;
}

// ── V8: Flecha de ordenamiento ───────────────────────────────
function SortArrow({ col, sortCol, sortDir }) {
  const active = sortCol === col;
  return (
    <span className={`sort-arrow ${active ? "sort-arrow--active" : ""}`}>
      {active ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
    </span>
  );
}

export default function PedidosWeb() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [pedidos, setPedidos]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [filtro, setFiltro]             = useState("activos");

  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [stockPorProducto, setStockPorProducto]     = useState({});
  const [loadingStock, setLoadingStock]             = useState(false);

  const [mostrandoFormError, setMostrandoFormError] = useState(false);
  const [notaError, setNotaError]       = useState("");
  const [errorNotaMsg, setErrorNotaMsg] = useState(""); // V4: reemplaza alert()

  const [toastMsg, setToastMsg]         = useState(null);

  // V8: estado de ordenamiento
  const [sortCol, setSortCol] = useState("fecha");
  const [sortDir, setSortDir] = useState("desc");

  // ── Datos en tiempo real ─────────────────────────────────
  useEffect(() => {
    if (!profile?.deposito) return;
    const q = query(
      collection(db, "pedidos_web"),
      where("depositoAsignado", "==", profile.deposito),
      orderBy("fecha", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, [profile?.deposito]);

  // ── Toast ────────────────────────────────────────────────
  const mostrarToast = (msg, tipo = "ok") => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3000);
  };

  // ── Abrir gestión de pedido (toggle si ya está abierto) ──
  const abrirGestion = async (pedido) => {
    if (pedidoSeleccionado?.id === pedido.id) {
      setPedidoSeleccionado(null);
      return;
    }
    setPedidoSeleccionado(pedido);
    setMostrandoFormError(false);
    setNotaError("");
    setErrorNotaMsg("");
    setLoadingStock(true);
    const nuevosStocks = {};
    try {
      const fnStock = httpsCallable(functions, "finnegansConsultarStock");
      await Promise.all(pedido.items.map(async (item) => {
        const [resR8, resIsa] = await Promise.all([
          fnStock({ productoCodigo: item.codigo, deposito: "RUTA8" }).catch(() => ({ data: { stock: [] } })),
          fnStock({ productoCodigo: item.codigo, deposito: "ISABELA" }).catch(() => ({ data: { stock: [] } })),
        ]);
        const stockR8  = resR8.data.stock?.[0];
        const stockIsa = resIsa.data.stock?.[0];
        nuevosStocks[item.codigo] = {
          r8: stockR8?.Cantidad || 0,
          isa: stockIsa?.Cantidad || 0,
          nombreFinnegans: stockR8?.ProductoNombre || stockIsa?.ProductoNombre || item.descripcion,
        };
      }));
      setStockPorProducto(nuevosStocks);
    } catch (err) {
      console.error("Error consultando stocks:", err);
    } finally {
      setLoadingStock(false);
    }
  };

  // ── Cambiar estado en Firestore ──────────────────────────
  const cambiarEstado = async (id, nuevoEstado, extra = {}) => {
    try {
      await updateDoc(doc(db, "pedidos_web", id), {
        estado: nuevoEstado,
        gestionadoPor: profile.email,
        fechaUltimaAccion: serverTimestamp(),
        ...extra,
      });
      setPedidoSeleccionado(null);
      mostrarToast(`Pedido marcado como: ${nuevoEstado}`);
    } catch {
      mostrarToast("Error al actualizar el estado.", "error");
    }
  };

  // ── V4: Confirmar error con validación inline ────────────
  const confirmarError = () => {
    if (!notaError.trim()) {
      setErrorNotaMsg("Por favor describí el problema antes de confirmar.");
      return;
    }
    setErrorNotaMsg("");
    cambiarEstado(pedidoSeleccionado.id, "ERROR_STOCK", { notaError });
    setMostrandoFormError(false);
    setNotaError("");
  };

  // ── Stock relevante según depósito del pedido ────────────
  const getStockRelevante = (codigo) => {
    if (!pedidoSeleccionado) return null;
    const stock = stockPorProducto[codigo];
    if (!stock) return null;
    return pedidoSeleccionado.depositoAsignado === "ISABELA" ? stock.isa : stock.r8;
  };

  // ── V8: Toggle de columna de ordenamiento ────────────────
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  // ── Filtrado + ordenamiento ──────────────────────────────
  const pedidosFiltrados = (
    filtro === "activos"
      ? pedidos.filter(p => ESTADOS_ACTIVOS.includes(p.estado))
      : pedidos
  ).slice().sort((a, b) => {
    if (sortCol === "fecha") {
      const fa = a.fecha?.toDate?.() || new Date(0);
      const fb = b.fecha?.toDate?.() || new Date(0);
      return sortDir === "desc" ? fb - fa : fa - fb;
    }
    if (sortCol === "estado") {
      const ia = ORDEN_ESTADOS.indexOf(a.estado);
      const ib = ORDEN_ESTADOS.indexOf(b.estado);
      return sortDir === "desc" ? ia - ib : ib - ia;
    }
    if (sortCol === "total") {
      return sortDir === "desc" ? (b.total || 0) - (a.total || 0) : (a.total || 0) - (b.total || 0);
    }
    return 0;
  });

  // ── V3: Breakdown de estados para el header ──────────────
  const cantNuevo = pedidos.filter(p => p.estado === "NUEVO").length;
  const cantPrep  = pedidos.filter(p => p.estado === "EN PREPARACION").length;
  const cantError = pedidos.filter(p => p.estado === "ERROR_STOCK").length;

  // ── Clase de fila ────────────────────────────────────────
  const claseFilaEstado = (estado, isSelected) => {
    const base =
      estado === "NUEVO"          ? "row--nuevo"       :
      estado === "EN PREPARACION" ? "row--preparacion" :
      estado === "ERROR_STOCK"    ? "row--error"       :
      ["ENTREGADO", "CANCELADO"].includes(estado) ? "row--inactivo" : "";
    return isSelected ? `${base} row--seleccionado` : base;
  };

  if (loading) return <div className="container screen-center">⏳ Cargando buzón...</div>;

  return (
    <div className="container" style={{ paddingBottom: 0 }}>

      {/* Toast de feedback */}
      {toastMsg && (
        <div className="toast" style={{
          background: toastMsg.tipo === "ok" ? "var(--ok)" : "var(--error)",
        }}>
          {toastMsg.msg}
        </div>
      )}

      {/* ── V3: Topbar con breakdown por estado ── */}
      <header className="topbar card" style={{ marginBottom: "12px" }}>
        <button onClick={() => navigate("/")} className="btn btn--ghost btn-sm">
          ⬅ Volver
        </button>
        <h1 className="h1" style={{ margin: 0, fontSize: "18px" }}>
          📦 Buzón Web — {profile?.deposito}
        </h1>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          {cantNuevo > 0  && <span className="pill pill--brand">{cantNuevo} Nuevo{cantNuevo !== 1 ? "s" : ""}</span>}
          {cantPrep  > 0  && <span className="pill pill--warn">{cantPrep} En Prep.</span>}
          {cantError > 0  && <span className="pill pill--error">{cantError} Error{cantError !== 1 ? "es" : ""}</span>}
          {cantNuevo === 0 && cantPrep === 0 && cantError === 0 && (
            <span className="pill pill--ok">✓ Al día</span>
          )}
        </div>
      </header>

      {/* ── V5: Layout 2 columnas ── */}
      <div className="pedidosweb-layout">

        {/* ─── Columna izquierda: filtros + tabla ─── */}
        <div className="pedidosweb-left">

          {/* Tabs de filtro */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button
              onClick={() => setFiltro("activos")}
              className={`btn btn-sm ${filtro === "activos" ? "btn--primary" : "btn--ghost"}`}
            >
              Activos ({pedidos.filter(p => ESTADOS_ACTIVOS.includes(p.estado)).length})
            </button>
            <button
              onClick={() => setFiltro("todos")}
              className={`btn btn-sm ${filtro === "todos" ? "btn--primary" : "btn--ghost"}`}
            >
              Todos ({pedidos.length})
            </button>
          </div>

          {/* Tabla — V2: widths definidos, V6: sin botón "Gestionar", V8: headers ordenables */}
          <div className="card table-wrap" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <colgroup>
                <col style={{ width: "10%" }} /> {/* ID */}
                <col style={{ width: "28%" }} /> {/* Cliente */}
                <col style={{ width: "18%" }} /> {/* Entrega */}
                <col style={{ width: "13%" }} /> {/* Fecha */}
                <col style={{ width: "13%" }} /> {/* Total */}
                <col style={{ width: "18%" }} /> {/* Estado */}
              </colgroup>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Cliente</th>
                  <th>Entrega</th>
                  <th className="th-sort" onClick={() => toggleSort("fecha")}>
                    Fecha <SortArrow col="fecha" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th className="th-sort" onClick={() => toggleSort("total")}>
                    Total <SortArrow col="total" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                  <th className="th-sort" onClick={() => toggleSort("estado")}>
                    Estado <SortArrow col="estado" sortCol={sortCol} sortDir={sortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      {/* V7: Empty state */}
                      <div style={{ textAlign: "center", padding: "48px 20px", color: "#94a3b8" }}>
                        <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
                        <strong style={{ color: "#334155", display: "block", marginBottom: "4px", fontSize: "15px" }}>
                          {filtro === "activos" ? "Sin pedidos activos" : "Sin pedidos registrados"}
                        </strong>
                        <span style={{ fontSize: "13px" }}>
                          {filtro === "activos" ? "Todos los pedidos están gestionados" : "Los pedidos aparecerán acá al llegar"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pedidosFiltrados.map(p => (
                    <tr
                      key={p.id}
                      className={claseFilaEstado(p.estado, pedidoSeleccionado?.id === p.id)}
                      onClick={() => abrirGestion(p)}
                      style={{ cursor: "pointer" }}
                      title="Clic para gestionar"
                    >
                      <td style={{ fontWeight: 700, fontSize: "13px" }}>{p.finnegansId}</td>
                      <td>{p.clienteNombre}</td>
                      <td style={{ fontSize: "13px", color: "#64748b" }}>{p.metodoEntrega || "—"}</td>
                      <td style={{ fontSize: "13px", color: "#64748b" }}>
                        {p.fecha?.toDate().toLocaleDateString("es-UY", { day: "2-digit", month: "short" })}
                      </td>
                      <td style={{ fontWeight: 700 }}>${p.total?.toFixed(0)}</td>
                      <td><EstadoPill estado={p.estado} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── Columna derecha: panel de detalle o placeholder ─── */}
        <div className="pedidosweb-right">
          {!pedidoSeleccionado ? (

            // V7: Placeholder
            <div className="pedidosweb-placeholder">
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>📋</div>
              <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: "16px", fontWeight: 700 }}>
                Seleccioná un pedido
              </h3>
              <p style={{ margin: 0, fontSize: "13px" }}>
                Hacé clic en cualquier fila de la tabla para gestionarlo
              </p>
            </div>

          ) : (

            // V5: Panel de detalle (reemplaza el modal)
            <div className="pedidosweb-panel">

              {/* Header del panel */}
              <div className="pedidosweb-panel__header">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h2 className="h2" style={{ margin: 0 }}>
                    Pedido #{pedidoSeleccionado.finnegansId}
                  </h2>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <EstadoPill estado={pedidoSeleccionado.estado} />
                    <button
                      onClick={() => setPedidoSeleccionado(null)}
                      style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8", lineHeight: 1, padding: "2px 6px" }}
                      title="Cerrar panel"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="meta" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  <div className="meta-item">
                    <span className="meta-label">Cliente</span>
                    <span className="meta-value">{pedidoSeleccionado.clienteNombre}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Entrega</span>
                    <span className="meta-value">{pedidoSeleccionado.metodoEntrega || "—"}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Pago</span>
                    <span className="meta-value" style={{ fontWeight: 700 }}>
                      {pedidoSeleccionado.metodoPago || "No especificado"}
                      {pedidoSeleccionado.metodoPago === "Transferencia" && ` (${pedidoSeleccionado.bancoTransferencia})`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Body scrollable */}
              <div className="pedidosweb-panel__body">

                {/* Banner de stock */}
                {!loadingStock && (() => {
                  const insuficientes = pedidoSeleccionado.items.filter(item => {
                    const sr = getStockRelevante(item.codigo);
                    return sr !== null && sr < item.cantidad;
                  });
                  return insuficientes.length > 0 ? (
                    <div className="banner banner--error" style={{ marginBottom: "12px" }}>
                      ⚠️ <strong>{insuficientes.length} producto{insuficientes.length > 1 ? "s" : ""} sin stock suficiente</strong> en {pedidoSeleccionado.depositoAsignado}
                    </div>
                  ) : (
                    <div className="banner banner--ok" style={{ marginBottom: "12px" }}>
                      ✅ <strong>Stock suficiente</strong> para todos los productos
                    </div>
                  );
                })()}

                {pedidoSeleccionado.notaError && (
                  <div className="banner banner--error" style={{ marginBottom: "12px" }}>
                    🔴 <strong>Nota del error:</strong> {pedidoSeleccionado.notaError}
                  </div>
                )}

                {pedidoSeleccionado.observaciones && (
                  <div className="banner banner--warn" style={{ marginBottom: "12px" }}>
                    📝 <strong>Obs. del cliente:</strong> {pedidoSeleccionado.observaciones}
                  </div>
                )}

                {/* Tabla de stock */}
                <div className="card--preparacion">
                  <h3 className="card-header" style={{ marginTop: 0 }}>Líneas del pedido y stock real</h3>
                  <div style={{ overflowX: "auto" }}>
                    <table className="table table-gestion">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th style={{ textAlign: "center" }}>Cant.</th>
                          <th style={{ textAlign: "center" }}>R8</th>
                          <th style={{ textAlign: "center" }}>ISA</th>
                          <th style={{ textAlign: "center" }}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidoSeleccionado.items.map((item, i) => {
                          const stock = stockPorProducto[item.codigo];
                          const stockRelevante = getStockRelevante(item.codigo);
                          const faltaStock = !loadingStock && stock && stockRelevante < item.cantidad;
                          const esDepIsa = pedidoSeleccionado.depositoAsignado === "ISABELA";
                          return (
                            <tr key={i}>
                              <td>
                                <div style={{ fontWeight: 700, fontSize: "13px" }}>
                                  {loadingStock ? item.descripcion : (stock?.nombreFinnegans || item.descripcion)}
                                </div>
                                <small style={{ color: "#94a3b8" }}>SKU: {item.codigo}</small>
                              </td>
                              <td style={{ textAlign: "center", fontWeight: 800, fontSize: "1.1rem" }}>
                                {item.cantidad}
                              </td>
                              <td style={{
                                textAlign: "center",
                                color: !esDepIsa && faltaStock ? "var(--error)" : "inherit",
                                fontWeight: !esDepIsa && faltaStock ? 800 : 400,
                              }}>
                                {loadingStock ? "…" : (stock?.r8 ?? "…")}
                              </td>
                              <td style={{
                                textAlign: "center",
                                color: esDepIsa && faltaStock ? "var(--error)" : "inherit",
                                fontWeight: esDepIsa && faltaStock ? 800 : 400,
                              }}>
                                {loadingStock ? "…" : (stock?.isa ?? "…")}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                {!loadingStock && stock ? (
                                  faltaStock
                                    ? <span className="pill pill--error" style={{ fontSize: "11px", padding: "3px 7px" }}>INSUF.</span>
                                    : <span className="pill pill--ok" style={{ fontSize: "11px", padding: "3px 7px" }}>OK</span>
                                ) : <span style={{ color: "#94a3b8" }}>…</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer con botones de acción */}
              <div className="pedidosweb-panel__footer">

                {/* V4: Formulario de error con validación inline */}
                {mostrandoFormError ? (
                  <div>
                    <label className="label" style={{ marginBottom: "6px", display: "block" }}>
                      📝 Describí el problema (el cliente lo verá):
                    </label>
                    {errorNotaMsg && (
                      <p style={{ color: "var(--error)", fontSize: "13px", fontWeight: 600, margin: "0 0 6px" }}>
                        ⚠ {errorNotaMsg}
                      </p>
                    )}
                    <textarea
                      className="input textarea"
                      value={notaError}
                      onChange={e => { setNotaError(e.target.value); setErrorNotaMsg(""); }}
                      placeholder="Ej: No hay stock del producto X. Se puede reemplazar por Y o cancelar."
                      style={{ marginBottom: "10px" }}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => { setMostrandoFormError(false); setErrorNotaMsg(""); }}
                        className="btn btn--ghost"
                        style={{ flex: 1 }}
                      >
                        Cancelar
                      </button>
                      <button onClick={confirmarError} className="btn btn--danger" style={{ flex: 2 }}>
                        🔴 Confirmar Error
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "10px" }}>

                    {pedidoSeleccionado.estado === "NUEVO" && (
                      <button
                        onClick={() => cambiarEstado(pedidoSeleccionado.id, "EN PREPARACION")}
                        className="btn bg-warn"
                        style={{ flex: 1, color: "#fff" }}
                      >
                        🟡 Comenzar Preparación
                      </button>
                    )}

                    {pedidoSeleccionado.estado === "EN PREPARACION" && (
                      <>
                        <button
                          onClick={() => setMostrandoFormError(true)}
                          className="btn btn--danger"
                          style={{ flex: 1 }}
                        >
                          🔴 Reportar Error
                        </button>
                        <button
                          onClick={() => cambiarEstado(pedidoSeleccionado.id, "PREPARADO")}
                          className="btn bg-ok"
                          style={{ flex: 2, color: "#fff" }}
                        >
                          🟢 Marcar como Listo
                        </button>
                      </>
                    )}

                    {pedidoSeleccionado.estado === "PREPARADO" && (
                      <button
                        onClick={() => cambiarEstado(pedidoSeleccionado.id, "ENTREGADO")}
                        className="btn btn--primary"
                        style={{ flex: 1 }}
                      >
                        ✅ Marcar como Entregado
                      </button>
                    )}

                    {pedidoSeleccionado.estado === "ERROR_STOCK" && (
                      <>
                        <button
                          onClick={() => {
                            if (window.confirm("¿Cancelar este pedido? Esta acción no se puede deshacer.")) {
                              cambiarEstado(pedidoSeleccionado.id, "CANCELADO");
                            }
                          }}
                          className="btn btn--danger"
                          style={{ flex: 1 }}
                        >
                          🚫 Cancelar Pedido
                        </button>
                        <button
                          onClick={() => cambiarEstado(pedidoSeleccionado.id, "PREPARADO", { notaError: null })}
                          className="btn bg-ok"
                          style={{ flex: 2, color: "#fff" }}
                        >
                          🟢 Confirmar con Cambios
                        </button>
                      </>
                    )}

                    {["ENTREGADO", "CANCELADO"].includes(pedidoSeleccionado.estado) && (
                      <p style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", width: "100%", margin: 0, padding: "8px 0" }}>
                        Este pedido ya está cerrado.
                      </p>
                    )}

                  </div>
                )}
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
