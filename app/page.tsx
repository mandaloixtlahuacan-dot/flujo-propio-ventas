export default function HomePage() {
  return (
    <main style={{ padding: "2rem", maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>Flujo Propio — Ventas</h1>
      <p>
        Bot comercial de WhatsApp: Whapi → webhook → OpenAI (prompt de ventas) →
        Supabase leads → reply.
      </p>
      <ul>
        <li>
          Health: <code>/api/health</code>
        </li>
        <li>
          Webhook: <code>/api/webhook</code>
        </li>
        <li>
          Admin: <code>/admin?secret=…</code>
        </li>
      </ul>
    </main>
  );
}
