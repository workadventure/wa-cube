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

/** Position de la cloche : juste à droite des deux boutons du chat (à régler si besoin). */
const BELL_LEFT = "148px";
const BELL_TOP = "12px";
const BELL_SIZE = "64px";

type UIWebsite = Awaited<ReturnType<typeof WA.ui.website.open>>;

let site: UIWebsite | null = null;
let unread = 0;

function pageUrl(): string {
  return `${new URL("cloche.html", WA.room.mapURL).href}#n=${unread}`;
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
    const body = (await res.json()) as { unread?: number };
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
  WA.player.state.onVariableChange("newsTick").subscribe(() => void refresh());
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
}
