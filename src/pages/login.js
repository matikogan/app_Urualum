import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "context/AuthContext";

export default function Login() {
  const { login, loading, user, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  if (!loading && user) nav("/");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await login(email, pass);
      nav("/");
    } catch (e) {
      setErr(e.message);
    }
  };

  const onGoogle = async () => {
    setErr("");
    try {
      await loginWithGoogle();
      nav("/");
    } catch (e) {
      // errores típicos: popup-blocked, popup-closed-by-user, auth/account-exists-with-different-credential
      setErr(e.message);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 360 }}>
      <h2>Ingresar</h2>
      <form onSubmit={onSubmit}>
        <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="Contraseña" type="password" value={pass} onChange={e=>setPass(e.target.value)} />
        <button type="submit">Entrar</button>
      </form>

      <div style={{ margin: "12px 0" }}>
        <button onClick={onGoogle}>Continuar con Google</button>
      </div>
      
      {err && <p style={{color:"crimson"}}>{err}</p>}
    </div>
  );
}
