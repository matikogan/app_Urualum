import React from "react";
import { useNavigate } from "react-router-dom";

export default function BackButton({ to, label = "⬅️ Regresar" }) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (to) {
      navigate(to);     // va a una ruta específica si pasás `to`
    } else {
      navigate(-1);     // va a la página anterior en el historial
    }
  };

  return (
    <button
      type="button"
      className="btn btn--secondary btn-sm"
      style={{ marginBottom: "16px" }}
      onClick={handleClick}
    >
      {label}
    </button>
  );
}
