import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Flujo Propio — Ventas",
  description: "Bot de ventas WhatsApp (Whapi + OpenAI + Supabase)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
