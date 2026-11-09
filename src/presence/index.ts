/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Présence (script de la map)
   ---------------------------------------------------------
   - rejoint l'espace de présence : le serveur WorkAdventure en tient la liste
     (nom, tags, carte), la page admin la reçoit en direct, sans interroger personne ;
   - répond avec sa position quand un admin la demande à CETTE personne ;
   - reçoit les demandes d'un admin : "rejoins-moi", ou un message.
   Rien n'est forcé : la personne voit une invitation et choisit.

   Modération : un admin peut déconnecter une session précise (inactive, restée
   à l'entrée, ou ancien onglet d'une double connexion). La commande passe par la
   variable de salle "adminCommand", inscriptible par les admins seulement
   (contrôlé par le serveur). La personne arrive sur la page /deconnecte et peut
   revenir quand elle veut.

   Les notifications s'affichent en haut à droite, dans une petite page
   Lovable (/notification) ouverte comme "site d'interface" : elle reste au
   premier plan, y compris devant un partage d'écran. Quand la personne clique,
   la page renvoie un accusé de réception à l'admin (admin:ack), qui voit
   alors "X a lu ton message" de la même façon.
   ========================================================= */

import { currentTagColors } from "../tagColors";
import { colorForTags } from "../tagColors/config";
import { canEnterAt, zoneAt } from "../zones";
import {
  ADMIN_COMMAND_MAX_AGE_MS,
  ADMIN_COMMAND_VARIABLE,
  STAFF_COMMAND_VARIABLE,
  AckAction,
  AckKind,
  AdminAck,
  AdminCommand,
  PRESENCE_EVENTS,
  PRESENCE_SPACE,
  PRESENCE_SPACE_FILTER,
  PRESENCE_VERSION,
  PresenceInfo,
  ackText,
  canModerate,
  isAdminAck,
  isAdminMessage,
  isAdminSummon,
  isHelloForMe,
  parseAdminCommand,
  roleFromTags,
} from "./protocol";

const connectedAt = Date.now();
/** Propre à cet onglet : sert à viser le bon onglet en cas de double connexion. */
const sessionId = `${connectedAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** Dernier déplacement du joueur dans cet onglet. */
let lastMoveAt = connectedAt;

/** Page affichée à la personne déconnectée par un admin. */
const LEFT_URL = "https://campus-entry-cube.lovable.app/deconnecte";
/** Réponses à une demande générale étalées dans le temps, pour ne pas saturer la page admin. */
const HELLO_JITTER_MS = 1500;

/** Page de notification hébergée sur Lovable (même domaine que Plan & FAQ). */
const NOTIFICATION_URL = "https://campus-entry-cube.lovable.app/notification";
const NOTIFICATION_WIDTH = "380px";
const NOTIFICATION_AUTO_CLOSE_MS = 60_000;
const ACK_AUTO_CLOSE_MS = 8_000;

type UIWebsite = Awaited<ReturnType<typeof WA.ui.website.open>>;
let currentNotification: UIWebsite | null = null;

interface NotificationData {
  kind: AckKind | "ack";
  id: string;
  fromName: string;
  fromUuid?: string;
  text?: string;
  zone?: string | null;
  x?: number;
  y?: number;
  /** Message venant de la modération : étiquette et couleur distinctes. */
  mod?: boolean;
}

/** Hauteur du cadre : assez pour afficher tout le message (≈ 38 caractères par ligne). */
function notificationHeight(n: NotificationData): string {
  if (n.kind === "ack") return "96px";
  if (n.kind === "summon") return "250px";
  const lines = Math.ceil((n.text ?? "").length / 38);
  return `${Math.min(400, 150 + Math.max(2, lines) * 21)}px`;
}

/**
 * Ouvre la notification en haut à droite. Les données passent dans le fragment (#),
 * qui n'est jamais envoyé au serveur : le texte d'un message ne finit pas dans des logs.
 * Une seule notification à la fois : la nouvelle remplace l'ancienne.
 */
async function showNotification(n: NotificationData, autoCloseMs: number): Promise<void> {
  const params = new URLSearchParams({
    kind: n.kind,
    id: n.id,
    from: n.fromName,
    fromUuid: n.fromUuid ?? "",
    text: (n.text ?? "").slice(0, 280),
    zone: n.zone ?? "",
    x: String(Math.round(n.x ?? 0)),
    y: String(Math.round(n.y ?? 0)),
    mod: n.mod ? "1" : "",
  });
  await currentNotification?.close().catch(() => undefined);
  currentNotification = null;
  const site = await WA.ui.website.open({
    url: `${NOTIFICATION_URL}#${params.toString()}`,
    allowApi: true,
    visible: true,
    position: { vertical: "top", horizontal: "right" },
    size: { width: NOTIFICATION_WIDTH, height: notificationHeight(n) },
    margin: { top: "16px", right: "16px" },
  });
  currentNotification = site;
  setTimeout(() => {
    site.close().catch(() => undefined);
    if (currentNotification === site) currentNotification = null;
  }, autoCloseMs);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Accusé de réception envoyé à l'admin (utilisé par les solutions de repli ci-dessous). */
