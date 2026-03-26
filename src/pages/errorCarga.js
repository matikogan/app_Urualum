// ErrorCarga.jsx
// Pantalla/Formulario para cargar errores (MVP)
// - Crea 1 documento por error en Firestore: errorEvents
// - Trae empleados desde Firestore: employees (active == true)
// - Guarda happenedAt con serverTimestamp y dayKey (YYYY-MM-DD)
// - Opcional: sube 1 o 2 fotos a Firebase Storage y guarda sus URLs en el doc
//
// Requisitos:
// - Tener Firebase inicializado y exportar `db` y (opcional) `storage` desde tu archivo firebase.
//   Ej: src/firebase.js -> export const db = getFirestore(app); export const storage = getStorage(app);
//
// Estilos:
// - Solo clases (sin estilos inline). Definilos en styles.css.

import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";    
import { auth, db, storage } from "../firebase"; // <-- ajustá la ruta según tu proyecto
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useNavigate } from "react-router-dom";


const ERROR_TYPES = [
  { value: "Cantidad", label: "Cantidad" },
  { value: "Color", label: "Color" },
  { value: "Tamanio", label: "Tamaño" },
  { value: "Otro", label: "Otro" },
];

function getLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

function safeNumber(value) {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export default function ErrorCarga() {
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);

  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");

  const [errorType, setErrorType] = useState("Cantidad");
  const [nroPedido, setNroPedido] = useState("");
  const [notes, setNotes] = useState("");

  const navigate = useNavigate();


  // Fotos opcionales
  const [fotoPedido, setFotoPedido] = useState(null);
  const [fotoPaquete, setFotoPaquete] = useState(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  const dayKey = useMemo(() => getLocalDayKey(), []);

  useEffect(() => {
    let alive = true;

    async function loadEmployees() {
        try {
            setEmployeesLoading(true);

            const uid = auth?.currentUser?.uid;
            if (!uid) throw new Error("No hay usuario autenticado");

            // 1) Leo MI doc para saber mi depósito (esto está permitido por tus rules)
            const mySnap = await getDoc(doc(db, "users", uid));
            const myData = mySnap.data();
            const miDeposito = myData?.deposito;

            if (!miDeposito) {
            throw new Error("El usuario no tiene 'deposito' en users/{uid}");
            }

            // 2) Traigo operarios del mismo depósito (esto está permitido por tus rules)
            const q = query(
            collection(db, "users"),
            where("role", "==", "operario"),
            where("deposito", "==", miDeposito),
            orderBy("nombre", "asc") // en tu users el campo es 'nombre'
            );

            const snap = await getDocs(q);

            // Normalizo a {id, name} para usarlo fácil en el dropdown
            const list = snap.docs.map((d) => {
            const data = d.data();
            return {
                id: d.id,
                name: data.nombre || data.email || d.id,
            };
            });

            if (!alive) return;

            setEmployees(list);

            if (list.length > 0) {
            setEmployeeId(list[0].id);
            setEmployeeName(list[0].name || "");
            }
        } catch (e) {
            console.error(e);
            if (!alive) return;
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

  function onEmployeeChange(nextId) {
    setEmployeeId(nextId);
    const emp = employees.find((x) => x.id === nextId);
    setEmployeeName(emp?.name || "");
  }

  function validate() {
    if (!employeeId || !employeeName) {
      return "Seleccioná un empleado.";
    }
    if (!errorType) {
      return "Seleccioná un tipo de error.";
    }
    const nro = safeNumber(nroPedido);
    if (nro === null) {
      return "Ingresá un número de pedido válido.";
    }
    if (String(notes).trim().length < 3) {
      return "Agregá un detalle corto (mínimo 3 caracteres).";
    }
    // Fotos son opcionales, no validamos.
    return "";
  }

  async function uploadPhoto(file, errorDocId, label) {
    if (!storage) return null; // Si no querés fotos, podés no exportar storage
    if (!file) return null;

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const filePath = `errorEvents/${errorDocId}/${label}.${ext}`;
    const storageRef = ref(storage, filePath);

    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ type: "", text: "" });

    const err = validate();
    if (err) {
      setMsg({ type: "error", text: err });
      return;
    }

    const nro = safeNumber(nroPedido);

    setSaving(true);
    try {
      // 1) Crear doc del error
      const docRef = await addDoc(collection(db, "errorEvents"), {
        employeeId,
        employeeName,
        errorType, // STRING (no array)
        nroPedido: nro,
        notes: String(notes).trim(),
        happenedAt: serverTimestamp(),
        dayKey, // YYYY-MM-DD
        // createdByUid: auth?.currentUser?.uid || null, // si querés guardar el usuario
      });

      // 2) Subir fotos (opcional) y actualizar doc con URLs
      const urls = [];
      const pedidoUrl = await uploadPhoto(fotoPedido, docRef.id, "pedido");
      if (pedidoUrl) urls.push(pedidoUrl);

      const paqueteUrl = await uploadPhoto(fotoPaquete, docRef.id, "paquete");
      if (paqueteUrl) urls.push(paqueteUrl);

      if (urls.length > 0) {
        await updateDoc(doc(db, "errorEvents", docRef.id), {
          photoUrls: urls,
        });
      }

      navigate(-1);
      return;


      // 3) Reset form (manteniendo empleado para cargar rápido varios errores)
      setErrorType("Cantidad");
      setNroPedido("");
      setNotes("");
      setFotoPedido(null);
      setFotoPaquete(null);

      // Para limpiar inputs file en UI: usamos key
      setFileInputKey((k) => k + 1);

      setMsg({ type: "success", text: "Error guardado correctamente." });
    } catch (e2) {
      console.error(e2);
      setMsg({
        type: "error",
        text: "No se pudo guardar el error. Revisá conexión / permisos de Firestore/Storage.",
      });
    } finally {
      setSaving(false);
    }
  }

  // Truco para resetear <input type="file">
  const [fileInputKey, setFileInputKey] = useState(1);

  return (
    <div className="page error-carga">
      <div className="card">
        <h1 className="title">Cargar error</h1>
        <p className="subtitle">
          Día: <strong>{dayKey}</strong>
        </p>

        {msg.text ? (
          <div className={`alert ${msg.type === "error" ? "alert-error" : "alert-success"}`}>
            {msg.text}
          </div>
        ) : null}

        <form className="form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="label">Empleado</label>
            <select
              className="input"
              value={employeeId}
              onChange={(e) => onEmployeeChange(e.target.value)}
              disabled={employeesLoading || saving}
            >
              {employeesLoading ? (
                <option value="">Cargando...</option>
              ) : employees.length === 0 ? (
                <option value="">No hay empleados activos</option>
              ) : (
                employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="form-row">
            <label className="label">Tipo de error</label>
            <select
              className="input"
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              disabled={saving}
            >
              {ERROR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="label">Nro. de pedido</label>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              placeholder="Ej: 109483"
              value={nroPedido}
              onChange={(e) => setNroPedido(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="form-row">
            <label className="label">Detalle / nota</label>
            <textarea
              className="input textarea"
              placeholder="Ej: Error en la cantidad del 189/1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>

          <div className="form-row">
            <label className="label">Foto del pedido (opcional)</label>
            <input
              key={`pedido-${fileInputKey}`}
              className="input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFotoPedido(e.target.files?.[0] || null)}
              disabled={saving}
            />
            <p className="hint">Podés sacar foto directo desde el teléfono.</p>
          </div>

          <div className="form-row">
            <label className="label">Foto del paquete armado (opcional)</label>
            <input
              key={`paquete-${fileInputKey}`}
              className="input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFotoPaquete(e.target.files?.[0] || null)}
              disabled={saving}
            />
          </div>

          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={saving || employeesLoading}>
              {saving ? "Guardando..." : "Guardar error"}
            </button>
          </div>

          <p className="footnote">
            Se guarda automáticamente la fecha y hora (happenedAt) y el día (dayKey).
          </p>
        </form>
      </div>
    </div>
  );
}
