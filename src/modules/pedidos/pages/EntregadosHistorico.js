/**
 * EntregadosHistorico — búsqueda y consulta de pedidos entregados.
 *
 * Diseño desktop-first. Carga los últimos 1000 pedidos de `pedidos_entregados`
 * y permite buscar por: nº de pedido, cliente y nombre/código de producto.
 * Filtros: rango de fechas + depósito.
 */

import { useEffect, useState, useMemo } from "react";
import {
  collection, query, orderBy, onSnapshot, limit,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { norm } from "utils/text";
// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(ts) {
  if (!ts?.seconds) return "—";
  return new Date(ts.seconds * 1000).toLocaleDateString("es-AR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatDateTime(ts) {
  if (!ts?.seconds) return "—";
  return new Date(ts.seconds * 1000).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const METODO_STYLE = {
  AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
  RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
  CAMION:  { bg: "#fef3c7", color: "#92400e" },
  GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
};

// ── Componente principal ───────────────────────────────────────────────────

export default function EntregadosHistorico() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const depositoUsuario = profile?.deposito
    ? String(profile.deposito).toUpperCase()
    : null;

  const [pedidos, setPedidos]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [searchQ, setSearchQ]         = useState("");
  const [debouncedQ, setDebouncedQ]   = useState("");
  const [filterDep, setFilterDep]     = useState(depositoUsuario || "");
  const [expandedId, setExpandedId]   = useState(null);

  // Rango de fechas — default: últimos 30 días
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [fechaHasta, setFechaHasta] = useState(
    () => new Date().toISOString().split("T")[0]
  );

  // ── Listener Firestore ──────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "pedidos_entregados"),
      orderBy("entregadoAt", "desc"),
      limit(1000)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPedidos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("[EntregadosHistorico]", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Debounce de búsqueda
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(searchQ), 250);
    return () => clearTimeout(h);
  }, [searchQ]);

  // ── Filtros ─────────────────────────────────────────────────────────────
  const pedidosFiltrados = useMemo(() => {
    let out = pedidos;

    // Depósito
    if (filterDep) {
      out = out.filter(
        (p) => String(p.deposito || "").toUpperCase() === filterDep
      );
    }

    // Rango de fechas (sobre entregadoAt)
    if (fechaDesde) {
      const from = new Date(fechaDesde + "T00:00:00").getTime();
      out = out.filter((p) => {
        const t = p.entregadoAt?.seconds;
        return t ? t * 1000 >= from : true;
      });
    }
    if (fechaHasta) {
      const to = new Date(fechaHasta + "T23:59:59").getTime();
      out = out.filter((p) => {
        const t = p.entregadoAt?.seconds;
        return t ? t * 1000 <= to : true;
      });
    }

    // Búsqueda de texto (número, cliente, o cualquier producto)
    if (debouncedQ) {
      const nq = norm(debouncedQ);
      out = out.filter((p) => {
        if (norm(p.numero || p.id || "").includes(nq)) return true;
        if (norm(p.cliente || "").includes(nq)) return true;
        if (
          p.productos?.some(
            (pr) =>
              // Finnegans guarda la descripción en "desc" y el código en "cod"
              norm(pr.desc || pr.nombre || pr.descripcion || "").includes(nq) ||
              norm(pr.cod || pr.codUru || pr.codigo || "").includes(nq)
          )
        )
          return true;
        return false;
      });
    }

    return out;
  }, [pedidos, filterDep, fechaDesde, fechaHasta, debouncedQ]);

  const hayFiltros = !!(searchQ || fechaDesde || fechaHasta);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

      {/* ── Header sticky ── */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "0 24px",
        height: "58px",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        position: "sticky",
        top: 0,
        zIndex: 20,
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "34px", height: "34px", flexShrink: 0,
            background: "#f8fafc", border: "1px solid #e2e8f0",
            borderRadius: "10px", cursor: "pointer", fontSize: "1rem",
          }}
        >
          ←
        </button>

        <h1 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
          📦 Entregados — Histórico
        </h1>

        {/* Stats */}
        {!loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              background: "#f0fdf4", color: "#15803d",
              fontSize: "0.72rem", fontWeight: 700,
              padding: "3px 10px", borderRadius: "999px",
            }}>
              {pedidosFiltrados.length} resultado{pedidosFiltrados.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Chips de depósito */}
        <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
          {["", "ISABELA", "R8"].map((dep) => {
            const active = filterDep === dep;
            return (
              <button
                key={dep || "__todos__"}
                onClick={() => setFilterDep(dep)}
                style={{
                  padding: "4px 12px",
                  borderRadius: "999px",
                  border: "none",
                  background: active ? "#0f172a" : "#f1f5f9",
                  color: active ? "#fff" : "#64748b",
                  fontSize: "0.74rem",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
              >
                {dep || "Todos"}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Barra de filtros ── */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #f1f5f9",
        padding: "12px 24px",
        display: "flex",
        gap: "12px",
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        {/* Búsqueda */}
        <input
          placeholder="🔍 Buscar por #pedido, cliente o producto…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          style={{
            flex: "1 1 300px",
            minWidth: "200px",
            padding: "8px 14px",
            borderRadius: "10px",
            border: "1.5px solid #e2e8f0",
            fontSize: "0.87rem",
            background: "#f8fafc",
            outline: "none",
          }}
        />

        {/* Rango de fechas */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{
            fontSize: "0.78rem", color: "#64748b", fontWeight: 600, whiteSpace: "nowrap",
          }}>
            Desde
          </span>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: "8px",
              border: "1.5px solid #e2e8f0",
              fontSize: "0.82rem",
              background: "#f8fafc",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>hasta</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: "8px",
              border: "1.5px solid #e2e8f0",
              fontSize: "0.82rem",
              background: "#f8fafc",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Botón limpiar */}
        {hayFiltros && (
          <button
            onClick={() => { setSearchQ(""); setFechaDesde(""); setFechaHasta(""); }}
            style={{
              padding: "7px 13px",
              borderRadius: "8px",
              border: "1.5px solid #fca5a5",
              background: "#fef2f2",
              color: "#dc2626",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            ✕ Limpiar filtros
          </button>
        )}
      </div>

      {/* ── Contenido ── */}
      <div style={{ padding: "20px 24px 80px" }}>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8", fontSize: "0.9rem" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 10px" }}>⏳</p>
            Cargando historial…
          </div>
        ) : pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <p style={{ fontSize: "2.5rem", margin: "0 0 10px" }}>📭</p>
            <p style={{ margin: 0, fontSize: "0.93rem", color: "#64748b", fontWeight: 500 }}>
              {debouncedQ
                ? `Sin resultados para "${debouncedQ}"`
                : "No hay pedidos entregados en este período."}
            </p>
            {hayFiltros && (
              <button
                onClick={() => { setSearchQ(""); setFechaDesde(""); setFechaHasta(""); }}
                style={{
                  marginTop: "14px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1.5px solid #e2e8f0",
                  background: "#fff",
                  color: "#475569",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                }}
              >
                Quitar filtros
              </button>
            )}
          </div>
        ) : (
          <div style={{
            background: "#fff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          }}>

            {/* Cabecera de tabla */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr 110px 70px 165px 90px 28px",
              padding: "9px 16px",
              background: "#f8fafc",
              borderBottom: "1px solid #f1f5f9",
            }}>
              {["# Pedido", "Cliente", "Método", "Ítems", "Entregado el", "Depósito", ""].map((h, i) => (
                <span key={i} style={{
                  fontSize: "0.66rem", fontWeight: 700,
                  color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Filas */}
            {pedidosFiltrados.map((p, i) => {
              const mc = METODO_STYLE[p.metodoEntrega] || { bg: "#f1f5f9", color: "#475569" };
              const prods = p.productos || [];
              const isExpanded = expandedId === p.id;
              const isOdd = i % 2 === 0;

              // Destacar productos que coinciden con la búsqueda
              const matchedProds = debouncedQ
                ? prods.filter((pr) => {
                    const nq = norm(debouncedQ);
                    return (
                      norm(pr.desc || pr.nombre || pr.descripcion || "").includes(nq) ||
                      norm(pr.cod || pr.codUru || pr.codigo || "").includes(nq)
                    );
                  })
                : [];

              return (
                <div key={p.id}>
                  {/* Fila principal */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "130px 1fr 110px 70px 165px 90px 28px",
                      padding: "11px 16px",
                      background: isExpanded
                        ? "#f0f9ff"
                        : isOdd ? "#fff" : "#fafafa",
                      borderBottom: isExpanded ? "none" : "1px solid #f1f5f9",
                      cursor: "pointer",
                      transition: "background 0.1s",
                      alignItems: "center",
                    }}
                    onMouseEnter={(e) => {
                      if (!isExpanded) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (!isExpanded)
                        e.currentTarget.style.background = isOdd ? "#fff" : "#fafafa";
                    }}
                    onClick={() => navigate(`/pedidos/${encodeURIComponent(p.id)}`)}
                  >
                    {/* # Pedido */}
                    <span style={{ fontWeight: 700, fontSize: "0.87rem", color: "#0f172a" }}>
                      #{p.numero || p.id}
                    </span>

                    {/* Cliente */}
                    <span style={{
                      fontSize: "0.87rem", color: "#1e293b", fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      paddingRight: "8px",
                    }}>
                      {p.cliente || "—"}
                    </span>

                    {/* Método */}
                    <div>
                      {p.metodoEntrega ? (
                        <span style={{
                          fontSize: "0.65rem", fontWeight: 700,
                          background: mc.bg, color: mc.color,
                          padding: "2px 8px", borderRadius: "999px",
                          whiteSpace: "nowrap",
                        }}>
                          {p.metodoEntrega}
                        </span>
                      ) : (
                        <span style={{ color: "#d1d5db", fontSize: "0.82rem" }}>—</span>
                      )}
                    </div>

                    {/* Ítems */}
                    <span
                      style={{
                        fontSize: "0.82rem", color: "#64748b",
                        cursor: "default",
                      }}
                      title={prods
                        .map((pr) => {
                          const nombre = (pr.desc || pr.nombre || pr.descripcion || "")
                            .replace(/^\d+\s*/, "").trim() || pr.cod || "?";
                          const cant = pr.cant ?? pr.cantidad;
                          return `• ${nombre}${cant != null ? ` × ${cant}` : ""}`;
                        })
                        .join("\n")}
                    >
                      {prods.length} ítem{prods.length !== 1 ? "s" : ""}
                    </span>

                    {/* Entregado el */}
                    <div>
                      <div style={{ fontSize: "0.82rem", color: "#475569" }}>
                        {formatDate(p.entregadoAt)}
                      </div>
                      {p.entregadoPorNombre && (
                        <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: "1px" }}>
                          👤 {p.entregadoPorNombre}
                        </div>
                      )}
                    </div>

                    {/* Depósito */}
                    <span style={{
                      fontSize: "0.78rem", color: "#94a3b8", fontWeight: 500,
                    }}>
                      {p.deposito || "—"}
                    </span>

                    {/* Botón expandir productos */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : p.id);
                      }}
                      title={isExpanded ? "Ocultar productos" : "Ver productos"}
                      style={{
                        width: "24px", height: "24px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isExpanded ? "#0f172a" : "#f1f5f9",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "0.6rem",
                        color: isExpanded ? "#fff" : "#64748b",
                        fontWeight: 700,
                        transition: "all 0.12s",
                        flexShrink: 0,
                      }}
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </div>

                  {/* Fila expandida — listado de productos */}
                  {isExpanded && (
                    <div style={{
                      background: "#f0f9ff",
                      borderBottom: "1px solid #bae6fd",
                      borderTop: "1px solid #bae6fd",
                      padding: "10px 16px 14px 24px",
                    }}>
                      <p style={{
                        margin: "0 0 8px",
                        fontSize: "0.67rem", fontWeight: 700,
                        color: "#0284c7", textTransform: "uppercase", letterSpacing: "0.07em",
                      }}>
                        Productos del pedido
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {prods.length === 0 ? (
                          <span style={{ fontSize: "0.82rem", color: "#94a3b8" }}>Sin detalle de productos</span>
                        ) : (
                          prods.map((pr, pi) => {
                            const isMatch = matchedProds.includes(pr);
                            return (
                              <div
                                key={pi}
                                style={{
                                  display: "flex", alignItems: "center", gap: "10px",
                                  padding: "5px 10px",
                                  borderRadius: "7px",
                                  background: isMatch ? "#fef9c3" : "#fff",
                                  border: isMatch ? "1px solid #fde047" : "1px solid #e2e8f0",
                                  fontSize: "0.83rem",
                                }}
                              >
                                {/* Código */}
                                {(pr.cod || pr.codUru || pr.codigo) && (
                                  <span style={{
                                    fontFamily: "monospace",
                                    fontSize: "0.75rem",
                                    color: "#64748b",
                                    background: "#f1f5f9",
                                    padding: "1px 6px",
                                    borderRadius: "4px",
                                    flexShrink: 0,
                                  }}>
                                    {pr.cod || pr.codUru || pr.codigo}
                                  </span>
                                )}
                                {/* Nombre — Finnegans lo guarda en "desc" */}
                                <span style={{ flex: 1, color: "#1e293b", fontWeight: 500 }}>
                                  {/* desc contiene "CODIGO Nombre producto" — mostramos sin el código al inicio */}
                                  {(pr.desc || pr.nombre || pr.descripcion || "Sin nombre")
                                    .replace(/^\d+\s*/, "").trim() || pr.desc || "Sin nombre"}
                                </span>
                                {/* Cantidad — Finnegans lo guarda en "cant" */}
                                {(pr.cant ?? pr.cantidad) !== undefined && (pr.cant ?? pr.cantidad) !== null && (
                                  <span style={{
                                    fontSize: "0.78rem", color: "#64748b",
                                    background: "#f8fafc",
                                    padding: "1px 8px",
                                    borderRadius: "6px",
                                    flexShrink: 0,
                                  }}>
                                    × {pr.cant ?? pr.cantidad}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Link al detalle completo */}
                      <button
                        onClick={() => navigate(`/pedidos/${encodeURIComponent(p.id)}`)}
                        style={{
                          marginTop: "10px",
                          padding: "6px 14px",
                          borderRadius: "8px",
                          border: "1px solid #bae6fd",
                          background: "#fff",
                          color: "#0284c7",
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Ver detalle completo →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Footer con total */}
            <div style={{
              padding: "10px 16px",
              background: "#f8fafc",
              borderTop: "1px solid #f1f5f9",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                Mostrando {pedidosFiltrados.length} de {pedidos.length} pedidos entregados cargados
              </span>
              {pedidos.length >= 1000 && (
                <span style={{ fontSize: "0.72rem", color: "#f59e0b", fontWeight: 600 }}>
                  ⚠ Máximo 1000 registros — usá el filtro de fechas para ver períodos anteriores
                </span>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