function sendAck(to: string | undefined, id: string, kind: AckKind, action: AckAction): void {
  if (!to) return;
  const ack: AdminAck = {
    v: PRESENCE_VERSION,
    to,
    id,
    kind,
    action,
    fromName: WA.player.name,
    fromUuid: WA.player.uuid ?? "",
  };
  WA.event.broadcast(PRESENCE_EVENTS.ack, ack).catch((e) => console.warn("[presence] accusé non envoyé", e));
}
async function myInfo(): Promise<PresenceInfo> {
  const pos = await WA.player.getPosition();
  const tags = WA.player.tags ?? [];
  const isLogged = WA.player.isLogged === true;
  const f = colorForTags(currentTagColors(), tags);
  return {
    v: PRESENCE_VERSION,
    uuid: WA.player.uuid ?? "",
    name: WA.player.name,
    isLogged,
    role: roleFromTags(tags, isLogged),
    formation: f ? { tag: f.tag, label: f.label, color: f.color } : null,
    zone: zoneAt(pos.x, pos.y),
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    connectedAt,
    sessionId,
    idleMs: Math.max(0, Date.now() - lastMoveAt),
    tags: [...tags],
  };
}

function isForMe(to: string): boolean {
  return !!to && to === (WA.player.uuid ?? "");
}

/** Tags des personnes connectées, tenus par le serveur (donc non falsifiables par un joueur). */
const tagsByUuid = new Map<string, string[]>();

export function roleOf(uuid: string) {
  const tags = tagsByUuid.get(uuid);
  return tags ? roleFromTags(tags, true) : null;
}

/** Coupe mon micro (je peux le rallumer), prévient la personne et renvoie l'accusé à l'expéditeur. */
function cutMyMicrophone(id: string, byName: string, byUuid: string | undefined): void {
  try {
    WA.controls.turnOffMicrophone();
  } catch (e) {
    console.warn("[modération] micro non coupé", e);
  }
  showNotification(
    {
      kind: "message",
      id,
      fromName: byName || "Modération",
      fromUuid: byUuid,
      text: "Ton micro a été coupé par la modération. Tu peux le rallumer quand tu veux parler.",
      mod: true,
    },
    NOTIFICATION_AUTO_CLOSE_MS,
  ).catch((e) => console.warn("[modération] notification indisponible", e));
  sendAck(byUuid, id, "message", "muted");
}

/**
 * Staff et admin : au clic sur l'avatar de quelqu'un, deux actions directes aux libellés courts, pour
 * que la carte de la personne reste étroite : « Couper micro » et « Déverrouiller » (demande envoyée à
 * toute la bulle). Couper les micros d'une bulle entière passe par la liste « Ma bulle » (staff) ou le
 * menu natif des vignettes (admins).
 */
