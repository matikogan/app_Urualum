// src/modules/pedidos/pages/EtiquetasHistorial.js
//
// Historial de cargas finalizadas: permite revisar qué pedidos y bultos
// se enviaron en cada carga (camión/gira) y si quedaron todos escaneados.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarCargasCompletas } from "../services/etiquetasFS";

function formatFecha(ts) {
  if (!ts?.toDate) return "";
  try {
    return ts.toDate().toLocaleString("es-UY", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function EtiquetasHistorial() {
  const navigate = useNavigate();
  const [cargas, setCargas] = useState(null);
  const [abierta, setAbierta] = useState(null);

  useEffect(() => {
    let cancelado = false;
    listarCargasCompletas().then((items) => {
      if (!cancelado) setCargas(items);
    });
    return () => { cancelado = true; };
  }, []);

  return (
    <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={volverStyle}>← Volver</button>

      <h2 style={{ margin: "0 0 4px", fontSize: "1.1rem" }}>📋 Historial de cargas</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "#64748b" }}>
        Cargas finalizadas. Tocá una para ver los pedidos y bultos que se enviaron.
      </p>

      {cargas === null ? (
        <p style={{ color: "#94a3b8" }}>Cargando…</p>
      ) : cargas.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Todavía no hay cargas finalizadas.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {cargas.map((c) => {
            const items = c.items || [];
            const escaneados = new Set(c.escaneados || []);
            const bultosTotal = items.reduce((acc, it) => acc + (Number(it.bultos) || 1), 0);
            const abiertaAhora = abierta === c.id;
            return (
              <div key={c.id} style={{ border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "10px 14px" }}>
                <button
                  onClick={() => setAbierta(abiertaAhora ? null : c.id)}
                  style={{
                    width: "100%", background: "none", border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "space-between", padding: 0,
                  }}
                >
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>📦 {c.nombre}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                      {items.length} pedido(s) · {escaneados.size}/{bultosTotal} bultos
                      {c.completadaAt && ` · ${formatFecha(c.completadaAt)}`}
                    </div>
                  </div>
                  <span style={{ color: "#94a3b8", fontSize: "1.1rem" }}>{abiertaAhora ? "▲" : "▼"}</span>
                </button>

                {abiertaAhora && (
                  <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {items.map((it) => {
                      const bultos = Math.max(1, Number(it.bultos) || 1);
                      return (
                        <div key={it.pedidoId} style={{ borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "#0f172a" }}>
                            #{it.numero} — {it.cliente}
                          </div>
                          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                            {it.direccion}{it.direccion && it.localidad ? " — " : ""}{it.localidad}
                          </div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                            {Array.from({ length: bultos }, (_, i) => i + 1).map((b) => {
                              const key = `${it.pedidoId}|${b}/${bultos}`;
                              const ok = escaneados.has(key);
                              return (
                                <span key={key} style={{
                                  display: "inline-flex", alignItems: "center", gap: "4px",
                                  padding: "3px 8px", borderRadius: "999px", fontSize: "0.72rem", fontWeight: 600,
                                  background: ok ? "#dcfce7" : "#fef2f2",
                                  color: ok ? "#15803d" : "#b91c1c",
                                  border: `1px solid ${ok ? "#86efac" : "#fecaca"}`,
                                }}>
                                  {ok ? "✓" : "✗"} Bulto {b}/{bultos}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
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

const volverStyle = {
  background: "none", border: "none", color: "#15803d", fontWeight: 600,
  fontSize: "0.85rem", padding: 0, marginBottom: "12px", cursor: "pointer",
};
