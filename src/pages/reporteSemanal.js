// src/pages/reporteSemanal.js
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";

function dayKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Semana Lun–Vie de la fecha "base"
function getWeekRange(baseDate = new Date()) {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0 dom ... 6 sáb
  const diffToMonday = (day === 0 ? -6 : 1) - day; // lunes
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return {
    start: monday,
    end: friday,
    startKey: dayKeyFromDate(monday),
    endKey: dayKeyFromDate(friday),
  };
}

const ERROR_TYPES = ["Cantidad", "Color", "Tamaño", "Otros"];

export default function ReporteSemanal() {
  const navigate = useNavigate();

  const [baseDate, setBaseDate] = useState(() => new Date());
  const range = useMemo(() => getWeekRange(baseDate), [baseDate]);

  const [loading, setLoading] = useState(true);
  const [miDeposito, setMiDeposito] = useState("");
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [typeModalData, setTypeModalData] = useState({
    employeeName: "",
    employeeId: "",
    errorType: "",
    errors: [],
  });
  const [selectedError, setSelectedError] = useState(null); // detalle dentro del modal



  function formatTs(ts) {
    try {
      if (!ts) return "-";
      if (typeof ts.toDate === "function") return ts.toDate().toLocaleString();
      if (ts instanceof Date) return ts.toLocaleString();
      return String(ts);
    } catch {
      return "-";
    }
  }

  function openTypeModal(row, type) {
    const errors = (row.errorsList || []).filter((e) => e.errorType === type);
    setTypeModalData({
      employeeName: row.employeeName,
      employeeId: row.employeeId,
      errorType: type,
      errors,
    });
    setSelectedError(null);
    setTypeModalOpen(true);
  }



  function changeWeek(deltaWeeks) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + deltaWeeks * 7);
    setBaseDate(d);
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setMsg({ type: "", text: "" });

      try {
        const uid = auth?.currentUser?.uid;
        if (!uid) throw new Error("No hay usuario autenticado");

        // 1) Deposito del usuario
        const mySnap = await getDoc(doc(db, "users", uid));
        const myData = mySnap.data();
        const deposito = myData?.deposito;
        if (!deposito) throw new Error("El usuario no tiene 'deposito' en users/{uid}");

        if (!alive) return;
        setMiDeposito(deposito);

        // 2) Empleados (operarios del depósito)
        const qUsers = query(
          collection(db, "users"),
          where("role", "==", "operario"),
          where("deposito", "==", deposito)
        );
        const usersSnap = await getDocs(qUsers);

        const employees = usersSnap.docs
          .map((d) => {
            const data = d.data();
            return { id: d.id, name: data.nombre || data.email || d.id };
          })
          .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

        // Map base por empleado
        const base = {};
        employees.forEach((e) => {
          base[e.id] = {
            employeeId: e.id,
            employeeName: e.name,
            totalErrors: 0,
            errorsByType: Object.fromEntries(ERROR_TYPES.map((t) => [t, 0])),
            errorsList: [], // ✅ NUEVO
            attitudeSum: 0,
            attitudeCount: 0,
            daysFilled: new Set(),
          };
        });

        // 3) Errores (por dayKey en rango Lun–Vie)
        // Usamos dayKey para evitar índices complejos y es súper simple para semanas
        const qErrors = query(
          collection(db, "errorEvents"),
          where("dayKey", ">=", range.startKey),
          where("dayKey", "<=", range.endKey)
        );
        const errorsSnap = await getDocs(qErrors);

        errorsSnap.docs.forEach((d) => {
          const e = d.data();
          const empName = e.employeeName || "";
          const empId = e.employeeId || null; // si en tus docs no existe, usamos name

          // Si no guardás employeeId en errorEvents, asociamos por nombre
          // (mejoraremos esto después si querés 100% robusto)
          let key = empId;
          if (!key) {
            const found = employees.find((x) => x.name === empName);
            key = found?.id;
          }
          if (!key || !base[key]) return;

          base[key].totalErrors += 1;

          const t = Array.isArray(e.errorType) ? e.errorType[0] : e.errorType;
          const type = ERROR_TYPES.includes(t) ? t : "Otros";
          base[key].errorsByType[type] += 1;

          // ✅ Guardar detalle para el modal
          base[key].errorsList.push({
            id: d.id,
            employeeId: key,
            employeeName: base[key].employeeName,
            errorType: type,                 // acá ya queda string
            nroPedido: e.nroPedido ?? null,
            notes: e.notes ?? "",
            happenedAt: e.happenedAt ?? null,
            dayKey: e.dayKey ?? "",
            photoPedidoUrl: e.photoPedidoUrl ?? "",
            photoPaqueteUrl: e.photoPaqueteUrl ?? "",
          });

        });

        // 4) Actitud (dailyPerformance) por dayKey en rango
        const qPerf = query(
          collection(db, "dailyPerformance"),
          where("dayKey", ">=", range.startKey),
          where("dayKey", "<=", range.endKey)
        );
        const perfSnap = await getDocs(qPerf);

        perfSnap.docs.forEach((d) => {
          const p = d.data();
          const empId = p.employeeId;
          if (!empId || !base[empId]) return;

          const score = Number(p.attitude);
          if (Number.isFinite(score)) {
            base[empId].attitudeSum += score;
            base[empId].attitudeCount += 1;
          }
          if (p.dayKey) base[empId].daysFilled.add(p.dayKey);
        });

        // 5) Pasar a rows
        const finalRows = employees.map((e) => {
          const r = base[e.id];
          const avg =
            r.attitudeCount > 0 ? (r.attitudeSum / r.attitudeCount).toFixed(2) : "-";
          return {
            employeeId: r.employeeId,
            employeeName: r.employeeName,
            totalErrors: r.totalErrors,
            byType: r.errorsByType,
            avgAttitude: avg,
            daysFilled: r.daysFilled.size,
            errorsList: r.errorsList || [], // ✅ NUEVO
          };
        });

        if (!alive) return;
        setRows(finalRows);
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setMsg({
          type: "error",
          text: "No pude cargar el reporte. Revisá permisos / datos.",
        });
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [range.startKey, range.endKey]);

  return (
    <div className="page error-carga">
      <div className="card">
        <div style={{ display: "grid", gap: 8 }}>
          <h1 className="title">Reporte semanal</h1>

          <div className="subtitle">
            Depósito: <strong>{miDeposito || "-"}</strong>
            <br />
            Semana: <strong>{range.startKey}</strong> a <strong>{range.endKey}</strong>
          </div>

          {msg.text ? (
            <div className={`alert ${msg.type === "error" ? "alert-error" : "alert-success"}`}>
              {msg.text}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className="btn btn--outline" onClick={() => changeWeek(-1)} disabled={loading}>
              ◀ Semana anterior
            </button>
            <button className="btn btn--outline" onClick={() => changeWeek(1)} disabled={loading}>
              Semana siguiente ▶
            </button>
          </div>

          <button className="btn btn--outline" onClick={() => navigate(-1)} disabled={loading}>
            Volver
          </button>
        </div>

        <div style={{ height: 12 }} />

        {loading ? (
          <div className="subtitle">Cargando reporte...</div>
        ) : rows.length === 0 ? (
          <div className="subtitle">No hay operarios para este depósito.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((r) => (
              <div
                key={r.employeeId}
                style={{
                  border: "1px solid #e9eef5",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 16 }}>{r.employeeName}</div>
                <div className="subtitle" style={{ marginTop: 4 }}>
                  Errores: <strong>{r.totalErrors}</strong> | Actitud prom:{" "}
                  <strong>{r.avgAttitude}</strong> | Días evaluados:{" "}
                  <strong>{r.daysFilled}</strong>/5
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 10 }}>
                  {ERROR_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => openTypeModal(r, t)}
                      disabled={!r.byType[t]}
                      style={{
                        border: "1px solid #eef2f7",
                        borderRadius: 12,
                        padding: 10,
                        textAlign: "center",
                        background: "#fff",
                        cursor: r.byType[t] ? "pointer" : "default",
                        opacity: r.byType[t] ? 1 : 0.55,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#5b6b7c", fontWeight: 700 }}>{t}</div>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{r.byType[t]}</div>
                      <div style={{ fontSize: 11, color: "#6b7a8c", marginTop: 4 }}>
                        {r.byType[t] ? "Ver detalle" : "Sin errores"}
                      </div>
                    </button>
                  ))}

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

        {/* MODAL: Errores por tipo */}
      {typeModalOpen ? (
        <div
          onClick={() => setTypeModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 14,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#fff",
              borderRadius: 16,
              padding: 14,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              maxHeight: "85vh",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>
                {typeModalData.employeeName} — {typeModalData.errorType}
                <span style={{ fontWeight: 700, color: "#6b7a8c" }}>
                  {" "}({typeModalData.errors.length})
                </span>
              </div>

              <button
                className="btn btn--outline"
                type="button"
                onClick={() => setTypeModalOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div style={{ height: 10 }} />

            {typeModalData.errors.length === 0 ? (
              <div className="subtitle">No hay errores para este tipo.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {typeModalData.errors
                  .slice()
                  .sort((a, b) => {
                    const ta = a?.happenedAt?.toMillis ? a.happenedAt.toMillis() : 0;
                    const tb = b?.happenedAt?.toMillis ? b.happenedAt.toMillis() : 0;
                    return tb - ta;
                  })
                  .map((err) => (
                    <button
                      key={err.id}
                      type="button"
                      className="btn btn--outline error-item"
                      style={{ textAlign: "left" }}
                      onClick={() => setSelectedError(err)}
                    >
                      <div style={{ fontWeight: 900 }}>
                        Pedido: {err.nroPedido ?? "-"}
                      </div>
                      <div className="subtitle" style={{ marginTop: 2 }}>
                        {formatTs(err.happenedAt)}
                        {err.notes ? ` • ${err.notes}` : ""}
                      </div>
                    </button>
                  ))}
              </div>
            )}

            {/* Detalle seleccionado */}
            {selectedError ? (
              <div style={{ marginTop: 14, borderTop: "1px solid #eef2f7", paddingTop: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Detalle</div>

                <div className="subtitle">
                  <strong>Pedido:</strong> {selectedError.nroPedido ?? "-"}
                </div>
                <div className="subtitle">
                  <strong>Fecha:</strong> {formatTs(selectedError.happenedAt)}
                </div>
                <div className="subtitle">
                  <strong>Nota:</strong> {selectedError.notes || "-"}
                </div>

                {(selectedError.photoPedidoUrl || selectedError.photoPaqueteUrl) ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {selectedError.photoPedidoUrl ? (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Foto del pedido</div>
                        <img
                          src={selectedError.photoPedidoUrl}
                          alt="Foto del pedido"
                          style={{ width: "100%", borderRadius: 12, border: "1px solid #e9eef5" }}
                        />
                      </div>
                    ) : null}

                    {selectedError.photoPaqueteUrl ? (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Foto del paquete</div>
                        <img
                          src={selectedError.photoPaqueteUrl}
                          alt="Foto del paquete"
                          style={{ width: "100%", borderRadius: 12, border: "1px solid #e9eef5" }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

    </div>
    

  );
}
