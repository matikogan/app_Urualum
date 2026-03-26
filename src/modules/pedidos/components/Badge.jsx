// src/components/Badge.jsx
export default function Badge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className="badge"
      aria-label={`${count} nuevas entradas`}
      title={`${count} nuevas entradas`}
    >
      {count}
    </span>
  );
}
