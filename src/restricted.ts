/// <reference types="@workadventure/iframe-api-typings" />

import { accessAt, accessDenied, isEnforced, tagsAllow } from "./zones";

/* =========================================================
   Lieux à accès restreint : ramener à l'entrée ceux qui n'y ont pas droit
   ---------------------------------------------------------
   La carte laisse entrer à pied toute personne qui a le tag premium. Un lieu plus fermé (la salle
   AI Automation Builder par défaut, ou tout lieu dont les droits ont été modifiés dans l'onglet Admin du
   site) est donc surveillé : une personne sans droit trouvée à l'intérieur, à pied ou téléportée par un
   lien, est ramenée devant l'arche d'entrée avec le message du lieu.
   Le staff et les admins passent partout (tagsAllow).
   ========================================================= */

const POLL_MS = 500;
/** Devant l'arche d'entrée : zone « Entrée », ouverte à tous. */
const ENTRANCE = { x: 3200, y: 4160 };

export function initRestrictedAreas(): void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tags = WA.player.tags ?? [];
      const p = await WA.player.getPosition();
      const zone = accessAt(p.x, p.y);
      if (!isEnforced(zone) || tagsAllow(zone, tags)) return;
      await WA.player.teleport(ENTRANCE.x, ENTRANCE.y);
      const text = accessDenied(zone);
      try {
        WA.ui.banner.openBanner({ id: "acces-refuse", text, bgColor: "#b3261e", textColor: "#ffffff", closable: true, timeToClose: 15000 });
      } catch {
        /* le message dans le chat suffit */
      }
      try {
        WA.chat.sendChatMessage(text, { scope: "local", author: "Campus" });
      } catch {
        /* sans effet */
      }
    } catch (e) {
      console.warn("[accès] contrôle impossible", e);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), POLL_MS);
}
