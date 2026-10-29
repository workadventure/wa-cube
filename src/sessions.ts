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
   - un bandeau prévient les participants 5 minutes avant la fin ;
   - vue de l'extérieur, une salle qui accueille une session (en cours ou dans moins d'une heure) est
     entourée d'un liseré vert (vous pouvez entrer) ou rouge, avec un panneau au-dessus de la porte :
     titre, horaire, bouton S'inscrire (page /panneau-salle du site). À l'intérieur, la salle normale.
   Mise en service, salles et messages se règlent sur le site (src/lib/sessions/config.ts), sans
   redéployer la carte. Plan inactif ou site injoignable : personne n'est bloqué.
   ========================================================= */

const SITE = "https://campus-entry-cube.lovable.app";
const PLAN_URL = `${SITE}/api/public/sessions-guard`;
/** Inscriptions de test choisies par un admin (agenda fictif) : variable privée du joueur, même nom côté site. */
const TEST_REGS_KEY = "sessionsTestRegs";
/** Une session est annoncée sur la salle au plus tôt une heure avant. */
const ANNOUNCE_MS = 60 * 60_000;
/** Épaisseur du liseré, en pixels de la carte. */
const EDGE = 6;
const GREEN = "98ff81";
const RED = "ff5353";
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
  panel: { x: number; y: number; width: number; height: number };
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
      body: JSON.stringify({ token: WA.player.userRoomToken ?? null, tags: WA.player.tags ?? [], testRegs: testRegs() }),
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

function testRegs(): Record<string, boolean> {
  try {
    const raw = WA.player.state[TEST_REGS_KEY];
    return typeof raw === "string" && raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const inside = ({ rect: [rx, ry, w, h] }: GuardRoom, x: number, y: number) => x >= rx && x < rx + w && y >= ry && y < ry + h;

function roomAt(x: number, y: number): GuardRoom | null {
  if (!plan?.active) return null;
  return plan.rooms.find((r) => inside(r, x, y)) ?? null;
}

/* ---------- Liseré et panneau, vus de l'extérieur ---------- */

type Website = ReturnType<typeof WA.room.website.create>;
interface Overlay {
  panel: Website;
  edges: Website[];
  /** État affiché : "" (caché) ou la couleur du liseré. */
  shown: string;
}
const overlays = new Map<string, Overlay>();

/** Session annoncée sur la salle : celle qui l'occupe, sinon la prochaine si elle commence dans moins d'une heure. */
function announced(room: GuardRoom, now: number): GuardWindow | null {
  const current = room.windows.find((w) => now >= w.from && now < w.to);
  if (current) return current;
  const next = room.windows.filter((w) => w.from > now).sort((a, b) => a.from - b.from)[0];
  return next && next.start - now < ANNOUNCE_MS ? next : null;
}

const edgeUrl = (color: string) => `${new URL("lisere.html", WA.room.mapURL).href}#c=${color}`;

function edgeRects([x, y, w, h]: GuardRoom["rect"]): [number, number, number, number][] {
  return [
    [x - EDGE, y - EDGE, w + 2 * EDGE, EDGE],
    [x - EDGE, y + h, w + 2 * EDGE, EDGE],
    [x - EDGE, y, EDGE, h],
    [x + w, y, EDGE, h],
  ];
}

/** color : couleur du liseré, ou "" pour tout cacher. */
function showOverlay(room: GuardRoom, color: string): void {
  let o = overlays.get(room.id);
  if (o?.shown === color) return;
  if (!o) {
    if (!color) return;
    const p = room.panel;
    o = {
      panel: WA.room.website.create({
        name: `session-panneau-${room.id}`,
        url: `${SITE}/panneau-salle?salle=${encodeURIComponent(room.id)}`,
        position: { x: p.x, y: p.y, width: p.width, height: p.height },
        visible: true,
        allowApi: true,
        origin: "map",
        scale: 1,
      }),
      edges: edgeRects(room.rect).map(([x, y, width, height], i) =>
        WA.room.website.create({
          name: `session-lisere-${room.id}-${i}`,
          url: edgeUrl(color),
          position: { x, y, width, height },
          visible: true,
          origin: "map",
          scale: 1,
        }),
      ),
      shown: color,
    };
    overlays.set(room.id, o);
    return;
  }
  const visible = color !== "";
  o.panel.visible = visible;
  for (const e of o.edges) {
    if (visible) e.url = edgeUrl(color);
    e.visible = visible;
  }
  o.shown = color;
}

function syncOverlays(x: number, y: number, now: number): void {
  const rooms = plan?.active ? plan.rooms : [];
  for (const room of rooms) {
    const w = inside(room, x, y) ? null : announced(room, now);
    showOverlay(room, w ? (w.allowed ? GREEN : RED) : "");
  }
  // Salle retirée du plan (ou plan inactif) : plus rien à afficher.
  for (const [id, o] of overlays) {
    if (!rooms.some((r) => r.id === id) && o.shown) {
      o.panel.visible = false;
      o.edges.forEach((e) => (e.visible = false));
      o.shown = "";
    }
  }
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
  // Inscription de test (agenda, admin ou panneau de la salle) : on relit le plan tout de suite.
  try {
    WA.player.state.onVariableChange(TEST_REGS_KEY).subscribe(() => void load());
  } catch {
    /* le plan sera relu au prochain tour */
  }

  let busy = false;
  const tick = async () => {
    if (busy || (!plan?.active && overlays.size === 0)) return;
    busy = true;
    try {
      const p = await WA.player.getPosition();
      const now = Date.now() + skew;
      syncOverlays(p.x, p.y, now);
      const room = roomAt(p.x, p.y);
      if (!room) return;
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