function initModerationMenu(): void {
  const myRole = roleFromTags(WA.player.tags ?? [], WA.player.isLogged === true);
  if (myRole !== "admin" && myRole !== "staff") return;

  // Les personnes autour d'un avatar cliqué (sa bulle) : positions des joueurs visibles à l'écran.
  WA.players.configureTracking({ players: true, movement: true }).catch((e) => console.warn("[modération] suivi", e));
  /** Distance (px) en dessous de laquelle quelqu'un est dans la même bulle que l'avatar cliqué. */
  const SAME_BUBBLE_PX = 190;

  const feedback = (text: string) =>
    showNotification({ kind: "ack", id: newId(), fromName: "Modération", text }, ACK_AUTO_CLOSE_MS).catch((e) =>
      console.warn("[modération] retour impossible", e),
    );

  /** L'avatar cliqué et ceux de sa bulle, hors staff et admins, hors moi. */
  const groupOf = (remote: { uuid: string; name: string; position: { x: number; y: number } }) => {
    const out = new Map<string, string>();
    const add = (uuid: string, name: string) => {
      if (!uuid || uuid === (WA.player.uuid ?? "")) return;
      const role = roleOf(uuid);
      if (role && !canModerate(myRole, role)) return;
      out.set(uuid, name);
    };
    add(remote.uuid, remote.name);
    try {
      for (const p of WA.players.list()) {
        const d = Math.hypot(p.position.x - remote.position.x, p.position.y - remote.position.y);
        if (d <= SAME_BUBBLE_PX) add(p.uuid, p.name);
      }
    } catch {
      /* suivi indisponible : seule la personne cliquée est visée */
    }
    return [...out.entries()].slice(0, 12).map(([uuid, name]) => ({ uuid, name }));
  };

  /** Envoie une commande par la variable de mon rôle : admin (adminCommand) ou staff (staffCommand). */
  const send = async (cmd: Omit<AdminCommand, "v" | "id" | "reason" | "by" | "byUuid" | "at">) => {
    const full: AdminCommand = {
      v: PRESENCE_VERSION,
      id: newId(),
      reason: "other",
      by: WA.player.name,
      byUuid: WA.player.uuid ?? "",
      at: Date.now(),
      ...cmd,
    };
    const variable = myRole === "admin" ? ADMIN_COMMAND_VARIABLE : STAFF_COMMAND_VARIABLE;
    await WA.state.saveVariable(variable, JSON.stringify(full));
  };

  const muteMany = async (targets: { uuid: string; name: string }[]) => {
    if (targets.length === 0) {
      feedback("Personne à viser ici.");
      return;
    }
    try {
      await send({ action: "mute", targets: targets.map((t) => ({ uuid: t.uuid, sessionId: "" })) });
      feedback(
        targets.length === 1
          ? `Micro de ${targets[0].name} coupé.`
          : `Micros coupés : ${targets.map((t) => t.name).join(", ")}.`,
      );
    } catch (e) {
      console.warn("[modération] coupure non envoyée", e);
      feedback("La coupure n'a pas pu partir. Réessaie.");
    }
  };

  const unlockAskedAt = new Map<string, number>();
  const actions = new Map<number, { remove(): void }[]>();
  WA.ui.onRemotePlayerClicked.subscribe((remote) => {
    actions.get(remote.playerId)?.forEach((a) => a.remove());
    const list: { remove(): void }[] = [];

    list.push(
      remote.addAction("Couper micro", () => {
        const role = roleOf(remote.uuid);
        if (role && !canModerate(myRole, role)) {
          feedback("Tu ne peux pas viser cette personne.");
          return;
        }
        void muteMany([{ uuid: remote.uuid, name: remote.name }]);
      }),
    );

    // Une bulle verrouillée ne se déverrouille pas par script : on demande poliment, à toute la bulle.
    list.push(
      remote.addAction("Déverrouiller", async () => {
        const targets = groupOf(remote).filter((t) => Date.now() - (unlockAskedAt.get(t.uuid) ?? 0) > 30_000);
        if (targets.length === 0) {
          feedback("La demande a déjà été envoyée à cette bulle.");
          return;
        }
        try {
          targets.forEach((t) => unlockAskedAt.set(t.uuid, Date.now()));
          await send({
            action: "message",
            targets: targets.map((t) => ({ uuid: t.uuid, sessionId: "" })),
            text: "Un membre de l'équipe souhaite rejoindre ta bulle. Peux-tu la déverrouiller avec le cadenas ? Merci.",
          });
          feedback(
            targets.length === 1
              ? `Demande envoyée à ${targets[0].name}.`
              : `Demande envoyée à ${targets.length} personnes de la bulle.`,
          );
        } catch (e) {
          console.warn("[modération] demande non envoyée", e);
          feedback("La demande n'a pas pu partir. Réessaie.");
        }
      }),
    );

    actions.set(remote.playerId, list);
  });
}

