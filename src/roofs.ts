/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Toits des bâtiments : filet de sécurité après une téléportation
   ---------------------------------------------------------
   Les toits se masquent à l'entrée d'une zone et se remettent à la sortie (voir main.ts). Quand quelqu'un
   est téléporté (membre de l'équipe qui rejoint une personne, invitation, lien avec un point d'arrivée),
   WorkAdventure ne déclenche pas toujours l'entrée de zone : la personne se retrouve dans le bâtiment avec
   le toit encore affiché, donc en vue du dessus. On lit donc régulièrement la position et on applique les toits
   dès que l'ensemble des zones où l'on se trouve change.
   ========================================================= */

const POLL_MS = 600;
const TILE = 32;

type Rect = { x: number; y: number; width: number; height: number };
interface ZoneDef {
  /** Calques de toit liés à cette zone. */
  roofs: string[];
  /** Rectangle (objet de la carte) ou calque de tuiles (nom du calque). */
  rect?: string;
  layer?: string;
}

const ZONES: Record<string, ZoneDef> = {
  campus: { roofs: ["roofs/roofCampus1", "roofs/roofCampus2"], layer: "zoneCampus" },
  event: { roofs: ["roofs/roofEvent"], rect: "zoneEvent" },
  circle: { roofs: ["roofs/roofSphere"], rect: "zoneCircle" },
  staff: { roofs: ["roofs/roofStaff"], rect: "zoneStaff" },
  showroom: { roofs: ["roofs/roofShowroom"], rect: "zoneShowroom" },
};
/** Tant que la personne est sur l'aire d'arrivée, tous les toits sont masqués (voir main.ts). */
const START_LAYER = "start";
const ALL_ROOFS = Object.values(ZONES).flatMap((z) => z.roofs);

interface TileLayerLike {
  name?: string;
  type?: string;
  width?: number;
  data?: number[] | string;
  chunks?: { x: number; y: number; width: number; height: number; data: number[] }[];
  layers?: TileLayerLike[];
  objects?: { name?: string; x?: number; y?: number; width?: number; height?: number }[];
}

const rects = new Map<string, Rect>();
const tileLayers = new Map<string, TileLayerLike>();

function walk(layers: TileLayerLike[] | undefined): void {
  for (const l of layers ?? []) {
    if (l.type === "group") walk(l.layers);
    else if (l.type === "objectgroup") {
      for (const o of l.objects ?? []) {
        if (o.name && o.width !== undefined && o.height !== undefined) {
          rects.set(o.name, { x: o.x ?? 0, y: o.y ?? 0, width: o.width, height: o.height });
        }
      }
    } else if (l.type === "tilelayer" && l.name) tileLayers.set(l.name, l);
  }
}

function tileAt(layer: TileLayerLike, tx: number, ty: number): number {
  if (Array.isArray(layer.data)) return layer.data[ty * (layer.width ?? 220) + tx] ?? 0;
  for (const c of layer.chunks ?? []) {
    if (tx >= c.x && tx < c.x + c.width && ty >= c.y && ty < c.y + c.height) {
      return c.data[(ty - c.y) * c.width + (tx - c.x)] ?? 0;
    }
  }
  return 0;
}

/** Zones (et aire d'arrivée) où se trouve le point (x, y). */
function zonesAt(x: number, y: number): Set<string> {
  const out = new Set<string>();
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  for (const [name, z] of Object.entries(ZONES)) {
    if (z.rect) {
      const r = rects.get(z.rect);
      if (r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) out.add(name);
    } else if (z.layer) {
      const l = tileLayers.get(z.layer);
      if (l && tileAt(l, tx, ty) > 0) out.add(name);
    }
  }
  const start = tileLayers.get(START_LAYER);
  if (start && tileAt(start, tx, ty) > 0) out.add("start");
  return out;
}

const show = (names: string[]) => names.forEach((n) => WA.room.showLayer(n));
const hide = (names: string[]) => names.forEach((n) => WA.room.hideLayer(n));

export function initRoofs(): void {
  void (async () => {
    try {
      await WA.onInit();
      const map = await WA.room.getTiledMap();
      walk(map.layers as unknown as TileLayerLike[]);
    } catch (e) {
      console.warn("[toits] carte illisible", e);
      return;
    }
    let last: Set<string> | null = null;
    const tick = async () => {
      try {
        const p = await WA.player.getPosition();
        const now = zonesAt(p.x, p.y);
        if (last === null) {
          last = now;
          return;
        }
        const changed = now.size !== last.size || [...now].some((z) => !last!.has(z));
        if (!changed) return;
        // On a quitté l'aire d'arrivée sans que WorkAdventure le signale : tous les toits reviennent.
        if (last.has("start") && !now.has("start")) show(ALL_ROOFS);
        for (const [name, z] of Object.entries(ZONES)) {
          if (now.has(name)) hide(z.roofs);
          else if (last.has(name)) show(z.roofs);
        }
        last = now;
      } catch (e) {
        console.warn("[toits] position illisible", e);
      }
    };
    setInterval(() => void tick(), POLL_MS);
  })();
}
