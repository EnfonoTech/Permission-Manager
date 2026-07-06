// Permission Manager — Warehouse Dashboard
// Shows the current user's warehouse-scoped work:
//   • Material Requests their warehouse needs to fulfil
//   • MRs they created (status tracking)
//   • Pending PM Workflow approvals

// Module-level state — persists across on_page_show calls
var _dash_data        = null;   // last API response
var _active_wh        = null;   // selected warehouse chip (null = show all)
var _fulfill_wh_filter = null;  // destination warehouse filter inside "To Fulfil"

frappe.pages["pm-warehouse-dashboard"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Warehouse Dashboard"),
        single_column: true,
    });

    _inject_css();

    page.add_inner_button(__("Refresh"), function () {
        _active_wh        = null;
        _fulfill_wh_filter = null;
        _load(page);
    });
    page.add_inner_button(__("My Approvals"), function () {
        frappe.set_route("pm-approval-inbox");
    });
    page.add_inner_button(__("New Material Request"), function () {
        frappe.new_doc("Material Request", { material_request_type: "Material Transfer" });
    });

    // Auto-refresh when a PM approval arrives in another tab (BroadcastChannel
    // is posted by pm_realtime.js whenever frappe.realtime fires the event)
    try {
        var bc = new BroadcastChannel("pm_approval_notifications");
        bc.onmessage = function () {
            if (_dash_data) _load(page);
        };
    } catch (_) {}

    // All click events are delegated on page.main so they survive re-renders
    _setup_events(page);

    wrapper._wh_page = page;
    _load(page);
};

frappe.pages["pm-warehouse-dashboard"].on_page_show = function (wrapper) {
    var page = wrapper._wh_page;
    if (page) _load(page);
};

// ── Event delegation (set up once) ────────────────────────────────────────────

function _setup_events(page) {
    // Warehouse chip — toggle filter
    page.main.on("click", ".wh-chip[data-wh]", function () {
        var wh = $(this).data("wh");
        _active_wh = (_active_wh === wh) ? null : wh;
        _draw(page);
    });

    // Clear-filter link
    page.main.on("click", ".wh-clear-filter", function (e) {
        e.preventDefault();
        _active_wh = null;
        _draw(page);
    });

    // Destination warehouse filter inside "To Fulfil" section
    page.main.on("click", ".wh-ff-chip", function () {
        var wh = $(this).data("ff-wh") || null;
        _fulfill_wh_filter = (_fulfill_wh_filter === wh) ? null : wh;
        _draw(page);
    });

    // Item row → open form
    page.main.on("click", ".wh-item[data-doctype][data-name]", function () {
        frappe.set_route("Form", $(this).data("doctype"), $(this).data("name"));
    });
}

// ── Data loading ───────────────────────────────────────────────────────────────

