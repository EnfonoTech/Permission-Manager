// Permission Manager — Warehouse Dashboard

var _dash_data          = null;
var _active_wh          = null;   // top-level warehouse chip filter
var _fulfill_wh_filter  = null;   // To Fulfil → destination warehouse
var _fulfill_pri_filter = null;   // To Fulfil → custom_priority

frappe.pages["pm-warehouse-dashboard"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Warehouse Dashboard"),
        single_column: true,
    });

    _inject_css();

    page.add_inner_button(__("Refresh"), function () {
        _active_wh = _fulfill_wh_filter = _fulfill_pri_filter = null;
        _load(page);
    });
    page.add_inner_button(__("My Approvals"), function () {
        frappe.set_route("pm-approval-inbox");
    });
    page.add_inner_button(__("New Material Request"), function () {
        frappe.new_doc("Material Request", { material_request_type: "Material Transfer" });
    });

    try {
        var bc = new BroadcastChannel("pm_approval_notifications");
        bc.onmessage = function () { if (_dash_data) _load(page); };
    } catch (_) {}

    _setup_events(page);
    wrapper._wh_page = page;
    _load(page);
};

frappe.pages["pm-warehouse-dashboard"].on_page_show = function (wrapper) {
    if (wrapper._wh_page) _load(wrapper._wh_page);
};

// ── Events (delegated — survive re-renders) ────────────────────────────────────

function _setup_events(page) {
    // Top-level warehouse chip
    page.main.on("click", ".wh-chip[data-wh]", function () {
        var wh = $(this).data("wh") || null;
        _active_wh = (_active_wh === wh) ? null : wh;
        _draw(page);
    });

    // Clear top-level filter
    page.main.on("click", ".wh-clear-filter", function (e) {
        e.preventDefault();
        _active_wh = null;
        _draw(page);
    });

    // To Fulfil: destination warehouse chip
    page.main.on("click", ".wh-ff-chip[data-ff-wh]", function () {
        var wh = $(this).data("ff-wh") || null;
        _fulfill_wh_filter = (_fulfill_wh_filter === wh) ? null : wh;
        _draw(page);
    });

    // To Fulfil: priority chip
    page.main.on("click", ".wh-ff-chip[data-ff-pri]", function () {
        var pri = $(this).data("ff-pri") || null;
        _fulfill_pri_filter = (_fulfill_pri_filter === pri) ? null : pri;
        _draw(page);
    });

    // Open document — whole-row click (fires when user clicks anywhere except the <a> link itself)
    page.main.on("click", ".wh-row[data-doctype][data-name]", function (e) {
        if ($(e.target).closest("a.wh-doc-link").length) return; // let the link handle it
        frappe.set_route("Form", $(this).data("doctype"), $(this).data("name"));
    });
}

// ── Load ───────────────────────────────────────────────────────────────────────

function _load(page) {
    page.main.html(_skeleton_html());
    frappe.call({
        method: "permission_manager.permission_manager.api.warehouse_dashboard.get_warehouse_dashboard_data",
        callback: function (r) {
            if (r.message) { _dash_data = r.message; _draw(page); }
        },
        error: function () {
            page.main.html('<div class="wh-dash"><p class="wh-error">' + __("Failed to load dashboard.") + "</p></div>");
        },
    });
}

// ── Draw ───────────────────────────────────────────────────────────────────────

