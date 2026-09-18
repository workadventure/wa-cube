
App · JS
/* =========================================================
   Plan du Campus — Logique
   ========================================================= */
 
/* =========================================================
   ⚙️  CONFIGURATION — À ÉDITER ICI
   Coordonnées de téléportation par zone : WA.player.teleport(x, y).
   Modifiez simplement les paires [x, y] ci-dessous.
   ========================================================= */
const TELEPORT_COORDS = {
  staff:    [592,  2000],
  campus:   [3200, 2850],
  showroom: [300,  4000],
  event:    [5130, 3900],
  entry:    [3200, 4160],
};
 
/* =========================================================
   ⚙️  SALLES DE CLASSE — À ÉDITER ICI
   tp   = point d'arrivée [x, y] en pixels sur la map (1 tuile = 32 px)
   rect = rectangle de la salle [x, y, largeur, hauteur] en pixels,
          sert uniquement à placer la salle sur l'image du plan.
   Pour ajouter une salle : copiez une ligne et changez les valeurs.
   featured: true = espace à part (bouton pleine largeur, autre couleur).
   ========================================================= */
const MAP_SIZE = [7040, 4448]; // taille de campus.tmj en pixels (220 x 139 tuiles)
 
const CLASSROOMS = [
  { id: 'agora', short: 'A', name: 'Agora', featured: true, tp: [2944, 2144], rect: [2656, 1664, 608, 704] },
  { id: 1, name: 'Salle 1', tp: [1600, 960], rect: [1440, 352, 640, 864] },
  { id: 2, name: 'Salle 2', tp: [2272, 960], rect: [2112, 352, 640, 864] },
  { id: 3, name: 'Salle 3', tp: [2944, 960], rect: [2784, 352, 640, 864] },
  { id: 4, name: 'Salle 4', tp: [3616, 960], rect: [3456, 352, 640, 864] },
  { id: 5, name: 'Salle 5', tp: [4288, 960], rect: [4128, 352, 640, 864] },
  { id: 6, name: 'Salle 6', tp: [4960, 960], rect: [4800, 352, 640, 864] },
  { id: 7, name: 'Salle 7', tp: [5232, 1456], rect: [5136, 1376, 336, 448] },
];
 
// Tags WorkAdventure autorisés à se téléporter dans les salles
// (même règle que main.ts : seuls les "premium" passent la barrière du campus).
// Mettez [] pour ouvrir les salles à tout le monde.
const ROOMS_REQUIRED_TAGS = ['premium'];
 
/* =========================================================
   Données des zones
   id = clé partagée par le hotspot, le filtre et la carte.
   ========================================================= */
const ZONES = [
  {
    id: 'staff',
    name: 'Staff',
    tag: 'Équipe Cube',
    color: 'var(--c-staff)',
    desc: "Espace réservé à l’équipe pédagogique, mentors et support. Posez vos questions ou demandez de l’aide.",
    actions: ['Mentorat', 'Support', 'Questions'],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  },
  {
    id: 'campus',
    name: 'Campus',
    tag: 'Cœur de formation',
    color: 'var(--c-campus)',
    desc: "Salles de cours, espaces d’apprentissage et ateliers en direct. Le bâtiment principal où tout se passe.",
    actions: ['Cours', 'Ateliers', 'Live'],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></svg>`,
  },
  {
    id: 'showroom',
    name: 'Showroom',
    tag: 'Projets & démos',
    color: 'var(--c-showroom)',
    desc: "Vitrine des projets d’apprenants, portfolios et démos en libre exploration. Inspiration garantie.",
    actions: ['Portfolios', 'Démos', 'Projets'],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
  },
  {
    id: 'event',
    name: 'Événement',
    tag: 'Conférences',
    color: 'var(--c-event)',
    desc: "Portes ouvertes, conférences, masterclasses et grands rendez-vous. Consultez l’agenda à l’entrée.",
    actions: ['Masterclass', 'Conférences', 'Rencontres'],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`,
  },
  {
    id: 'entry',
    name: 'Entrée · Bienvenue',
    tag: 'Onboarding',
    color: 'var(--c-entry)',
    desc: "Point d’arrivée des nouveaux visiteurs. Onboarding rapide pour découvrir les commandes et les zones.",
    actions: ['Tutoriel', 'Découverte', 'Premiers pas'],
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h12"/><path d="M9 6l-6 6 6 6"/><path d="M21 4v16"/></svg>`,
  },
];
 
