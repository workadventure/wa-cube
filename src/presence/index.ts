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
  AckAction,
  AckKind,
  AdminAck,
  AdminMessage,
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
  isModMute,
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
/** Fenêtre de modération (message, couper le micro) ouverte au clic sur un avatar. */
const MODERATION_URL = "https://campus-entry-cube.lovable.app/moderation";
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
  };
}

function isForMe(to: string): boolean {
  return !!to && to === (WA.player.uuid ?? "");
}

/** Tags des personnes connectées, tenus par le serveur (donc non falsifiables par un joueur). */
const tagsByUuid = new Map<string, string[]>();

function roleOf(uuid: string) {
  const tags = tagsByUuid.get(uuid);
  return tags ? roleFromTags(tags, true) : null;
}

/** Le rôle de l'expéditeur annoncé dans le message est-il confirmé par le serveur, et suffisant ? */
function senderMayModerateMe(fromUuid: string): boolean {
  const sender = roleOf(fromUuid);
  if (!sender || fromUuid === (WA.player.uuid ?? "")) return false;
  const myTags = WA.player.tags ?? [];
  return canModerate(sender, roleFromTags(myTags, WA.player.isLogged === true));
}

/** Personnes de la bulle (ou de la salle de réunion) où je suis, comme dans la liste des participants. */
const bubble = new Map<number, { uuid: string; name: string }>();

function trackBubble(): void {
  const add = (p: { playerId: number; uuid: string; name: string }) => {
    if (p.uuid) bubble.set(p.playerId, { uuid: p.uuid, name: p.name });
  };
  try {
    WA.player.meetings.onJoin().subscribe((meeting) => {
      bubble.clear();
      meeting.participants.forEach(add);
      meeting.onParticipantJoin().subscribe(add);
      meeting.onParticipantLeave().subscribe((p) => bubble.delete(p.playerId));
      meeting.onLeave().subscribe(() => bubble.clear());
    });
  } catch (e) {
    console.warn("[modération] suivi des réunions indisponible", e);
  }
  try {
    // Ancienne API des bulles de proximité, au cas où meetings ne les remonte pas.
    WA.player.proximityMeeting.onJoin().subscribe((users) => {
      bubble.clear();
      users.forEach(add);
    });
    WA.player.proximityMeeting.onParticipantJoin().subscribe(add);
    WA.player.proximityMeeting.onParticipantLeave().subscribe((p) => bubble.delete(p.playerId));
    WA.player.proximityMeeting.onLeave().subscribe(() => bubble.clear());
  } catch (e) {
    console.warn("[modération] suivi des bulles indisponible", e);
  }
}

/**
 * Staff et admin : au clic sur l'avatar de quelqu'un, une entrée "Modération" ouvre la
 * fenêtre du site (message, couper le micro, couper les micros de la bulle).
 */
