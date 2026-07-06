// Permission Manager — real-time approval inbox notifications
// Listens for pm_new_approval_action events pushed via frappe.publish_realtime
// and plays a two-tone chime, shows a toast, fires a system notification,
// and refreshes the inbox if open.

function _play_approval_chime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        // Two-tone ascending chime: D5 (587 Hz) then F#5 (740 Hz)
        [[587.33, 0], [739.99, 0.22]].forEach(([freq, delay]) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = freq;
            const t = ctx.currentTime + delay;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
            osc.start(t);
            osc.stop(t + 0.6);
        });
    } catch (_) {}
}

function _show_system_notification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
        const n = new Notification(title, {
            body,
            icon: "/assets/permission_manager/images/pm_notification_icon.png",
            tag: "pm-approval",          // replaces previous unread one instead of stacking
            requireInteraction: false,
        });
        n.onclick = () => {
            window.focus();
            frappe.set_route("pm-approval-inbox");
            n.close();
        };
    } catch (_) {}
}

function _request_notification_permission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        // Delay slightly so it doesn't fire on every page load before user interaction
        setTimeout(() => {
            Notification.requestPermission();
        }, 3000);
    }
}

// BroadcastChannel lets background tabs hear the chime when the active tab
// receives the realtime event from the server. Falls back silently if unsupported.
const _pm_bc = (function () {
    try { return new BroadcastChannel("pm_approval_notifications"); }
    catch (_) { return null; }
})();

function _handle_approval_event(data, { alert = true } = {}) {
    _play_approval_chime();

    if (alert) {
        frappe.show_alert(
            {
                message: __("New approval: {0} {1}", [data.doctype, data.docname]),
                indicator: "orange",
            },
            8
        );
    }

    _show_system_notification(
        __("Approval Required"),
        data.subject || __("{0} {1} is waiting for your approval.", [data.doctype, data.docname])
    );

    // Auto-refresh inbox if open in this tab
    const inbox_page = frappe.pages && frappe.pages["pm-approval-inbox"];
    if (inbox_page && inbox_page.approval_inbox) {
        inbox_page.approval_inbox.load();
    }
}

// Listen for events broadcast from the tab that received the server push
if (_pm_bc) {
    _pm_bc.onmessage = (evt) => {
        try { _handle_approval_event(evt.data, { alert: false }); } catch (_) {}
    };
}

// Use setTimeout(0) so realtime setup runs after the bundle IIFE completes and
// all globals (window.pm_approval_inbox etc.) are guaranteed to be set.
setTimeout(() => {
    try {
        _request_notification_permission();

        if (frappe.realtime && typeof frappe.realtime.on === "function") {
            frappe.realtime.on("pm_new_approval_action", (data) => {
                try {
                    // Broadcast to all other same-origin tabs so they can play the chime
                    // even if the user isn't looking at this tab
                    if (_pm_bc) _pm_bc.postMessage(data);

                    _handle_approval_event(data);
                } catch (_) {}
            });
        }
    } catch (_) {}
}, 0);
