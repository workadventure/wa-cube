/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Diagnostic : chronologie des dernières minutes (script de la map)
   ---------------------------------------------------------
   Sert au bouton "Signaler un problème" de la page Plan & FAQ : au moment du
   signalement, la page lit deux variables privées du joueur :
     diagSnapshot  la bulle en cours (type, nombre de personnes, pic, seuil de 5 franchi)
     diagTimeline  les évènements récents (arrivées/départs de bulle, changement du nombre
                   de personnes, zone, onglet masqué, réseau coupé ou changé)
   Rien ne quitte le navigateur tant que la personne n'envoie pas son signalement.
   Aucun contenu de conversation n'est consigné : seulement des compteurs et des noms d'évènements.
   ========================================================= */

import { zoneAt } from "../zones";

interface Ev {
  t: number;
  e: string;
  d?: Record<string, string | number | boolean | null>;
}

interface Snapshot {
  inMeeting: boolean;
  kind: string | null;
  name: string | null;
  participants: number;
  since: number | null;
  peakParticipants: number;
  crossedFive: number;
}

const KEEP_MS = 6 * 60_000;
const MAX_EVENTS = 60;
/** Seuil observé par l'équipe : à partir de 5 personnes, la zone passe sur le serveur média. */
const SERVER_THRESHOLD = 5;
const WRITE_EVERY_MS = 4_000;
/** Délai après l'entrée pendant lequel les participants déjà présents sont annoncés. */
const SETTLE_MS = 5_000;

const events: Ev[] = [];
let snap: Snapshot = {
  inMeeting: false,
  kind: null,
  name: null,
  participants: 0,
  since: null,
  peakParticipants: 0,
  crossedFive: 0,
};
let dirty = false;
let lastWrite = 0;
let lastZone: string | null | undefined;

/** Évènement venu d'un autre module (ex. détection du son perdu), ajouté à la chronologie. */
export function diagEvent(e: string, d?: Ev["d"]): void {
  push(e, d);
}

function push(e: string, d?: Ev["d"]): void {
  const now = Date.now();
  events.push({ t: now, e, ...(d ? { d } : {}) });
  while (events.length > MAX_EVENTS || (events.length > 0 && now - events[0].t > KEEP_MS)) events.shift();
  dirty = true;
  void flush();
}

async function flush(force = false): Promise<void> {
  const now = Date.now();
  if (!dirty || (!force && now - lastWrite < WRITE_EVERY_MS)) {
    if (dirty) setTimeout(() => void flush(true), WRITE_EVERY_MS);
    return;
  }
  lastWrite = now;
  dirty = false;
  try {
    // Variables privées et non persistées : lisibles par la page Plan & FAQ de ce joueur seulement.
    await WA.player.state.saveVariable("diagTimeline", JSON.stringify(events), { public: false, persist: false });
    await WA.player.state.saveVariable("diagSnapshot", JSON.stringify(snap), { public: false, persist: false });
  } catch (err) {
    console.warn("[diagnostic] écriture impossible", err);
  }
}

function setParticipants(n: number): void {
  const before = snap.participants;
  snap.participants = n;
  snap.peakParticipants = Math.max(snap.peakParticipants, n);
  // Juste après l'entrée, WorkAdventure annonce les personnes déjà présentes une par une : pas une bascule.
  const settled = snap.since !== null && Date.now() - snap.since >= SETTLE_MS;
  const crossedUp = settled && before < SERVER_THRESHOLD && n >= SERVER_THRESHOLD;
  const crossedDown = settled && before >= SERVER_THRESHOLD && n < SERVER_THRESHOLD;
  if (crossedUp || crossedDown) snap.crossedFive++;
  push("participants", { n, from: before, ...(crossedUp ? { mode: "serveur" } : crossedDown ? { mode: "direct" } : {}) });
}

function endMeeting(reason: string): void {
  if (!snap.inMeeting) return;
  push("meeting_leave", { reason, kind: snap.kind, peak: snap.peakParticipants });
  snap = { ...snap, inMeeting: false, participants: 0, since: null };
}

/** À appeler une fois, après WA.onInit(). */
export function initDiagnostics(): void {
  push("script_start", { visible: document.visibilityState });

  try {
    WA.player.meetings.onJoin().subscribe((meeting) => {
      snap = {
        inMeeting: true,
        kind: String(meeting.kind),
        name: meeting.name ?? null,
        participants: meeting.participants.length + 1,
        since: Date.now(),
        peakParticipants: meeting.participants.length + 1,
        crossedFive: 0,
      };
      push("meeting_join", { kind: String(meeting.kind), n: snap.participants });
      meeting.onParticipantJoin().subscribe(() => setParticipants(snap.participants + 1));
      meeting.onParticipantLeave().subscribe(() => setParticipants(Math.max(1, snap.participants - 1)));
      meeting.onLeave().subscribe(() => endMeeting("left"));
    });
  } catch (err) {
    console.warn("[diagnostic] suivi des réunions indisponible", err);
  }

  try {
    // Bulles de proximité (ancienne API, conservée au cas où meetings ne les remonte pas).
    WA.player.proximityMeeting.onJoin().subscribe((users) => {
      if (snap.inMeeting) return;
      snap = {
        inMeeting: true,
        kind: "proximity",
        name: null,
        participants: users.length + 1,
        since: Date.now(),
        peakParticipants: users.length + 1,
        crossedFive: 0,
      };
      push("meeting_join", { kind: "proximity", n: snap.participants });
    });
    WA.player.proximityMeeting.onParticipantJoin().subscribe(() => {
      if (snap.kind === "proximity") setParticipants(snap.participants + 1);
    });
    WA.player.proximityMeeting.onParticipantLeave().subscribe(() => {
      if (snap.kind === "proximity") setParticipants(Math.max(1, snap.participants - 1));
    });
    WA.player.proximityMeeting.onLeave().subscribe(() => {
      if (snap.kind === "proximity") endMeeting("left");
    });
  } catch (err) {
    console.warn("[diagnostic] suivi des bulles indisponible", err);
  }

  // Zone : toutes les 5 s, uniquement si elle change.
  setInterval(() => {
    WA.player
      .getPosition()
      .then((p) => {
        const z = zoneAt(p.x, p.y);
        if (z !== lastZone) {
          if (lastZone !== undefined) push("zone", { from: lastZone, to: z });
          lastZone = z;
        }
      })
      .catch(() => undefined);
  }, 5_000);

  document.addEventListener("visibilitychange", () => push(document.hidden ? "hidden" : "visible"));
  window.addEventListener("offline", () => push("offline"));
  window.addEventListener("online", () => push("online"));
  const conn = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; rtt?: number } }).connection;
  conn?.addEventListener?.("change", () => push("net_change", { type: conn.effectiveType ?? null, rtt: conn.rtt ?? null }));
}
