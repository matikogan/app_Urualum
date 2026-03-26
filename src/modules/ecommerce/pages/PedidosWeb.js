import React, { useState, useEffect } from "react";
import { collection, query, orderBy, where, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../firebase";
import { useAuth } from "context/AuthContext";
import { useNavigate } from "react-router-dom";

const ESTADOS_ACTIVOS = ["NUEVO", "EN PREPARACION", "ERROR_STOCK"];

export default function PedidosWeb() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("activos");

  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [stockPorProducto, setStockPorProducto] = useState({});
  const [loadingStock, setLoadingStock] = useState(false);

  const [mostrandoFormError, setMostrandoFormError] = useState(false);
  const [notaError, setNotaError] = useState("");

  const [toastMsg, setToastMsg] = useState(null);

  const mostrarToast = (msg, tipo = "ok") => {
    setToastMsg({ msg, tipo });
    setTimeout(() => setToastMsg(null), 3000);
  };

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

  const abrirGestion = async (pedido) => {
    setPedidoSeleccionado(pedido);
    setMostrandoFormError(false);
    setNotaError("");
    setLoadingStock(true);
    const nuevosStocks = {};
    try {
      const fnStock = httpsCallable(functions, "finnegansConsultarStock");
      await Promise.all(pedido.items.map(async (item) => {
        const [resR8, resIsa] = await Promise.all([
          fnStock({ productoCodigo: item.codigo, deposito: "RUTA8" }).catch(() => ({ data: { stock: [] } })),
          fnStock({ productoCodigo: item.codigo, deposito: "ISABELA" }).catch(() => ({ data: { stock: [] } }))
        ]);
        const stockR8 = resR8.data.stock?.[0];
        const stockIsa = resIsa.data.stock?.[0];
        nuevosStocks[item.codigo] = {
          r8: stockR8?.Cantidad || 0,
          isa: stockIsa?.Cantidad || 0,
          nombreFinnegans: stockR8?.ProductoNombre || stockIsa?.ProductoNombre || item.descripcion
        };
      }));
      setStockPorProducto(nuevosStocks);
    } catch (error) {
      console.error("Error consultando stocks:", error);
    } finally {
      setLoadingStock(false);
    }
  };

  const cambiarEstado = async (id, nuevoEstado, extra = {}) => {
    try {
      await updateDoc(doc(db, "pedidos_web", id), {
        estado: nuevoEstado,
        gestionadoPor: profile.email,
        fechaUltimaAccion: serverTimestamp(),
        ...extra
      });
      setPedidoSeleccionado(null);
      mostrarToast(`Pedido marcado como: ${nuevoEstado}`);
    } catch (error) {
      alert("Error al actualizar estado.");
    }
  };

  const confirmarError = () => {
    if (!notaError.trim()) return alert("Por favor describí el problema antes de confirmar.");
    cambiarEstado(pedidoSeleccionado.id, "ERROR_STOCK", { notaError });
    setMostrandoFormError(false);
    setNotaError("");
  };

  // Devuelve el stock del depósito correspondiente al pedido
  const getStockRelevante = (codigo) => {
    if (!pedidoSeleccionado) return null;
    const stock = stockPorProducto[codigo];
    if (!stock) return null;
    return pedidoSeleccionado.depositoAsignado === "ISABELA" ? stock.isa : stock.r8;
  };

  const renderEstadoPill = (estado) => {
    const config = {
      "NUEVO":          { cls: "pill--brand", label: "NUEVO" },
      "EN PREPARACION": { cls: "pill--warn",  label: "EN PREPARACION" },
      "PREPARADO":      { cls: "pill--ok",    label: "PREPARADO" },
      "ERROR_STOCK":    { cls: "pill--error", label: "ERROR STOCK" },
      "ENTREGADO":      { cls: "pill--info",  label: "ENTREGADO" },
      "CANCELADO":      { cls: "pill--error", label: "CANCELADO" },
    };
    const c = config[estado] || { cls: "pill--info", label: estado || "NUEVO" };
    return <span className={`pill ${c.cls}`}>{c.label}</span>;
  };

  const claseFilaEstado = (estado) => {
    if (estado === "NUEVO") return "row--nuevo";
    if (estado === "EN PREPARACION") return "row--preparacion";
    if (estado === "ERROR_STOCK") return "row--error";
    if (estado === "ENTREGADO" || estado === "CANCELADO") return "muted";
    return "";
  };

  const pedidosFiltrados = filtro === "activos"
    ? pedidos.filter(p => ESTADOS_ACTIVOS.includes(p.estado))
    : pedidos;

  const cantidadActivos = pedidos.filter(p => ["NUEVO", "EN PREPARACION"].includes(p.estado)).length;

  if (loading) return <div className="container screen-center">⏳ Cargando buzón...</div>;

  return (
    <div className="container">

      {/* TOAST */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          background: toastMsg.tipo === "ok" ? "var(--ok)" : "var(--error)",
          color: '#fff', padding: '12px 24px', borderRadius: '8px', zIndex: 9999,
          fontWeight: 'bold', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          {toastMsg.msg}
        </div>
      )}

      <header className="topbar card">
        <button
          onClick={() => navigate("/")}
          className="btn btn--ghost"
          style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          ⬅️ Volver
        </button>
        <h1 className="h1">📦 Buzón Web — {profile?.deposito}</h1>
        <span className="pill pill--brand">{cantidadActivos} Activos</span>
      </header>

      {/* FILTRO TABS */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
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

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ID Finnegans</th>
              <th>Cliente</th>
              <th>Fecha</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {pedidosFiltrados.map(p => (
              <tr
                key={p.id}
                className={claseFilaEstado(p.estado)}
                onClick={() => abrirGestion(p)}
                style={{ cursor: 'pointer' }}
              >
                <td className="font-bold">{p.finnegansId}</td>
                <td>{p.clienteNombre}</td>
                <td>{p.fecha?.toDate().toLocaleDateString()}</td>
                <td className="font-bold">${p.total?.toFixed(2)}</td>
                <td>{renderEstadoPill(p.estado)}</td>
                <td>
                  <button
                    onClick={(e) => { e.stopPropagation(); abrirGestion(p); }}
                    className="btn btn--secondary btn-sm"
                  >
                    Gestionar
                  </button>
                </td>
              </tr>
            ))}
            {pedidosFiltrados.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
                  No hay pedidos activos
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pedidoSeleccionado && (
        <div className="modal-backdrop">
          <div className="modal-card modal modal-card--xl">

            {/* HEADER FIJO */}
            <div className="modal-header-fixed">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 className="h2" style={{ margin: 0 }}>
                  Gestionar Pedido #{pedidoSeleccionado.finnegansId}
                </h2>
                {renderEstadoPill(pedidoSeleccionado.estado)}
              </div>
              <div className="meta" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: '15px' }}>
                <div className="meta-item">
                  <span className="meta-label">Cliente</span>
                  <span className="meta-value">{pedidoSeleccionado.clienteNombre}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Entrega</span>
                  <span className="meta-value">{pedidoSeleccionado.metodoEntrega}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Pago</span>
                  <span className="meta-value font-bold">
                    {pedidoSeleccionado.metodoPago || "No especificado"}
                    {pedidoSeleccionado.metodoPago === "Transferencia" && ` (${pedidoSeleccionado.bancoTransferencia})`}
                  </span>
                </div>
              </div>
            </div>

            {/* ÁREA DE SCROLL */}
            <div className="modal-scroll-area">

              {/* Resumen de stock */}
              {!loadingStock && (() => {
                const insuficientes = pedidoSeleccionado.items.filter(item => {
                  const sr = getStockRelevante(item.codigo);
                  return sr !== null && sr < item.cantidad;
                });
                if (insuficientes.length > 0) {
                  return (
                    <div className="banner banner--error" style={{ marginBottom: '12px' }}>
                      ⚠️ <strong>{insuficientes.length} producto{insuficientes.length > 1 ? "s" : ""} sin stock suficiente</strong> en depósito {pedidoSeleccionado.depositoAsignado}
                    </div>
                  );
                }
                return (
                  <div className="banner banner--ok" style={{ marginBottom: '12px' }}>
                    ✅ <strong>Stock suficiente</strong> para todos los productos
                  </div>
                );
              })()}

              {/* Nota de error guardada */}
              {pedidoSeleccionado.notaError && (
                <div className="banner banner--error" style={{ marginBottom: '12px' }}>
                  🔴 <strong>Nota del error reportado:</strong> {pedidoSeleccionado.notaError}
                </div>
              )}

              {/* Observaciones del cliente */}
              {pedidoSeleccionado.observaciones && (
                <div className="banner banner--warn" style={{ marginBottom: '12px' }}>
                  📝 <strong>Observaciones del Cliente:</strong> {pedidoSeleccionado.observaciones}
                </div>
              )}

              <div className="card--preparacion">
                <h3 className="card-header">Líneas de Pedido y Stock Real</h3>
                <table className="table table-gestion">
                  <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
                    <tr>
                      <th>Producto</th>
                      <th>Cant. Pedida</th>
                      <th>Stock R8</th>
                      <th>Stock ISA</th>
                      <th>Validación</th>
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
                            <div style={{ fontWeight: '700' }}>
                              {loadingStock ? item.descripcion : (stock?.nombreFinnegans || item.descripcion)}
                            </div>
                            <small className="muted">SKU: {item.codigo}</small>
                          </td>
                          <td className="font-bold" style={{ fontSize: '1.2rem' }}>{item.cantidad}</td>
                          <td style={{ color: !esDepIsa && faltaStock ? 'var(--error)' : 'inherit' }}>
                            {loadingStock ? "..." : (stock?.r8 ?? "...")}
                          </td>
                          <td style={{ color: esDepIsa && faltaStock ? 'var(--error)' : 'inherit' }}>
                            {loadingStock ? "..." : (stock?.isa ?? "...")}
                          </td>
                          <td>
                            {!loadingStock && stock ? (
                              faltaStock
                                ? <span className="pill pill--error">INSUFICIENTE</span>
                                : <span className="pill pill--ok">DISPONIBLE</span>
                            ) : "..."}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* FOOTER */}
            <div style={{ borderTop: '1px solid #eee', paddingTop: '15px' }}>
              {mostrandoFormError ? (
                <div style={{ width: '100%' }}>
                  <label className="label" style={{ marginBottom: '8px', display: 'block' }}>
                    📝 Describí el problema (el cliente lo verá en su pedido):
                  </label>
                  <textarea
                    className="input textarea"
                    value={notaError}
                    onChange={e => setNotaError(e.target.value)}
                    placeholder="Ej: No hay stock del producto X. Se puede reemplazar por Y o cancelar el pedido."
                    style={{ marginBottom: '10px' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setMostrandoFormError(false)} className="btn btn--ghost" style={{ flex: 1 }}>
                      Cancelar
                    </button>
                    <button onClick={confirmarError} className="btn btn--danger" style={{ flex: 2 }}>
                      🔴 Confirmar Error
                    </button>
                  </div>
                </div>
              ) : (
                <div className="product-actions" style={{ flexDirection: 'row', gap: '12px' }}>
                  <button onClick={() => setPedidoSeleccionado(null)} className="btn btn--ghost" style={{ flex: 1 }}>
                    Cerrar
                  </button>

                  {pedidoSeleccionado.estado === "NUEVO" && (
                    <button
                      onClick={() => cambiarEstado(pedidoSeleccionado.id, "EN PREPARACION")}
                      className="btn btn--primary bg-warn"
                      style={{ flex: 2 }}
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
                        className="btn btn--primary bg-ok"
                        style={{ flex: 2 }}
                      >
                        🟢 Marcar como Listo
                      </button>
                    </>
                  )}

                  {pedidoSeleccionado.estado === "PREPARADO" && (
                    <button
                      onClick={() => cambiarEstado(pedidoSeleccionado.id, "ENTREGADO")}
                      className="btn btn--primary"
                      style={{ flex: 2 }}
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
                        className="btn btn--primary bg-ok"
                        style={{ flex: 2 }}
                      >
                        🟢 Confirmar con Cambios
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
