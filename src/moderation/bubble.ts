/// <reference types="@workadventure/iframe-api-typings" />

import { roleOf } from "../presence";
import { roleFromTags } from "../presence/protocol";

/* =========================================================
   Modération depuis la bulle (staff, hors admins)
   ---------------------------------------------------------
   Quand on est dans une bulle ou une salle de réunion avec d'autres personnes, la liste des
   participants s'affiche en bas, au-dessus de la pastille Cowork, avec leur nombre : un micro à cliquer
   par personne (il se barre) et « Couper tout le monde », en un clic. Elle se replie en pastille.
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
/** La personne a masqué la liste : elle revient à l'entrée dans une bulle, ou par le menu du jeu. */
let hidden = false;
const HIDDEN_VARIABLE = "bulleMasquee";

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
  if (hidden || list.length === 0) {
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
      // En bas, au centre, AU-DESSUS de la pastille « Cowork » (48 px de haut, 14 px du bas) : rien ne se
      // recouvre, quelle que soit la largeur de la fenêtre, et les boutons natifs restent libres
      // (barre du haut, chat à gauche, zoom en bas à droite).
      position: { vertical: "bottom", horizontal: "middle" },
      // Taille ajustée ensuite par la page elle-même (déplié, replié, nombre de personnes).
      size: { width: "460px", height: "260px" },
      margin: { bottom: "74px" },
    });
  })().finally(() => {
    opening = null;
  });
  await opening;
}

/** À appeler une fois, après WA.onInit(). Sans effet pour tout compte qui n'est pas staff, admins compris. */
export function initBubbleModeration(): void {
  // Réservée au staff. Un admin (même s'il porte aussi le tag staff) a déjà le menu natif de
  // WorkAdventure sur les vignettes : roleFromTags donne "admin" avant "staff".
  const myRole = roleFromTags(WA.player.tags ?? [], WA.player.isLogged === true);
  if (myRole !== "staff") return;

  const setHidden = (value: boolean) => {
    hidden = value;
    WA.player.state
      .saveVariable(HIDDEN_VARIABLE, value, { public: false, persist: false })
      .catch((e) => console.warn("[modération] état de la liste", e));
  };

  // Le bouton « Masquer » de la page écrit cette variable ; le script ferme alors le cadre.
  try {
    WA.player.state.onVariableChange(HIDDEN_VARIABLE).subscribe((value) => {
      hidden = value === true;
      void refresh();
    });
  } catch (e) {
    console.warn("[modération] masquage indisponible", e);
  }

  // Rouvrir à tout moment par le menu de WorkAdventure (en haut à droite).
  try {
    WA.ui.registerMenuCommand("Afficher la liste de ma bulle", () => {
      setHidden(false);
      void refresh();
    });
  } catch (e) {
    console.warn("[modération] entrée de menu indisponible", e);
  }

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
      // Nouvelle bulle ou nouvelle salle : la liste revient.
      setHidden(false);
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
      setHidden(false);
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