/* Helpers DOM */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
 
const legendEl = $('#legend');
const mapEl    = $('#map');
const detailEl = $('#detail');
 
let stickyZone = null; // zone "épinglée" par un clic
 
/* =========================================================
   Génération des cartes de la légende (carrousel)
   ========================================================= */
ZONES.forEach(zone => {
  const card = document.createElement('button');
  card.className = 'zone-card';
  card.dataset.zone = zone.id;
  card.style.setProperty('--c', zone.color);
  card.innerHTML = `
    <div class="head">
      <div class="ico" aria-hidden="true">${zone.icon}</div>
      <span class="tag">${zone.tag}</span>
    </div>
    <h3>${zone.name}</h3>
    <p>${zone.desc}</p>
    <div class="actions">${zone.actions.map(a => `<span>${a}</span>`).join('')}</div>
  `;
  card.addEventListener('mouseenter', () => highlight(zone.id));
  card.addEventListener('mouseleave', () => { if (!stickyZone) highlight(null); });
  card.addEventListener('focus',      () => highlight(zone.id));
  card.addEventListener('blur',       () => { if (!stickyZone) highlight(null); });
  card.addEventListener('click',      () => { selectZone(zone.id); openDetail(zone); });
  legendEl.appendChild(card);
});
 
/* =========================================================
   Navigation du carrousel
   ========================================================= */
const legPrev = $('#legendPrev');
const legNext = $('#legendNext');
const legendStep = () => legendEl.clientWidth * 0.8;
 
function updateLegendNav(){
  legPrev.disabled = legendEl.scrollLeft <= 4;
  legNext.disabled = legendEl.scrollLeft + legendEl.clientWidth >= legendEl.scrollWidth - 4;
}
legPrev.addEventListener('click', () => legendEl.scrollBy({ left: -legendStep(), behavior: 'smooth' }));
legNext.addEventListener('click', () => legendEl.scrollBy({ left:  legendStep(), behavior: 'smooth' }));
legendEl.addEventListener('scroll', updateLegendNav, { passive: true });
window.addEventListener('resize', updateLegendNav);
updateLegendNav();
 
/* Fait défiler le carrousel pour rendre une carte visible */
function scrollCardIntoView(zoneId){
  const card = $(`.zone-card[data-zone="${zoneId}"]`);
  if (!card) return;
  const cardRect   = card.getBoundingClientRect();
  const listRect   = legendEl.getBoundingClientRect();
  const delta      = (cardRect.left - listRect.left) - 8; // align à gauche + padding
  legendEl.scrollBy({ left: delta, behavior: 'smooth' });
}
 
/* =========================================================
   Mise en évidence d'une zone (hover ou sélection épinglée)
   ========================================================= */
function highlight(zoneId){
  const targetId = zoneId ?? stickyZone;
  $$('.hotspot').forEach(h        => h.classList.toggle('is-on',  h.dataset.zone === targetId));
  $$('.zone-card').forEach(c      => c.classList.toggle('is-on',  c.dataset.zone === targetId));
  $$('.filter[data-zone]').forEach(f => f.classList.toggle('active', f.dataset.zone === targetId));
  mapEl.classList.toggle('is-focused', !!targetId);
  // Les salles n'apparaissent sur l'image que quand Campus est sélectionné
  mapEl.classList.toggle('show-rooms', stickyZone === 'campus');
}
 
function selectZone(zoneId){
  if (stickyZone === zoneId){
    stickyZone = null;
    highlight(null);
  } else {
    stickyZone = zoneId;
    highlight(zoneId);
    scrollCardIntoView(zoneId);
  }
}
 
/* =========================================================
   Hotspots sur la carte
   ========================================================= */
$$('.hotspot').forEach(hotspot => {
  const id = hotspot.dataset.zone;
  hotspot.addEventListener('mouseenter', () => highlight(id));
  hotspot.addEventListener('mouseleave', () => { if (!stickyZone) highlight(null); });
  hotspot.addEventListener('focus',      () => highlight(id));
  hotspot.addEventListener('blur',       () => { if (!stickyZone) highlight(null); });
  hotspot.addEventListener('click', () => {
    selectZone(id);
    openDetail(ZONES.find(z => z.id === id));
  });
});
 
/* =========================================================
   Filtres (pills)
   ========================================================= */