/** À appeler une fois, après WA.onInit(). */
export function initPresence(): void {
  // Apparaître dans la liste native des connectés (aucun trafic ensuite).
  WA.spaces
    .joinSpace(PRESENCE_SPACE, PRESENCE_SPACE_FILTER, [])
    .then((space) => {
      space.userJoinedObservable.subscribe((u) => tagsByUuid.set(u.uuid, u.tags ?? []));
      space.userLeftObservable.subscribe((u) => tagsByUuid.delete(u.uuid));
    })
    .catch((e) => console.warn("[presence] espace indisponible", e));

  try {
    initModerationMenu();
  } catch (e) {
    console.warn("[modération] menu indisponible", e);
  }

  WA.event.on(PRESENCE_EVENTS.hello).subscribe((ev) => {
    // Seule la personne interrogée répond : un seul message au lieu d'une rafale.
    if (!isHelloForMe(ev.data, WA.player.uuid ?? "")) return;
    const targeted = !!(ev.data && typeof ev.data === "object" && (ev.data as { to?: unknown }).to);
    // Demande à une personne : réponse immédiate. Demande générale (analyse admin) : on s'étale.
    setTimeout(
      () => {
        myInfo()
          .then((info) => WA.event.broadcast(PRESENCE_EVENTS.here, info))
          .catch((e) => console.warn("[presence]", e));
      },
      targeted ? 0 : Math.random() * HELLO_JITTER_MS,
    );
  });

  // Activité : un déplacement suffit à remettre le compteur d'inactivité à zéro.
  try {
    WA.player.onPlayerMove(() => {
      lastMoveAt = Date.now();
    });
  } catch (e) {
    console.warn("[presence] suivi d'activité indisponible", e);
  }

  // Commandes de modération : variable des admins (tout) et variable du staff (messages et micros
  // seulement). Le serveur WorkAdventure refuse l'écriture à tout autre compte.
  const done = new Set<string>();
  const handleCommand = (value: unknown, via: "admin" | "staff") => {
    const cmd = parseAdminCommand(value);
    if (!cmd || done.has(cmd.id)) return;
    done.add(cmd.id);
    if (Math.abs(Date.now() - cmd.at) > ADMIN_COMMAND_MAX_AGE_MS) return;
    const me = WA.player.uuid ?? "";
    const soft = cmd.action === "mute" || cmd.action === "message";
    // Le staff n'a que les actions douces, et jamais sur un autre staff ni sur un admin.
    if (via === "staff") {
      if (!soft) return;
      const myRole = roleFromTags(WA.player.tags ?? [], WA.player.isLogged === true);
      if (myRole === "staff" || myRole === "admin") return;
    }
    if (!cmd.targets.some((t) => t.uuid === me && (soft || t.sessionId === sessionId))) return;

    if (cmd.action === "mute") {
      cutMyMicrophone(cmd.id, cmd.by || "Modération", cmd.byUuid);
      return;
    }
    if (cmd.action === "message") {
      showNotification(
        {
          kind: "message",
          id: cmd.id,
          fromName: cmd.by || "Modération",
          fromUuid: cmd.byUuid,
          text: cmd.text ?? "",
          mod: true,
        },
        NOTIFICATION_AUTO_CLOSE_MS,
      ).catch((e) => console.warn("[modération] notification indisponible", e));
      return;
    }
    if (cmd.action === "teleport") {
      // L'admin amène la personne à lui. Jamais plus loin que ses droits ne le permettent à pied.
      const x = cmd.x ?? 0;
      const y = (cmd.y ?? 0) + 32;
      if (!canEnterAt(WA.player.tags ?? [], x, y)) {
        // L'admin le sait : « X n'a pas accès à cet endroit ».
        sendAck(cmd.byUuid, cmd.id, "summon", "denied");
        return;
      }
      WA.player
        .teleport(x, y)
        .then(() => sendAck(cmd.byUuid, cmd.id, "summon", "accepted"))
        .then(() =>
          showNotification(
            {
              kind: "message",
              id: cmd.id,
              fromName: cmd.by || "Un membre de l'équipe",
              text: "Tu as été téléporté auprès de cette personne de l'équipe.",
            },
            NOTIFICATION_AUTO_CLOSE_MS,
          ),
        )
        .catch((e) => console.warn("[presence] téléportation impossible", e));
      return;
    }
    // WA.room.id est une adresse complète (https://play.workadventu.re/@/...) ; un chemin est accepté aussi.
    const rid = WA.room.id;
    const back = /^https?:\/\//i.test(rid)
      ? rid.split("#")[0].split("?")[0]
      : rid.startsWith("/")
        ? `https://play.workadventu.re${rid.split("#")[0].split("?")[0]}`
        : "";
    const note = cmd.note ? `&note=${encodeURIComponent(cmd.note)}` : "";
    const url = `${LEFT_URL}?r=${encodeURIComponent(cmd.reason)}${note}${back ? `&back=${encodeURIComponent(back)}` : ""}`;
    WA.nav.goToPage(url);
  };
  try {
    WA.state.onVariableChange(ADMIN_COMMAND_VARIABLE).subscribe((value) => handleCommand(value, "admin"));
    WA.state.onVariableChange(STAFF_COMMAND_VARIABLE).subscribe((value) => handleCommand(value, "staff"));
  } catch (e) {
    console.warn("[presence] canal de modération indisponible", e);
  }

  WA.event.on(PRESENCE_EVENTS.summon).subscribe((ev) => {
    if (!isAdminSummon(ev.data) || !isForMe(ev.data.to)) return;
    const s = ev.data;
    const id = s.id ?? newId();
    showNotification(
      { kind: "summon", id, fromName: s.fromName, fromUuid: s.fromUuid, zone: s.zone, x: s.x, y: s.y },
      NOTIFICATION_AUTO_CLOSE_MS,
    ).catch((e) => {
      // Repli : l'ancien message en bas de l'écran (espace pour accepter).
      console.warn("[presence] notification indisponible", e);
      const where = s.zone ? ` (${s.zone})` : "";
      const msg = WA.ui.displayActionMessage({
        message: `Invitation de ${s.fromName} : un membre de l'équipe t'invite à le rejoindre${where}. Appuie sur espace pour y aller.`,
        type: "message",
        callback: () => {
          // Jamais plus loin que ce que les droits de la personne permettent à pied.
          if (!canEnterAt(WA.player.tags ?? [], s.x, s.y + 32)) {
            sendAck(s.fromUuid, id, "summon", "denied");
            return;
          }
          sendAck(s.fromUuid, id, "summon", "accepted");
          WA.player.teleport(s.x, s.y + 32).catch((err) => console.warn(err));
        },
      });
      setTimeout(() => msg.remove().catch(() => undefined), NOTIFICATION_AUTO_CLOSE_MS);
    });
  });

  WA.event.on(PRESENCE_EVENTS.message).subscribe((ev) => {
    if (!isAdminMessage(ev.data) || !isForMe(ev.data.to)) return;
    const m = ev.data;
    // Les messages de modération passent par les variables staffCommand / adminCommand (serveur) :
    // un événement qui se réclame de la modération n'est pas affiché.
    if (m.moderation) return;
    showNotification(
      {
        kind: "message",
        id: m.id ?? newId(),
        fromName: m.fromName,
        fromUuid: m.fromUuid,
        text: m.text,
      },
      NOTIFICATION_AUTO_CLOSE_MS,
    ).catch((e) => {
      // Repli : bandeau en haut (pas d'accusé possible, il n'a pas de clic).
      console.warn("[presence] notification indisponible", e);
      WA.ui.banner.openBanner({
        id: `admin-message-${Date.now()}`,
        text: `${m.fromName} : ${m.text.slice(0, 280)}`,
        bgColor: "#6E1FFF",
        textColor: "#FFFFFF",
        closable: true,
        timeToClose: NOTIFICATION_AUTO_CLOSE_MS,
      });
    });
  });

  // Côté admin : la personne a cliqué, on affiche l'accusé au même endroit.
  WA.event.on(PRESENCE_EVENTS.ack).subscribe((ev) => {
    if (!isAdminAck(ev.data) || !isForMe(ev.data.to)) return;
    const a = ev.data;
    showNotification(
      { kind: "ack", id: a.id, fromName: a.fromName, fromUuid: a.fromUuid, text: ackText(a) },
      ACK_AUTO_CLOSE_MS,
    ).catch((e) => console.warn("[presence] accusé non affiché", e));
  });
}
