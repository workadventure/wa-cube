/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Sessions de l'agenda : une salle appartient à la session en cours
   ---------------------------------------------------------
   Le site calcule, pour chaque personne, les salles contrôlées et leurs créneaux (autorisé ou non,
   message, lien d'inscription) : /api/public/sessions-guard. Ce script ne connaît ni l'agenda ni les
   règles, il applique le plan reçu :
   - dans une salle dont la session ne lui est pas ouverte, la personne est placée devant la porte avec le
     message (« Inscrivez-vous pour rejoindre cette session » et un bouton vers la plateforme) ;
   - c'est aussi ce qui sort, à la fin d'une session, ceux qui ne sont pas inscrits à la suivante ;
   - un bandeau prévient les participants 5 minutes avant la fin.
   Mise en service, salles et messages se règlent sur le site (src/lib/sessions/config.ts), sans
   redéployer la carte. Plan inactif ou site injoignable : personne n'est bloqué.
   ========================================================= */

const PLAN_URL = "https://campus-entry-cube.lovable.app/api/public/sessions-guard";
const POLL_MS = 500;
/** Relecture si le site ne répond pas. */
const RETRY_MS = 3 * 60_000;

interface GuardWindow {
  sessionId: string;
  title: string;
  from: number;
  to: number;
  start: number;
  allowed: boolean;
  message: string;
  link?: { label: string; url: string };
  endNotice?: { at: number; text: string };
}

interface GuardRoom {
  id: string;
  label: string;
  rect: [number, number, number, number];
  front: { x: number; y: number };
  windows: GuardWindow[];
}

interface GuardPlan {
  v: 1;
  now: number;
  refreshMs: number;
  active: boolean;
  rooms: GuardRoom[];
}

let plan: GuardPlan | null = null;
/** Écart entre l'horloge du serveur et celle du poste : tout le monde bascule au même moment. */
let skew = 0;
const noticesShown = new Set<string>();

async function load(): Promise<number> {
  try {
    const res = await fetch(PLAN_URL, {
      method: "POST",
      // text/plain : requête « simple », sans préparation CORS. Le site lit le JSON dans le corps.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ token: WA.player.userRoomToken ?? null, tags: WA.player.tags ?? [] }),
      cache: "no-store",
    });
    if (!res.ok) return RETRY_MS;
    const p = (await res.json()) as GuardPlan;
    if (p?.v !== 1) return RETRY_MS;
    plan = p;
    skew = p.now - Date.now();
    return Math.max(30_000, p.refreshMs || RETRY_MS);
  } catch (e) {
    console.warn("[sessions] plan illisible, aucun contrôle", e);
    return RETRY_MS;
  }
}

function roomAt(x: number, y: number): GuardRoom | null {
  if (!plan?.active) return null;
  return plan.rooms.find(({ rect: [rx, ry, w, h] }) => x >= rx && x < rx + w && y >= ry && y < ry + h) ?? null;
}

function banner(id: string, text: string, bgColor: string, link?: { label: string; url: string }): void {
  try {
    WA.ui.banner.openBanner({ id, text, bgColor, textColor: "#ffffff", closable: true, timeToClose: 30_000, link });
  } catch (e) {
    console.warn("[sessions] bandeau indisponible", e);
  }
}

export function initSessions(): void {
  if (!WA.player.isLogged) return; // visiteurs : jamais concernés par les sessions
  const refresh = async () => {
    const next = await load();
    setTimeout(() => void refresh(), next);
  };
  void refresh();

  let busy = false;
  const tick = async () => {
    if (busy || !plan?.active || plan.rooms.length === 0) return;
    busy = true;
    try {
      const p = await WA.player.getPosition();
      const room = roomAt(p.x, p.y);
      if (!room) return;
      const now = Date.now() + skew;
      const w = room.windows.find((x) => now >= x.from && now < x.to);
      if (!w) return; // salle libre
      if (!w.allowed) {
        await WA.player.teleport(room.front.x, room.front.y);
        banner("session-refus", w.message, "#b3261e", w.link);
        return;
      }
      if (w.endNotice && now >= w.endNotice.at && !noticesShown.has(w.sessionId)) {
        noticesShown.add(w.sessionId);
        banner("session-fin", w.endNotice.text, "#6e1fff");
      }
    } catch (e) {
      console.warn("[sessions] contrôle impossible", e);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), POLL_MS);
}
