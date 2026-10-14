/* =========================================================
   Présence et actions admin : protocole partagé
   ---------------------------------------------------------
   Copié TEL QUEL dans l'app Lovable (src/lib/presence-protocol.ts).
   Ne dépend pas de l'API WorkAdventure.
   ========================================================= */

export const PRESENCE_VERSION = 1;

/**
 * Espace WorkAdventure (API Spaces) que chaque joueur rejoint dès son arrivée.
 * C'est le serveur qui tient la liste de tous les connectés du monde, sans interrogation.
 * "streaming" : personne n'est audible tant que personne ne lance de diffusion,
 * donc rejoindre cet espace ne mélange jamais les conversations.
 */
export const PRESENCE_SPACE = "cube-presence";
export const PRESENCE_SPACE_FILTER = "streaming" as const;

/**
 * Variable de salle par laquelle un admin envoie une commande de modération.
 * Déclarée dans campus.tmj avec `writableBy: admin` : c'est le serveur
 * WorkAdventure qui refuse l'écriture à tout autre compte, donc personne
 * ne peut déconnecter quelqu'un en imitant un admin.
 */
export const ADMIN_COMMAND_VARIABLE = "adminCommand";

export const PRESENCE_EVENTS = {
  /** "Où es-tu ?" : envoyé par la page admin à UNE personne (champ `to`). */
  hello: "presence:hello",
  /** Réponse de la personne interrogée : sa position et sa zone. */
  here: "presence:here",
  /** Un admin demande à quelqu'un de le rejoindre. */
  summon: "admin:summon",
  /** Un admin envoie un message à quelqu'un. */
  message: "admin:message",
  /** Accusé de réception : la personne a pris en compte le message ou la demande. */
  ack: "admin:ack",
  /** La modération (staff ou admin) coupe le micro de quelqu'un. */
  mute: "mod:mute",
} as const;

/**
 * Rôle affiché dans la liste, du plus fort au plus faible.
 * Mêmes règles que main.ts : admin = tag admin (admins WorkAdventure),
 * staff = tag staff, premium = accès à l'intérieur du campus.
 */
export type PresenceRole = "admin" | "staff" | "premium" | "membre" | "visiteur";

export interface PresenceInfo {
  v: number;
  uuid: string;
  name: string;
  isLogged: boolean;
  role: PresenceRole;
  /** Formation déduite des tags, avec la couleur en vigueur. */
  formation: { tag: string; label: string; color: string } | null;
  zone: string | null;
  x: number;
  y: number;
  /** Heure d'arrivée sur le campus (ms epoch). */
  connectedAt: number;
  /** Identifiant propre à cet onglet : deux onglets du même compte ont deux sessionId. */
  sessionId?: string;
  /** Temps écoulé sans déplacement dans cet onglet (ms). */
  idleMs?: number;
}

export type KickReason = "inactive" | "entrance" | "duplicate" | "other";

/** Une session précise (uuid + onglet) : l'autre onglet du même compte n'est pas touché. */
export interface KickTarget {
  uuid: string;
  sessionId: string;
}

export interface AdminCommand {
  v: number;
  /** Identifiant unique : une commande n'est exécutée qu'une fois. */
  id: string;
  /** kick : déconnecter. teleport : amener la personne à (x, y). */
  action: "kick" | "teleport";
  reason: KickReason;
  targets: KickTarget[];
  /** Point d'arrivée d'une téléportation (action "teleport"), en pixels de la map. */
  x?: number;
  y?: number;
  zone?: string | null;
  /** Motif libre affiché à la personne sur la page de déconnexion (140 caractères max). */
  note?: string;
  by: string;
  /** ms epoch. Une commande de plus de 60 s est ignorée. */
  at: number;
}

export const ADMIN_COMMAND_MAX_AGE_MS = 60_000;

/** Lit la valeur de la variable (texte JSON ou objet). Renvoie null si elle est invalide. */
export function parseAdminCommand(value: unknown): AdminCommand | null {
  let data: unknown = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const c = data as Record<string, unknown>;
  if ((c.action !== "kick" && c.action !== "teleport") || typeof c.id !== "string" || typeof c.at !== "number") {
    return null;
  }
  if (c.action === "teleport" && (typeof c.x !== "number" || typeof c.y !== "number")) return null;
  if (!Array.isArray(c.targets)) return null;
  const targets: KickTarget[] = [];
  for (const t of c.targets) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.uuid === "string" && typeof r.sessionId === "string" && r.uuid && r.sessionId) {
      targets.push({ uuid: r.uuid, sessionId: r.sessionId });
    }
  }
  if (targets.length === 0) return null;
  const reason: KickReason =
    c.reason === "inactive" || c.reason === "entrance" || c.reason === "duplicate" ? c.reason : "other";
  return {
    v: typeof c.v === "number" ? c.v : 1,
    id: c.id,
    action: c.action,
    reason,
    targets,
    x: typeof c.x === "number" ? c.x : undefined,
    y: typeof c.y === "number" ? c.y : undefined,
    zone: typeof c.zone === "string" ? c.zone : null,
    note: typeof c.note === "string" ? c.note.slice(0, 140) : undefined,
    by: typeof c.by === "string" ? c.by : "",
    at: c.at,
  };
}

