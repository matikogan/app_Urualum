// ============================================================
// ProductModal.jsx — Modal de Producto Rediseñado
// Reemplaza el bloque {productoSeleccionado && (() => { ... })()} 
// de Catalogo.js con este componente standalone.
//
// PROPS:
//   producto         — objeto del producto seleccionado
//   stockInfo        — { r8, isa, Cantidad, Unidad }
//   precioCalculado  — número
//   loadingStock     — bool
//   loadingPrecio    — bool
//   cantidad         — número
//   onCantidadChange — fn(val)
//   onAgregar        — fn()
//   onCerrar         — fn()
//   isVendedorAdmin  — bool
// ============================================================

import React from "react";
import SelectorCantidad, { obtenerLimiteProducto } from "../components/SelectorCantidad";

// ---- Helpers -----------------------------------------------

const colorHexMap = {
  Anodizado:    "#b5babe",
  Blanco:       "#f5f5f5",
  Anolok:       "#2c2c2c",
  Madera:       "#8b5a2b",
  Natural:      "#d1d5d8",
  Negro:        "#1a1a1a",
  Antracita:    "#3d3d3d",
};

function StockBadge({ label, cantidad, unidad, loading }) {
  if (loading) {
    return (
      <div className="pm-stock-badge pm-stock-badge--loading">
        <span className="pm-stock-badge__label">{label}</span>
        <span className="pm-stock-badge__shimmer" />
      </div>
    );
  }

  const n = Number(cantidad ?? 0);
  const state = n >= 10 ? "ok" : n > 0 ? "warn" : "zero";

  return (
    <div className={`pm-stock-badge pm-stock-badge--${state}`}>
      <span className="pm-stock-badge__label">{label}</span>
      <span className="pm-stock-badge__qty">{n}</span>
      <span className="pm-stock-badge__unit">{unidad || "un."}</span>
    </div>
  );
}

function ClientStockPill({ cantidad, loading }) {
  if (loading) return <span className="pm-pill pm-pill--loading">Consultando…</span>;
  const n = Number(cantidad ?? 0);
  if (n >= 10) return <span className="pm-pill pm-pill--ok">✓ Disponible</span>;
  if (n > 0)   return <span className="pm-pill pm-pill--warn">Stock limitado</span>;
  return             <span className="pm-pill pm-pill--zero">Sin stock</span>;
}

// ---- Componente principal ----------------------------------

