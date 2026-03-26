// src/components/SelectorCantidad.js
import React from "react";

export const obtenerLimiteProducto = (producto) => {
    const PRODUCTOS_TIRAS = ['502001891','502001901', '502001902', '502001903', '502001904'];
    if (PRODUCTOS_TIRAS.includes(producto.codigo || producto.codUru)) return 20;
    if (producto.padre === "Accesorio Aluminio") return 500;
    return 9999;
};

export default function SelectorCantidad({ cantidad, onChange, producto }) {
  const limite = obtenerLimiteProducto(producto);

  const handleInput = (valor) => {
    let num = parseInt(valor);
    if (valor === "") { onChange(0); return; }
    if (isNaN(num) || num < 1) num = 1;
    onChange(num);
  };

  const esExceso = cantidad > limite;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div className="qty-selector" style={{ borderColor: esExceso ? 'var(--error)' : '#e9ecef' }}>
        <button 
          className="qty-selector__btn" 
          onClick={() => handleInput(cantidad - 1)} 
          disabled={cantidad <= 1}
        >
          -
        </button>
        
        <input 
          type="tel" 
          className="qty-selector__input"
          value={cantidad === 0 ? "" : cantidad}
          onChange={(e) => handleInput(e.target.value)}
          style={{ color: esExceso ? 'var(--error)' : 'inherit' }}
        />
        
        <button 
          className="qty-selector__btn" 
          onClick={() => handleInput(cantidad + 1)}
        >
          +
        </button>
      </div>

      {esExceso && (
        <small style={{ color: 'var(--error)', fontWeight: '700', marginTop: '4px' }}>
          Límite: {limite}
        </small>
      )}
    </div>
  );
}