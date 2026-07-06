// Permission Manager — Notification Chime Tester

frappe.pages["pm-chime-tester"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Notification Chime Tester"),
        single_column: true,
    });

    page.add_inner_button(__("← Approval Inbox"), function () {
        frappe.set_route("pm-approval-inbox");
    });

    page.add_inner_button(__("Fire Test Notification"), function () {
        _fire_test_notification(page);
    });

    _inject_css();
    _render(page);
};

// ── Note table ─────────────────────────────────────────────────────────────────

var NOTES = [
    {n:"C3",f:130.81},{n:"D3",f:146.83},{n:"E3",f:164.81},{n:"F3",f:174.61},
    {n:"G3",f:196.00},{n:"A3",f:220.00},{n:"B3",f:246.94},
    {n:"C4",f:261.63},{n:"D4",f:293.66},{n:"E4",f:329.63},{n:"F4",f:349.23},
    {n:"F#4",f:369.99},{n:"G4",f:392.00},{n:"A4",f:440.00},{n:"B4",f:493.88},
    {n:"C5",f:523.25},{n:"D5",f:587.33},{n:"E5",f:659.25},{n:"F5",f:698.46},
    {n:"F#5",f:739.99},{n:"G5",f:783.99},{n:"A5",f:880.00},{n:"B5",f:987.77},
    {n:"C6",f:1046.5},{n:"D6",f:1174.7},{n:"E6",f:1318.5},{n:"F6",f:1396.9},
    {n:"G6",f:1568.0},{n:"A6",f:1760.0},{n:"B6",f:1975.5},
];

function _ni(name) {
    return NOTES.findIndex(function(n) { return n.n === name; });
}

// ── Presets ────────────────────────────────────────────────────────────────────

var PRESETS = [
    { label: "Original",    s: { notes: [{ni:_ni("D5"),  delay:0,    dur:.55},{ni:_ni("F#5"),delay:.22, dur:.55}], wave:"sine",     vol:.22 } },
    { label: "Success ✓",  s: { notes: [{ni:_ni("C5"),  delay:0,    dur:.40},{ni:_ni("E5"), delay:.14, dur:.40},{ni:_ni("G5"),delay:.28,dur:.5}], wave:"sine", vol:.20 } },
    { label: "Soft Bell",   s: { notes: [{ni:_ni("A5"),  delay:0,    dur:.70},{ni:_ni("E6"), delay:.3,  dur:.60}], wave:"sine",     vol:.14 } },
    { label: "Alert",       s: { notes: [{ni:_ni("A4"),  delay:0,    dur:.18},{ni:_ni("A5"), delay:.20, dur:.18},{ni:_ni("A5"),delay:.40,dur:.30}], wave:"square", vol:.12 } },
    { label: "Ping",        s: { notes: [{ni:_ni("B5"),  delay:0,    dur:.45}],                                   wave:"sine",     vol:.18 } },
    { label: "Notify",      s: { notes: [{ni:_ni("G5"),  delay:0,    dur:.35},{ni:_ni("D6"), delay:.18, dur:.45}], wave:"triangle", vol:.20 } },
];

// ── State ──────────────────────────────────────────────────────────────────────

var _state = {
    notes: [
        {ni: _ni("D5"),  delay: 0,    dur: 0.55},
        {ni: _ni("F#5"), delay: 0.22, dur: 0.55},
    ],
    wave: "sine",
    vol:  0.22,
};
var _activePreset = 0;
var _analyser     = null;
var _vizAF        = null;

// ── Play ───────────────────────────────────────────────────────────────────────

function _play(s) {
    var A = window.AudioContext || window.webkitAudioContext;
    if (!A) { frappe.show_alert({ message: __("Web Audio API not supported in this browser."), indicator: "red" }); return; }
    var ctx = new A();

    _analyser = ctx.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.connect(ctx.destination);

    var maxEnd = 0;
    s.notes.forEach(function (note) {
        if (note.ni < 0 || note.ni >= NOTES.length) return;
        var freq = NOTES[note.ni].f;
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(_analyser);
        osc.type = s.wave;
        osc.frequency.value = freq;
        var t = ctx.currentTime + note.delay;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(s.vol, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t + note.dur);
        osc.start(t);
        osc.stop(t + note.dur + 0.05);
        maxEnd = Math.max(maxEnd, note.delay + note.dur + 0.1);
    });

    var btn = document.getElementById("ct-play-btn");
    if (btn) btn.classList.add("ct-playing");
    _drawViz(true);
    setTimeout(function () {
        if (btn) btn.classList.remove("ct-playing");
        ctx.close();
        _drawViz(false);
    }, maxEnd * 1000 + 250);
}