export default function ProductModal({
  producto,
  stockInfo,
  precioCalculado,
  loadingStock,
  loadingPrecio,
  cantidad,
  onCantidadChange,
  onAgregar,
  onCerrar,
  isVendedorAdmin,
}) {
  if (!producto) return null;

  const esKitManual    = producto.color?.toLowerCase() === "kit";
  const limiteMaximo   = esKitManual ? 10 : obtenerLimiteProducto(producto);
  const superaLimite   = cantidad > limiteMaximo;
  const sinStock       = !loadingStock && (stockInfo?.Cantidad ?? 0) === 0 && !esKitManual;
  const puedeAgregar   = !superaLimite && !loadingPrecio && precioCalculado > 0 && !sinStock;
  const colorHex       = colorHexMap[producto.color];
  const esKit          = producto.esKit;
  const tieneDetalle   = producto.detalle && producto.detalle !== producto.descripcion;

  return (
    <>
      {/* ── Backdrop ── */}
      <div className="pm-backdrop" onClick={onCerrar} />

      {/* ── Sheet ── */}
      <div className="pm-sheet" role="dialog" aria-modal="true">

        {/* Header */}
        <div className="pm-header">
          <div className="pm-header__meta">
            {colorHex && (
              <span
                className="pm-color-dot"
                style={{
                  background: colorHex,
                  border: colorHex === "#f5f5f5" ? "1px solid #ccc" : "none",
                }}
              />
            )}
            {esKit && <span className="pm-kit-tag">KIT ARMADO</span>}
            {producto.padre === "Perfiles Aluminio" && (
              <span className="pm-category-tag">Perfil aluminio</span>
            )}
          </div>

          <h2 className="pm-title">
            {producto.customerNo || producto.descripcion || "Artículo"}
          </h2>

          {producto.codUru && (
            <p className="pm-sku">SKU {producto.codUru}</p>
          )}

          {tieneDetalle && (
            <p className="pm-description">{producto.detalle}</p>
          )}
          {!tieneDetalle && producto.descripcion && (
            <p className="pm-description">{producto.descripcion}</p>
          )}

          {/* Componentes del kit */}
          {esKit && producto.componentesResueltos && (
            <div className="pm-kit-components">
              <p className="pm-kit-components__title">Componentes del kit</p>
              {producto.componentesResueltos.map((c) => (
                <div key={c.codigo} className="pm-kit-row">
                  <span className="pm-kit-row__desc">{c.desc}</span>
                  <span className="pm-kit-row__qty">×{c.cantidadBase}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="pm-divider" />

        {/* Data grid */}
        <div className="pm-data-grid">

          {/* Stock */}
          <div className="pm-data-cell pm-data-cell--stock">
            <span className="pm-data-cell__label">Disponibilidad</span>
            {isVendedorAdmin ? (
              <div className="pm-stock-badges">
                <StockBadge
                  label="R8"
                  cantidad={stockInfo?.r8}
                  unidad={stockInfo?.Unidad}
                  loading={loadingStock}
                />
                <StockBadge
                  label="ISA"
                  cantidad={stockInfo?.isa}
                  unidad={stockInfo?.Unidad}
                  loading={loadingStock}
                />
              </div>
            ) : (
              <ClientStockPill cantidad={stockInfo?.Cantidad} loading={loadingStock} />
            )}
          </div>

          {/* Precio */}
          <div className="pm-data-cell pm-data-cell--price">
            <span className="pm-data-cell__label">Precio unitario</span>
            {loadingPrecio ? (
              <span className="pm-price pm-price--loading">
                <span className="pm-stock-badge__shimmer" style={{ width: 80, height: 28, display: "inline-block", borderRadius: 4 }} />
              </span>
            ) : (
              <span className="pm-price">
                <span className="pm-price__currency">$</span>
                {precioCalculado > 0
                  ? precioCalculado.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "—"}
              </span>
            )}
          </div>

          {/* Peso (solo perfiles) */}
          {producto.padre === "Perfiles Aluminio" && producto.peso && (
            <div className="pm-data-cell pm-data-cell--weight">
              <span className="pm-data-cell__label">Peso por tira</span>
              <span className="pm-data-cell__value">{producto.peso} <small>kg</small></span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="pm-divider" />

        {/* Selector de cantidad */}
        {!sinStock && (
          <div className="pm-qty-row">
            <span className="pm-qty-row__label">Cantidad</span>
            <SelectorCantidad
              cantidad={cantidad}
              onChange={onCantidadChange}
              producto={producto}
            />
            {superaLimite && (
              <p className="pm-qty-warning">
                Límite máximo: {limiteMaximo} unidades
              </p>
            )}
          </div>
        )}

        {/* Total calculado */}
        {!sinStock && precioCalculado > 0 && !loadingPrecio && (
          <div className="pm-total-row">
            <span className="pm-total-row__label">Total</span>
            <span className="pm-total-row__value">
              ${(precioCalculado * cantidad).toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="pm-actions">
          {sinStock ? (
            <div className="pm-out-of-stock">Sin stock disponible en este momento</div>
          ) : (
            <button
              className={`pm-btn-add ${puedeAgregar ? "pm-btn-add--active" : "pm-btn-add--disabled"}`}
              onClick={onAgregar}
              disabled={!puedeAgregar}
            >
              {superaLimite
                ? `Límite: ${limiteMaximo}`
                : loadingPrecio
                ? "Calculando precio…"
                : loadingStock
                ? "Verificando stock…"
                : "Agregar al carrito"}
            </button>
          )}
          <button className="pm-btn-cancel" onClick={onCerrar}>
            Cancelar
          </button>
        </div>

      </div>
    </>
  );
}
