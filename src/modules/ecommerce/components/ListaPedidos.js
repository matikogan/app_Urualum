import React, { useState } from "react";
import logo from "../../../logo-urualum.png";
import { useApp } from "context/AppContext";
import { useNavigate } from "react-router-dom";

// ── Datos bancarios centralizados ────────────────────────────
const CUENTAS_BANCARIAS = {
  BROU: [
    { id: "brou-uy",  label: "Pesos ($UY)",    valor: "184-0844570 / 001818622-00001" },
    { id: "brou-usd", label: "Dólares (U$S)",  valor: "184-0844588 / 001818622-00002" },
  ],
  ITAU: [
    { id: "itau-uy",  label: "Pesos ($UY)",    valor: "7133510" },
    { id: "itau-usd", label: "Dólares (U$S)",  valor: "7132404" },
  ],
  SANTANDER: [
    { id: "san-uy",   label: "Pesos ($UY)",    valor: "1174665 (Suc. 7)" },
    { id: "san-usd",  label: "Dólares (U$S)",  valor: "5101083855" },
  ],
};

// ── Helper: pill de estado ───────────────────────────────────
function EstadoPill({ estado }) {
  switch (estado) {
    case "NUEVO":          return <span className="pill pill--brand">🔵 Recibido</span>;
    case "EN PREPARACION": return <span className="pill pill--warn">🟡 En Preparación</span>;
    case "PREPARADO":      return <span className="pill pill--ok">🟢 ¡Listo!</span>;
    case "ERROR_STOCK":    return <span className="pill pill--error">🔴 Diferencia de Stock</span>;
    case "ENTREGADO":      return <span className="pill pill--info">✅ Entregado</span>;
    case "CANCELADO":      return <span className="pill pill--error">🚫 Cancelado</span>;
    default:               return <span className="pill">{estado}</span>;
  }
}