$$('.filter[data-zone]').forEach(filter => {
  const id = filter.dataset.zone;
  filter.addEventListener('mouseenter', () => highlight(id));
  filter.addEventListener('mouseleave', () => { if (!stickyZone) highlight(null); });
  filter.addEventListener('click',      () => selectZone(id));
});
 
/* =========================================================
   Panneau de détails
   ========================================================= */
function openDetail(zone){
  detailEl.style.setProperty('--c', zone.color);
  $('#dIco').innerHTML   = zone.icon;
  $('#dSub').textContent   = zone.tag;
  $('#dTitle').textContent = zone.name;
  $('#dDesc').textContent  = zone.desc;
  $('#dTp').onclick = () => teleport(zone);
  $('#dRooms').hidden = zone.id !== 'campus';
  detailEl.classList.add('open');
}
function closeDetail(){ detailEl.classList.remove('open'); }
$('#detailClose').addEventListener('click', closeDetail);
$('#dDismiss').addEventListener('click', closeDetail);
 
/* =========================================================
   Workadventure — appels API (attendent WA.onInit)
   ========================================================= */
function withWA(fn){
  if (window.WA && WA.onInit) WA.onInit().then(fn).catch(fn);
  else fn();
}
 
function teleport(zone){
  const [x, y] = TELEPORT_COORDS[zone.id] || TELEPORT_COORDS.entry;
  withWA(() => {
    try { WA.player.teleport(x, y); } catch (e) { console.warn(e); }
    try { WA.ui.modal.closeModal(); } catch (e) { console.warn(e); }
  });
}
 
/* =========================================================
   Salles de classe : boutons du sous-menu Campus + zones sur l'image
   ========================================================= */
let roomsAllowed = true; // recalculé avec les tags du joueur
 
function teleportToRoom(room){
  if (!roomsAllowed) return;
  const [x, y] = room.tp;
  withWA(() => {
    try { WA.player.teleport(x, y); } catch (e) { console.warn(e); }
    try { WA.ui.modal.closeModal(); } catch (e) { console.warn(e); }
  });
}
 
const pct = (v, total) => `${(v / total * 100).toFixed(2)}%`;
 
CLASSROOMS.forEach(room => {
  // Bouton dans le panneau Campus
  const btn = document.createElement('button');
  btn.className = 'room-btn' + (room.featured ? ' is-featured' : '');
  btn.dataset.room = room.id;
  btn.innerHTML = `<span class="num">${room.short ?? room.id}</span>${room.name}`;
  btn.addEventListener('click', () => teleportToRoom(room));
  $('#dRoomsGrid').appendChild(btn);
 
  // Zone cliquable sur l'image (visible quand Campus est sélectionné)
  const [x, y, w, h] = room.rect;
  const spot = document.createElement('button');
  spot.className = 'room-spot' + (room.featured ? ' is-featured' : '');
  spot.dataset.room = room.id;
  const dest = room.featured ? `à l'${room.name}` : `en ${room.name}`;
  spot.setAttribute('aria-label', `Aller ${dest}`);
  spot.title = `Aller ${dest}`;
  spot.style.left   = pct(x, MAP_SIZE[0]);
  spot.style.top    = pct(y, MAP_SIZE[1]);
  spot.style.width  = pct(w, MAP_SIZE[0]);
  spot.style.height = pct(h, MAP_SIZE[1]);
  spot.textContent = room.featured ? room.name : room.id;
  spot.addEventListener('click', e => { e.stopPropagation(); teleportToRoom(room); });
  $('.hotspots').appendChild(spot);
});
 
function applyRoomsAccess(tags){
  roomsAllowed = ROOMS_REQUIRED_TAGS.length === 0
    || ROOMS_REQUIRED_TAGS.some(t => (tags || []).includes(t));
  $$('.room-btn, .room-spot').forEach(b => { b.disabled = !roomsAllowed; });
  $('#dRoomsLock').hidden = roomsAllowed;
}
 
// Dans WorkAdventure on lit les tags du joueur. Hors WA (test local), tout est ouvert.
if (window.WA && WA.onInit){
  WA.onInit()
    .then(() => applyRoomsAccess(WA.player.tags))
    .catch(() => applyRoomsAccess([]));
}
 
$('#closeBtn').addEventListener('click', () => {
  withWA(() => {
    try { WA.ui.modal.closeModal(); } catch (e) { console.warn(e); }
  });
});
 
/* =========================================================
   Raccourci clavier : Échap réinitialise la sélection
   ========================================================= */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    closeDetail();
    stickyZone = null;
    highlight(null);
  }
});
 


