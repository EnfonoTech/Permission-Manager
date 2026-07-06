// Permission Manager — real-time approval inbox notifications

// ── Shared AudioContext ────────────────────────────────────────────────────────
// Browsers block `new AudioContext()` in async/realtime callbacks (autoplay policy).
// Solution: create the context once on the first user click and keep it alive.
// Every subsequent chime — including those triggered by Socket.io events —
// uses this already-running context.

var _pm_audio_ctx = null;

function _get_pm_audio_ctx() {
    try {
        var A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        if (!_pm_audio_ctx) {
            _pm_audio_ctx = new A();
        }
        return _pm_audio_ctx;
    } catch (_) {
        return null;
    }
}

// Resume the context on every click so it never stays suspended after the
// browser auto-suspends it (happens after ~30 s of silence on some browsers).
document.addEventListener("click", function () {
    try {
        var ctx = _get_pm_audio_ctx();
        if (ctx && ctx.state === "suspended") ctx.resume();
    } catch (_) {}
});

function _do_play_chime(ctx) {
    // Two-tone ascending chime: D5 (587 Hz) → F#5 (740 Hz)
    [[587.33, 0], [739.99, 0.22]].forEach(function (tone) {
        var freq  = tone[0], delay = tone[1];
        var osc   = ctx.createOscillator();
        var gain  = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        var t = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        osc.start(t);
        osc.stop(t + 0.6);
    });
}

function _play_approval_chime() {
    try {
        var ctx = _get_pm_audio_ctx();
        if (!ctx) return;

        if (ctx.state === "running") {
            _do_play_chime(ctx);
        } else if (ctx.state === "suspended") {
            // Attempt resume — resolves async but usually fast enough
            ctx.resume().then(function () {
                _do_play_chime(ctx);
            }).catch(function () {});
        }
    } catch (_) {}
}

// ── System notification ────────────────────────────────────────────────────────

function _show_system_notification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
        // No custom icon — avoids silent failure when the image file is absent
        var n = new Notification(title, {
            body: body,
            tag: "pm-approval",
            requireInteraction: false,
        });
        n.onclick = function () {
            window.focus();
            frappe.set_route("pm-approval-inbox");
            n.close();
        };
    } catch (_) {}
}

// Chrome 84+ requires a user gesture to call requestPermission().
// We hook into the first click on the page rather than using a bare setTimeout.
var _pm_notif_requested = false;
function _request_notification_permission_on_gesture() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    if (_pm_notif_requested) return;
    _pm_notif_requested = true;
    try {
        Notification.requestPermission();
    } catch (_) {}
}

document.addEventListener("click", function () {
    _request_notification_permission_on_gesture();
}, { once: true });

// ── BroadcastChannel — cross-tab chime ────────────────────────────────────────

var _pm_bc = (function () {
    try { return new BroadcastChannel("pm_approval_notifications"); }
    catch (_) { return null; }
})();

function _handle_approval_event(data, opts) {
    var alert = !opts || opts.alert !== false;
    _play_approval_chime();

    if (alert) {
        frappe.show_alert(
            { message: __("New approval: {0} {1}", [data.doctype, data.docname]), indicator: "orange" },
            8
        );
    }

    _show_system_notification(
        __("Approval Required"),
        data.subject || __("{0} {1} is waiting for your approval.", [data.doctype, data.docname])
    );

    var inbox_page = frappe.pages && frappe.pages["pm-approval-inbox"];
    if (inbox_page && inbox_page.approval_inbox) {
        inbox_page.approval_inbox.load();
    }
}

if (_pm_bc) {
    _pm_bc.onmessage = function (evt) {
        try { _handle_approval_event(evt.data, { alert: false }); } catch (_) {}
    };
}

// ── Socket.io listener — with retry ───────────────────────────────────────────
// frappe.realtime = new RealTimeClient() runs at bundle-load time, but
// frappe.realtime.init() (which sets this.socket) runs later in desk.js
// inside $(document).ready.  frappe.realtime.on() silently does nothing when
// this.socket is null, so we must wait until the socket object exists.

(function _setup_realtime(attempt) {
    try {
        if (frappe.realtime && frappe.realtime.socket) {
            frappe.realtime.on("pm_new_approval_action", function (data) {
                try {
                    if (_pm_bc) _pm_bc.postMessage(data);
                    _handle_approval_event(data);
                } catch (_) {}
            });
            return; // listener registered — stop retrying
        }
    } catch (_) {}
    // Socket not ready yet — retry every 300 ms for up to 30 s
    if (attempt < 100) {
        setTimeout(function () { _setup_realtime(attempt + 1); }, 300);
    }
})(0);
