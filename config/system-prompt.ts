/**
 * Flujo Propio — sales WhatsApp bot system prompt.
 * Source: BOT_VENTAS_SYSTEM_PROMPT.md (embedded verbatim at build/runtime via this module).
 * The full prompt text is also kept as config/BOT_VENTAS_SYSTEM_PROMPT.md.
 */
import { readFileSync } from "fs";
import { join } from "path";

function loadPrompt(): string {
  try {
    return readFileSync(
      join(process.cwd(), "config", "BOT_VENTAS_SYSTEM_PROMPT.md"),
      "utf8",
    );
  } catch {
    return "Eres el asistente comercial de Flujo Propio (México). Habla por WhatsApp en español mexicano, corto y firme.";
  }
}

export const SALES_SYSTEM_PROMPT = loadPrompt();
