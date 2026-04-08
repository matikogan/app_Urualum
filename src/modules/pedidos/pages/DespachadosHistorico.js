// src/modules/pedidos/pages/DespachadosHistorico.js
import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import SearchBar from "../components/SearchBar";
import { norm } from "utils/text";
import VolverListaPedidos from "../components/VolverListaPedidos";
import DatePicker from "react-datepicker";
import { es } from "date-fns/locale";
import { useAuth } from "../../../context/AuthContext";


export default function DespachadosHistorico() {
  const { profile } = useAuth();
  const depositoUsuario = profile?.deposito || null;

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

    // NUEVO: filtros
    const [fechaDesde, setFechaDesde] = useState("");
    const [fechaHasta, setFechaHasta] = useState("");
    const [filtroAplicado, setFiltroAplicado] = useState(null);



  // Listener a colección pedidos_despachados — filtro depósito en cliente (orderBy impide where extra)
  useEffect(() => {
    const col = collection(db, "pedidos_despachados");
    const qy = query(col, orderBy("despachadoAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((d) => !depositoUsuario || d.deposito === depositoUsuario);
        setPedidos(list);
        setLoading(false);
      },
      (err) => {
        console.error("[Histórico] error escuchando pedidos_despachados:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [depositoUsuario]);

  // Debounce
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(h);
  }, [q]);

  // Filtro de búsqueda
  const pedidosFiltrados = useMemo(() => {
    let out = pedidos;

    // --- 1) FILTRO POR TEXTO ---
    if (debouncedQ) {
      const nq = norm(debouncedQ);
      out = out.filter((p) => {
        const numero = norm(p.numero || p.id || "");
        const cliente = norm(p.cliente || "");
        const metodo = norm(p.metodoEntrega || "");
        const deposito = norm(p.deposito || "");
        return (
          numero.includes(nq) ||
          cliente.includes(nq) ||
          metodo.includes(nq) ||
          deposito.includes(nq)
        );
      });
    }

    // --- 2) FILTRO POR FECHAS ---
      if (filtroAplicado?.desde) {
          const d = new Date(filtroAplicado.desde);
          d.setHours(0, 0, 0, 0);

          out = out.filter((p) => {
              const ts = p.despachadoAt || p.movedAt;
              if (!ts) return false;
              return ts.seconds * 1000 >= d.getTime();
          });
      }

      if (filtroAplicado?.hasta) {
          const d = new Date(filtroAplicado.hasta);
          d.setHours(23, 59, 59, 999);

          out = out.filter((p) => {
              const ts = p.despachadoAt || p.movedAt;
              if (!ts) return false;
              return ts.seconds * 1000 <= d.getTime();
          });
      }



    return out;
  }, [pedidos, debouncedQ, filtroAplicado]);

function formatDMY(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-AR");
}




  function renderCard(p) {
    return (
      <div key={p.id} className="card order-card">
        <div className="order-head">
          <div className="order-number">#{p.numero || p.id}</div>
          <span className="pill pill--info">{p.metodoEntrega}</span>
        </div>

        <div className="order-body">
          <div className="order-field">
            <span className="order-label">Fecha</span>
            <span className="order-value">{p.finFecha}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Cliente</span>
            <span className="order-value">{p.cliente}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Depósito</span>
            <span className="order-value">{p.deposito}</span>
          </div>
          <div className="order-field">
            <span className="order-label">Despachado por</span>
            <span className="order-value">{p.despachadoPor || "—"}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="deck-head" style={{ marginBottom: 12 }}>
        <VolverListaPedidos to="/ventas/para-despachar" />
        <div className="deck-title">Histórico de pedidos despachados</div>
        {filtroAplicado && (
            <div
                style={{
                marginTop: 8,
                background: "#eef4ff",
                padding: "6px 10px",
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                }}
            >
                <span className="muted">
                Filtro:{" "}
                {filtroAplicado.desde && `desde ${formatDMY(filtroAplicado.desde)}`}{" "}
                {filtroAplicado.hasta && `hasta ${formatDMY(filtroAplicado.hasta)}`}
                </span>

                {/* Botón para limpiar filtro */}
                <button
                onClick={() => {
                    setFechaDesde("");
                    setFechaHasta("");
                    setFiltroAplicado(null);
                }}
                style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 16,
                    cursor: "pointer",
                }}
                >
                ✕
                </button>
            </div>
            )}


      </div>

      <SearchBar
        value={q}
        onChange={setQ}
        onClear={() => setQ("")}
        placeholder="Buscar por número, cliente, depósito, método…"
      />

      {/* FILTRO DE PERÍODO */}
      <div
        className="card card--compact"
        style={{
          padding: 10,
          marginTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span className="order-label" style={{ marginRight: 4 }}>
          Período:
        </span>

        {/* Fecha DESDE */}
        <DatePicker
          selected={fechaDesde ? new Date(fechaDesde) : null}
          onChange={(date) =>
            setFechaDesde(date?.toISOString().split("T")[0] || "")
          }
          locale={es}
          dateFormat="dd/MM/yyyy"
          placeholderText="Desde"
          customInput={
            <button
              className="btn btn--small"
              style={{
                padding: "6px 12px",
                fontSize: 14,
                border: "1px solid #ccc",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              {fechaDesde ? formatDMY(fechaDesde) : "Desde"}
            </button>
          }
          popperPlacement="bottom-start"
        />

        {/* Fecha HASTA */}
        <DatePicker
          selected={fechaHasta ? new Date(fechaHasta) : null}
          onChange={(date) =>
            setFechaHasta(date?.toISOString().split("T")[0] || "")
          }
          locale={es}
          dateFormat="dd/MM/yyyy"
          placeholderText="Hasta"
          customInput={
            <button
              className="btn btn--small"
              style={{
                padding: "6px 12px",
                fontSize: 14,
                border: "1px solid #ccc",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              {fechaHasta ? formatDMY(fechaHasta) : "Hasta"}
            </button>
          }
          popperPlacement="bottom-start"
        />

        {/* Botón Aplicar */}
        <button
          className="btn btn--small"
          style={{
            padding: "6px 12px",
            fontSize: 14,
            background: "#007bff",
            color: "#fff",
            borderRadius: 8,
          }}
          onClick={() => {
            if (!fechaDesde && !fechaHasta) return;
            setFiltroAplicado({
              desde: fechaDesde,
              hasta: fechaHasta,
            });
          }}
        >
          Aplicar
        </button>
      </div>


      
        {loading && (
          <div className="card card--compact empty-card">
            <div className="muted">Cargando historial…</div>
          </div>
        )}

        {!loading && pedidosFiltrados.length === 0 && (
          <div className="card card--compact empty-card">
            <div className="muted">
              {filtroAplicado
                ? "No se registraron despachos en ese período."
                : "No hay resultados."}
            </div>
          </div>
        )}


      <div className="orders-grid" style={{ marginTop: 16 }}>
        {pedidosFiltrados.map((p) => renderCard(p))}
      </div>
    </div>
  );
}
