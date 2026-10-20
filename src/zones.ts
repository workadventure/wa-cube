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
   Droits d'accès par lieu (mêmes règles que main.ts, wa.ts et l'onglet Admin du site)
   ---------------------------------------------------------
   Une téléportation, y compris celle déclenchée par un admin ("rejoins-moi"), ne doit jamais
   amener quelqu'un là où il ne pourrait pas aller à pied.
   Chaque lieu a une règle : tout le monde, ou au moins un des tags listés. Les valeurs ci-dessous sont
   les règles PAR DÉFAUT ; l'onglet Admin du site (« Droits des lieux ») peut les modifier sans toucher
   au code : le site et le script de la carte les chargent (setAccessOverrides).
   Le staff et les admins (tags « staff » et « admin ») passent partout, quelle que soit la règle.
   Ce fichier existe à l'identique dans wa-cube (src/zones.ts) et campus-entry-cube (src/lib/zones.ts).
   ========================================================= */

export interface AccessRule {
  /** « all » : tout le monde ; « tags » : au moins un des tags listés. */
  mode: "all" | "tags";
  tags: string[];
  /** Message montré à qui n'a pas accès (vide : phrase automatique). */
  message: string;
}

export interface AccessZone {
  id: string;
  label: string;
  /** Rectangles [x, y, largeur, hauteur] en pixels de la carte. */
  rects: [number, number, number, number][];
  rule: AccessRule;
  /** Règle non modifiable depuis l'administration. */
  locked?: boolean;
  /** Le script ramène à l'entrée toute personne sans droit trouvée dans ce lieu (même par défaut). */
  enforce?: boolean;
}

/** Niveau d'accès d'un lieu = identifiant de sa zone d'accès (voir ACCESS_ZONES). */
export type AccessLevel = string;

const ALL: AccessRule = { mode: "all", tags: [], message: "" };
const PREMIUM: AccessRule = { mode: "tags", tags: ["premium"], message: "" };
const MEMBER: AccessRule = { mode: "tags", tags: ["member", "premium"], message: "" };

/**
 * Zones d'accès, la plus précise d'abord : la première qui contient le point gagne.
 * Hors de toute zone : « Entrée » dans la bande du bas (y >= 4040), sinon « Intérieur du campus ».
 */
