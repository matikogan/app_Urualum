// src/components/Toast.jsx
import React from "react";
export default function Toast({ open, children }) {
  if (!open) return null;
  return <div className="toast">{children}</div>;
}