// ── C6: Caja de dato bancario con botón de copiar ────────────
function CajaCopiable({ id, label, valor, copiadoId, onCopiar }) {
  const esCopia = copiadoId === id;
  return (
    <div className="copy-box">
      <div className="copy-box__label">{label}</div>
      <div className="copy-box__row">
        <code className="copy-box__valor">{valor}</code>
        <button
          className={`copy-box__btn ${esCopia ? "copy-box__btn--copiado" : ""}`}
          onClick={() => onCopiar(valor, id)}
        >
          {esCopia ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

// ── C5: Vista de detalle completa (reemplaza el modal) ───────
function PedidoDetalle({ pedido: p, onVolver, copiadoId, onCopiar, onRepetir }) {
  const banco = p.metodoPago === "Transferencia" ? CUENTAS_BANCARIAS[p.bancoTransferencia] : null;

  return (
    <div className="container pedido-detalle">

      {/* Header sticky con botón volver */}
      <div className="pedido-detalle__header">
        <button className="pedido-detalle__back" onClick={onVolver}>
          ← Volver
        </button>
        <h2 className="pedido-detalle__title">Pedido #{p.finnegansId}</h2>
        <EstadoPill estado={p.estado} />
      </div>

      {/* Banner de estado especial */}
      {p.estado === "PREPARADO" && (
        <div className="pago-instrucciones">
          <p className="pago-instrucciones__titulo">🎉 ¡Tu pedido está listo!</p>
          {p.metodoPago === "Transferencia" ? (
            <p className="pago-instrucciones__sub">Realizá la transferencia y enviá el comprobante al grupo de WhatsApp.</p>
          ) : (
            <p className="pago-instrucciones__sub">Acercate al local para realizar el pago y retirar tu mercadería.</p>
          )}
        </div>
      )}

      {p.estado === "ERROR_STOCK" && (
        <div className="banner banner--error" style={{ marginBottom: "12px" }}>
          <strong>⚠️ Hay una diferencia en tu pedido</strong>
          {p.itemsConError?.length > 0 ? (
            <>
              <p style={{ margin: "8px 0 4px", fontSize: "14px", fontWeight: 600 }}>
                Productos con problema:
              </p>
              <ul style={{ margin: "0 0 6px", paddingLeft: "18px" }}>
                {p.itemsConError.map((it, i) => (
                  <li key={i} style={{ fontSize: "14px", marginBottom: "4px" }}>
                    <strong>{it.descripcion}</strong> (x{it.cantidadPedida})
                    {it.nota ? <span style={{ color: "#7f1d1d" }}> — {it.nota}</span> : ""}
                  </li>
                ))}
              </ul>
              {p.notaError && (
                <p style={{ margin: "4px 0 0", fontSize: "13px" }}>{p.notaError}</p>
              )}
              <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#7f1d1d" }}>
                Un asesor se contactará contigo a la brevedad.
              </p>
            </>
          ) : (
            <p style={{ margin: "6px 0 0", fontSize: "14px" }}>
              {p.notaError || "Un asesor se contactará contigo a la brevedad."}
            </p>
          )}
        </div>
      )}

      {p.estado === "CANCELADO" && (
        <div className="banner banner--error" style={{ marginBottom: "12px" }}>
          <strong>🚫 Este pedido fue cancelado</strong>
          {p.notaError && <p style={{ margin: "6px 0 0", fontSize: "14px" }}>{p.notaError}</p>}
        </div>
      )}

      {/* Resumen del pedido: entrega, pago, fecha */}
      <div className="pedido-detalle__info">
        <div className="detalle-info-item">
          <span className="detalle-info-item__label">Entrega</span>
          <span className="detalle-info-item__value">{p.metodoEntrega || "—"}</span>
        </div>
        <div className="detalle-info-item">
          <span className="detalle-info-item__label">Pago</span>
          <span className="detalle-info-item__value">{p.metodoPago || "—"}</span>
        </div>
        <div className="detalle-info-item">
          <span className="detalle-info-item__label">Fecha</span>
          <span className="detalle-info-item__value">
            {p.fecha?.toDate().toLocaleDateString("es-UY", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
        <div className="detalle-info-item">
          <span className="detalle-info-item__label">Ítems</span>
          <span className="detalle-info-item__value">{p.items?.length || 0}</span>
        </div>
      </div>

      {/* C6: Instrucciones de pago bancario */}
      {p.estado === "PREPARADO" && banco && (
        <div className="card" style={{ marginBottom: "12px" }}>
          <p style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "10px" }}>
            Datos para transferir — {p.bancoTransferencia}
          </p>
          <p style={{ fontSize: "13px", color: "#334155", marginBottom: "10px" }}>
            Titular: <strong>NICUICO, SA.</strong>
          </p>
          {banco.map(cuenta => (
            <CajaCopiable
              key={cuenta.id}
              id={cuenta.id}
              label={cuenta.label}
              valor={cuenta.valor}
              copiadoId={copiadoId}
              onCopiar={onCopiar}
            />
          ))}
          <p className="pago-wsp-aviso">
            📲 Enviá el comprobante al grupo de WhatsApp para que podamos liberar la mercadería.
          </p>
        </div>
      )}

      {/* Lista completa de ítems — sin scroll interno */}
      <div className="card" style={{ marginBottom: "12px" }}>
        <p style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: "12px" }}>
          Productos del pedido
        </p>
        <div className="pedido-items-list">
          {p.items?.map((item, idx) => (
            <div key={idx} className="pedido-item-row">
              <div style={{ flex: 1 }}>
                <div className="pedido-item-row__desc">{item.descripcion}</div>
                <div className="pedido-item-row__sku">SKU {item.codigo}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="pedido-item-row__precio">
                  {item.cantidad} × ${item.precioUnitario?.toLocaleString("es-UY")}
                </div>
                <div className="pedido-item-row__cant">
                  = ${(item.cantidad * item.precioUnitario)?.toLocaleString("es-UY", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total */}
      <div className="pedido-detalle__total">
        <span className="pedido-detalle__total-label">Total del pedido</span>
        <span className="pedido-detalle__total-valor">${p.total?.toLocaleString("es-UY", { minimumFractionDigits: 2 })}</span>
      </div>

      {/* Acción: repetir pedido */}
      {p.estado !== "CANCELADO" && (
        <button
          onClick={onRepetir}
          className="btn btn--secondary btn--full"
          style={{ marginTop: "16px", background: "#e7f5ec", color: "#2e7d32", border: "1px solid #cde9d6" }}
        >
          🔄 Repetir este pedido
        </button>
      )}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────
export default function ListaPedidos({ pedidos, loading, onVolver }) {
  const navigate = useNavigate();
  const { agregarAlCarrito, limpiarCarrito } = useApp();

  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [copiadoId, setCopiadoId] = useState(null);         // C6
  const [showConfirmRepetir, setShowConfirmRepetir] = useState(false); // C7

  // C6: función de copia al portapapeles
  const handleCopiar = (texto, id) => {
    navigator.clipboard.writeText(texto).catch(() => {});
    setCopiadoId(id);
    setTimeout(() => setCopiadoId(null), 2500);
  };

  // Abrir detalle y hacer scroll al tope (importante en mobile)
  const abrirDetalle = (p) => {
    setPedidoSeleccionado(p);
    window.scrollTo(0, 0);
  };

  // C7: repetir pedido con modal propio en lugar de window.confirm
  const handleRepetirPedido = () => {
    limpiarCarrito();
    pedidoSeleccionado.items.forEach(item => {
      agregarAlCarrito({
        codigo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        precioTotal: item.precioUnitario * item.cantidad,
      });
    });
    setShowConfirmRepetir(false);
    navigate("/carrito");
  };

  // C5: Si hay pedido seleccionado, mostrar vista completa (no modal)
  if (pedidoSeleccionado) {
    return (
      <>
        <PedidoDetalle
          pedido={pedidoSeleccionado}
          onVolver={() => { setPedidoSeleccionado(null); window.scrollTo(0, 0); }}
          copiadoId={copiadoId}
          onCopiar={handleCopiar}
          onRepetir={() => setShowConfirmRepetir(true)}
        />

        {/* C7: Modal de confirmación personalizado */}
        {showConfirmRepetir && (
          <div className="modal-backdrop">
            <div className="modal-card modal">
              <div className="modal-confirm__icon">🔄</div>
              <h3 className="modal-confirm__title">¿Repetir este pedido?</h3>
              <p className="modal-confirm__body">
                Se va a limpiar tu carrito actual y se van a cargar los{" "}
                <strong>{pedidoSeleccionado.items?.length} productos</strong> de este pedido.
              </p>
              <div className="modal-confirm__actions">
                <button
                  className="btn btn--primary btn--full"
                  style={{ background: "var(--ok)" }}
                  onClick={handleRepetirPedido}
                >
                  Sí, cargar al carrito
                </button>
                <button
                  className="btn btn--ghost btn--full"
                  onClick={() => setShowConfirmRepetir(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Vista lista de pedidos
  return (
    <div className="container" style={{ paddingBottom: "40px" }}>

      {/* Header */}
      <header className="topbar card" style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button onClick={onVolver} className="btn btn--secondary nav-back">
            ← Inicio
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", borderLeft: "1px solid #eee", paddingLeft: "12px" }}>
            <img src={logo} alt="Urualum" style={{ height: "24px", width: "auto" }} />
            <h2 className="h2" style={{ margin: 0, color: "var(--brand)", fontSize: "1rem" }}>
              Mis Pedidos
            </h2>
          </div>
        </div>
      </header>

      {/* Contenido */}
      {loading ? (
        <div className="card empty-card">⏳ Sincronizando...</div>
      ) : pedidos.length === 0 ? (
        <div className="card empty-card">
          <h3 className="h2 muted">No hay compras registradas.</h3>
        </div>
      ) : (
        <div className="orders-grid">
          {pedidos.map(p => {
            const esPreparado = p.estado === "PREPARADO";
            const esError = p.estado === "ERROR_STOCK";
            return (
              <div
                key={p.id}
                onClick={() => abrirDetalle(p)}
                className={`order-card card card--selectable ${esPreparado ? "order-card--preparado" : esError ? "order-card--error" : ""}`}
              >
                {/* C3+C4: head con número + fecha + total + estado */}
                <div className="order-head">
                  <div>
                    <h3 className="order-number">Pedido #{p.finnegansId}</h3>
                    <div className="meta-label">
                      {p.fecha?.toDate().toLocaleDateString("es-UY", { day: "2-digit", month: "short" })}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="h2" style={{ margin: "0 0 4px 0" }}>
                      ${p.total?.toFixed(2)}
                    </div>
                    <EstadoPill estado={p.estado} />
                  </div>
                </div>

                {/* C4: Meta row — entrega + cantidad de ítems */}
                <div className="order-card-meta">
                  <span>📦 {p.items?.length || 0} ítem{p.items?.length !== 1 ? "s" : ""}</span>
                  <span>🚚 {p.metodoEntrega || "Retiro"}</span>
                </div>

                {/* C3: Hint visible sin abrir el detalle */}
                {esPreparado && (
                  <div className="order-card-hint order-card-hint--preparado">
                    {p.metodoPago === "Transferencia"
                      ? "💳 Ver instrucciones de pago →"
                      : "📍 Acercate al local para retirar →"}
                  </div>
                )}
                {esError && (
                  <div className="order-card-hint order-card-hint--error">
                    ⚠️ Hay una diferencia en tu pedido. Tocá para ver los detalles →
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