// ── Visualiser ─────────────────────────────────────────────────────────────────

function _drawViz(active) {
    if (_vizAF) { cancelAnimationFrame(_vizAF); _vizAF = null; }
    var canvas = document.getElementById("ct-viz");
    if (!canvas) return;
    var c = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;

    function isDark() {
        return document.documentElement.dataset.theme === "dark"
            || (window.matchMedia("(prefers-color-scheme:dark)").matches && document.documentElement.dataset.theme !== "light");
    }

    if (!active || !_analyser) {
        c.clearRect(0, 0, W, H);
        c.strokeStyle = isDark() ? "#2e2b37" : "#dedad4";
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
        return;
    }

    var data = new Uint8Array(_analyser.frequencyBinCount);
    function frame() {
        _vizAF = requestAnimationFrame(frame);
        _analyser.getByteTimeDomainData(data);
        c.clearRect(0, 0, W, H);
        c.fillStyle = isDark() ? "#0d0b10" : "#ffffff";
        c.fillRect(0, 0, W, H);
        var accent = isDark() ? "#f59e0b" : "#d97706";
        c.strokeStyle = accent;
        c.lineWidth = 2;
        c.shadowColor = accent;
        c.shadowBlur = 6;
        c.beginPath();
        var sliceW = W / data.length;
        var x = 0;
        for (var i = 0; i < data.length; i++) {
            var v = data[i] / 128;
            var y = (v * H) / 2;
            i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
            x += sliceW;
        }
        c.stroke();
        c.shadowBlur = 0;
    }
    frame();
}

// ── Render ─────────────────────────────────────────────────────────────────────

function _render(page) {
    var e = frappe.utils.escape_html;
    var html = '<div class="ct-wrap">';

    // Presets
    html += '<div class="ct-sh">' + __("Presets — click to load & play") + "</div>";
    html += '<div class="ct-presets" id="ct-presets">';
    PRESETS.forEach(function (p, i) {
        html += '<button class="ct-pre-btn' + (i === _activePreset ? " ct-active" : "") + '" data-pi="' + i + '">' + e(p.label) + "</button>";
    });
    html += "</div>";

    // Notes
    html += '<div class="ct-sh">' + __("Notes") + "</div>";
    html += '<div class="ct-card" id="ct-notes-card">';
    html += '<div id="ct-note-rows">' + _notesHtml() + "</div>";
    html += '<div class="ct-add-row"><button class="ct-add-btn" id="ct-add-note">＋ ' + __("Add note (max 4)") + "</button></div>";
    html += "</div>";

    // Controls
    html += '<div class="ct-ctrls">';
    html += '<div class="ct-ctrl-card">';
    html += '<div class="ct-sh">' + __("Waveform") + "</div>";
    html += '<div class="ct-wave-opts" id="ct-wave-opts">';
    ["sine","triangle","square","sawtooth"].forEach(function (w) {
        html += '<button class="ct-w-btn' + (_state.wave === w ? " ct-active" : "") + '" data-w="' + w + '">' + w + "</button>";
    });
    html += "</div></div>";
    html += '<div class="ct-ctrl-card">';
    html += '<div class="ct-sh">' + __("Volume") + "</div>";
    html += '<div class="ct-vol-row"><input type="range" id="ct-vol" min="1" max="100" value="' + Math.round(_state.vol * 100) + '">';
    html += '<span class="ct-vol-val" id="ct-vol-val">' + Math.round(_state.vol * 100) + "%</span></div>";
    html += "</div></div>";

    // Play button
    html += '<div class="ct-play-wrap">';
    html += '<button class="ct-play-btn" id="ct-play-btn">▶ &nbsp;' + __("Play Chime") + "</button>";
    html += "</div>";

    // Visualiser
    html += '<canvas id="ct-viz" width="580" height="56"></canvas>';

    // Notification permission status
    html += _notif_status_html();

    // Code output
    html += '<div class="ct-code-card">';
    html += '<div class="ct-code-hdr"><span class="ct-code-title">' + __("Generated Code — paste into pm_realtime.js") + "</span>";
    html += '<button class="ct-copy-btn" id="ct-copy-btn">' + __("Copy") + "</button></div>";
    html += '<pre id="ct-code-out">' + e(_genCode()) + "</pre>";
    html += "</div>";

    html += "</div>"; // .ct-wrap
    page.main.html(html);

    // Wire events
    _bindEvents(page);
    _bind_notif_btn();
    _drawViz(false);
}

