/// <reference types="@workadventure/iframe-api-typings" />

/* =========================================================
   Son perdu : détection par les témoins (PROTOTYPE)
   ---------------------------------------------------------
   Chaque navigateur écoute le mélange des voix qu'il REÇOIT dans la conversation (Meeting.listenToAudioStream,
   qui suit la bascule P2P / LiveKit) et n'en garde qu'une chose : voix ou silence, par tranche de 250 ms.
   Aucun son n'est enregistré ni envoyé.

   Quand j'entends le silence depuis 20 s dans une conversation d'au moins 3 personnes, mon script demande
   en silence aux scripts des autres participants : « vous avez entendu de la voix ces 20 dernières secondes ? ».
   Ils répondent seuls (un pourcentage), rien ne s'affiche chez eux.
     - Personne n'entend de voix : tout le monde se tait, rien à signaler.
     - Quelqu'un entend de la voix et mon micro est coupé : ce n'est pas moi qui parle, donc j'ai perdu le son.
       Alerte chez moi seulement.
     - Mon micro est ouvert : je suis peut-être celui qui parle. Pas d'alerte, juste une trace (« ambigu »).
   L'état des micros vient de l'espace « cube-son » (API Spaces, filtre streaming : personne n'y est audible).

   Prototype : actif seulement pour les tags de PROTOTYPE_TAGS. Les témoins doivent aussi l'avoir.
   Chaque décision va dans la chronologie du signalement (diagTimeline) et dans la console ([son]).
   ========================================================= */

import { diagEvent } from "../diagnostics";

/**
 * Personnes qui font tourner le prototype (témoins compris). Tags lus à la connexion.
 * Seulement test-son : le staff et les admins ne l'ont pas sans l'avoir demandé.
 */
const PROTOTYPE_TAGS = ["test-son"];

const SAMPLE_RATE = 8_000;
const FRAME_MS = 250;
/** Niveau (RMS) au-dessus duquel une tranche compte comme de la voix. Le bruit est déjà filtré à l'envoi. */
const VOICE_RMS = 0.01;
const WINDOW_MS = 20_000;
/** Il faut avoir écouté au moins ce temps dans la conversation avant de conclure quoi que ce soit. */
const MIN_LISTEN_MS = 20_000;
/** En dessous, c'est du silence (en % des tranches de la fenêtre). */
const SILENT_MAX_PCT = 3;
/** Au-dessus, un témoin a bien entendu quelqu'un parler. */
const WITNESS_MIN_PCT = 25;
const MIN_PARTICIPANTS = 3;
const ASK_EVERY_MS = 30_000;
const ANSWER_WAIT_MS = 3_000;
const ALERT_EVERY_MS = 10 * 60_000;
const CHECK_EVERY_MS = 5_000;

const SPACE = "cube-son";
const EVENTS = { question: "son:question", answer: "son:reponse" } as const;

interface Question {
  v: 1;
  id: string;
  fromPlayerId: number;
  fromUuid: string;
  to: number[];
}

interface Answer {
  v: 1;
  id: string;
  to: number;
  fromPlayerId: number;
  voicePct: number;
  frames: number;
  /** Le micro de celui qui demande, tel que je le vois dans l'espace (null si inconnu). */
  askerMic: boolean | null;
}

type Result = "son_perdu" | "silence_general" | "moi_qui_parle" | "ambigu" | "sans_reponse";

interface Listening {
  meetingName: string;
  since: number;
  participants: Map<number, { uuid: string; name: string }>;
  frames: { t: number; voiced: boolean }[];
  acc: { sumSq: number; n: number };
  unsubscribe: () => void;
}

let current: Listening | null = null;
const mics = new Map<string, boolean>();
const pending = new Map<string, { answers: Answer[]; timer: ReturnType<typeof setTimeout> }>();
let lastAsk = 0;
let lastAlert = 0;

function log(...args: unknown[]): void {
  console.info("[son]", ...args);
}

function voicePct(now: number): { pct: number; frames: number } {
  if (!current) return { pct: 0, frames: 0 };
  const recent = current.frames.filter((f) => now - f.t <= WINDOW_MS);
  if (recent.length === 0) return { pct: 0, frames: 0 };
  return { pct: Math.round((100 * recent.filter((f) => f.voiced).length) / recent.length), frames: recent.length };
}

