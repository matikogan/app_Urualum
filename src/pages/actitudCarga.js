// src/pages/actitudCarga.js
import React, { useEffect, useMemo, useState } from "react";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";

function getLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function ActitudCarga() {
  const navigate = useNavigate();
  const dayKey = useMemo(() => getLocalDayKey(), []);

  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);

  // Evaluaciones por empleado: { [employeeId]: { attitude: 1..5, notes: "" } }
  const [evals, setEvals] = useState({});


  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  const [miDeposito, setMiDeposito] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadEmployees() {
      try {
        setEmployeesLoading(true);
        setMsg({ type: "", text: "" });

        const uid = auth?.currentUser?.uid;
        if (!uid) throw new Error("No hay usuario autenticado");

        // 1) Leo mi doc para saber deposito
        const mySnap = await getDoc(doc(db, "users", uid));
        const myData = mySnap.data();
        const deposito = myData?.deposito;

        if (!deposito) throw new Error("El usuario no tiene 'deposito' en users/{uid}");

        if (!alive) return;
        setMiDeposito(deposito);

        // 2) Traigo operarios del mismo depósito
        // (Sin orderBy para evitar índice; ordenamos en JS)
        const q = query(
          collection(db, "users"),
          where("role", "==", "operario"),
          where("deposito", "==", deposito)
        );

        const snap = await getDocs(q);

        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.nombre || data.email || d.id,
          };
        });

        list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));

        if (!alive) return;

        setEmployees(list);

        // Inicializo el estado para TODOS los operarios (5 por defecto)
        const initial = {};
        for (const emp of list) {
          initial[emp.id] = { attitude: 5, notes: "" };
        }
        setEvals(initial);

      } catch (e) {
        console.error(e);
        if (!alive) return;
        setEmployees([]);
        setMsg({
          type: "error",
          text: "No pude cargar la lista de empleados. Revisá Firestore / permisos.",
        });
      } finally {
        if (alive) setEmployeesLoading(false);
      }
    }

    loadEmployees();
    return () => {
      alive = false;
    };
  }, []);

    function updateAttitude(empId, value) {
    setEvals((prev) => ({
      ...prev,
      [empId]: { ...(prev[empId] || {}), attitude: Number(value) },
    }));
  }

  function updateNotes(empId, value) {
    setEvals((prev) => ({
      ...prev,
      [empId]: { ...(prev[empId] || {}), notes: value },
    }));
  }


    async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ type: "", text: "" });

    setSaving(true);
    try {
      const uid = auth?.currentUser?.uid;
      if (!uid) throw new Error("No hay usuario autenticado");

      if (!employees || employees.length === 0) {
        setMsg({ type: "error", text: "No hay operarios para evaluar." });
        setSaving(false);
        return;
      }

      // Validación simple: todos deben tener actitud 1..5
      for (const emp of employees) {
        const a = Number(evals?.[emp.id]?.attitude);
        if (!Number.isFinite(a) || a < 1 || a > 5) {
          setMsg({ type: "error", text: `Actitud inválida para ${emp.name}.` });
          setSaving(false);
          return;
        }
      }

      const batch = writeBatch(db);

      for (const emp of employees) {
        const perfId = `${dayKey}_${emp.id}`;
        const payload = {
          dayKey,
          employeeId: emp.id,
          employeeName: emp.name,
          deposito: miDeposito || null,
          attitude: Number(evals?.[emp.id]?.attitude ?? 5),
          notes: String(evals?.[emp.id]?.notes || "").trim(),
          createdByUid: uid,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        };

        batch.set(doc(db, "dailyPerformance", perfId), payload, { merge: true });
      }

      await batch.commit();

      // Volver a la pantalla anterior (Inicio / menú)
      navigate(-1);
    } catch (err) {
      console.error(err);
      setMsg({
        type: "error",
        text: "No se pudo guardar. Revisá conexión / permisos de Firestore.",
      });
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="page error-carga">
      <div className="card">
        <h1 className="title">Actitud / Desempeño</h1>
        <p className="subtitle">
          Día: <strong>{dayKey}</strong>
        </p>

        {msg.text ? (
          <div className={`alert ${msg.type === "error" ? "alert-error" : "alert-success"}`}>
            {msg.text}
          </div>
        ) : null}

                <form className="form" onSubmit={handleSubmit}>
          {employeesLoading ? (
            <div className="muted">Cargando operarios...</div>
          ) : employees.length === 0 ? (
            <div className="muted">No hay empleados activos</div>
          ) : (
            <div className="perf-grid">
              {employees.map((emp) => {
                const a = Number(evals?.[emp.id]?.attitude ?? 5);
                const n = String(evals?.[emp.id]?.notes ?? "");

                return (
                  <div key={emp.id} className="perf-card">
                    <div className="perf-head">
                      <div className="perf-name">{emp.name}</div>
                      <div className="perf-sub">Operario</div>
                    </div>

                    <div className="form-row">
                      <label className="label">Actitud (1 a 5)</label>
                      <select
                        className="input"
                        value={a}
                        onChange={(e) => updateAttitude(emp.id, e.target.value)}
                        disabled={saving}
                      >
                        <option value={5}>5 - Excelente</option>
                        <option value={4}>4 - Muy buena</option>
                        <option value={3}>3 - Normal</option>
                        <option value={2}>2 - Mala</option>
                        <option value={1}>1 - Muy mala</option>
                      </select>
                    </div>

                    <div className="form-row">
                      <label className="label">Notas (opcional)</label>
                      <textarea
                        className="input textarea"
                        placeholder="Ej: Buena predisposición, ayudó en control..."
                        value={n}
                        onChange={(e) => updateNotes(emp.id, e.target.value)}
                        disabled={saving}
                        rows={2}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="actions">
            <button className="btn btn-primary btn--full" type="submit" disabled={saving || employeesLoading}>
              {saving ? "Guardando..." : "Guardar desempeño (todos)"}
            </button>
          </div>

          <p className="footnote">Se guarda 1 registro por empleado por día.</p>
        </form>

      </div>
    </div>
  );
}