function _notesHtml() {
    var e = frappe.utils.escape_html;
    return _state.notes.map(function (note, i) {
        var opts = NOTES.map(function (n, idx) {
            return '<option value="' + idx + '"' + (idx === note.ni ? " selected" : "") + ">" + n.n + "</option>";
        }).join("");
        return '<div class="ct-note-row">'
            + '<div class="ct-note-num">' + (i + 1) + "</div>"
            + '<select class="ct-sel" data-i="' + i + '" data-field="ni">' + opts + "</select>"
            + '<span class="ct-hz">' + (NOTES[note.ni] ? NOTES[note.ni].f.toFixed(0) : "—") + " Hz</span>"
            + '<div class="ct-nf"><span class="ct-nf-lbl">' + __("Delay (s)") + "</span>"
            + '<input type="number" class="ct-num" value="' + note.delay.toFixed(2) + '" step="0.01" min="0" max="3" data-i="' + i + '" data-field="delay"></div>'
            + '<div class="ct-nf"><span class="ct-nf-lbl">' + __("Duration (s)") + "</span>"
            + '<input type="number" class="ct-num" value="' + note.dur.toFixed(2) + '" step="0.05" min="0.05" max="3" data-i="' + i + '" data-field="dur"></div>'
            + '<button class="ct-del-btn" data-del="' + i + '">×</button>'
            + "</div>";
    }).join("");
}

function _genCode() {
    var tones = _state.notes.map(function (n) {
        var f = NOTES[n.ni] ? NOTES[n.ni].f : 440;
        return "        [" + f.toFixed(2) + ", " + n.delay.toFixed(2) + ", " + n.dur.toFixed(2) + "],";
    }).join("\n");
    return "function _play_approval_chime() {\n"
        + "    try {\n"
        + "        const AudioCtx = window.AudioContext || window.webkitAudioContext;\n"
        + "        if (!AudioCtx) return;\n"
        + "        const ctx = new AudioCtx();\n"
        + "        // [freq_hz, delay_s, duration_s]\n"
        + "        [\n"
        + tones + "\n"
        + "        ].forEach(([freq, delay, dur]) => {\n"
        + "            const osc  = ctx.createOscillator();\n"
        + "            const gain = ctx.createGain();\n"
        + "            osc.connect(gain);\n"
        + "            gain.connect(ctx.destination);\n"
        + "            osc.type = \"" + _state.wave + "\";\n"
        + "            osc.frequency.value = freq;\n"
        + "            const t = ctx.currentTime + delay;\n"
        + "            gain.gain.setValueAtTime(0, t);\n"
        + "            gain.gain.linearRampToValueAtTime(" + _state.vol.toFixed(2) + ", t + 0.015);\n"
        + "            gain.gain.exponentialRampToValueAtTime(0.001, t + dur);\n"
        + "            osc.start(t);\n"
        + "            osc.stop(t + dur + 0.05);\n"
        + "        });\n"
        + "    } catch (_) {}\n"
        + "}";
}

function _updateCode() {
    var el = document.getElementById("ct-code-out");
    if (el) el.textContent = _genCode();
}

