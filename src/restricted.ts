/// <reference types="@workadventure/iframe-api-typings" />

import { accessAt, accessDenied, isEnforced, tagsAllow } from "./zones";
import { playerTags } from "./extraTags";

/* =========================================================
   Lieux à accès restreint : ramener devant la porte ceux qui n'y ont pas droit
   ---------------------------------------------------------
   La carte laisse entrer à pied toute personne qui a le tag premium. Un lieu plus fermé (la salle
   AI Automation Builder par défaut, ou tout lieu dont les droits ont été modifiés dans l'onglet Admin du
   site) est donc surveillé : une personne sans droit qui entre à pied est remise là où elle était juste
   avant (devant la salle), avec le message du lieu. Sans position récente proche (arrivée par un lien
   ou une téléportation), elle est ramenée devant l'arche d'entrée.
   Le staff et les admins passent partout (tagsAllow).
   ========================================================= */

const POLL_MS = 500;
/** Devant l'arche d'entrée : zone « Entrée », ouverte à tous. Seulement quand on ne sait pas d'où la personne vient. */
const ENTRANCE = { x: 3200, y: 4160 };
/**
 * Au-delà de cette distance (px) entre la dernière position autorisée et l'intérieur du lieu, la personne
 * n'est pas venue à pied (lien, téléportation) : on la ramène à l'entrée plutôt qu'à l'autre bout du campus.
 */
const WALK_MAX_PX = 480;

export function initRestrictedAreas(): void {
  let busy = false;
  /** Dernier endroit où la personne avait le droit d'être (relevé toutes les POLL_MS). */
  let lastAllowed: { x: number; y: number } | null = null;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tags = playerTags();
      const p = await WA.player.getPosition();
      const zone = accessAt(p.x, p.y);
      if (!isEnforced(zone) || tagsAllow(zone, tags)) {
        lastAllowed = { x: p.x, y: p.y };
        return;
      }
      // Venue à pied : on la remet devant la salle, là où elle était juste avant d'entrer.
      const back =
        lastAllowed && Math.hypot(p.x - lastAllowed.x, p.y - lastAllowed.y) <= WALK_MAX_PX ? lastAllowed : ENTRANCE;
      await WA.player.teleport(Math.round(back.x), Math.round(back.y));
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