export const ACCESS_ZONES: AccessZone[] = [
  {
    id: "salle-ai-automation",
    label: "Salle AI Automation Builder",
    rects: [[3744, 2368, 416, 400]],
    rule: { mode: "tags", tags: ["aab"], message: "Vous devez être en formation AI Automation Builder pour entrer." },
    enforce: true,
  },
  // Staff : un peu plus bas que le cadre de la zone, pour inclure son point de téléportation (592, 2000).
  { id: "staff", label: "Zone équipe (staff)", rects: [[346, 1240, 462, 820]], rule: { mode: "tags", tags: ["staff"], message: "" } },
  // Salle d'événement et parvis gauche (jusqu'au panneau "Téléportation Showroom") : seul endroit de ce côté
  // du campus où un visiteur peut se trouver. Les murs de la carte ferment cette zone.
  { id: "parvis-evenement", label: "Parvis de l'événement", rects: [[4608, 2784, 768, 1032]], rule: ALL },
  // Showroom et Événement descendent jusqu'à y = 4040 : leurs points de téléportation sont sous leur panneau.
  { id: "showroom", label: "Showroom", rects: [[119, 3497, 1470, 543]], rule: ALL },
  { id: "evenement", label: "Salle d'événement", rects: [[4864, 2776, 514, 1264]], rule: MEMBER },
  { id: "devant-campus", label: "Devant le campus", rects: [[2200, 2784, 2000, 1250]], rule: MEMBER },
  { id: "agora", label: "Agora", rects: [[2656, 1664, 608, 704]], rule: PREMIUM },
  { id: "salle-1", label: "Salle 1", rects: [[1440, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-2", label: "Salle 2", rects: [[2112, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-3", label: "Salle 3", rects: [[2784, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-4", label: "Salle 4", rects: [[3456, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-5", label: "Salle 5", rects: [[4128, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-6", label: "Salle 6", rects: [[4800, 352, 640, 864]], rule: PREMIUM },
  { id: "salle-7", label: "Salle 7", rects: [[5136, 1376, 336, 448]], rule: PREMIUM },
  { id: "cowork", label: "Cowork", rects: [[1440, 1240, 1010, 630]], rule: PREMIUM },
  { id: "campus", label: "Intérieur du campus (autres lieux)", rects: [], rule: PREMIUM },
  { id: "entree", label: "Entrée et parvis du bas", rects: [], rule: ALL, locked: true },
];

const ZONE_BY_ID = new Map(ACCESS_ZONES.map((z) => [z.id, z]));

let overrides: Record<string, AccessRule> = {};

/**
 * Règles modifiées depuis l'administration. Une valeur invalide est ignorée ; un identifiant inconnu aussi.
 * Appelée au chargement (site et script) avec la réponse du site ; null ou {} remet les règles par défaut.
 */
export function setAccessOverrides(raw: Record<string, Partial<AccessRule>> | null | undefined): void {
  const next: Record<string, AccessRule> = {};
  for (const [id, r] of Object.entries(raw ?? {})) {
    const zone = ZONE_BY_ID.get(id);
    if (!zone || zone.locked || !r || (r.mode !== "all" && r.mode !== "tags")) continue;
    const tags = Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];
    next[id] = { mode: r.mode, tags, message: typeof r.message === "string" ? r.message.slice(0, 200) : "" };
  }
  overrides = next;
}

/** Règle en vigueur d'un lieu (modifiée ou par défaut). */
export function ruleOf(level: AccessLevel): AccessRule {
  const zone = ZONE_BY_ID.get(level);
  if (!zone) return PREMIUM;
  return overrides[level] ?? zone.rule;
}

/** La règle de ce lieu a-t-elle été modifiée depuis l'administration ? */
export function isOverridden(level: AccessLevel): boolean {
  return level in overrides;
}

/** Faut-il ramener à l'entrée les personnes sans droit trouvées dans ce lieu ? (lieu sensible ou règle modifiée) */
export function isEnforced(level: AccessLevel): boolean {
  return !!ZONE_BY_ID.get(level)?.enforce || level in overrides;
}

/** Zone d'accès qui contient ce point de la carte. */
export function accessAt(x: number, y: number): AccessLevel {
  for (const z of ACCESS_ZONES) {
    for (const [rx, ry, rw, rh] of z.rects) {
      if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return z.id;
    }
  }
  // Bande du bas : parvis et point d'arrivée, devant l'arche (la porte est à y ≈ 4032).
  return y >= 4040 ? "entree" : "campus";
}

export function tagsAllow(level: AccessLevel, tags: readonly string[]): boolean {
  const mine = tags.map((t) => t.toLowerCase());
  // L'équipe (staff) et les admins passent partout, sans avoir besoin d'autre tag.
  if (mine.includes("admin") || mine.includes("staff")) return true;
  const rule = ruleOf(level);
  if (rule.mode === "all") return true;
  return rule.tags.some((t) => mine.includes(t));
}

/** Cette personne peut-elle se trouver à (x, y) ? */
export function canEnterAt(tags: readonly string[], x: number, y: number): boolean {
  return tagsAllow(accessAt(x, y), tags);
}

/** Complète "réservé" / "réservée" : "Cet endroit est réservé aux élèves en cours de formation". */
export function accessRule(level: AccessLevel): string {
  const rule = ruleOf(level);
  if (rule.mode === "all") return "à tous";
  const tags = [...rule.tags].sort();
  const same = (a: string[]) => a.length === tags.length && a.every((t, i) => t === tags[i]);
  if (same(["premium"])) return "aux élèves en cours de formation";
  if (same(["member", "premium"])) return "aux membres (compte member ou premium)";
  if (tags.length === 0 || same(["staff"])) return "à l'équipe";
  if (same(["aab"])) return "aux élèves en formation AI Automation Builder";
  return `aux personnes qui ont le tag ${tags.join(" ou ")}`;
}

/** Phrase à montrer à quelqu'un qui n'a pas accès à ce lieu. */
export function accessDenied(level: AccessLevel): string {
  const rule = ruleOf(level);
  return rule.message.trim() || `Cet endroit est réservé ${accessRule(level)}.`;
}

/** Court message de bouton grisé (« Réservé aux élèves en cours de formation »). */
export function accessHintFor(level: AccessLevel): string {
  const rule = ruleOf(level);
  if (rule.mode === "all") return "";
  if (rule.message.trim()) return rule.message.trim();
  const tags = [...rule.tags].sort();
  if (tags.length === 2 && tags[0] === "member" && tags[1] === "premium") return "Connecte-toi avec ton compte Cube";
  if (tags.length === 0 || (tags.length === 1 && tags[0] === "staff")) return "Réservé à l'équipe (tag staff)";
  return `Réservé ${accessRule(level)}`;
}