function _draw(page) {
    var d = _dash_data;
    if (!d) return;
    var e = frappe.utils.escape_html;

    // ── Apply top-level warehouse filter ─────────────────────────────
    var mr_fulfill = _active_wh
        ? (d.mr_to_fulfill || []).filter(function (mr) { return mr.set_from_warehouse === _active_wh; })
        : (d.mr_to_fulfill || []);

    var my_mrs = _active_wh
        ? (d.my_mrs || []).filter(function (mr) { return mr.set_warehouse === _active_wh; })
        : (d.my_mrs || []);

    var approvals = _active_wh
        ? (d.pending_approvals || []).filter(function (ap) { return !ap.to_warehouse || ap.to_warehouse === _active_wh; })
        : (d.pending_approvals || []);

    // ── Header ────────────────────────────────────────────────────────
    var wh_chips = (d.warehouses || []).map(function (w) {
        var cls = "wh-chip" + (_active_wh === w ? " wh-chip-active" : "");
        return '<span class="' + cls + '" data-wh="' + e(w) + '">' + e(w) + "</span>";
    }).join("");

    var html = '<div class="wh-dash">';
    html += '<div class="wh-header">';
    html += '<div class="wh-header-left">';
    html += '<h2 class="wh-title">' + __("Warehouse Dashboard") + "</h2>";
    html += wh_chips
        ? '<div class="wh-chips">' + wh_chips + "</div>"
        : '<div class="wh-chips"><span class="wh-chip wh-chip-muted">' + __("No warehouse assigned") + "</span></div>";
    if (_active_wh) {
        html += '<div class="wh-filter-note">' + frappe.utils.icon("filter", "xs") + " "
            + __("Filtered: {0}", [e(_active_wh)])
            + ' — <a class="wh-clear-filter">' + __("Show all") + "</a></div>";
    }
    html += "</div>";
    html += '<div class="wh-header-right"><span class="wh-date">'
        + frappe.datetime.str_to_user(frappe.datetime.get_today()) + "</span></div>";
    html += "</div>";

    // ── KPI row ───────────────────────────────────────────────────────
    html += '<div class="wh-kpi-row">';
    html += _kpi("📋", mr_fulfill.length,             __("To Fulfil"),         "fulfil");
    html += _kpi("📬", my_mrs.length,                 __("My Open Requests"),  "my");
    html += _kpi("⏳", approvals.length,              __("Pending Approvals"), "approval");
    html += _kpi("✅", (d.kpis || {}).transferred_today || 0, __("Transferred Today"), "done");
    html += "</div>";

    // ── Main grid: 3 columns ──────────────────────────────────────────
    html += '<div class="wh-grid">';

    // ── Col 1: To Fulfil ─────────────────────────────────────────────
    html += '<div class="wh-col wh-col-fulfill">';
    html += '<div class="wh-col-hdr"><span>📋</span> ' + __("To Fulfil")
        + '<span class="wh-col-count">' + mr_fulfill.length + "</span></div>";

    // Build filter bar (to-warehouse + priority)
    var dest_whs = [], priorities = [];
    mr_fulfill.forEach(function (mr) {
        if (mr.set_warehouse && dest_whs.indexOf(mr.set_warehouse) === -1) dest_whs.push(mr.set_warehouse);
        if (mr.custom_priority && priorities.indexOf(mr.custom_priority) === -1) priorities.push(mr.custom_priority);
    });

    var PRI_ORDER = ["Critical", "Urgent", "High", "Medium", "Low"];
    priorities.sort(function (a, b) {
        var ai = PRI_ORDER.indexOf(a), bi = PRI_ORDER.indexOf(b);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    if (dest_whs.length > 0 || priorities.length > 0) {
        html += '<div class="wh-ff-bar">';

        if (dest_whs.length > 0) {
            html += '<div class="wh-ff-group">';
            html += '<span class="wh-ff-label">' + __("To:") + "</span>";
            var wh_all_cls = "wh-ff-chip" + (!_fulfill_wh_filter ? " wh-ff-active" : "");
            html += '<span class="' + wh_all_cls + '" data-ff-wh="">' + __("All") + "</span>";
            dest_whs.forEach(function (wh) {
                var cls = "wh-ff-chip" + (_fulfill_wh_filter === wh ? " wh-ff-active" : "");
                html += '<span class="' + cls + '" data-ff-wh="' + e(wh) + '">' + e(wh) + "</span>";
            });
            html += "</div>";
        }

        if (priorities.length > 0) {
            html += '<div class="wh-ff-group">';
            html += '<span class="wh-ff-label">' + __("Priority:") + "</span>";
            var pri_all_cls = "wh-ff-chip" + (!_fulfill_pri_filter ? " wh-ff-active" : "");
            html += '<span class="' + pri_all_cls + '" data-ff-pri="">' + __("All") + "</span>";
            priorities.forEach(function (pri) {
                var cls = "wh-ff-chip wh-ff-pri-" + pri.toLowerCase() + (_fulfill_pri_filter === pri ? " wh-ff-active" : "");
                html += '<span class="' + cls + '" data-ff-pri="' + e(pri) + '">' + e(pri) + "</span>";
            });
            html += "</div>";
        }

        html += "</div>";
    }

    // Apply section-level filters
    var shown = mr_fulfill;
    if (_fulfill_wh_filter)  shown = shown.filter(function (mr) { return mr.set_warehouse    === _fulfill_wh_filter; });
    if (_fulfill_pri_filter) shown = shown.filter(function (mr) { return mr.custom_priority  === _fulfill_pri_filter; });

    if (shown.length) {
        html += '<div class="wh-list">';
        shown.forEach(function (mr) { html += _mr_row(mr); });
        html += "</div>";
    } else {
        html += _empty_panel(__("No pending requests"));
    }
    html += "</div>"; // .wh-col-fulfill

    // ── Col 2: Pending Approvals ──────────────────────────────────────
    html += '<div class="wh-col wh-col-approvals">';
    html += '<div class="wh-col-hdr"><span>⏳</span> ' + __("Pending Approvals")
        + '<span class="wh-col-count">' + approvals.length + "</span></div>";
    if (approvals.length) {
        html += '<div class="wh-list">';
        approvals.forEach(function (ap) { html += _approval_row(ap); });
        html += "</div>";
    } else {
        html += _empty_panel(__("No pending approvals"));
    }
    html += "</div>";

    html += "</div>"; // .wh-grid

    // ── My Material Requests (full width) ────────────────────────────
    html += '<div class="wh-section">';
    html += '<div class="wh-col-hdr wh-hdr-full"><span>📬</span> ' + __("My Material Requests")
        + '<span class="wh-col-count">' + my_mrs.length + "</span></div>";
    if (my_mrs.length) {
        html += '<div class="wh-list wh-list-full">';
        my_mrs.forEach(function (mr) { html += _mr_row(mr); });
        html += "</div>";
    } else {
        html += _empty_full(__("No open requests created by you"));
    }
    html += "</div>";

    html += "</div>"; // .wh-dash
    page.main.html(html);

    // Staggered fade-in
    setTimeout(function () {
        page.main.find(".wh-kpi-card, .wh-row").each(function (i) {
            var $el = $(this);
            setTimeout(function () { $el.addClass("wh-visible"); }, i * 18);
        });
    }, 30);
}

// ── Row builders ───────────────────────────────────────────────────────────────

function _doc_link(doctype, name) {
    return "/app/" + doctype.toLowerCase().replace(/ /g, "-") + "/" + encodeURIComponent(name);
}

var _PRI_CLS = {
    Critical: "wh-pri-critical",
    Urgent:   "wh-pri-urgent",
    High:     "wh-pri-high",
    Medium:   "wh-pri-medium",
    Low:      "wh-pri-low",
};

function _mr_row(mr) {
    var e      = frappe.utils.escape_html;
    var status = mr.status || "Submitted";
    var left_cls = "wh-row-left";
    if (status === "Partially Ordered") left_cls += " wh-row-partial";

    // Priority pill
    var pri_html = mr.custom_priority
        ? '<span class="wh-pri ' + (_PRI_CLS[mr.custom_priority] || "") + '">' + e(mr.custom_priority) + "</span>"
        : "";

    // Item count
    var count_html = mr.item_count
        ? '<span class="wh-count">' + mr.item_count + " " + __("items")
            + (mr.total_qty ? " · " + _fmt_qty(mr.total_qty) : "") + "</span>"
        : "";

    // Requestor
    var req_html = mr.requester_name
        ? '<span class="wh-req">' + e(mr.requester_name) + "</span>"
        : "";

    return '<div class="wh-row" data-doctype="Material Request" data-name="' + e(mr.name) + '">'
        + '<div class="wh-row-name">'
        + '<a class="wh-doc-link" href="' + _doc_link("Material Request", mr.name) + '">' + e(mr.name) + "</a>"
        + pri_html + "</div>"
        + '<div class="wh-row-route">'
        + '<span class="wh-wh">' + e(mr.set_from_warehouse || "—") + "</span>"
        + '<span class="wh-arr">→</span>'
        + '<span class="wh-wh wh-wh-to">' + e(mr.set_warehouse || "—") + "</span>"
        + "</div>"
        + '<div class="wh-row-meta">'
        + req_html
        + '<span class="wh-date-lbl">' + frappe.datetime.str_to_user(mr.transaction_date) + "</span>"
        + count_html
        + '<span class="wh-st wh-st-' + status.toLowerCase().replace(/ /g, "-") + '">' + e(__(status)) + "</span>"
        + "</div>"
        + "</div>";
}

function _approval_row(ap) {
    var e        = frappe.utils.escape_html;
    var date_str = ap.creation ? ap.creation.substring(0, 10) : "";

    var wh_html = (ap.from_warehouse || ap.to_warehouse)
        ? '<div class="wh-row-route">'
            + '<span class="wh-wh">' + e(ap.from_warehouse || "—") + "</span>"
            + '<span class="wh-arr">→</span>'
            + '<span class="wh-wh wh-wh-to">' + e(ap.to_warehouse || "—") + "</span>"
            + "</div>"
        : "";

    return '<div class="wh-row" data-doctype="' + e(ap.reference_doctype) + '" data-name="' + e(ap.reference_name) + '">'
        + '<div class="wh-row-name">'
        + '<a class="wh-doc-link" href="' + _doc_link(ap.reference_doctype, ap.reference_name) + '">' + e(ap.reference_name) + "</a>"
        + '<span class="wh-state-pill">' + e(ap.workflow_state || "") + "</span>"
        + "</div>"
        + wh_html
        + '<div class="wh-row-meta">'
        + '<span class="wh-date-lbl">' + frappe.datetime.str_to_user(date_str) + "</span>"
        + '<span class="wh-role">' + e(ap.role_label || "") + "</span>"
        + "</div>"
        + "</div>";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _kpi(emoji, value, label, type) {
    return '<div class="wh-kpi-card wh-kpi-' + type + '">'
        + '<div class="wh-kpi-top"><span class="wh-kpi-emoji">' + emoji + "</span>"
        + '<span class="wh-kpi-label">' + frappe.utils.escape_html(label) + "</span></div>"
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
    for (var i = 0; i < 5; i++) rows += '<div class="wh-skel-row"><div class="wh-skel-a"></div><div class="wh-skel-b"></div></div>';
    return '<div class="wh-dash"><div class="wh-loading"><div class="wh-spinner"></div><span>' + __("Loading…") + "</span></div>"
        + '<div class="wh-skel-wrap">' + rows + "</div></div>";
}

// ── CSS ────────────────────────────────────────────────────────────────────────

function _inject_css() {
    if (document.getElementById("wh-dash-style")) return;
    var s = document.createElement("style");
    s.id  = "wh-dash-style";
    s.textContent = `
/* ── Base ─────────────────────────────── */
.wh-dash { padding: 20px 24px; max-width: 1400px; margin: 0 auto; font-family: inherit; }
.wh-loading { display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 70px 20px; color: var(--text-muted); font-size: 14px; }
.wh-spinner { width: 20px; height: 20px; border: 2px solid var(--border-color);
    border-top-color: var(--primary); border-radius: 50%; animation: wh-spin .65s linear infinite; }
@keyframes wh-spin { to { transform: rotate(360deg); } }
.wh-error { color: var(--red); text-align: center; padding: 60px; font-size: 14px; }

/* ── Skeleton ─────────────────────────── */
.wh-skel-wrap { padding: 0 4px; }
.wh-skel-row { display: flex; gap: 12px; margin-bottom: 8px; }
.wh-skel-a, .wh-skel-b { height: 12px; border-radius: 4px;
    background: var(--bg-color); animation: wh-pulse 1.4s ease-in-out infinite; }
.wh-skel-a { flex: 0 0 120px; }
.wh-skel-b { flex: 1; }
@keyframes wh-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }

/* ── Header ───────────────────────────── */
.wh-header { display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color); }
.wh-title { font-size: 20px; font-weight: 800; color: var(--heading-color);
    margin: 0 0 6px; letter-spacing: -.4px; }
.wh-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.wh-chip { font-size: 11px; font-weight: 600; background: var(--control-bg);
    color: var(--text-color); border: 1px solid var(--border-color);
    padding: 2px 9px; border-radius: 20px;
    transition: background .15s, color .15s, border-color .15s; }
.wh-chip[data-wh] { cursor: pointer; }
.wh-chip[data-wh]:hover { background: var(--primary-light); border-color: var(--primary); color: var(--primary); }
.wh-chip-active { background: var(--primary) !important; color: #fff !important; border-color: var(--primary) !important; }
.wh-chip-muted { color: var(--text-muted); font-weight: 400; }
.wh-filter-note { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
.wh-clear-filter { color: var(--primary); cursor: pointer; text-decoration: underline; }
.wh-date { font-size: 11px; color: var(--text-muted); background: var(--control-bg);
    padding: 4px 10px; border-radius: 20px; white-space: nowrap; }

/* ── KPI Cards ────────────────────────── */
.wh-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.wh-kpi-card { background: var(--card-bg); border: 1px solid var(--border-color);
    border-radius: 12px; padding: 14px; position: relative; overflow: hidden;
    opacity: 0; transform: translateY(8px); transition: opacity .3s, transform .3s; }
.wh-kpi-card.wh-visible { opacity: 1; transform: translateY(0); }
.wh-kpi-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.wh-kpi-fulfil::before   { background: #f59e0b; }
.wh-kpi-my::before       { background: #3b82f6; }
.wh-kpi-approval::before { background: #ef4444; }
.wh-kpi-done::before     { background: #10b981; }
.wh-kpi-top { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.wh-kpi-emoji { font-size: 14px; line-height: 1; }
.wh-kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; color: var(--text-muted); }
.wh-kpi-value { font-size: 30px; font-weight: 800; line-height: 1; letter-spacing: -1px; }
.wh-kpi-fulfil .wh-kpi-value   { color: #d97706; }
.wh-kpi-my .wh-kpi-value       { color: #2563eb; }
.wh-kpi-approval .wh-kpi-value { color: #dc2626; }
.wh-kpi-done .wh-kpi-value     { color: #059669; }

/* ── Main grid (2 columns) ────────────── */
.wh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; align-items: start; }
.wh-section { margin-bottom: 8px; }

/* ── Column header ────────────────────── */
.wh-col-hdr {
    font-size: 12px; font-weight: 700;
    padding: 7px 12px;
    background: var(--control-bg);
    border: 1px solid var(--border-color);
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    display: flex; align-items: center; gap: 6px;
    color: var(--heading-color);
}
.wh-hdr-full { border-radius: 8px 8px 0 0; }
.wh-col-count {
    margin-left: auto;
    font-size: 11px; font-weight: 700;
    background: var(--primary);
    color: #fff;
    padding: 1px 7px; border-radius: 10px;
    min-width: 20px; text-align: center;
}

/* ── Filter bar ───────────────────────── */
.wh-ff-bar {
    display: flex; flex-wrap: wrap; align-items: center;
    gap: 4px 10px;
    padding: 6px 10px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-top: none;
}
.wh-ff-group { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.wh-ff-label { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .4px; color: var(--text-muted); white-space: nowrap; }
.wh-ff-chip {
    font-size: 10px; font-weight: 600;
    padding: 2px 8px; border-radius: 12px;
    border: 1px solid var(--border-color);
    background: var(--card-bg); color: var(--text-muted);
    cursor: pointer; white-space: nowrap;
    transition: background .12s, color .12s, border-color .12s;
}
.wh-ff-chip:hover { border-color: var(--primary); color: var(--primary); }
.wh-ff-active { background: var(--primary) !important; color: #fff !important; border-color: var(--primary) !important; }

/* priority filter chip colors (unselected) */
.wh-ff-pri-critical:not(.wh-ff-active) { color: #dc2626; border-color: #fca5a5; background: #fee2e2; }
.wh-ff-pri-urgent:not(.wh-ff-active)   { color: #d97706; border-color: #fcd34d; background: #fef3c7; }
.wh-ff-pri-high:not(.wh-ff-active)     { color: #d97706; border-color: #fde68a; background: #fffbeb; }
.wh-ff-pri-medium:not(.wh-ff-active)   { color: #2563eb; border-color: #bfdbfe; background: #eff6ff; }
.wh-ff-pri-low:not(.wh-ff-active)      { color: #6b7280; border-color: #d1d5db; background: #f9fafb; }

/* ── List ─────────────────────────────── */
.wh-list {
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 8px 8px;
    overflow-y: auto;
    max-height: 420px;
}
.wh-list-full {
    border-radius: 0 0 8px 8px;
    max-height: 280px;
    overflow-y: auto;
}
/* thin scrollbar */
.wh-list::-webkit-scrollbar,
.wh-list-full::-webkit-scrollbar { width: 5px; }
.wh-list::-webkit-scrollbar-track,
.wh-list-full::-webkit-scrollbar-track { background: transparent; }
.wh-list::-webkit-scrollbar-thumb,
.wh-list-full::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
.wh-list::-webkit-scrollbar-thumb:hover,
.wh-list-full::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ── Row ──────────────────────────────── */
.wh-row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    column-gap: 10px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity .22s ease, transform .22s ease, background .12s;
}
.wh-row.wh-visible { opacity: 1; transform: translateX(0); }
.wh-row:last-child { border-bottom: 0; }
.wh-row:hover { background: var(--fg-color); }

/* row grid areas */
.wh-row-name  { grid-column: 1; grid-row: 1; display: flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 700; }
.wh-doc-link { color: var(--primary); text-decoration: none; font-weight: 700; }
.wh-doc-link:hover { text-decoration: underline; color: var(--primary-dark, var(--primary)); }
.wh-row-route { grid-column: 1; grid-row: 2; display: flex; align-items: center; gap: 4px;
    margin-top: 2px; flex-wrap: wrap; }
.wh-row-meta  { grid-column: 2; grid-row: 1 / 3; display: flex; flex-direction: column;
    align-items: flex-end; justify-content: center; gap: 3px; white-space: nowrap; }

/* warehouse pill */
.wh-wh { font-size: 10px; color: var(--text-muted); background: var(--control-bg);
    padding: 1px 6px; border-radius: 3px;
    max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wh-wh-to { color: #2563eb; background: #eff6ff; }
.wh-arr { color: var(--text-muted); font-size: 10px; }

/* status badge */
.wh-st { font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .4px; padding: 1px 6px; border-radius: 3px; }
.wh-st-submitted         { color: #d97706; background: #fffbeb; }
.wh-st-partially-ordered { color: #2563eb; background: #eff6ff; }
.wh-st-ordered           { color: #059669; background: #ecfdf5; }
.wh-st-pending           { color: #7c3aed; background: #f5f3ff; }

/* state pill (approvals) */
.wh-state-pill { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
    color: #2563eb; background: #eff6ff; }

/* meta atoms */
.wh-date-lbl { font-size: 10px; color: var(--text-muted); }
.wh-req  { font-size: 10px; font-weight: 600; color: #1d4ed8; }
.wh-count { font-size: 10px; font-weight: 600; color: #6d28d9; }
.wh-role { font-size: 10px; font-weight: 600; color: #5b21b6;
    background: #f5f3ff; padding: 1px 6px; border-radius: 3px; border: 1px solid #ede9fe; }

/* priority badge (inline in name row) */
.wh-pri { font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .3px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
.wh-pri-critical { color: #dc2626; background: #fee2e2; }
.wh-pri-urgent   { color: #d97706; background: #fef3c7; }
.wh-pri-high     { color: #d97706; background: #fffbeb; }
.wh-pri-medium   { color: #2563eb; background: #eff6ff; }
.wh-pri-low      { color: #6b7280; background: #f9fafb; }

/* section title */
.wh-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: var(--text-muted); margin: 22px 0 8px; }

/* empty states */
.wh-empty { text-align: center; padding: 24px 16px; font-size: 12px;
    color: var(--text-muted); background: var(--card-bg);
    border: 1px solid var(--border-color); border-top: none;
    border-radius: 0 0 8px 8px; }
.wh-empty-full { border-radius: 0 0 8px 8px; border-top: none; }

/* ── Responsive ───────────────────────── */
@media (max-width: 900px) {
    .wh-grid { grid-template-columns: 1fr; }
    .wh-kpi-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
    .wh-dash { padding: 12px; }
    .wh-kpi-value { font-size: 24px; }
    .wh-header { flex-direction: column; gap: 8px; }
    .wh-row { grid-template-columns: 1fr; grid-template-rows: auto auto auto; }
    .wh-row-meta { grid-column: 1; grid-row: 3; flex-direction: row; flex-wrap: wrap;
        align-items: center; justify-content: flex-start; }
}
    `;
    document.head.appendChild(s);
}
