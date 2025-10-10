// src/components/SearchBar.jsx
import { useEffect, useRef } from "react";

export default function SearchBar({
  value,
  onChange,
  placeholder = "Buscar por #pedido, cliente o descripción…",
  autoFocus = false,
  onClear,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  return (
    <div className="searchbar">
      <input
        ref={ref}
        type="text"
        className="searchbar__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="searchbar__clear"
          onClick={onClear}
          aria-label="Limpiar búsqueda"
        >
          ×
        </button>
      ) : (
        <span className="searchbar__icon">🔍</span>
      )}
    </div>
  );
}