function _bindEvents(page) {
    // Preset click
    var presetsEl = document.getElementById("ct-presets");
    if (presetsEl) {
        presetsEl.addEventListener("click", function (ev) {
            var btn = ev.target.closest(".ct-pre-btn");
            if (!btn) return;
            var pi = parseInt(btn.dataset.pi, 10);
            _activePreset = pi;
            _state = JSON.parse(JSON.stringify(PRESETS[pi].s));
            _render(page);
            setTimeout(function () { _play(_state); }, 60);
        });
    }

    // Add note
    var addBtn = document.getElementById("ct-add-note");
    if (addBtn) {
        addBtn.addEventListener("click", function () {
            if (_state.notes.length >= 4) return;
            var last = _state.notes[_state.notes.length - 1];
            _state.notes.push({ ni: _ni("A5"), delay: last.delay + last.dur + 0.05, dur: 0.45 });
            _activePreset = -1;
            document.getElementById("ct-note-rows").innerHTML = _notesHtml();
            _updateCode();
        });
    }

    // Note change / delete
    var noteRows = document.getElementById("ct-note-rows");
    if (noteRows) {
        noteRows.addEventListener("change", function (ev) {
            var i = parseInt(ev.target.dataset.i, 10);
            var field = ev.target.dataset.field;
            if (isNaN(i) || !field) return;
            if (field === "ni") {
                _state.notes[i].ni = parseInt(ev.target.value, 10);
                var row = ev.target.closest(".ct-note-row");
                if (row) row.querySelector(".ct-hz").textContent = NOTES[_state.notes[i].ni].f.toFixed(0) + " Hz";
            } else {
                _state.notes[i][field] = parseFloat(ev.target.value);
            }
            _activePreset = -1;
            _updateCode();
        });
        noteRows.addEventListener("click", function (ev) {
            var del = ev.target.closest("[data-del]");
            if (!del) return;
            if (_state.notes.length <= 1) return;
            _state.notes.splice(parseInt(del.dataset.del, 10), 1);
            _activePreset = -1;
            noteRows.innerHTML = _notesHtml();
            _updateCode();
        });
    }

    // Waveform
    var waveOpts = document.getElementById("ct-wave-opts");
    if (waveOpts) {
        waveOpts.addEventListener("click", function (ev) {
            var btn = ev.target.closest(".ct-w-btn");
            if (!btn) return;
            _state.wave = btn.dataset.w;
            _activePreset = -1;
            waveOpts.querySelectorAll(".ct-w-btn").forEach(function (b) {
                b.classList.toggle("ct-active", b.dataset.w === _state.wave);
            });
            _updateCode();
        });
    }

    // Volume
    var volEl = document.getElementById("ct-vol");
    if (volEl) {
        volEl.addEventListener("input", function () {
            _state.vol = parseInt(volEl.value, 10) / 100;
            var valEl = document.getElementById("ct-vol-val");
            if (valEl) valEl.textContent = volEl.value + "%";
            _updateCode();
        });
    }

    // Play
    var playBtn = document.getElementById("ct-play-btn");
    if (playBtn) playBtn.addEventListener("click", function () { _play(_state); });

    // Copy
    var copyBtn = document.getElementById("ct-copy-btn");
    if (copyBtn) {
        copyBtn.addEventListener("click", function () {
            var code = _genCode();
            navigator.clipboard.writeText(code).then(function () {
                copyBtn.textContent = __("Copied ✓");
                copyBtn.classList.add("ct-copied");
                setTimeout(function () {
                    copyBtn.textContent = __("Copy");
                    copyBtn.classList.remove("ct-copied");
                }, 2000);
            });
        });
    }
}

// ── Notification permission panel ─────────────────────────────────────────────

function _notif_status_html() {
    if (!("Notification" in window)) {
        return '<div class="ct-notif-bar ct-notif-na">'
            + '<span class="ct-notif-icon">🔕</span>'
            + '<span>' + __("System notifications not supported in this browser.") + "</span>"
            + "</div>";
    }
    var perm = Notification.permission;
    if (perm === "granted") {
        return '<div class="ct-notif-bar ct-notif-ok">'
            + '<span class="ct-notif-icon">🔔</span>'
            + '<strong>' + __("System notifications: ON") + "</strong>"
            + '<span class="ct-notif-sub">' + __("OS alerts will appear when a new approval arrives.") + "</span>"
            + "</div>";
    }
    if (perm === "denied") {
        return '<div class="ct-notif-bar ct-notif-denied">'
            + '<span class="ct-notif-icon">🚫</span>'
            + '<strong>' + __("System notifications: BLOCKED") + "</strong>"
            + '<span class="ct-notif-sub">'
            + __("Unblock in browser settings: click the 🔒 lock icon in the address bar → Notifications → Allow.")
            + "</span>"
            + "</div>";
    }
    // "default" — not yet asked
    return '<div class="ct-notif-bar ct-notif-ask">'
        + '<span class="ct-notif-icon">🔔</span>'
        + '<strong>' + __("System notifications: not enabled") + "</strong>"
        + '<span class="ct-notif-sub">' + __("Click the button to allow OS alerts alongside the chime.") + "</span>"
        + '<button class="ct-notif-btn" id="ct-grant-notif">' + __("Enable Notifications") + "</button>"
        + "</div>";
}