/** Test : avec #test-son=sourd dans l'adresse, on fait comme si on ne recevait plus aucun son. */
let deafTest = false;

function onPcm(data: Float32Array): void {
  if (!current) return;
  const acc = current.acc;
  if (!deafTest) for (let i = 0; i < data.length; i++) acc.sumSq += data[i] * data[i];
  acc.n += data.length;
  const frameSize = (SAMPLE_RATE * FRAME_MS) / 1000;
  if (acc.n < frameSize) return;
  const now = Date.now();
  current.frames.push({ t: now, voiced: Math.sqrt(acc.sumSq / acc.n) > VOICE_RMS });
  acc.sumSq = 0;
  acc.n = 0;
  while (current.frames.length > 0 && now - current.frames[0].t > WINDOW_MS + 5_000) current.frames.shift();
}

function startListening(meeting: {
  name: string;
  participants: { playerId: number; uuid?: string; name: string }[];
  listenToAudioStream(sampleRate: number): { subscribe(f: (d: Float32Array) => void): { unsubscribe(): void } };
}): void {
  stopListening();
  const participants = new Map<number, { uuid: string; name: string }>();
  meeting.participants.forEach((p) => participants.set(p.playerId, { uuid: p.uuid ?? "", name: p.name }));
  current = {
    meetingName: meeting.name,
    since: Date.now(),
    participants,
    frames: [],
    acc: { sumSq: 0, n: 0 },
    unsubscribe: () => undefined,
  };
  try {
    const sub = meeting.listenToAudioStream(SAMPLE_RATE).subscribe(onPcm);
    current.unsubscribe = () => sub.unsubscribe();
  } catch (e) {
    console.warn("[son] écoute indisponible", e);
  }
}

function stopListening(): void {
  current?.unsubscribe();
  current = null;
}

/** Mon micro : dans l'espace si je m'y vois, sinon d'après ce que voient les témoins (majorité). */
function myMic(answers: Answer[]): boolean | null {
  const own = WA.player.uuid ? mics.get(WA.player.uuid) : undefined;
  if (own !== undefined) return own;
  const seen = answers.map((a) => a.askerMic).filter((m): m is boolean => m !== null);
  if (seen.length === 0) return null;
  return seen.filter(Boolean).length > seen.length / 2;
}

function decide(answers: Answer[]): { result: Result; mic: boolean | null; witnesses: number } {
  const mic = myMic(answers);
  if (answers.length === 0) return { result: "sans_reponse", mic, witnesses: 0 };
  const witnesses = answers.filter((a) => a.voicePct >= WITNESS_MIN_PCT).length;
  if (witnesses === 0) return { result: "silence_general", mic, witnesses };
  if (mic === false) return { result: "son_perdu", mic, witnesses };
  // Micro ouvert ou inconnu : si personne d'autre n'est dans le silence, c'est sûrement moi qui parle.
  const silentOthers = answers.filter((a) => a.voicePct <= SILENT_MAX_PCT).length;
  return { result: silentOthers === 0 ? "moi_qui_parle" : "ambigu", mic, witnesses };
}

function alert(openHelp: () => void): void {
  const now = Date.now();
  if (now - lastAlert < ALERT_EVERY_MS) return;
  lastAlert = now;
  WA.ui.banner.openBanner({
    id: `son-perdu-${now}`,
    text:
      "On dirait que tu n'entends plus la conversation : d'autres participants entendent quelqu'un parler, toi non. " +
      "Recharge la page (F5). Si ça revient, signale-le depuis Plan & FAQ : ça nous aide à trouver la cause. (test)",
    bgColor: "#b3261e",
    textColor: "#ffffff",
    closable: true,
    timeToClose: 30_000,
  });
  try {
    const msg = WA.ui.displayActionMessage({
      message: "Son perdu ? Appuie sur Espace pour ouvrir Plan & FAQ et le signaler",
      callback: () => openHelp(),
    });
    setTimeout(() => void msg.remove(), 30_000);
  } catch (e) {
    console.warn("[son] message d'action indisponible", e);
  }
}