function _load(page) {
    page.main.html(_skeleton_html());

    frappe.call({
        method: "permission_manager.permission_manager.api.warehouse_dashboard.get_warehouse_dashboard_data",
        callback: function (r) {
            if (r.message) {
                _dash_data = r.message;
                _draw(page);
            }
        },
        error: function () {
            page.main.html(
                '<div class="wh-dash"><p class="wh-error">' +
                __("Failed to load dashboard.") + "</p></div>"
            );
        },
    });
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function _draw(page) {
    var d = _dash_data;
    if (!d) return;

    var e = frappe.utils.escape_html;

    // Apply warehouse filter
    var mr_fulfill = _active_wh
        ? (d.mr_to_fulfill || []).filter(function (mr) {
            return mr.set_from_warehouse === _active_wh;
          })
        : (d.mr_to_fulfill || []);

    // My MRs: user is the TO-warehouse requester — filter by set_warehouse (destination)
    var my_mrs = _active_wh
        ? (d.my_mrs || []).filter(function (mr) {
            return mr.set_warehouse === _active_wh;
          })
        : (d.my_mrs || []);

    // Pending Approvals: user is the TO-warehouse acceptor — filter by to_warehouse
    var approvals = _active_wh
        ? (d.pending_approvals || []).filter(function (ap) {
            return !ap.to_warehouse || ap.to_warehouse === _active_wh;
          })
        : (d.pending_approvals || []);

    // ── Header ───────────────────────────────────────────────────────
    var wh_chips = (d.warehouses || []).map(function (w) {
        var active = (_active_wh === w) ? " wh-chip-active" : "";
        return '<span class="wh-chip' + active + '" data-wh="' + e(w) + '" title="'
            + __("Click to filter to this warehouse") + '">' + e(w) + "</span>";
    }).join("");

    var html = '<div class="wh-dash">';

    html += '<div class="wh-header">';
    html += '<div class="wh-header-left">';
    html += '<h2 class="wh-title">' + __("Warehouse Dashboard") + "</h2>";
    html += wh_chips
        ? '<div class="wh-chips">' + wh_chips + "</div>"
        : '<div class="wh-chips"><span class="wh-chip wh-chip-muted">' + __("No warehouse assigned") + "</span></div>";
    if (_active_wh) {
        html += '<div class="wh-filter-note">'
            + frappe.utils.icon("filter", "xs") + " "
            + __("Filtered: {0}", [e(_active_wh)])
            + ' — <a class="wh-clear-filter">' + __("Show all") + "</a></div>";
    }
    html += "</div>";
    html += '<div class="wh-header-right"><span class="wh-date">'
        + frappe.datetime.str_to_user(frappe.datetime.get_today()) + "</span></div>";
    html += "</div>"; // .wh-header

    // ── KPI Row — counts update with filter ──────────────────────────
    html += '<div class="wh-kpi-row">';
    html += _kpi("📋", mr_fulfill.length,             __("To Fulfil"),         "fulfil");
    html += _kpi("📬", my_mrs.length,                 __("My Open Requests"),  "my");
    html += _kpi("⏳", approvals.length,              __("Pending Approvals"), "approval");
    html += _kpi("✅", (d.kpis || {}).transferred_today || 0, __("Transferred Today"), "done");
    html += "</div>";

    // ── Split columns ────────────────────────────────────────────────
    html += '<div class="wh-split">';

    html += '<div class="wh-col">';
    html += '<div class="wh-col-hdr"><span>📋</span> ' + __("Material Requests to Fulfil") + "</div>";

    // Destination warehouse filter — chips for each unique to-warehouse
    var dest_whs = [];
    mr_fulfill.forEach(function (mr) {
        if (mr.set_warehouse && dest_whs.indexOf(mr.set_warehouse) === -1) {
            dest_whs.push(mr.set_warehouse);
        }
    });
    if (dest_whs.length > 1) {
        html += '<div class="wh-ff-bar">';
        html += '<span class="wh-ff-label">' + __("To:") + "</span>";
        var all_active = !_fulfill_wh_filter ? " wh-ff-active" : "";
        html += '<span class="wh-ff-chip' + all_active + '" data-ff-wh="">' + __("All") + "</span>";
        dest_whs.forEach(function (wh) {
            var act = (_fulfill_wh_filter === wh) ? " wh-ff-active" : "";
            html += '<span class="wh-ff-chip' + act + '" data-ff-wh="' + e(wh) + '">' + e(wh) + "</span>";
        });
        html += "</div>";
    }

    // Apply destination filter
    var mr_fulfill_shown = _fulfill_wh_filter
        ? mr_fulfill.filter(function (mr) { return mr.set_warehouse === _fulfill_wh_filter; })
        : mr_fulfill;

    if (mr_fulfill_shown.length) {
        html += '<div class="wh-list">';
        mr_fulfill_shown.forEach(function (mr) { html += _mr_item(mr, "fulfill"); });
        html += "</div>";
    } else {
        html += _empty_panel(__("No pending requests from your warehouse"));
    }
    html += "</div>";

    html += '<div class="wh-col">';
    html += '<div class="wh-col-hdr"><span>⏳</span> ' + __("Pending Approvals") + "</div>";
    if (approvals.length) {
        html += '<div class="wh-list">';
        approvals.forEach(function (ap) { html += _approval_item(ap); });
        html += "</div>";
    } else {
        html += _empty_panel(__("No pending approvals"));
    }
    html += "</div>";

    html += "</div>"; // .wh-split

    // ── My Material Requests ─────────────────────────────────────────
    html += '<h3 class="wh-section-title">' + __("My Material Requests") + "</h3>";
    if (my_mrs.length) {
        html += '<div class="wh-list wh-list-full">';
        my_mrs.forEach(function (mr) { html += _mr_item(mr, "mine"); });
        html += "</div>";
    } else {
        html += _empty_full(__("No open requests created by you"));
    }

    html += "</div>"; // .wh-dash
    page.main.html(html);

    // ── Staggered fade-in ────────────────────────────────────────────
    setTimeout(function () {
        page.main.find(".wh-kpi-card, .wh-item").each(function (i) {
            var $el = $(this);
            setTimeout(function () { $el.addClass("wh-visible"); }, i * 35);
        });
    }, 40);
}

// ── Item builders ──────────────────────────────────────────────────────────────

function _mr_item(mr, mode) {
    var e      = frappe.utils.escape_html;
    var status = mr.status || "Submitted";
    var cls    = "wh-item";
    if (status === "Partially Ordered") cls += " wh-item-partial";

    // Right-side meta column
    var meta = "";

    // Requestor — who raised this MR (shown in fulfill column so warehouse
    // person knows who to coordinate with)
    if (mode === "fulfill" && mr.requester_name) {
        meta += '<span class="wh-requester" title="' + __("Requested by") + '">'
            + frappe.utils.icon("user", "xs") + " " + e(mr.requester_name) + "</span>";
    }

    meta += '<div class="wh-date-lbl">' + frappe.datetime.str_to_user(mr.transaction_date) + "</div>";

    // Item count + total qty
    if (mr.item_count) {
        meta += '<span class="wh-item-count">'
            + mr.item_count + " " + __("items");
        if (mr.total_qty) {
            meta += " · " + _fmt_qty(mr.total_qty) + " " + __("qty");
        }
        meta += "</span>";
    }

    meta += '<span class="wh-status wh-status-' + status.toLowerCase().replace(/ /g, "-") + '">'
        + e(__(status)) + "</span>";

    return '<div class="' + cls + '" data-doctype="Material Request" data-name="' + e(mr.name) + '">'
        + '<div class="wh-item-info">'
        + '<span class="wh-item-name">' + e(mr.name) + "</span>"
        + '<div class="wh-route">'
        + '<span class="wh-wh wh-from">' + e(mr.set_from_warehouse || "—") + "</span>"
        + '<span class="wh-arrow">→</span>'
        + '<span class="wh-wh wh-to">' + e(mr.set_warehouse || "—") + "</span>"
        + "</div>"
        + "</div>"
        + '<div class="wh-item-meta">' + meta + "</div>"
        + "</div>";
}

function _approval_item(ap) {
    var e        = frappe.utils.escape_html;
    var date_str = ap.creation ? ap.creation.substring(0, 10) : "";

    // Warehouse route: from → to
    var wh_route = (ap.from_warehouse || ap.to_warehouse)
        ? '<div class="wh-route">'
            + '<span class="wh-wh wh-from">' + e(ap.from_warehouse || "—") + "</span>"
            + '<span class="wh-arrow">→</span>'
            + '<span class="wh-wh wh-to">' + e(ap.to_warehouse || "—") + "</span>"
            + "</div>"
        : "";

    return '<div class="wh-item" data-doctype="' + e(ap.reference_doctype) + '" data-name="' + e(ap.reference_name) + '">'
        + '<div class="wh-item-info">'
        + '<span class="wh-item-name">' + e(ap.reference_name) + "</span>"
        + '<div class="wh-route">'
        + '<span class="wh-doctype">' + e(ap.reference_doctype) + "</span>"
        + '<span class="wh-arrow">›</span>'
        + '<span class="wh-state">' + e(ap.workflow_state || "") + "</span>"
        + "</div>"
        + wh_route
        + "</div>"
        + '<div class="wh-item-meta">'
        + '<div class="wh-date-lbl">' + frappe.datetime.str_to_user(date_str) + "</div>"
        + '<span class="wh-role-badge">' + e(ap.role_label || "") + "</span>"
        + "</div>"
        + "</div>";
}

// ── Micro helpers ──────────────────────────────────────────────────────────────

function _kpi(emoji, value, label, type) {
    return '<div class="wh-kpi-card wh-kpi-' + type + '">'
        + '<div class="wh-kpi-top">'
        + '<span class="wh-kpi-emoji">' + emoji + "</span>"
        + '<span class="wh-kpi-label">' + frappe.utils.escape_html(label) + "</span>"
        + "</div>"
        + '<div class="wh-kpi-value">' + value + "</div>"
        + "</div>";
}

function _empty_panel(msg) {
    return '<div class="wh-empty">' + frappe.utils.escape_html(msg) + "</div>";
}

function _empty_full(msg) {
    return '<div class="wh-empty wh-empty-full">' + frappe.utils.escape_html(msg) + "</div>";
}

function _fmt_qty(qty) {
    var n = parseFloat(qty);
    return isNaN(n) ? "" : (n % 1 === 0 ? n.toString() : n.toFixed(2));
}

function _skeleton_html() {
    var rows = "";
    for (var i = 0; i < 3; i++) {
        rows += '<div class="wh-skel-row"><div class="wh-skel-a"></div><div class="wh-skel-b"></div></div>';
    }
    return '<div class="wh-dash"><div class="wh-loading"><div class="wh-spinner"></div>'
        + "<span>" + __("Loading…") + "</span></div>"
        + '<div class="wh-skel-wrap">' + rows + "</div></div>";
}

// ── CSS ────────────────────────────────────────────────────────────────────────

function _inject_css() {
    if (document.getElementById("wh-dash-style")) return;
    var s = document.createElement("style");
    s.id  = "wh-dash-style";
    s.textContent = `
/* ── Base ─────────────────────────────── */
.wh-dash {
    padding: 24px 28px;
    max-width: 1280px;
    margin: 0 auto;
    font-family: inherit;
}
.wh-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 70px 20px;
    color: var(--text-muted);
    font-size: 14px;
}
.wh-spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--border-color);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: wh-spin 0.65s linear infinite;
}
@keyframes wh-spin { to { transform: rotate(360deg); } }
.wh-error { color: var(--red); text-align: center; padding: 60px; font-size: 14px; }

/* ── Skeleton ─────────────────────────── */
.wh-skel-wrap { padding: 0 4px; }
.wh-skel-row { display: flex; gap: 12px; margin-bottom: 10px; }
.wh-skel-a, .wh-skel-b {
    height: 14px; border-radius: 6px;
    background: var(--bg-color);
    animation: wh-pulse 1.4s ease-in-out infinite;
}
.wh-skel-a { flex: 0 0 140px; }
.wh-skel-b { flex: 1; }
@keyframes wh-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }

/* ── Header ───────────────────────────── */
.wh-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border-color);
}
.wh-title {
    font-size: 22px; font-weight: 800;
    color: var(--heading-color); margin: 0 0 8px;
    letter-spacing: -0.4px;
}
.wh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }

.wh-chip {
    font-size: 11px; font-weight: 600;
    background: var(--control-bg);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    padding: 3px 10px; border-radius: 20px;
    transition: background .15s, color .15s, border-color .15s;
}
.wh-chip[data-wh] {
    cursor: pointer;
}
.wh-chip[data-wh]:hover {
    background: var(--primary-light);
    border-color: var(--primary);
    color: var(--primary);
}
.wh-chip-active {
    background: var(--primary) !important;
    color: #fff !important;
    border-color: var(--primary) !important;
}
.wh-chip-muted { color: var(--text-muted); font-weight: 400; }

.wh-filter-note {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
}
.wh-clear-filter {
    color: var(--primary);
    cursor: pointer;
    text-decoration: underline;
}

.wh-date {
    font-size: 12px; color: var(--text-muted);
    background: var(--control-bg);
    padding: 5px 12px; border-radius: 20px;
    white-space: nowrap;
}

/* ── KPI Cards ────────────────────────── */
.wh-kpi-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 28px;
}
.wh-kpi-card {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 18px 16px;
    position: relative;
    overflow: hidden;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity .3s ease, transform .3s ease, box-shadow .2s ease;
}
.wh-kpi-card.wh-visible { opacity: 1; transform: translateY(0); }
.wh-kpi-card::before {
    content: ""; position: absolute;
    top: 0; left: 0; right: 0; height: 3px;
}
.wh-kpi-fulfil::before   { background: #f59e0b; }
.wh-kpi-my::before       { background: #3b82f6; }
.wh-kpi-approval::before { background: #ef4444; }
.wh-kpi-done::before     { background: #10b981; }
.wh-kpi-top {
    display: flex; align-items: center;
    gap: 6px; margin-bottom: 10px;
}
.wh-kpi-emoji { font-size: 15px; line-height: 1; }
.wh-kpi-label {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .7px;
    color: var(--text-muted);
}
.wh-kpi-value {
    font-size: 34px; font-weight: 800;
    line-height: 1; letter-spacing: -1px;
}
.wh-kpi-fulfil .wh-kpi-value   { color: #d97706; }
.wh-kpi-my .wh-kpi-value       { color: #2563eb; }
.wh-kpi-approval .wh-kpi-value { color: #dc2626; }
.wh-kpi-done .wh-kpi-value     { color: #059669; }

/* ── Section title ────────────────────── */
.wh-section-title {
    font-size: 13px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .5px;
    color: var(--text-muted);
    margin: 28px 0 10px;
}

/* ── Split columns ────────────────────── */
.wh-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 4px;
}
.wh-col-hdr {
    font-size: 13px; font-weight: 700;
    padding: 9px 16px;
    background: var(--control-bg);
    border: 1px solid var(--border-color);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    display: flex; align-items: center; gap: 6px;
    color: var(--heading-color);
}

/* ── Item list ────────────────────────── */
.wh-list {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: 0 0 10px 10px;
    overflow: hidden;
    max-height: 420px;
    overflow-y: auto;
}
.wh-list-full {
    border-radius: 10px;
    max-height: 360px;
}
.wh-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    opacity: 0;
    transform: translateX(-6px);
    transition: opacity .28s ease, transform .28s ease, background .15s ease;
}
.wh-item.wh-visible  { opacity: 1; transform: translateX(0); }
.wh-item:last-child  { border-bottom: 0; }
.wh-item:hover       { background: var(--fg-color); }
.wh-item-partial     { border-left: 3px solid #f59e0b; }

.wh-item-name {
    font-size: 13px; font-weight: 700;
    color: var(--primary);
}
.wh-item:hover .wh-item-name { text-decoration: underline; }

.wh-route {
    display: flex; align-items: center;
    gap: 5px; margin-top: 3px;
    flex-wrap: wrap;
}
.wh-wh {
    font-size: 11px; color: var(--text-muted);
    background: var(--control-bg);
    padding: 1px 7px; border-radius: 3px;
    max-width: 180px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
}
.wh-doctype {
    font-size: 11px; color: var(--text-muted);
}
.wh-state {
    font-size: 11px; font-weight: 600;
    color: #2563eb;
    background: #eff6ff;
    padding: 1px 7px; border-radius: 3px;
}
.wh-arrow { color: var(--text-muted); font-size: 12px; }

.wh-item-meta {
    text-align: right;
    flex-shrink: 0;
    display: flex; flex-direction: column;
    align-items: flex-end; gap: 4px;
    min-width: 110px;
}
.wh-date-lbl { font-size: 11px; color: var(--text-muted); }

/* Requestor name badge */
.wh-requester {
    font-size: 11px; font-weight: 600;
    color: #1d4ed8;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    padding: 2px 7px; border-radius: 3px;
    display: flex; align-items: center; gap: 3px;
    white-space: nowrap;
}

/* Item count + qty badge */
.wh-item-count {
    font-size: 10px; font-weight: 600;
    color: #6d28d9;
    background: #f5f3ff;
    border: 1px solid #e9d5ff;
    padding: 2px 7px; border-radius: 3px;
    white-space: nowrap;
}

.wh-status {
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .5px;
    padding: 2px 7px; border-radius: 3px;
}
.wh-status-submitted         { color: #d97706; background: #fffbeb; }
.wh-status-partially-ordered { color: #2563eb; background: #eff6ff; }
.wh-status-ordered           { color: #059669; background: #ecfdf5; }

.wh-role-badge {
    font-size: 10px; font-weight: 600;
    color: #5b21b6; background: #f5f3ff;
    padding: 2px 7px; border-radius: 3px;
    border: 1px solid #ede9fe;
}

.wh-action-btn {
    font-size: 11px; font-weight: 600;
    color: #fff; background: var(--primary);
    border: none; border-radius: 5px;
    padding: 4px 10px; cursor: pointer;
    transition: opacity .2s;
    white-space: nowrap;
}
.wh-action-btn:hover { opacity: .85; }

/* ── To-Fulfil destination filter bar ─── */
.wh-ff-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    background: var(--control-bg);
    border: 1px solid var(--border-color);
    border-top: none;
}
.wh-ff-label {
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .5px;
    color: var(--text-muted);
    margin-right: 2px;
}
.wh-ff-chip {
    font-size: 10px; font-weight: 600;
    padding: 2px 9px; border-radius: 20px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-muted);
    cursor: pointer;
    transition: background .15s, color .15s, border-color .15s;
    white-space: nowrap;
}
.wh-ff-chip:hover { border-color: var(--primary); color: var(--primary); }
.wh-ff-active {
    background: var(--primary) !important;
    color: #fff !important;
    border-color: var(--primary) !important;
}

.wh-empty {
    text-align: center;
    padding: 32px 16px;
    font-size: 13px;
    color: var(--text-muted);
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 10px 10px;
}
.wh-empty-full {
    border-radius: 10px;
    border-top: 1px solid var(--border-color);
}

/* ── Responsive ───────────────────────── */
@media (max-width: 900px) {
    .wh-split { grid-template-columns: 1fr; }
    .wh-kpi-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
    .wh-dash { padding: 16px; }
    .wh-kpi-row { gap: 10px; }
    .wh-kpi-value { font-size: 26px; }
    .wh-item { flex-direction: column; align-items: flex-start; }
    .wh-item-meta { text-align: left; align-items: flex-start; }
    .wh-header { flex-direction: column; gap: 10px; }
}
    `;
    document.head.appendChild(s);
}