function _bind_notif_btn() {
    var btn = document.getElementById("ct-grant-notif");
    if (!btn) return;
    btn.addEventListener("click", function () {
        Notification.requestPermission().then(function (result) {
            // Re-render just the status bar to reflect the new state
            var bar = document.querySelector(".ct-notif-bar");
            if (bar) bar.outerHTML = _notif_status_html();
            _bind_notif_btn();
            if (result === "granted") {
                frappe.show_alert({ message: __("Notifications enabled!"), indicator: "green" }, 4);
            } else {
                frappe.show_alert({ message: __("Notifications blocked. Check browser settings."), indicator: "orange" }, 6);
            }
        });
    });
}

// ── Fire test notification (server-side realtime event) ────────────────────────

function _fire_test_notification(page) {
    // Pre-unlock the shared AudioContext RIGHT NOW (we are inside a click handler).
    // By the time the realtime event arrives (~100-300 ms later), the context will
    // be in "running" state and the chime can play without a new gesture.
    try {
        var A = window.AudioContext || window.webkitAudioContext;
        if (A) {
            if (!window._pm_audio_ctx) window._pm_audio_ctx = new A();
            if (window._pm_audio_ctx.state === "suspended") window._pm_audio_ctx.resume();
        }
    } catch (_) {}

    frappe.call({
        method: "permission_manager.permission_manager.api.chime_test.fire_test_notification",
        callback: function (r) {
            if (r.message && r.message.ok) {
                frappe.show_alert({
                    message: __("Test notification sent — listen for the chime."),
                    indicator: "green",
                }, 6);
            }
        },
        error: function () {
            frappe.show_alert({ message: __("Could not fire test notification — check console."), indicator: "orange" }, 5);
        },
    });
}

// ── CSS ────────────────────────────────────────────────────────────────────────