function ask(openHelp: () => void): void {
  if (!current) return;
  const now = Date.now();
  const to = [...current.participants.keys()];
  if (to.length + 1 < MIN_PARTICIPANTS || now - lastAsk < ASK_EVERY_MS) return;
  if (now - current.since < MIN_LISTEN_MS) return;
  const mine = voicePct(now);
  // Pas assez de tranches : le flux n'arrive pas du tout, c'est aussi un silence.
  if (mine.pct > SILENT_MAX_PCT) return;
  lastAsk = now;
  const q: Question = {
    v: 1,
    id: `${WA.player.playerId}-${now}`,
    fromPlayerId: WA.player.playerId,
    fromUuid: WA.player.uuid ?? "",
    to,
  };
  const meetingName = current.meetingName;
  const timer = setTimeout(() => {
    const answers = pending.get(q.id)?.answers ?? [];
    pending.delete(q.id);
    const { result, mic, witnesses } = decide(answers);
    log(result, { salle: meetingName, moi: mine, micro: mic, reponses: answers.map((a) => a.voicePct) });
    diagEvent("son_temoins", {
      result,
      room: meetingName,
      mine: mine.pct,
      frames: mine.frames,
      mic,
      witnesses,
      answers: answers.length,
      asked: to.length,
    });
    if (result === "son_perdu") alert(openHelp);
  }, ANSWER_WAIT_MS);
  pending.set(q.id, { answers: [], timer });
  WA.event.broadcast(EVENTS.question, q).catch((e) => console.warn("[son] question non envoyée", e));
}

function isQuestion(x: unknown): x is Question {
  const q = x as Question;
  return !!q && q.v === 1 && typeof q.id === "string" && typeof q.fromPlayerId === "number" && Array.isArray(q.to);
}

function isAnswer(x: unknown): x is Answer {
  const a = x as Answer;
  return !!a && a.v === 1 && typeof a.id === "string" && typeof a.to === "number" && typeof a.voicePct === "number";
}

/** À appeler une fois, après WA.onInit(). `openHelp` ouvre la page Plan & FAQ. */
export function initSoundCheck(openHelp: () => void): void {
  if (!PROTOTYPE_TAGS.some((t) => WA.player.tags.includes(t))) return;
  try {
    deafTest = WA.room.hashParameters["test-son"] === "sourd";
  } catch {
    deafTest = false;
  }
  log(deafTest ? "prototype actif, mode test sourd" : "prototype actif");

  WA.spaces
    .joinSpace(SPACE, "streaming", ["microphoneState"])
    .then((space) => {
      space.userJoinedObservable.subscribe((u) => {
        mics.set(u.uuid, !!u.microphoneState);
        u.reactiveUser.microphoneState?.subscribe((m: unknown) => mics.set(u.uuid, !!m));
      });
      space.userLeftObservable.subscribe((u) => mics.delete(u.uuid));
    })
    .catch((e) => console.warn("[son] espace indisponible", e));

  WA.player.meetings.onJoin().subscribe((meeting) => {
    startListening(meeting);
    meeting.onParticipantJoin().subscribe((p) => current?.participants.set(p.playerId, { uuid: p.uuid ?? "", name: p.name }));
    meeting.onParticipantLeave().subscribe((p) => current?.participants.delete(p.playerId));
    meeting.onLeave().subscribe(() => stopListening());
  });

  WA.event.on(EVENTS.question).subscribe((ev) => {
    const q = ev.data;
    if (!isQuestion(q) || !q.to.includes(WA.player.playerId) || !current) return;
    const now = Date.now();
    // Pas assez écouté pour témoigner : on se tait plutôt que de répondre « silence ».
    if (now - current.since < MIN_LISTEN_MS) return;
    const { pct, frames } = voicePct(now);
    const askerMic = mics.has(q.fromUuid) ? (mics.get(q.fromUuid) ?? null) : null;
    const a: Answer = { v: 1, id: q.id, to: q.fromPlayerId, fromPlayerId: WA.player.playerId, voicePct: pct, frames, askerMic };
    WA.event.broadcast(EVENTS.answer, a).catch((e) => console.warn("[son] réponse non envoyée", e));
  });

  WA.event.on(EVENTS.answer).subscribe((ev) => {
    const a = ev.data;
    if (!isAnswer(a) || a.to !== WA.player.playerId) return;
    pending.get(a.id)?.answers.push(a);
  });

  setInterval(() => ask(openHelp), CHECK_EVERY_MS);
}