function initModerationMenu(): void {
  const myRole = roleFromTags(WA.player.tags ?? [], WA.player.isLogged === true);
  if (myRole !== "admin" && myRole !== "staff") return;

  trackBubble();

  const actions = new Map<number, { remove(): void }[]>();
  const unlockAskedAt = new Map<string, number>();
  WA.ui.onRemotePlayerClicked.subscribe((remote) => {
    actions.get(remote.playerId)?.forEach((a) => a.remove());
    const list: { remove(): void }[] = [];

    // Une bulle verrouillée ne se déverrouille pas par script : on demande poliment à la personne.
    list.push(
      remote.addAction("Demander de déverrouiller", async () => {
        const feedback = (text: string) =>
          showNotification(
            { kind: "ack", id: newId(), fromName: "Modération", text },
            ACK_AUTO_CLOSE_MS,
          ).catch((e) => console.warn("[modération] retour impossible", e));
        const target = roleOf(remote.uuid);
        if (target && !canModerate(myRole, target)) {
          feedback("Tu ne peux pas viser cette personne.");
          return;
        }
        const last = unlockAskedAt.get(remote.uuid) ?? 0;
        if (Date.now() - last < 30_000) {
          feedback(`La demande a déjà été envoyée à ${remote.name}.`);
          return;
        }
        unlockAskedAt.set(remote.uuid, Date.now());
        const payload: AdminMessage = {
          v: PRESENCE_VERSION,
          id: newId(),
          fromUuid: WA.player.uuid ?? "",
          to: remote.uuid,
          fromName: WA.player.name,
          text: "Un membre de l'équipe souhaite rejoindre ta bulle. Peux-tu la déverrouiller avec le cadenas ? Merci.",
          moderation: true,
        };
        try {
          await WA.event.broadcast(PRESENCE_EVENTS.message, payload);
          feedback(`Demande envoyée à ${remote.name}.`);
        } catch (e) {
          console.warn("[modération] demande non envoyée", e);
          feedback("La demande n'a pas pu partir. Réessaie.");
        }
      }),
    );

    list.push(remote.addAction("Modération", async () => {
      try {
        // Les mêmes personnes que dans la "Liste des participants" de la bulle, hors staff et admins.
        const around = [...bubble.values()].filter((p) => {
          const role = roleOf(p.uuid);
          return role !== "staff" && role !== "admin";
        });
        const params = new URLSearchParams({
          to: remote.uuid,
          name: remote.name,
          around: JSON.stringify(around.slice(0, 40).map(({ uuid, name }) => ({ uuid, name }))),
        });
        WA.ui.modal.openModal({
          title: "Modération",
          src: `${MODERATION_URL}#${params.toString()}`,
          allow: null,
          allowApi: true,
          position: "center",
          closable: true,
          allowFullScreen: false,
        });
      } catch (e) {
        console.warn("[modération] ouverture impossible", e);
      }
    }));
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

  // Commande de modération envoyée par un admin.
  const done = new Set<string>();
  try {
    WA.state.onVariableChange(ADMIN_COMMAND_VARIABLE).subscribe((value) => {
      const cmd = parseAdminCommand(value);
      if (!cmd || done.has(cmd.id)) return;
      done.add(cmd.id);
      if (Math.abs(Date.now() - cmd.at) > ADMIN_COMMAND_MAX_AGE_MS) return;
      const me = WA.player.uuid ?? "";
      if (!cmd.targets.some((t) => t.uuid === me && t.sessionId === sessionId)) return;
      if (cmd.action === "teleport") {
        // L'admin amène la personne à lui. Jamais plus loin que ses droits ne le permettent à pied.
        const x = cmd.x ?? 0;
        const y = (cmd.y ?? 0) + 32;
        if (!canEnterAt(WA.player.tags ?? [], x, y)) return;
        WA.player
          .teleport(x, y)
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
    });
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
    // Un message "modération" n'est affiché que si le serveur confirme que l'expéditeur est staff ou admin.
    if (m.moderation && !senderMayModerateMe(m.fromUuid ?? "")) {
      console.warn("[modération] message ignoré : expéditeur non confirmé");
      return;
    }
    showNotification(
      {
        kind: "message",
        id: m.id ?? newId(),
        fromName: m.fromName,
        fromUuid: m.fromUuid,
        text: m.text,
        mod: m.moderation === true,
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

  // La modération coupe mon micro. Je peux le rallumer : on prévient, on n'enferme pas.
  const mutesDone = new Set<string>();
  WA.event.on(PRESENCE_EVENTS.mute).subscribe((ev) => {
    if (!isModMute(ev.data) || !isForMe(ev.data.to) || mutesDone.has(ev.data.id)) return;
    const m = ev.data;
    if (!senderMayModerateMe(m.fromUuid)) {
      console.warn("[modération] coupure de micro ignorée : expéditeur non confirmé");
      return;
    }
    mutesDone.add(m.id);
    try {
      WA.controls.turnOffMicrophone();
    } catch (e) {
      console.warn("[modération] micro non coupé", e);
    }
    showNotification(
      {
        kind: "message",
        id: m.id,
        fromName: "Modération",
        fromUuid: m.fromUuid,
        text: "Ton micro a été coupé par la modération. Tu peux le rallumer quand tu veux parler.",
        mod: true,
      },
      NOTIFICATION_AUTO_CLOSE_MS,
    ).catch((e) => console.warn("[modération] notification indisponible", e));
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
