/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Cloche « Nouveautés »
   ---------------------------------------------------------
   Une petite cloche en haut à gauche, à droite des boutons du chat, avec le nombre de nouveautés non lues.
   Un clic ouvre la liste (page du site, fenêtre à droite) : message, vidéo, lien, et « Marquer comme lu »,
   qui enlève la pastille. Les nouveautés lues restent consultables. Elles sont publiées depuis l'onglet
   Admin du site (« Nouveautés (cloche) »).
   Le compteur est relu au chargement, toutes les 2 minutes et à chaque « lu » (variable newsTick).
   La cloche est un fichier de la carte (public/cloche.html) ; son clic passe par la variable newsOpen.
   ========================================================= */

const COUNT_URL = "https://campus-entry-cube.lovable.app/api/public/news";
const PAGE_URL = "https://campus-entry-cube.lovable.app/nouveautes";
const REFRESH_MS = 2 * 60_000;

/**
 * Position de la cloche : sur la ligne des boutons du chat, même hauteur (62 px), juste à droite.
 * WorkAdventure place les fenêtres de site sous la barre du haut (environ 96 px) : le haut est donc négatif
 * pour remonter sur la ligne des boutons. Valeurs par défaut ; le site peut les remplacer (réponse de
 * /api/public/news, fichier src/lib/news-bell.ts du site) pour recaler la cloche sans redéployer la carte.
 */
const BELL_LEFT = "143px";
const BELL_TOP = "-80px";
const BELL_SIZE = "62px";

type UIWebsite = Awaited<ReturnType<typeof WA.ui.website.open>>;

let site: UIWebsite | null = null;
let unread = 0;

function pageUrl(): string {
  return `${new URL("cloche.html", WA.room.mapURL).href}#n=${unread}`;
}

interface BellPlace {
  left?: string;
  top?: string;
  size?: string;
}

/** Applique une position donnée par le site (valeurs en px seulement). */
function placeBell(b: BellPlace | undefined): void {
  if (!site || !b) return;
  const px = (v: unknown) => (typeof v === "string" && /^-?\d{1,4}px$/.test(v) ? v : null);
  const left = px(b.left);
  const top = px(b.top);
  const size = px(b.size);
  try {
    if (left || top) site.margin = { left: left ?? BELL_LEFT, top: top ?? BELL_TOP };
    if (size) site.size = { width: size, height: size };
  } catch (e) {
    console.warn("[nouveautés] position non appliquée", e);
  }
}

async function fetchUnread(): Promise<number | null> {
  const token = WA.player.userRoomToken;
  if (!token) return null;
  try {
    const res = await fetch(COUNT_URL, {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "Content-Type": "text/plain" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { unread?: number; bell?: BellPlace };
    placeBell(body.bell);
    return typeof body.unread === "number" ? body.unread : null;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const n = await fetchUnread();
  if (n === null || n === unread) return;
  unread = n;
  if (site) site.url = pageUrl();
}

function openList(): void {
  WA.ui.modal.openModal({
    title: "Nouveautés",
    src: PAGE_URL,
    allow: "fullscreen; clipboard-write",
    allowApi: true,
    position: "right",
    closable: true,
    allowFullScreen: false,
  });
}

/** À appeler une fois, après WA.onInit(). */
export async function initNews(): Promise<void> {
  site = await WA.ui.website.open({
    url: pageUrl(),
    allowApi: true,
    visible: true,
    position: { vertical: "top", horizontal: "left" },
    size: { width: BELL_SIZE, height: BELL_SIZE },
    margin: { top: BELL_TOP, left: BELL_LEFT },
  });
  WA.player.state.onVariableChange("newsOpen").subscribe(() => openList());
  // Le volet donne directement le nombre restant ; on le relit aussi sur le serveur pour confirmer.
  WA.player.state.onVariableChange("newsTick").subscribe((value) => {
    const left = (value as { unread?: unknown } | undefined)?.unread;
    if (typeof left === "number" && left !== unread) {
      unread = left;
      if (site) site.url = pageUrl();
    }
    void refresh();
  });
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
}
