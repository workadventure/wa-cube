/// <reference types="@workadventure/iframe-api-typings" />

import { roleOf } from "../presence";
import { roleFromTags } from "../presence/protocol";

/* =========================================================
   Modération depuis la bulle (staff et admins)
   ---------------------------------------------------------
   Quand on est dans une bulle ou une salle de réunion avec d'autres personnes, la liste des
   participants s'affiche en bas à gauche avec leur nombre : « Couper le micro » par personne et
   « Couper les micros de tout le monde », en un clic. Elle se replie en pastille.
   La page est un fichier de la carte (public/bulle.html) : aucun site externe. Elle envoie les
   commandes par les variables vérifiées par le serveur (adminCommand pour les admins,
   staffCommand pour le staff).
   ========================================================= */

/** Page de la liste : un fichier de la carte (public/bulle.html), servi avec elle, sans site externe. */
function pageUrl(): string {
  return new URL("bulle.html", WA.room.mapURL).href;
}

type UIWebsite = Awaited<ReturnType<typeof WA.ui.website.open>>;

const bubble = new Map<number, { uuid: string; name: string }>();
let site: UIWebsite | null = null;
let opening: Promise<void> | null = null;

/** Participants à viser : tout le monde dans ma conversation, sauf moi, le staff et les admins. */
function targets(): { uuid: string; name: string }[] {
  const me = WA.player.uuid ?? "";
  return [...bubble.values()].filter((p) => {
    if (!p.uuid || p.uuid === me) return false;
    const role = roleOf(p.uuid);
    return role !== "staff" && role !== "admin";
  });
}

function urlFor(list: { uuid: string; name: string }[]): string {
  const params = new URLSearchParams({ p: JSON.stringify(list.slice(0, 40)) });
  return `${pageUrl()}#${params.toString()}`;
}

async function refresh(): Promise<void> {
  const list = targets();
  if (list.length === 0) {
    const current = site;
    site = null;
    await current?.close().catch(() => undefined);
    return;
  }
  const url = urlFor(list);
  if (site) {
    site.url = url;
    return;
  }
  if (opening) return;
  opening = (async () => {
    site = await WA.ui.website.open({
      url,
      allowApi: true,
      visible: true,
      // En bas, au centre, juste à droite de la pastille « Cowork » (centrée, 220 px de large) :
      // en cowork, le staff voit les deux côte à côte. Rien ne recouvre les boutons natifs
      // (barre du haut, chat à gauche, zoom en bas à droite).
      position: { vertical: "bottom", horizontal: "left" },
      // Taille ajustée ensuite par la page elle-même (déplié, replié, nombre de personnes).
      size: { width: "270px", height: "200px" },
      margin: { bottom: "14px", left: "calc(50% + 130px)" },
    });
  })().finally(() => {
    opening = null;
  });
  await opening;
}

/** À appeler une fois, après WA.onInit(). Sans effet pour les autres comptes que staff et admin. */
export function initBubbleModeration(): void {
  const myRole = roleFromTags(WA.player.tags ?? [], WA.player.isLogged === true);
  if (myRole !== "admin" && myRole !== "staff") return;

  const add = (p: { playerId: number; uuid: string; name: string }) => {
    if (p.uuid) bubble.set(p.playerId, { uuid: p.uuid, name: p.name });
    void refresh();
  };
  const remove = (playerId: number) => {
    bubble.delete(playerId);
    void refresh();
  };
  const clear = () => {
    bubble.clear();
    void refresh();
  };

  try {
    WA.player.meetings.onJoin().subscribe((meeting) => {
      bubble.clear();
      meeting.participants.forEach((p) => bubble.set(p.playerId, { uuid: p.uuid, name: p.name }));
      void refresh();
      meeting.onParticipantJoin().subscribe(add);
      meeting.onParticipantLeave().subscribe((p) => remove(p.playerId));
      meeting.onLeave().subscribe(clear);
    });
  } catch (e) {
    console.warn("[modération] suivi des réunions indisponible", e);
  }
  try {
    // Ancienne API des bulles de proximité, au cas où meetings ne les remonte pas.
    WA.player.proximityMeeting.onJoin().subscribe((users) => {
      bubble.clear();
      users.forEach((u) => bubble.set(u.playerId, { uuid: u.uuid, name: u.name }));
      void refresh();
    });
    WA.player.proximityMeeting.onParticipantJoin().subscribe(add);
    WA.player.proximityMeeting.onParticipantLeave().subscribe((p) => remove(p.playerId));
    WA.player.proximityMeeting.onLeave().subscribe(clear);
  } catch (e) {
    console.warn("[modération] suivi des bulles indisponible", e);
  }
}
