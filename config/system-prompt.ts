/**
 * Flujo Propio — sales WhatsApp bot system prompt.
 * Full sales prompt text lives in config/BOT_VENTAS_SYSTEM_PROMPT.md
 * and is exported here as SALES_SYSTEM_PROMPT.
 */
import { readFileSync } from "fs";
import { join } from "path";

function loadPrompt(): string {
  return readFileSync(
    join(process.cwd(), "config", "BOT_VENTAS_SYSTEM_PROMPT.md"),
    "utf8",
  );
}

export const SALES_SYSTEM_PROMPT = loadPrompt();
