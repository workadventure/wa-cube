/// <reference types="@workadventure/iframe-api-typings" />

import { canEnterAt } from "./zones";

/* =========================================================
   Arrivée directe par lien d'invitation
   ---------------------------------------------------------
   Un lien d'invitation de Plan & FAQ a la forme  <adresse du campus>#start&goto=x,y
   La personne est placée à (x, y) dès son arrivée, sans marcher depuis l'entrée.
   Jamais plus loin que ses droits ne le permettent à pied : si l'endroit est réservé
   (premium, staff…), elle reste au point d'arrivée habituel.
   ========================================================= */

/** Paramètre du fragment d'adresse : "goto=1200,3400". */
const GOTO_PARAM = "goto";

export function initArrival(): void {
  try {
    const raw = WA.room.hashParameters?.[GOTO_PARAM];
    if (!raw) return;
    const [x, y] = raw.split(",").map((n) => Number(n));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Hors de la carte : on ignore.
    if (x < 0 || y < 0 || x > 7040 || y > 4448) return;
    if (!canEnterAt(WA.player.tags ?? [], x, y)) return;
    // Petit délai : le point d'arrivée de la carte est appliqué juste avant.
    setTimeout(() => {
      WA.player.teleport(Math.round(x), Math.round(y)).catch((e) => console.warn("[arrivée] téléportation impossible", e));
    }, 400);
  } catch (e) {
    console.warn("[arrivée] paramètre illisible", e);
  }
}
