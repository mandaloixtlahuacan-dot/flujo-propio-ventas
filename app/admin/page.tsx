import { listRecentLeads } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ secret?: string }>;
};

export default async function AdminPage({ searchParams }: Props) {
  const sp = await searchParams;
  const secret = sp?.secret || "";
  const expected = process.env.DASHBOARD_SECRET || "";

  if (!expected || secret !== expected) {
    return (
      <main style={{ padding: "2rem", maxWidth: 720 }}>
        <h1>Admin</h1>
        <p>
          Unauthorized. Usa <code>/admin?secret=…</code> con DASHBOARD_SECRET.
        </p>
      </main>
    );
  }

  let leads: Awaited<ReturnType<typeof listRecentLeads>> = [];
  let error: string | null = null;
  try {
    leads = await listRecentLeads(40);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 960 }}>
      <h1 style={{ marginTop: 0 }}>Leads recientes</h1>
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {!error && leads.length === 0 && (
        <p>Sin leads aún (o tablas no creadas).</p>
      )}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <thead>
          <tr>
            {["Tel / JID", "Stage", "Paquete", "Summary", "Updated"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ccc",
                  padding: "6px 8px",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}>
              <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                {l.phone || l.wa_jid}
              </td>
              <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                {l.stage || "—"}
              </td>
              <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                {l.interest_package || "—"}
              </td>
              <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                {(l.summary || "").slice(0, 160)}
              </td>
              <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                {l.updated_at || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
