/* =========================================================
   Zones de la map, pour dire "Salle 3" plutôt que des pixels.
   Les plus précises d'abord : la première qui contient le point gagne.
   ========================================================= */

export interface Zone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZONES: Zone[] = [
  { name: "Agora", x: 2656, y: 1664, w: 608, h: 704 },
  { name: "Salle AI Automation Builder", x: 3744, y: 2368, w: 416, h: 400 },
  { name: "Salle 1", x: 1440, y: 352, w: 640, h: 864 },
  { name: "Salle 2", x: 2112, y: 352, w: 640, h: 864 },
  { name: "Salle 3", x: 2784, y: 352, w: 640, h: 864 },
  { name: "Salle 4", x: 3456, y: 352, w: 640, h: 864 },
  { name: "Salle 5", x: 4128, y: 352, w: 640, h: 864 },
  { name: "Salle 6", x: 4800, y: 352, w: 640, h: 864 },
  { name: "Salle 7", x: 5136, y: 1376, w: 336, h: 448 },
  { name: "Cowork", x: 1440, y: 1240, w: 1010, h: 630 },
  { name: "Staff", x: 346, y: 1240, w: 462, h: 722 },
  { name: "Showroom", x: 119, y: 3497, w: 1470, h: 440 },
  { name: "Événement", x: 4864, y: 2776, w: 514, h: 1040 },
  // Parvis devant l'arche "Bienvenue" jusqu'au point d'arrivée (spawn, y ≈ 4416).
  { name: "Entrée", x: 2800, y: 3680, w: 800, h: 768 },
  { name: "Campus", x: 1408, y: 352, w: 4128, h: 2432 },
];

export function zoneAt(x: number, y: number): string | null {
  const z = ZONES.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  return z ? z.name : null;
}

/* =========================================================
   Droits d'accès par lieu (mêmes règles que main.ts et wa.ts)
   ---------------------------------------------------------
   Une téléportation, y compris celle déclenchée par un admin
   ("rejoins-moi"), ne doit jamais amener quelqu'un là où il ne pourrait
   pas aller à pied : intérieur du campus = tag premium, staff = tag staff,
   devant le campus et événement = member ou premium, le tag admin passe partout.
   Dans le doute (lieu inconnu), on exige premium.
   ========================================================= */

export type AccessLevel = "public" | "membre" | "premium" | "staff";

const LEVEL_TAGS: Record<AccessLevel, readonly string[] | null> = {
  public: null,
  membre: ["member", "premium"],
  premium: ["premium"],
  staff: ["staff"],
};

/** Zones à accès plus ouvert que "premium", de la plus précise à la plus large. */
const OPEN_ZONES: { x: number; y: number; w: number; h: number; level: AccessLevel }[] = [
  // Salle d'événement et parvis gauche (jusqu'au panneau "Téléportation Showroom") : seul
  // endroit de ce côté du campus où un visiteur peut se trouver. Les murs existants de la
  // carte ferment cette zone ; le visiteur n'y entre que téléporté.
  { x: 4608, y: 2784, w: 768, h: 1032, level: "public" },
  // Showroom et Événement descendent jusqu'à y = 4040 : leurs points de téléportation
  // (300, 4000) et (5130, 3900) sont juste sous leur panneau sur la carte.
  { x: 119, y: 3497, w: 1470, h: 543, level: "public" }, // Showroom
  { x: 4864, y: 2776, w: 514, h: 1264, level: "membre" }, // Événement
  { x: 2200, y: 2784, w: 2000, h: 1250, level: "membre" }, // Devant le campus
];

/** Niveau d'accès nécessaire pour se trouver à ce point de la carte. */
export function accessAt(x: number, y: number): AccessLevel {
  const inside = (z: { x: number; y: number; w: number; h: number }) =>
    x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
  // Staff : un peu plus bas que le cadre de la zone, pour inclure son point de téléportation (592, 2000).
  if (inside({ x: 346, y: 1240, w: 462, h: 820 })) return "staff";
  const open = OPEN_ZONES.find(inside);
  if (open) return open.level;
  // Bande du bas : parvis et point d'arrivée, devant l'arche (la porte est à y ≈ 4032).
  if (y >= 4040) return "public";
  return "premium";
}

export function tagsAllow(level: AccessLevel, tags: readonly string[]): boolean {
  // L'équipe (staff) et les admins passent partout, sans avoir besoin du tag premium.
  if (tags.includes("admin") || tags.includes("staff")) return true;
  const allowed = LEVEL_TAGS[level];
  return allowed === null || allowed.some((t) => tags.includes(t));
}

/** Cette personne peut-elle se trouver à (x, y) ? */
export function canEnterAt(tags: readonly string[], x: number, y: number): boolean {
  return tagsAllow(accessAt(x, y), tags);
}

/** Complète "réservé" / "réservée" : "Cet endroit est réservé aux élèves en cours de formation". */
export function accessRule(level: AccessLevel): string {
  switch (level) {
    case "premium":
      return "aux élèves en cours de formation";
    case "membre":
      return "aux membres (compte member ou premium)";
    case "staff":
      return "à l'équipe";
    default:
      return "à tous";
  }
}
