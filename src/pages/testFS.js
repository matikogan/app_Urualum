import { useEffect, useRef, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  addDoc,
  serverTimestamp,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../firebase"; // misma app que Auth
import { useAuth } from "../context/AuthContext";

export default function TestFSPage() {
  const { user, profile, loading } = useAuth();

  // ---- test_read (ya probado)
  const [testDocs, setTestDocs] = useState([]);
  const [testSnapCount, setTestSnapCount] = useState(0);

  // ---- pedidos (lo que queremos probar ahora)
  const [pedidosAll, setPedidosAll] = useState([]);
  const [pedidosR8, setPedidosR8] = useState([]);
  const [pedidosSnapCount, setPedidosSnapCount] = useState(0);

  // errores visibles
  const [errTest, setErrTest] = useState(null);
  const [errPedidosAll, setErrPedidosAll] = useState(null);
  const [errPedidosR8, setErrPedidosR8] = useState(null);
  const [errSnapPedidos, setErrSnapPedidos] = useState(null);

  const unsubPedidosRef = useRef(null);

  // ---------- helpers test_read ----------
  const runGetDocsTest = async () => {
    setErrTest(null);
    try {
      const snap = await getDocs(collection(db, "test_read"));
      setTestDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("[testFS] getDocs test_read error:", e);
      setErrTest(`${e.code || ""} ${e.message || e}`);
    }
  };

  const createPing = async () => {
    setErrTest(null);
    try {
      await addDoc(collection(db, "test_read"), {
        createdAt: serverTimestamp(),
        by: user?.email || "anon",
        msg: "hello from /test-fs",
      });
      await runGetDocsTest();
    } catch (e) {
      console.error("[testFS] addDoc test_read error:", e);
      setErrTest(`${e.code || ""} ${e.message || e}`);
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "test_read"),
      (snapshot) => {
        setTestSnapCount((c) => c + 1);
        setTestDocs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (e) => {
        console.error("[testFS] onSnapshot test_read error:", e);
        setErrTest(`${e.code || ""} ${e.message || e}`);
      }
    );
    return () => unsub();
  }, []);

  // ---------- pruebas pedidos ----------
  const runGetPedidosAll = async () => {
    setErrPedidosAll(null);
    setPedidosAll([]);
    try {
      const snap = await getDocs(query(collection(db, "pedidos"), limit(20)));
      setPedidosAll(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("[testFS] getDocs pedidos (ALL) error:", e);
      setErrPedidosAll(`${e.code || ""} ${e.message || e}`);
    }
  };

  const runGetPedidosByDeposito = async (dep) => {
    setErrPedidosR8(null);
    setPedidosR8([]);
    try {
      const qy = query(
        collection(db, "pedidos"),
        where("deposito", "==", dep),
        limit(20)
      );
      const snap = await getDocs(qy);
      setPedidosR8(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("[testFS] getDocs pedidos (deposito) error:", e);
      setErrPedidosR8(`${e.code || ""} ${e.message || e}`);
    }
  };

  const startSnapshotPedidosByDeposito = (dep) => {
    setErrSnapPedidos(null);
    setPedidosSnapCount(0);
    // limpiar suscripción previa
    unsubPedidosRef.current?.();
    unsubPedidosRef.current = onSnapshot(
      query(collection(db, "pedidos"), where("deposito", "==", dep), limit(20)),
      (snapshot) => {
        setPedidosSnapCount((c) => c + 1);
        const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPedidosR8(rows);
      },
      (e) => {
        console.error("[testFS] onSnapshot pedidos (deposito) error:", e);
        setErrSnapPedidos(`${e.code || ""} ${e.message || e}`);
      }
    );
  };

  useEffect(() => {
    return () => {
      unsubPedidosRef.current?.();
    };
  }, []);

  const depositoDefault = profile?.deposito || "R8";

  return (
    <div className="p-4 space-y-6">
      <section>
        <h1 className="text-lg font-semibold mb-2">Test Firestore</h1>
        <div className="text-sm">
          <div><b>Auth loading:</b> {String(loading)}</div>
          <div><b>User uid:</b> {user?.uid || "null"}</div>
          <div><b>User email:</b> {user?.email || "null"}</div>
          <div><b>Profile role:</b> {profile?.role || "null"}</div>
          <div><b>Profile deposito:</b> {profile?.deposito || "null"}</div>
        </div>
      </section>

      {/* -------- test_read -------- */}
      <section className="space-y-2">
        <h2 className="font-medium">Colección de prueba: <code>test_read</code></h2>
        <div className="flex gap-2">
          <button className="px-3 py-2 border rounded" onClick={runGetDocsTest}>
            getDocs test_read
          </button>
          <button className="px-3 py-2 border rounded" onClick={createPing}>
            addDoc test_read
          </button>
        </div>
        <div className="text-xs text-gray-500">
          onSnapshot eventos: {testSnapCount}
        </div>
        {errTest && <div className="text-red-600 text-sm">Error: {errTest}</div>}
        <ul className="text-sm divide-y">
          {testDocs.map((d) => (
            <li key={d.id} className="py-1">
              <b>{d.id}</b> — {d.msg || "(sin msg)"} · {d.by || "-"}
            </li>
          ))}
          {testDocs.length === 0 && (
            <li className="text-gray-500">No hay documentos en test_read.</li>
          )}
        </ul>
      </section>

      {/* -------- pedidos -------- */}
      <section className="space-y-2">
        <h2 className="font-medium">Colección real: <code>pedidos</code></h2>

        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-2 border rounded" onClick={runGetPedidosAll}>
            getDocs pedidos (ALL, limit 20)
          </button>

          <button
            className="px-3 py-2 border rounded"
            onClick={() => runGetPedidosByDeposito(depositoDefault)}
          >
            getDocs pedidos where deposito == {depositoDefault}
          </button>

          <button
            className="px-3 py-2 border rounded"
            onClick={() => startSnapshotPedidosByDeposito(depositoDefault)}
          >
            onSnapshot pedidos where deposito == {depositoDefault}
          </button>
        </div>

        {errPedidosAll && (
          <div className="text-red-600 text-sm">ALL error: {errPedidosAll}</div>
        )}
        {errPedidosR8 && (
          <div className="text-red-600 text-sm">Depósito error: {errPedidosR8}</div>
        )}
        {errSnapPedidos && (
          <div className="text-red-600 text-sm">Snapshot error: {errSnapPedidos}</div>
        )}

        <div className="text-xs text-gray-500">
          onSnapshot pedidos eventos: {pedidosSnapCount}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium mb-1">Resultado ALL</h3>
            <ul className="text-sm divide-y">
              {pedidosAll.map((p) => (
                <li key={p.id} className="py-1">
                  <b>{p.numero || p.id}</b> — {p.cliente || "-"} · dep: {p.deposito || "-"}
                </li>
              ))}
              {pedidosAll.length === 0 && (
                <li className="text-gray-500">—</li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-1">Resultado depósito ({depositoDefault})</h3>
            <ul className="text-sm divide-y">
              {pedidosR8.map((p) => (
                <li key={p.id} className="py-1">
                  <b>{p.numero || p.id}</b> — {p.cliente || "-"} · dep: {p.deposito || "-"}
                </li>
              ))}
              {pedidosR8.length === 0 && (
                <li className="text-gray-500">—</li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
