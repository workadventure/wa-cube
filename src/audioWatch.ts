/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Repérage automatique des allers-retours répétés dans une conversation
   ---------------------------------------------------------
   Quand le son se coupe, la personne sort puis revient dans la bulle ou la salle pour se « réinitialiser ».
   Si cela se répète (au moins deux retours en moins de 90 s chacun, sur 10 minutes), le script envoie UN seul
   relevé technique au site (au plus un toutes les 10 minutes par personne) : nom, salle, nombre de personnes,
   bascules estimées entre P2P et LiveKit, navigateur, système, matériel et connexion.
   But : comprendre les problèmes de son et les corriger. Aucun contenu de conversation, aucun son, aucune image.
   Accès réservé aux admins du campus ; conservation de 90 jours (voir « Données et vie privée » dans l'onglet Aide).
   ========================================================= */

const ENDPOINT = "https://campus-entry-cube.lovable.app/api/public/audio-incident";
/** Un retour dans la même conversation en moins de ce délai est un « aller-retour ». */
const REJOIN_MAX_MS = 90_000;
const WINDOW_MS = 10 * 60_000;
const MIN_REJOINS = 2;
const SEND_EVERY_MS = 10 * 60_000;
/** À 5 personnes et plus, la conversation passe par le serveur (estimation). */
const SERVER_THRESHOLD = 5;

let current: { key: string; kind: string; name: string | null; n: number; crossings: number } | null = null;
let lastLeave: { key: string; at: number } | null = null;
const rejoins: number[] = [];
let lastSent = 0;

function key(kind: string, name: string | null): string {
  return `${kind}:${name ?? ""}`;
}

type NavExt = Navigator & {
  connection?: { type?: string; effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };
  deviceMemory?: number;
  userAgentData?: { platform?: string; mobile?: boolean; brands?: { brand: string; version: string }[] };
  brave?: unknown;
};

function env(): Record<string, string | number | boolean | null> {
  const n = navigator as NavExt;
  const c = n.connection;
  return {
    userAgent: navigator.userAgent.slice(0, 300),
    platform: n.userAgentData?.platform ?? navigator.platform ?? null,
    brands: (n.userAgentData?.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(", ").slice(0, 200) || null,
    brave: !!n.brave,
    mobile: n.userAgentData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent),
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: n.deviceMemory ?? null,
    connType: c?.type ?? null,
    connEffective: c?.effectiveType ?? null,
    rttMs: c?.rtt ?? null,
    downlinkMbps: c?.downlink ?? null,
    saveData: c?.saveData ?? null,
    online: navigator.onLine,
    visibility: document.visibilityState,
    language: navigator.language,
  };
}

async function send(): Promise<void> {
  const now = Date.now();
  if (!current || now - lastSent < SEND_EVERY_MS) return;
  const token = WA.player.userRoomToken;
  if (!token) return;
  lastSent = now;
  const body = {
    v: 1,
    token,
    name: WA.player.name,
    room: current.name ?? current.kind,
    kind: current.kind,
    participants: current.n,
    modeEstimate: current.n >= SERVER_THRESHOLD ? "livekit" : "p2p",
    switches: current.crossings,
    rejoins: rejoins.length,
    env: env(),
  };
  try {
    // text/plain : requête « simple », sans préparation CORS. Le site lit le JSON dans le corps.
    await fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain" }, keepalive: true });
  } catch (e) {
    console.warn("[audio] relevé non envoyé", e);
  }
}

function onJoin(kind: string, name: string | null, n: number): void {
  const now = Date.now();
  const k = key(kind, name);
  current = { key: k, kind, name, n, crossings: 0 };
  if (lastLeave && lastLeave.key === k && now - lastLeave.at < REJOIN_MAX_MS) rejoins.push(now);
  while (rejoins.length > 0 && now - rejoins[0] > WINDOW_MS) rejoins.shift();
  lastLeave = null;
  if (rejoins.length >= MIN_REJOINS) void send();
}

function onLeave(): void {
  if (!current) return;
  lastLeave = { key: current.key, at: Date.now() };
  current = null;
}

function setN(n: number): void {
  if (!current) return;
  const before = current.n;
  current.n = n;
  if ((before < SERVER_THRESHOLD) !== (n < SERVER_THRESHOLD)) current.crossings++;
}

/** À appeler une fois, après WA.onInit(). */
export function initAudioWatch(): void {
  try {
    WA.player.meetings.onJoin().subscribe((meeting) => {
      onJoin(String(meeting.kind), meeting.name ?? null, meeting.participants.length + 1);
      meeting.onParticipantJoin().subscribe(() => setN((current?.n ?? 1) + 1));
      meeting.onParticipantLeave().subscribe(() => setN(Math.max(1, (current?.n ?? 2) - 1)));
      meeting.onLeave().subscribe(() => onLeave());
    });
  } catch (e) {
    console.warn("[audio] suivi des réunions indisponible", e);
  }
  try {
    // Ancienne API des bulles de proximité, au cas où « meetings » ne les remonte pas.
    WA.player.proximityMeeting.onJoin().subscribe((users) => {
      if (current) return;
      onJoin("proximity", null, users.length + 1);
    });
    WA.player.proximityMeeting.onParticipantJoin().subscribe(() => {
      if (current?.kind === "proximity") setN(current.n + 1);
    });
    WA.player.proximityMeeting.onParticipantLeave().subscribe(() => {
      if (current?.kind === "proximity") setN(Math.max(1, current.n - 1));
    });
    WA.player.proximityMeeting.onLeave().subscribe(() => {
      if (current?.kind === "proximity") onLeave();
    });
  } catch (e) {
    console.warn("[audio] suivi des bulles indisponible", e);
  }
}
