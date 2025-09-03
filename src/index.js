// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import App from "App";
import './styles.css';

import { BrowserRouter } from "react-router-dom";

import { AuthProvider } from "context/AuthContext";
import { AppProvider } from "context/AppContext";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {/* 👇 El Router debe envolver a TODO lo que use rutas/hooks */}
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