function _inject_css() {
    if (document.getElementById("ct-style")) return;
    var s = document.createElement("style");
    s.id = "ct-style";
    s.textContent = `
.ct-wrap { max-width: 620px; padding: 20px 4px 48px; }
.ct-sh { font-size: 10px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 8px; }

/* presets */
.ct-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
.ct-pre-btn { padding: 5px 13px; border-radius: 20px; border: 1px solid var(--border-color);
    background: var(--card-bg); color: var(--text-color); font-size: 12px; font-weight: 600;
    font-family: inherit; cursor: pointer; transition: border-color .12s, color .12s, background .12s; }
.ct-pre-btn:hover { border-color: var(--primary); color: var(--primary); }
.ct-pre-btn.ct-active { background: var(--primary); color: #fff; border-color: var(--primary); }

/* notes card */
.ct-card { background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
.ct-note-row { display: grid; grid-template-columns: 22px 72px 58px 1fr 1fr 22px;
    align-items: center; gap: 8px; padding: 9px 12px;
    background: var(--control-bg); border-bottom: 1px solid var(--border-color); }
.ct-note-row:last-of-type { border-bottom: 0; }
.ct-note-num { width: 22px; height: 22px; border-radius: 50%; background: var(--primary);
    color: #fff; font-size: 10px; font-weight: 800;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ct-sel { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 5px;
    color: var(--text-color); font-size: 12px; padding: 4px 5px; cursor: pointer; width: 100%; }
.ct-hz { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ct-nf { display: flex; flex-direction: column; gap: 2px; }
.ct-nf-lbl { font-size: 9px; text-transform: uppercase; letter-spacing: .5px;
    color: var(--text-muted); font-weight: 700; }
.ct-num { width: 100%; padding: 3px 6px; background: var(--card-bg);
    border: 1px solid var(--border-color); border-radius: 5px;
    color: var(--text-color); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.ct-num:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
.ct-del-btn { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--border-color);
    background: transparent; color: var(--text-muted); font-size: 15px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; line-height: 1;
    transition: color .1s, border-color .1s; flex-shrink: 0; }
.ct-del-btn:hover { color: var(--red); border-color: var(--red); }
.ct-add-row { padding: 8px 12px; background: var(--card-bg); }
.ct-add-btn { width: 100%; padding: 5px; border: 1px dashed var(--border-color);
    border-radius: 5px; background: transparent; color: var(--text-muted);
    font-size: 12px; font-family: inherit; cursor: pointer;
    transition: color .1s, border-color .1s; }
.ct-add-btn:hover { color: var(--primary); border-color: var(--primary); }

/* controls */
.ct-ctrls { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
.ct-ctrl-card { background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 8px; padding: 10px 14px; flex: 1; min-width: 140px; }
.ct-wave-opts { display: flex; gap: 5px; flex-wrap: wrap; }
.ct-w-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid var(--border-color);
    background: var(--control-bg); color: var(--text-muted); font-size: 11px;
    cursor: pointer; transition: all .1s; }
.ct-w-btn.ct-active { background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 700; }
.ct-w-btn:hover:not(.ct-active) { border-color: var(--primary); color: var(--primary); }
.ct-vol-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.ct-vol-row input[type=range] { flex: 1; accent-color: var(--primary); cursor: pointer; }
.ct-vol-val { font-size: 11px; color: var(--text-muted); min-width: 32px;
    text-align: right; font-variant-numeric: tabular-nums; }

/* play button */
.ct-play-wrap { display: flex; justify-content: center; margin-bottom: 16px; }
.ct-play-btn { padding: 13px 36px; background: var(--primary); color: #fff; border: none;
    border-radius: 40px; font-size: 15px; font-weight: 700; font-family: inherit;
    cursor: pointer; transition: transform .1s, box-shadow .1s;
    box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.ct-play-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,.2); }
.ct-play-btn:active { transform: scale(.97); }
.ct-play-btn.ct-playing { animation: ct-pulse .5s ease-in-out infinite alternate; }
@keyframes ct-pulse { from { box-shadow: 0 4px 16px rgba(0,0,0,.15); } to { box-shadow: 0 8px 28px rgba(66,153,225,.45); } }

/* visualiser */
#ct-viz { display: block; width: 100%; height: 56px; border-radius: 8px;
    border: 1px solid var(--border-color); background: var(--card-bg);
    margin-bottom: 20px; }

/* code */
.ct-code-card { background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 8px; overflow: hidden; }
.ct-code-hdr { display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; border-bottom: 1px solid var(--border-color); }
.ct-code-title { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .8px; color: var(--text-muted); }
.ct-copy-btn { padding: 4px 12px; border-radius: 5px; border: 1px solid var(--border-color);
    background: var(--control-bg); color: var(--text-color); font-size: 11px;
    font-family: inherit; font-weight: 600; cursor: pointer; transition: all .12s; }
.ct-copy-btn:hover { border-color: var(--primary); color: var(--primary); }
.ct-copy-btn.ct-copied { background: var(--green); color: #fff; border-color: var(--green); }
#ct-code-out { margin: 0; padding: 14px; background: #18161a; color: #e8e4f0;
    font-family: 'SF Mono','Fira Code',Consolas,monospace; font-size: 12px;
    line-height: 1.65; overflow-x: auto; white-space: pre; tab-size: 4; }

/* notification status bar */
.ct-notif-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
    padding: 10px 14px; border-radius: 8px; margin-bottom: 16px;
    border: 1px solid var(--border-color); font-size: 12px; }
.ct-notif-icon { font-size: 16px; flex-shrink: 0; }
.ct-notif-ok     { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
.ct-notif-denied { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
.ct-notif-ask    { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
.ct-notif-na     { background: var(--control-bg); color: var(--text-muted); }
.ct-notif-sub    { color: inherit; opacity: .75; font-size: 11px; flex: 1 1 100%; margin-top: 1px; }
.ct-notif-btn { margin-left: auto; padding: 5px 14px; border-radius: 6px;
    border: 1px solid currentColor; background: transparent; color: inherit;
    font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer;
    transition: background .12s, color .12s; }
.ct-notif-btn:hover { background: currentColor; }
.ct-notif-btn:hover { color: #fff; }
    `;
    document.head.appendChild(s);
}
