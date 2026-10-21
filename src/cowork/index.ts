/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Espace de coworking : pastille du bas
   ---------------------------------------------------------
   Tant qu'on est dans la zone "Coworking 1" du map editor, une pastille (page /cowork-bar du site)
   est affichée en bas de l'écran : « Cowork · Table N ». Un clic dessus ouvre le panneau du site
   (/cowork) sur le côté.
   La pastille signale aussi la table où l'on est assis : on reste dans la liste même panneau fermé.
   Aucun bouton dans la barre d'actions et aucune touche : pas de conflit avec la touche Espace
   (déverrouillage des zones).
   ========================================================= */

/** Nom exact de la zone du map editor. */
const COWORK_AREA = "Coworking 1";
/** Pastille : petit cadre qui tient la présence même quand le panneau est fermé. */
const BAR_URL = "https://campus-entry-cube.lovable.app/cowork-bar";
/** Calque des bouées d'aide et rectangle par défaut de la zone (pixels), si la zone est introuvable. */
const HELP_LAYER = "aide";
const COWORK_RECT = { x: 1433, y: 1334, width: 989, height: 485 };
const TILE_PX = 32;

/**
 * Efface toutes les bouées d'aide posées localement dans la zone. La pastille les retire elle-même, mais
 * quand on quitte la zone elle est fermée sans pouvoir le faire : sans ce nettoyage, une bouée restait
 * affichée chez ceux qui sont partis.
 */
async function clearHelpTiles(): Promise<void> {
  let rect = COWORK_RECT;
  try {
    const areas = await WA.mapEditor.area.list();
    const a = areas.find((x) => x.name === COWORK_AREA);
    if (a) rect = { x: a.x, y: a.y, width: a.width, height: a.height };
  } catch {
    /* rectangle par défaut */
  }
  const tiles: { x: number; y: number; tile: null; layer: string }[] = [];
  const x0 = Math.floor(rect.x / TILE_PX) - 2;
  const y0 = Math.floor(rect.y / TILE_PX) - 2;
  const x1 = Math.ceil((rect.x + rect.width) / TILE_PX) + 2;
  const y1 = Math.ceil((rect.y + rect.height) / TILE_PX) + 2;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) tiles.push({ x, y, tile: null, layer: HELP_LAYER });
  WA.room.setTiles(tiles);
}

/** Délai laissé à la pastille pour signaler son départ avant qu'on la ferme. */
const LEAVE_GRACE_MS = 4000;

type UIWebsite = Awaited<ReturnType<typeof WA.ui.website.open>>;
let bar: UIWebsite | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

async function openBar(): Promise<void> {
  if (bar) return;
  bar = await WA.ui.website.open({
    url: BAR_URL,
    allowApi: true,
    visible: true,
    position: { vertical: "bottom", horizontal: "middle" },
    size: { width: "220px", height: "48px" },
    margin: { bottom: "14px" },
  });
}

async function closeBar(): Promise<void> {
  const current = bar;
  bar = null;
  await current?.close().catch(() => undefined);
}

/** À appeler une fois, après WA.onInit(). */
export function initCowork(): void {
  try {
    WA.mapEditor.area.onEnter(COWORK_AREA).subscribe(() => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      // Repart d'une carte propre : les bouées sont reposées par la pastille à sa première lecture.
      clearHelpTiles().catch(() => undefined);
      openBar().catch((e) => console.warn("[cowork] pastille", e));
    });
    WA.mapEditor.area.onLeave(COWORK_AREA).subscribe(() => {
      // La pastille signale son départ, puis on la ferme.
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        closeBar().catch(() => undefined);
        clearHelpTiles().catch(() => undefined);
      }, LEAVE_GRACE_MS);
    });
  } catch (e) {
    console.warn("[cowork] zone indisponible", e);
  }
}
