/// <reference types="@workadventure/iframe-api-typings" />

import { bootstrapExtra } from "@workadventure/scripting-api-extra";
import { closeDialog } from "@workadventure/npc-dialog-box";
import { startShowroomTutorial } from "./showroomTutorial";
import { initTagColors } from "./tagColors";
import { initPresence } from "./presence";
import { initBubbleModeration } from "./moderation/bubble";
import { initArrival } from "./arrival";
import { initCowork } from "./cowork";
import { initDiagnostics } from "./diagnostics";
import { initRoofs } from "./roofs";
import { initAccessRules } from "./accessRules";
import { initRestrictedAreas } from "./restricted";

console.info('Script started successfully');

// Page Lovable affichée derrière le bouton "Plan & FAQ"
const PLAN_URL = "https://campus-entry-cube.lovable.app/plan-aide";

// Waiting for the API to be ready
WA.onInit().then(() => {
    console.info('Scripting API ready');
    console.info('Player tags: ',WA.player.tags)
    const userTags = WA.player.tags;    
    // Couleur du nom selon la formation : réglable depuis l'onglet Admin
    // de la page Plan & FAQ (variable de salle "tagColors").
    // Posée en premier : une erreur plus bas dans ce script ne doit pas
    // laisser la personne avec un fond gris.
    initTagColors().catch(e => console.error("[couleurs]", e));

    // Liste des tags autorisés à traverser (basée sur votre script)
    // "admin" (admins WorkAdventure) et "staff" (équipe) passent partout.
    const authorizedTags = ["premium", "staff", "admin"];
    const authorizedTagsEntrance = ["member", "premium", "staff", "admin"];

    // Vérifier si l'utilisateur possède au moins un des tags
    const hasAuthorizedTag = authorizedTags.some(tag => userTags.includes(tag));
    const hasAuthorizedTagEntrance = authorizedTagsEntrance.some(tag => userTags.includes(tag));

    if (hasAuthorizedTag) {
        // Masquer la couche de collision pour les membres de l'équipe
        WA.room.hideLayer("rightsRestriction");
        WA.room.hideLayer("collidesVisitor");
        WA.room.hideLayer("visitorAssets");
    }
    if (hasAuthorizedTagEntrance) {
        // Masquer la couche de collision pour les membres de l'équipe
        WA.room.hideLayer("entranceAssets");
        WA.room.hideLayer("collidesEntrance");
    }

    hideEvent();
    hideCircle();
    hideStaff();
    hideCampus();
    hideShowroom();

    WA.room.onLeaveLayer("start").subscribe(() => {
        showEvent();
        showCircle();
        showStaff();
        showCampus();
        showShowroom();
    });

    // Présence : permet à l'onglet Admin de lister les personnes du campus,
    // d'aller vers elles, de les faire venir ou de leur envoyer un message.
    initPresence();
    // Toits : remis d'équerre après une téléportation (les entrées de zone ne sont pas toujours signalées).
    initRoofs();
    // Droits des lieux : règles modifiables depuis l'onglet Admin du site, et contrôle des lieux restreints.
    initAccessRules();
    initRestrictedAreas();
    try {
        initBubbleModeration();
    } catch (e) {
        console.warn("[modération] bulle", e);
    }
    initArrival();
    try {
        initCowork();
    } catch (e) {
        console.warn("[cowork]", e);
    }

    // Boutons "Partager" (invitation) : celui de la barre d'actions ET celui de la liste des
    // personnes du panneau de gauche dépendent du même réglage de WorkAdventure, ils
    // disparaissent donc ensemble. L'invitation passe par le bouton "Inviter" de la
    // page Plan & FAQ (staff et admin).
    try {
        WA.controls.disableInviteButton();
    } catch (e) {
        console.warn("[partager] bouton non masqué", e);
    }

    // Chronologie des dernières minutes pour le bouton "Signaler un problème" (Plan & FAQ).
    try {
        initDiagnostics();
    } catch (e) {
        console.warn("[diagnostic]", e);
    }

    WA.ui.actionBar.addButton({
        id: "nav-btn",
        label: "Plan & FAQ",
        bgColor: "#6D1FFF",
        textColor: "#FFFFFF",
        toolTip: "",
        callback: () => {
            WA.ui.modal.openModal({
                title: "Navigation",
                src: PLAN_URL,
                // micro et caméra : test du micro et liste des périphériques
                // dans le formulaire de signalement ; presse-papiers : bouton "Copier"
                allow: "microphone; camera; clipboard-write",
                allowApi: true,
                position: "center",
                closable: true,
                allowFullScreen: false
            });
        }
    });

    // The line below bootstraps the Scripting API Extra library that adds a number of advanced properties/features to WorkAdventure
    bootstrapExtra().then(() => {
        WA.room.area.onEnter("zoneEvent").subscribe(() => {
            hideEvent();
        });
        WA.room.area.onLeave("zoneEvent").subscribe(() => {
            showEvent();
        });

        WA.room.area.onEnter("zoneCircle").subscribe(() => {
            hideCircle();
        });
        WA.room.area.onLeave("zoneCircle").subscribe(() => {
            showCircle();
        });

        WA.room.area.onEnter("zoneStaff").subscribe(() => {
            hideStaff();
        });
        WA.room.area.onLeave("zoneStaff").subscribe(() => {
            showStaff();
        });

        WA.room.onEnterLayer("zoneCampus").subscribe(() => {
            hideCampus();
        }); 
        WA.room.onLeaveLayer("zoneCampus").subscribe(() => {
            showCampus();
        });

        WA.room.area.onEnter("zoneShowroom").subscribe(() => {
            hideShowroom();
        });
        WA.room.area.onLeave("zoneShowroom").subscribe(() => {
            showShowroom();
        });



        WA.room.area.onEnter("zoneShowStep1").subscribe(() => {
            WA.room.showLayer("steps/step2");
            WA.room.showLayer("steps/step2b");
            WA.controls.disablePlayerProximityMeeting();
            startShowroomTutorial().catch(e => console.error(e));
        });

        WA.room.area.onLeave("zoneShowStep1").subscribe(() => {
            WA.controls.restorePlayerProximityMeeting();
            closeDialog().catch(e => console.error(e));
        });

        WA.room.area.onEnter("zoneShowStep2").subscribe(() => {
            WA.room.showLayer("steps/step3");
        });

        WA.room.area.onEnter("zoneShowStep3").subscribe(() => {
            WA.room.showLayer("steps/step4");
        });

        WA.room.area.onEnter("zoneShowStep4").subscribe(() => {
            WA.room.showLayer("steps/step5");
        });

        const hasAuthorizedTag = authorizedTags.some(tag => userTags.includes(tag));

        if (!hasAuthorizedTag) { 
            WA.room.onEnterLayer("rightsRestriction").subscribe(() => {
                const triggerMessage = WA.ui.displayActionMessage({
                    message: "Pour accéder au campus il faut vous connecter avec votre compte Cube",
                    callback: () => {
                       
                    }
                });

                setTimeout(() => {
                    // later
                    triggerMessage.remove();
                }, 5000)
            });
        }
    }).catch(e => console.error(e));

}).catch(e => console.error(e));

const showEvent = () => {
    WA.room.showLayer("roofs/roofEvent");
}
const hideEvent = () => {
    WA.room.hideLayer("roofs/roofEvent");
}
const showCircle = () => {
    WA.room.showLayer("roofs/roofSphere");
}
const hideCircle = () => {
    WA.room.hideLayer("roofs/roofSphere");
}
const showCampus = () => {
    WA.room.showLayer("roofs/roofCampus1");
    WA.room.showLayer("roofs/roofCampus2");
}
const hideCampus = () => {
    WA.room.hideLayer("roofs/roofCampus1");
    WA.room.hideLayer("roofs/roofCampus2");
}
const showShowroom = () => {
    WA.room.showLayer("roofs/roofShowroom");
}
const hideShowroom = () => {
    WA.room.hideLayer("roofs/roofShowroom");
}
const showStaff = () => {
    WA.room.showLayer("roofs/roofStaff");
}
const hideStaff = () => {
    WA.room.hideLayer("roofs/roofStaff");
}

export {};
