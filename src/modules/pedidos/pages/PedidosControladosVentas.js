// src/modules/pedidos/pages/PedidosControladosVentas.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  query as q,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "context/AuthContext";
import { Link } from "react-router-dom";

const METODOS = ["AGENCIA", "RETIRA", "CAMION", "GIRA"];
const PAGE = 25;

const norm = (s) =>
  (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function PedidosControladosVentas() {
  const { user, toast } = useAuth(); // <= NO dependemos de profile.role para montar

  // datos
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // filtros
  const [metodo, setMetodo] = useState(""); // "" = todos
  const [qText, setQText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // paginación
  const [lastDoc, setLastDoc] = useState(null);
  const [isEnd, setIsEnd] = useState(false);

  // control de suscripción y modo de orden
  const unsubRef = useRef(null);
  const preferOrderByRef = useRef(true); // intentar con orderBy; si falla, pasamos a false

  // debounce buscador
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(qText), 180);
    return () => clearTimeout(id);
  }, [qText]);

  // helper: construir query según preferencia
  const buildBaseQuery = (useOrder) => {
    const col = collection(db, "pedidos");
    const parts = [where("estado", "==", "CONTROLADO")];
    if (metodo) parts.push(where("metodoEntrega", "==", metodo));
    if (useOrder) parts.push(orderBy("updatedAt", "desc"));
    parts.push(limit(PAGE));
    return q(col, ...parts);
  };

  // suscripción principal con fallback
  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(true);
      return;
    }

    // cerrar listener previo
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    setLoading(true);
    setIsEnd(false);
    setLastDoc(null);

    // 1) intentamos con orderBy
    const trySubscribe = (useOrder) => {
      const qq = buildBaseQuery(useOrder);
      const unsub = onSnapshot(
        qq,
        (snap) => {
          // si preferíamos orderBy y devuelve 0 pero hay datos, luego paginación los recupera;
          // igualmente si estamos en fallback (sin order), ordenamos en cliente
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), _ref: d }));
          if (!useOrder) {
            docs.sort((a, b) => {
              const ta = a?.updatedAt?.toMillis?.() ?? 0;
              const tb = b?.updatedAt?.toMillis?.() ?? 0;
              return tb - ta;
            });
          }
          setItems(docs);
          setLastDoc(snap.docs.at(-1) || null);
          setIsEnd(snap.size < PAGE);
          setLoading(false);
        },
        async (err) => {
          // Si falla por índice u otro tema, hacemos fallback sin orderBy
          if (err?.code === "failed-precondition" || err?.code === "permission-denied") {
            // solo mostramos toast para info; el fallback arranca solo
            if (err?.code === "failed-precondition") {
              toast?.error?.("Falta crear un índice; se muestra sin orden por fecha.");
            } else {
              toast?.error?.("Permiso denegado para leer pedidos.");
            }
            // fallback: suscribir sin orderBy
            preferOrderByRef.current = false;
            setLoading(true);
            if (unsubRef.current) {
              unsubRef.current();
              unsubRef.current = null;
            }
            // lanzar listener sin orderBy
            const unsubFallback = onSnapshot(
              buildBaseQuery(false),
              (snap2) => {
                const docs2 = snap2.docs.map((d) => ({ id: d.id, ...d.data(), _ref: d }));
                docs2.sort((a, b) => {
                  const ta = a?.updatedAt?.toMillis?.() ?? 0;
                  const tb = b?.updatedAt?.toMillis?.() ?? 0;
                  return tb - ta;
                });
                setItems(docs2);
                setLastDoc(snap2.docs.at(-1) || null);
                setIsEnd(snap2.size < PAGE);
                setLoading(false);
              },
              (err2) => {
                toast?.error?.("Error al cargar pedidos.");
                setLoading(false);
              }
            );
            unsubRef.current = unsubFallback;
          } else {
            toast?.error?.("Error al cargar pedidos.");
            setLoading(false);
          }
        }
      );
      unsubRef.current = unsub;
    };

    trySubscribe(preferOrderByRef.current);

    // cleanup
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [user?.uid, metodo, toast]); // <- NO dependemos de profile.role

  // paginar (respeta fallback)
  const loadMore = async () => {
    if (!user) return;
    if (loading || isEnd || !lastDoc) return;
    try {
      setLoading(true);
      const col = collection(db, "pedidos");
      const parts = [where("estado", "==", "CONTROLADO")];
      if (metodo) parts.push(where("metodoEntrega", "==", metodo));
      if (preferOrderByRef.current) parts.push(orderBy("updatedAt", "desc"));
      parts.push(startAfter(lastDoc), limit(PAGE));

      const snap = await getDocs(q(col, ...parts));
      let docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), _ref: d }));
      if (!preferOrderByRef.current) {
        docs.sort((a, b) => {
          const ta = a?.updatedAt?.toMillis?.() ?? 0;
          const tb = b?.updatedAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      }
      setItems((prev) => [...prev, ...docs]);
      setLastDoc(snap.docs.at(-1) || null);
      setIsEnd(snap.size < PAGE);
    } catch (err) {
      if (err?.code === "failed-precondition") {
        // si paginar con order falla, hacemos un último intento sin order
        try {
          const snap2 = await getDocs(
            q(
              collection(db, "pedidos"),
              where("estado", "==", "CONTROLADO"),
              ...(metodo ? [where("metodoEntrega", "==", metodo)] : []),
              startAfter(lastDoc),
              limit(PAGE)
            )
          );
          let docs2 = snap2.docs.map((d) => ({ id: d.id, ...d.data(), _ref: d }));
          docs2.sort((a, b) => {
            const ta = a?.updatedAt?.toMillis?.() ?? 0;
            const tb = b?.updatedAt?.toMillis?.() ?? 0;
            return tb - ta;
          });
          preferOrderByRef.current = false;
          setItems((prev) => [...prev, ...docs2]);
          setLastDoc(snap2.docs.at(-1) || null);
          setIsEnd(snap2.size < PAGE);
          toast?.error?.("Índice faltante. Paginando sin orden por fecha.");
        } catch {
          toast?.error?.("Falta crear un índice para paginación.");
        }
      } else {
        toast?.error?.("Error al cargar más pedidos.");
      }
    } finally {
      setLoading(false);
    }
  };

  // búsqueda local
  const filtered = useMemo(() => {
    const nq = norm(debouncedQ);
    if (!nq) return items;
    return items.filter((p) => {
      const numero = norm(p.numero || p.id || "");
      const cliente = norm(p.cliente || "");
      const desc = norm(p.descripcion || "");
      const m = norm(p.metodoEntrega || "");
      return (
        numero.includes(nq) ||
        cliente.includes(nq) ||
        desc.includes(nq) ||
        m.includes(nq)
      );
    });
  }, [items, debouncedQ]);

  const metodoBtnClass = (m) =>
    `btn ${metodo === m ? "btn--primary" : "btn--outline"}`;

  // ---- Guards de render
  if (user === null) {
    return (
      <div className="p-3">
        <div className="deck-head">
          <div className="deck-title">Listos para despachar</div>
          <span className="pill pill--brand">Ventas</span>
        </div>
        <p className="muted mt-3">No estás autenticado.</p>
        <a className="btn btn--primary mt-2" href="/login">
          Iniciar sesión
        </a>
      </div>
    );
  }

  // ---- UI final
  return (
    <div className="p-3">
      {/* Encabezado */}
      <div className="deck-head">
        <div className="deck-title">Listos para despachar</div>
        <span className="pill pill--brand">Ventas</span>
      </div>

      {/* Filtros */}
      <div className="filters">
        <div className="filters-row">
          <div className="searchbar">
            <span className="searchbar__icon">🔎</span>
            <input
              className="searchbar__input"
              placeholder="Buscar por #PEDVTA, cliente, método o descripción…"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
            />
            {qText && (
              <button
                className="searchbar__clear"
                title="Limpiar"
                onClick={() => setQText("")}
              >
                ×
              </button>
            )}
          </div>
          <div />
        </div>

        <div className="filters-row">
          <div className="methods-grid">
            <button
              className={metodo === "" ? "btn btn--primary" : "btn btn--outline"}
              onClick={() => setMetodo("")}
            >
              Todos
            </button>
            {METODOS.map((m) => (
              <button
                key={m}
                className={metodoBtnClass(m)}
                onClick={() => setMetodo(m === metodo ? "" : m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Estado de carga / vacío */}
      {loading && <p className="muted mt-2">Cargando…</p>}
      {!loading && filtered.length === 0 && (
        <div className="card empty-card mt-2">
          <div className="h2" style={{ margin: 0 }}>
            Sin resultados
          </div>
          <p className="muted">No hay pedidos controlados para mostrar.</p>
        </div>
      )}

      {/* Lista */}
      <div className="orders-grid">
        {filtered.map((p) => {
          const fecha =
            p?.updatedAt?.toDate?.()?.toLocaleString?.() ||
            p?.timestamps?.creado?.toDate?.()?.toLocaleString?.() ||
            "—";
          return (
            <Link
              key={p.id}
              to={`/ventas/para-despachar/${encodeURIComponent(p.id)}`}
              className="card order-card card--selectable"
            >
              <div className="order-head">
                <div className="order-number">#{p.numero || p.id}</div>
                <span className="pill pill--info">
                  {p.metodoEntrega || "—"}
                </span>
              </div>

              <div className="order-body">
                <div className="order-field">
                  <div className="order-label">Cliente</div>
                  <div className="order-value">{p.cliente || "—"}</div>
                </div>
                <div className="order-field">
                  <div className="order-label">Depósito</div>
                  <div className="order-value">{p.deposito || "—"}</div>
                </div>
                <div className="order-field">
                  <div className="order-label">Actualizado</div>
                  <div className="order-value">{fecha}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Paginación */}
      {!loading && !isEnd && (
        <div className="btn-center" style={{ marginTop: 12 }}>
          <button className="btn btn--secondary" onClick={loadMore}>
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
