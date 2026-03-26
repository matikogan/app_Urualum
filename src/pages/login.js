import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "context/AuthContext";

export default function Login() {
  const { login, loading, user, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      nav("/");
    }
  }, [loading, user, nav]);


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
    <div className="login-page">
      <div className="login-card">

        <img
          src="/logo-urualum.png"
          alt="Urualum"
          className="login-logo"
        />


        <h2 className="login-title">Ingresar</h2>

        <form className="login-form" onSubmit={onSubmit}>
          <input
            className="login-input"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />

          <input
            className="login-input"
            placeholder="Contraseña"
            type="password"
            value={pass}
            onChange={e => setPass(e.target.value)}
          />

          <button className="btn btn-primary btn-full" type="submit">
            Entrar
          </button>
        </form>

        <div className="login-separator">o</div>

        <button
          className="btn btn-outline btn-full"
          onClick={onGoogle}
        >
          Continuar con Google
        </button>

        {err && <p className="login-error">{err}</p>}
      </div>
    </div>
  );

}
