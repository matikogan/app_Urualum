// src/utils/telemetry.js

// UUID v4 simple usando Web Crypto (sin dependencias)
function uuidv4() {
  // 10000000-1000-4000-8000-100000000000
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

export function getDeviceId() {
  const KEY = "urualum_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getAppVersion() {
  // definila en .env: REACT_APP_APP_VERSION=1.0.0
  return process.env.REACT_APP_APP_VERSION || "dev";
}

export function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
  };
}
