/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Tags ajoutés depuis l'onglet Admin du site
   ---------------------------------------------------------
   WorkAdventure ne laisse pas un script changer les tags d'une personne. L'onglet Admin du site
   (« Tags ajoutés ») en enregistre donc de son côté, rattachés à l'e-mail du compte. La carte les
   demande au site avec le jeton de salle de la personne (le site vérifie le jeton : on ne reçoit que
   les siens), puis les ajoute aux tags de WorkAdventure pour les droits des lieux, les calques
   réservés, la couleur et la présence.
   Relus toutes les minutes : un tag ajouté en cours de partie compte sans reconnexion.

   Ne comptent PAS : les zones réservées réglées dans l'éditeur de carte de WorkAdventure, et les
   pouvoirs de modération (vérifiés sur les tags tenus par le serveur WorkAdventure).
   ========================================================= */

const TAGS_URL = "https://campus-entry-cube.lovable.app/api/public/my-tags";
const REFRESH_MS = 60_000;
/** Attente maximale du site au chargement, pour ne pas retarder la carte. */
const FIRST_LOAD_MAX_MS = 2_500;

let extra: string[] = [];
let email = "";
const listeners = new Set<() => void>();

const norm = (tags: readonly string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

/** Tags de la personne : ceux de WorkAdventure + ceux ajoutés sur le site, en minuscules, sans doublon. */
export function playerTags(): string[] {
  return norm([...(WA.player.tags ?? []), ...extra]);
}

/** Tags ajoutés sur le site seulement. */
export function addedTags(): string[] {
  return [...extra];
}

/** E-mail du compte, vérifié par le site (vide pour un visiteur ou si le site n'a pas répondu). */
export function verifiedEmail(): string {
  return email;
}

/** Prévenu quand les tags ajoutés changent (ajout ou retrait depuis l'onglet Admin). */
export function onPlayerTagsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function load(): Promise<void> {
  if (WA.player.isLogged !== true) return;
  const token = WA.player.userRoomToken;
  if (!token) return;
  try {
    const res = await fetch(TAGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { tags?: unknown; email?: unknown };
    const next = Array.isArray(body.tags) ? norm(body.tags.filter((t): t is string => typeof t === "string")).slice(0, 20) : [];
    if (typeof body.email === "string") email = body.email;
    if (next.join(",") === extra.join(",")) return;
    extra = next;
    console.info("[tags ajoutés]", extra);
    for (const cb of listeners) {
      try {
        cb();
      } catch (e) {
        console.warn("[tags ajoutés] mise à jour", e);
      }
    }
  } catch (e) {
    console.warn("[tags ajoutés] lecture impossible, tags de WorkAdventure seuls", e);
  }
}

/** À attendre au début de WA.onInit() : les droits et les calques dépendent de ces tags. */
export async function initExtraTags(): Promise<void> {
  await Promise.race([load(), new Promise((r) => setTimeout(r, FIRST_LOAD_MAX_MS))]);
  setInterval(() => void load(), REFRESH_MS);
}