export interface PresenceHello {
  v: number;
  /** uuid de la personne interrogée. Absent = ancien format, tout le monde répond. */
  to?: string;
}

/** Faut-il répondre à cette demande de position ? */
export function isHelloForMe(data: unknown, myUuid: string): boolean {
  if (!data || typeof data !== "object") return true;
  const to = (data as { to?: unknown }).to;
  return typeof to !== "string" || (!!myUuid && to === myUuid);
}

export interface AdminSummon {
  v: number;
  /** Identifiant de la demande, repris dans l'accusé de réception. */
  id?: string;
  to: string;
  /** uuid de l'admin, pour que l'accusé lui revienne. */
  fromUuid?: string;
  fromName: string;
  x: number;
  y: number;
  zone: string | null;
}

export interface AdminMessage {
  v: number;
  id?: string;
  to: string;
  fromUuid?: string;
  fromName: string;
  text: string;
  /**
   * Message de modération (staff ou admin) : affiché avec l'étiquette "Modération".
   * Le destinataire vérifie que l'expéditeur est bien staff ou admin avant de l'afficher.
   */
  moderation?: boolean;
}

/** La modération coupe le micro de la personne `to`. Elle peut le rallumer ensuite. */
export interface ModMute {
  v: number;
  id: string;
  to: string;
  fromUuid: string;
  fromName: string;
}

/**
 * Qui peut modérer qui : l'admin peut agir sur tout le monde (sauf lui-même), le staff
 * sur les autres personnes seulement, jamais sur un autre staff ni sur un admin.
 */
export function canModerate(sender: PresenceRole, target: PresenceRole): boolean {
  if (sender === "admin") return true;
  if (sender === "staff") return target !== "staff" && target !== "admin";
  return false;
}

export function isModMute(v: unknown): v is ModMute {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.to === "string" && typeof m.id === "string" && typeof m.fromUuid === "string" && typeof m.fromName === "string"
  );
}

export type AckKind = "message" | "summon";
/**
 * read : message lu. accepted : la personne vient. declined : pas maintenant.
 * denied : la personne n'a pas les droits pour aller à cet endroit.
 */
export type AckAction = "read" | "accepted" | "declined" | "denied";

/** Réponse envoyée à l'admin quand la personne clique sur la notification. */
export interface AdminAck {
  v: number;
  /** uuid de l'admin à prévenir. */
  to: string;
  id: string;
  kind: AckKind;
  action: AckAction;
  /** Nom de la personne qui a répondu. */
  fromName: string;
  fromUuid: string;
}

export const MAX_MESSAGE_LENGTH = 280;

export function isPresenceInfo(v: unknown): v is PresenceInfo {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.uuid === "string" && typeof p.name === "string" && typeof p.x === "number" && typeof p.y === "number";
}

export function isAdminSummon(v: unknown): v is AdminSummon {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.to === "string" && typeof s.fromName === "string" && typeof s.x === "number" && typeof s.y === "number";
}

export function isAdminMessage(v: unknown): v is AdminMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return typeof m.to === "string" && typeof m.fromName === "string" && typeof m.text === "string";
}

export function isAdminAck(v: unknown): v is AdminAck {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.to === "string" &&
    typeof a.id === "string" &&
    typeof a.fromName === "string" &&
    (a.kind === "message" || a.kind === "summon") &&
    (a.action === "read" || a.action === "accepted" || a.action === "declined" || a.action === "denied")
  );
}

/** Phrase affichée à l'admin quand la personne a répondu. */
export function ackText(a: Pick<AdminAck, "kind" | "action" | "fromName">): string {
  if (a.action === "denied") return `${a.fromName} n'a pas accès à cet endroit.`;
  if (a.action === "declined") return `${a.fromName} ne peut pas te rejoindre pour l'instant.`;
  if (a.action === "accepted") return `${a.fromName} te rejoint.`;
  return `${a.fromName} a lu ton message.`;
}

export function roleFromTags(tags: readonly string[], isLogged: boolean): PresenceRole {
  if (tags.includes("admin")) return "admin";
  if (tags.includes("staff")) return "staff";
  if (tags.includes("premium")) return "premium";
  return isLogged ? "membre" : "visiteur";
}
