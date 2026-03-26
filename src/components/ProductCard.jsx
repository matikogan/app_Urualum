// ============================================================
// ProductCard.jsx — Tarjeta de Producto Rediseñada
//
// Reemplaza la función renderProductCard(p) en Catalogo.js.
//
// PROPS:
//   producto    — objeto del producto
//   onClick     — fn(producto)
//   animIndex   — número (para stagger de animación, opcional)
// ============================================================

import React from "react";

const COLOR_HEX = {
  Anodizado: "#b5babe",
  Blanco:    "#f0f0f0",
  Anolok:    "#2c2c2c",
  Madera:    "#8b5a2b",
  Natural:   "#d1d5d8",
  Negro:     "#1a1a1a",
  Antracita: "#3d3d3d",
};

const OFERTAS = [
  "502028111", "502028112", "513000121", "513000131",
];

export default function ProductCard({ producto: p, onClick, animIndex = 0 }) {
  const colorHex = COLOR_HEX[p.color];
  const esOferta = OFERTAS.includes(p.codUru);
  const esKit    = p.esKit;

  // Descripción corta: max 72 caracteres
  const desc = p.descripcion
    ? p.descripcion.length > 72
      ? p.descripcion.slice(0, 69) + "…"
      : p.descripcion
    : null;

  return (
    <div
      className="pc-card"
      style={{ animationDelay: `${animIndex * 35}ms` }}
      onClick={() => onClick(p)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick(p)}
    >
      {/* Banda superior de color */}
      {colorHex && (
        <div
          className="pc-color-band"
          style={{
            background: colorHex,
            border: colorHex === "#f0f0f0" ? "none" : undefined,
          }}
        />
      )}

      <div className="pc-body">
        {/* Badges superiores */}
        <div className="pc-badges">
          {esOferta && <span className="pc-badge pc-badge--offer">🔥 Oferta</span>}
          {esKit    && <span className="pc-badge pc-badge--kit">Kit armado</span>}
          {p.color && !esKit && (
            <span className="pc-badge pc-badge--color">{p.color}</span>
          )}
        </div>

        {/* Nombre principal */}
        <p className="pc-name">
          {p.customerNo || p.codUru || "Artículo"}
        </p>

        {/* Descripción corta */}
        {desc && <p className="pc-desc">{desc}</p>}

        {/* Footer: SKU + flecha */}
        <div className="pc-footer">
          {p.codUru && (
            <span className="pc-sku">{p.codUru}</span>
          )}
          <span className="pc-arrow">→</span>
        </div>
      </div>
    </div>
  );
}
