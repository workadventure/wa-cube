/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Couleur du nom selon les tags (script de la map)
   ---------------------------------------------------------
   Au chargement : lit la variable de salle "tagColors" (modifiable
   depuis l'onglet Admin de la page Plan & FAQ) et colore le nom du
   joueur. Si elle est vide, on garde les couleurs par défaut.
   Ensuite : chaque modification faite par un admin est appliquée
   tout de suite, sans recharger.

   La couleur est aussi ré-affirmée régulièrement : un appel unique au
   chargement peut être perdu (reconnexion réseau, appel trop tôt, erreur
   ailleurs dans le script) et laisse alors un fond gris à la personne
   jusqu'à son prochain rechargement.
   ========================================================= */

import {
  DEFAULT_TAG_COLORS,
  TAG_COLORS_VARIABLE,
  TagColor,
  colorForTags,
  hexToRgb,
  parseTagColors,
} from "./config";

/** Ré-envoie la couleur à intervalle régulier, même si elle n'a pas changé. */
const REASSERT_EVERY_MS = 30_000;
/** Premiers rappels rapprochés, au cas où l'appel initial serait ignoré. */
const EARLY_REASSERT_MS = [2_000, 8_000];

let appliedColor: string | null = null;
let entriesInUse: TagColor[] = DEFAULT_TAG_COLORS;

function currentEntries(value: unknown): TagColor[] {
  entriesInUse = parseTagColors(value) ?? DEFAULT_TAG_COLORS;
  return entriesInUse;
}

/** Couleurs en vigueur (utilisé par le module de présence). */
export function currentTagColors(): TagColor[] {
  return entriesInUse;
}

async function applyMyColor(entries: TagColor[], force = false): Promise<void> {
  const match = colorForTags(entries, WA.player.tags ?? []);
  const color = match ? match.color : null;
  if (!force && color === appliedColor) return;
  // Rien à poser et rien posé : inutile de solliciter le serveur.
  if (!color && !appliedColor) return;

  try {
    if (color) {
      const { r, g, b } = hexToRgb(color);
      await WA.player.setOutlineColor(r, g, b);
    } else if (appliedColor) {
      // Le tag n'a plus de couleur : on retire celle qu'on avait posée.
      await WA.player.removeOutlineColor();
    }
    appliedColor = color;
  } catch (e) {
    console.warn("[couleurs] impossible d'appliquer la couleur", e);
  }
}

/** À appeler une fois, après WA.onInit(). */
export async function initTagColors(): Promise<void> {
  let value: unknown = undefined;
  try {
    value = WA.state.loadVariable(TAG_COLORS_VARIABLE);
  } catch (e) {
    // Variable absente de la map (ancienne version) : couleurs par défaut.
    console.warn("[couleurs] variable de salle indisponible, couleurs par défaut", e);
  }
  await applyMyColor(currentEntries(value));

  const reassert = () => applyMyColor(entriesInUse, true).catch((e) => console.warn(e));
  EARLY_REASSERT_MS.forEach((ms) => setTimeout(reassert, ms));
  setInterval(reassert, REASSERT_EVERY_MS);

  try {
    WA.state.onVariableChange(TAG_COLORS_VARIABLE).subscribe((next) => {
      applyMyColor(currentEntries(next)).catch((e) => console.warn(e));
    });
  } catch (e) {
    console.warn("[couleurs] suivi des changements indisponible", e);
  }
}
