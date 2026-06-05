/// <reference types="@workadventure/iframe-api-typings" />

import { bootstrapExtra } from "@workadventure/scripting-api-extra";

console.info('Script started successfully');

// Waiting for the API to be ready
WA.onInit().then(() => {
    console.info('Scripting API ready');
    console.info('Player tags: ',WA.player.tags)
    const userTags = WA.player.tags;    
    // Liste des tags autorisés à traverser (basée sur votre script)
    const authorizedTags = ["premium"];
    const authorizedTagsEntrance = ["member", "premium"];

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

    // Équipe encadrante
    if (userTags.includes("staff")) {
        WA.player.setOutlineColor(148, 103, 189); // Violet #9467BD
    } 
    // Autom & agents IA
    else if (userTags.includes("autom")) {
        WA.player.setOutlineColor(31, 119, 180); // Bleu #1F77B4
    } 
    // Développement d'app IA
    else if (userTags.includes("dev")) {
        WA.player.setOutlineColor(255, 127, 14); // Orange #FF7F0E
    } 
    // Chef de projet IA
    else if (userTags.includes("projet")) {
        WA.player.setOutlineColor(214, 39, 40); // Rouge #D62728
    } 
    // Acquisition organique
    else if (userTags.includes("seo")) {
        WA.player.setOutlineColor(227, 119, 194); // Rose #E377C2
    } 
    // Acquisition payante
    else if (userTags.includes("paid")) {
        WA.player.setOutlineColor(23, 190, 207); // Cyan #17BECF
    } 
    // IA générative
    else if (userTags.includes("iagen")) {
        WA.player.setOutlineColor(188, 189, 34); // Jaune #BCBD22
    } 
    // Product Builder
    else if (userTags.includes("pbn")) {
        WA.player.setOutlineColor(44, 160, 44); // Vert #2CA02C
    } 
    // Growth Marketer
    else if (userTags.includes("growth")) {
        WA.player.setOutlineColor(140, 86, 75); // Marron #8C564B
    }

    WA.ui.actionBar.addButton({
        id: "nav-btn",
        label: "Plan & Aide",
        bgColor: "#6D1FFF",
        textColor: "#FFFFFF",
        toolTip: "",
        callback: () => {
            WA.ui.modal.openModal({
                title: "Navigation",
                src: "https://workadventu.re/campus.html",
                allow: null,
                allowApi: true,
                position: "right",
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
