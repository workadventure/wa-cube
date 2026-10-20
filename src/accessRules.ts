import { setAccessOverrides } from "./zones";

/* =========================================================
   Droits des lieux modifiés depuis l'administration
   ---------------------------------------------------------
   L'onglet Admin du site (« Droits des lieux ») enregistre les règles d'accès (quels tags peuvent entrer
   où). La carte les relit ici : au chargement, puis toutes les quelques minutes. Si le site ne répond pas,
   on garde les règles par défaut de zones.ts (ou les dernières reçues).
   ========================================================= */

const RULES_URL = "https://campus-entry-cube.lovable.app/api/public/access-rules";
const REFRESH_MS = 3 * 60_000;

async function load(): Promise<void> {
  try {
    const res = await fetch(RULES_URL, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { overrides?: Record<string, unknown> };
    setAccessOverrides((body.overrides ?? {}) as Parameters<typeof setAccessOverrides>[0]);
  } catch (e) {
    console.warn("[droits des lieux] lecture impossible, règles par défaut conservées", e);
  }
}

export function initAccessRules(): void {
  void load();
  setInterval(() => void load(), REFRESH_MS);
}
