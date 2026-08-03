// Permission Manager — Approval Inbox Component
// Author: siva <siva@enfono.com>

import { esc } from "../utils/helpers";

const CATEGORY_META = {
    "Approval Pending":        { color: "ps-ai-grp-approval", icon: "review"  },
    "Decision Pending":        { color: "ps-ai-grp-decision", icon: "branch"  },
    "Acknowledgement Pending": { color: "ps-ai-grp-ack",      icon: "tick"    },
};

// Color action buttons by semantics, not list position
function _action_btn_class(action_name) {
    const n = (action_name || "").toLowerCase();
    if (/\b(accept|approve|submit|confirm|complete|done|pass)\b/.test(n)) return "btn-success";
    if (/\b(reject|decline|cancel|return|refuse|deny|refuse)\b/.test(n)) return "btn-danger";
    return "btn-default";
}

// Rank actions so the positive/primary action (Accept, Approve…) comes first
// and the negative one (Reject, Return…) last. This drives both the on-screen
// button order AND the bulk-action indexing (index 0 = approve, 1 = reject),
// keeping the two in sync.
function _action_rank(action_name) {
    const cls = _action_btn_class(action_name);
    if (cls === "btn-success") return 0;
    if (cls === "btn-danger")  return 2;
    return 1;
}

// Reorder each item's available_actions in place using the semantic rank.
// Array.sort is stable, so actions of equal rank keep their original order.
function _order_actions(data) {
    (data && data.groups || []).forEach((g) => {
        (g.items || []).forEach((item) => {
            if (Array.isArray(item.available_actions)) {
                item.available_actions.sort((a, b) => _action_rank(a) - _action_rank(b));
            }
        });
    });
}

const PRIORITY_CLASS = {
    Critical: "ps-ai-pri-critical",
    Urgent:   "ps-ai-pri-urgent",
    High:     "ps-ai-pri-high",
    Medium:   "ps-ai-pri-medium",
    Low:      "ps-ai-pri-low",
};

export class ApprovalInbox {
    constructor(opts) {
        this.wrapper          = opts.wrapper;
        this.data             = null;
        this.collapsed        = {};
        this._search          = "";
        this._filter_doctype  = "";
        this._from_date       = "";
        this._to_date         = "";
        this._date_sort       = "desc";      // "asc" | "desc"
        this._active_tab      = "pending";   // "pending" | "history" | "analytics"
        this._build_shell();
        this.load();
    }

    // ── Shell ─────────────────────────────────────────────────────────────────

    _build_shell() {
        this.wrapper.html(`
            <div class="ps-ai-wrap">

                <div class="ps-ai-toolbar">
                    <div class="ps-ai-toolbar-left">
                        ${frappe.utils.icon("review", "sm")}
                        <strong class="ps-ai-title">${__("My Approvals")}</strong>
                        <span class="ps-ai-total-badge"></span>
                    </div>
                    <div class="ps-ai-toolbar-right">
                        <input  class="form-control ps-ai-search"
                                type="text"
                                placeholder="${__("Search documents, creators, states…")}"
                                autocomplete="off" />
                        <select class="form-control ps-ai-dt-filter">
                            <option value="">${__("All Transactions")}</option>
                        </select>
                        <div class="ps-ai-date-range">
                            <input class="form-control ps-ai-from-date" type="date" title="${__("From Date")}" />
                            <span class="ps-ai-date-sep">–</span>
                            <input class="form-control ps-ai-to-date"   type="date" title="${__("To Date")}" />
                        </div>
                        <button class="btn btn-sm btn-default ps-ai-refresh-btn">
                            ${frappe.utils.icon("refresh", "xs")} ${__("Refresh")}
                        </button>
                    </div>
                </div>

                <div class="ps-ai-nav-tabs">
                    <button class="ps-ai-nav-tab active" data-tab="pending">${__("Pending")}</button>
                    <button class="ps-ai-nav-tab" data-tab="history">${__("History")}</button>
                    <button class="ps-ai-nav-tab" data-tab="analytics">${__("Analytics")}</button>
                </div>

                <div class="ps-ai-stats-bar"></div>

                <div class="ps-ai-body">
                    <div class="ps-loading">${__("Loading…")}</div>
                </div>

            </div>
        `);

        this.wrapper.find(".ps-ai-refresh-btn").on("click", () => this.load());

        this.wrapper.find(".ps-ai-search").on("input", (e) => {
            this._search = $(e.target).val().trim().toLowerCase();
            if (this._active_tab === "pending") this._apply_filter();
            // History rows are already loaded, so filter what is on screen rather than refetch
            else if (this._active_tab === "history") this._paint_history();
        });

        this.wrapper.find(".ps-ai-dt-filter").on("change", (e) => {
            this._filter_doctype = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
            else if (this._active_tab === "history") this._paint_history();
        });

        this.wrapper.find(".ps-ai-from-date").on("change", (e) => {
            this._from_date = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
            else if (this._active_tab === "history") this._render_history();
        });

        this.wrapper.find(".ps-ai-to-date").on("change", (e) => {
            this._to_date = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
            else if (this._active_tab === "history") this._render_history();
        });

        this.wrapper.find(".ps-ai-nav-tab").on("click", (e) => {
            const tab = $(e.currentTarget).data("tab");
            this.wrapper.find(".ps-ai-nav-tab").removeClass("active");
            $(e.currentTarget).addClass("active");
            this._active_tab = tab;
            this._switch_tab(tab);
        });
    }

    _switch_tab(tab) {
        const $search_row = this.wrapper.find(".ps-ai-search, .ps-ai-dt-filter, .ps-ai-date-range");
        $search_row.toggle(tab === "pending");
        this.wrapper.find(".ps-ai-stats-bar").toggle(tab === "pending");

        if (tab === "pending") {
            this._render();
        } else if (tab === "history") {
            this._render_history();
        } else if (tab === "analytics") {
            this._render_analytics();
        }
    }

    // ── Data load ─────────────────────────────────────────────────────────────

    load() {
        const $body = this.wrapper.find(".ps-ai-body");
        $body.html(`<div class="ps-loading">${__("Loading…")}</div>`);
        this.wrapper.find(".ps-ai-stats-bar").empty();

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_my_pending_approvals",
            callback: (r) => {
                this.data = r.message || { groups: [], total: 0 };
                _order_actions(this.data);   // Accept before Reject, everywhere
                this._switch_tab(this._active_tab);
            },
            error: () => {
                $body.html(`
                    <div class="ps-ai-empty">
                        ${frappe.utils.icon("alert", "lg")}
                        <p>${__("Failed to load approvals. Check console for errors.")}</p>
                    </div>
                `);
            },
        });
    }

    // ── Pending tab ───────────────────────────────────────────────────────────

    _render() {
        const d     = this.data;
        const $body = this.wrapper.find(".ps-ai-body");

        // Total badge
        this.wrapper.find(".ps-ai-total-badge")
            .text(d.total || "").toggle(!!d.total);

        // Populate doctype filter
        const $dt_sel  = this.wrapper.find(".ps-ai-dt-filter");
        const doctypes = [...new Set(d.groups.flatMap((g) => g.items.map((i) => i.doctype)))].sort();
        $dt_sel.html(`<option value="">${__("All Transactions")}</option>`);
        doctypes.forEach((dt) => $dt_sel.append(`<option value="${esc(dt)}">${esc(dt)}</option>`));

        this._render_stats_bar();

        if (!d.total) {
            $body.html(`
                <div class="ps-ai-empty">
                    ${frappe.utils.icon("tick-circle", "xl")}
                    <h4>${__("All Clear!")}</h4>
                    <p>${__("You have no pending approvals at this time.")}</p>
                </div>
            `);
            return;
        }

        $body.empty();
        d.groups.forEach((group) => this._render_group($body, group));
        if (this._search || this._filter_doctype) this._apply_filter();
    }

    _render_stats_bar() {
        const d = this.data;
        if (!d.total) return;

        const overdue  = d.groups.flatMap((g) => g.items).filter((i) => i.days > 30).length;
        const high_pri = d.groups.flatMap((g) => g.items)
            .filter((i) => ["High","Urgent","Critical"].includes(i.priority)).length;
        const cats = d.groups.map((g) =>
            `<span class="ps-ai-stat-cat">${esc(__(g.label))}: <strong>${g.items.length}</strong></span>`
        ).join("");

        this.wrapper.find(".ps-ai-stats-bar").html(`
            <div class="ps-ai-stats">
                ${cats}
                ${high_pri ? `<span class="ps-ai-stat-alert">🔴 ${high_pri} ${__("high priority")}</span>` : ""}
                ${overdue  ? `<span class="ps-ai-stat-overdue">⚠️ ${overdue} ${__("overdue (>30 days)")}</span>` : ""}
            </div>
        `);
    }

    // ── Group section ─────────────────────────────────────────────────────────

    _render_group($body, group) {
        const label      = group.label;
        const meta       = CATEGORY_META[label] || { color: "", icon: "list" };
        const is_collapsed = !!this.collapsed[label];
        const cat_key    = label.replace(/\s+/g, "_").toLowerCase();

        const $grp = $(`
            <div class="ps-ai-group" data-category="${esc(cat_key)}">

                <div class="ps-ai-grp-hdr ${esc(meta.color)}">
                    <span class="ps-ai-grp-toggle">${is_collapsed ? "▶" : "▼"}</span>
                    <span class="ps-ai-grp-icon">${frappe.utils.icon(meta.icon, "xs")}</span>
                    <strong class="ps-ai-grp-label">${esc(__(label))}</strong>
                    <span class="ps-ai-grp-count">${group.items.length}</span>

                    <div class="ps-ai-bulk-bar" ${is_collapsed ? 'style="display:none"' : ""}>
                        <label class="ps-ai-sel-all-label">
                            <input type="checkbox" class="ps-ai-chk-all" />
                            <span>${__("Select all")}</span>
                        </label>
                        <button class="btn btn-xs btn-success ps-ai-bulk-btn" style="display:none">
                            ✓ ${__("Bulk approve checked")}
                        </button>
                        <button class="btn btn-xs btn-danger ps-ai-bulk-reject-btn" style="display:none">
                            ✗ ${__("Bulk reject checked")}
                        </button>
                    </div>
                </div>

                <div class="ps-ai-grp-body" ${is_collapsed ? 'style="display:none"' : ""}>
                    <div class="ps-ai-table-wrap">
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th class="ps-ai-col-chk"></th>
                                <th class="ps-ai-col-date ps-ai-col-sortable" data-sort="date">
                                    ${__("Date")} <span class="ps-ai-sort-icon">${this._date_sort === "asc" ? "↑" : "↓"}</span>
                                </th>
                                <th class="ps-ai-col-pri">${__("Priority")}</th>
                                <th class="ps-ai-col-trans">${__("Transaction")}</th>
                                <th class="ps-ai-col-num">${__("#")}</th>
                                <th class="ps-ai-col-role">${__("Role")}</th>
                                <th class="ps-ai-col-holder">${__("With")}</th>
                                <th class="ps-ai-col-state">${__("Approval")}</th>
                                <th class="ps-ai-col-days">${__("Days")}</th>
                                <th class="ps-ai-col-creator">${__("Creator")}</th>
                                <th class="ps-ai-col-actions">${__("Actions")}</th>
                            </tr></thead>
                            <tbody class="ps-ai-tbody"></tbody>
                        </table>
                    </div>
                </div>

            </div>
        `);

        const $tbody    = $grp.find(".ps-ai-tbody");
        const $bulk_bar = $grp.find(".ps-ai-bulk-bar");
        const $bulk_btn = $grp.find(".ps-ai-bulk-btn");
        const $bulk_rej = $grp.find(".ps-ai-bulk-reject-btn");

        // Sort items by date
        const sorted = [...group.items].sort((a, b) => {
            const cmp = (a.creation_iso || "").localeCompare(b.creation_iso || "");
            return this._date_sort === "asc" ? cmp : -cmp;
        });
        sorted.forEach((item) => this._render_row($tbody, item));

        // Date column sort click
        $grp.find(".ps-ai-col-sortable").on("click", () => {
            this._date_sort = this._date_sort === "asc" ? "desc" : "asc";
            this._render();
        });

        // Collapse toggle
        $grp.find(".ps-ai-grp-hdr").on("click", (e) => {
            if ($(e.target).closest("input, button, label, a").length) return;
            const $panel  = $grp.find(".ps-ai-grp-body");
            const now_vis = $panel.is(":visible");
            this.collapsed[label] = now_vis;
            $panel.toggle(!now_vis);
            $bulk_bar.toggle(!now_vis);
            $grp.find(".ps-ai-grp-toggle").text(now_vis ? "▶" : "▼");
        });

        // Select-all
        $grp.find(".ps-ai-chk-all").on("change", function () {
            const checked = $(this).is(":checked");
            $tbody.find(".ps-ai-row-chk:not(:disabled)").prop("checked", checked);
            const any = $tbody.find(".ps-ai-row-chk:checked").length > 0;
            $bulk_btn.toggle(any);
            $bulk_rej.toggle(any);
        });
        $tbody.on("change", ".ps-ai-row-chk", () => {
            const any = $tbody.find(".ps-ai-row-chk:checked").length > 0;
            $bulk_btn.toggle(any);
            $bulk_rej.toggle(any);
        });

        // Bulk actions
        $bulk_btn.on("click", () =>
            this._bulk_action($tbody.find(".ps-ai-row-chk:checked").closest("tr"), group.items, 0));
        $bulk_rej.on("click", () =>
            this._bulk_action($tbody.find(".ps-ai-row-chk:checked").closest("tr"), group.items, 1));

        $body.append($grp);
    }

    // ── Individual row with inline preview ────────────────────────────────────

    _render_row($tbody, item) {
        const pri_class  = PRIORITY_CLASS[item.priority] || "ps-ai-pri-low";
        const days_class = item.days > 30 ? "ps-ai-days-critical"
                         : item.days > 7  ? "ps-ai-days-warn"
                         : "ps-ai-days-ok";
        const row_class  = item.days > 30 ? "ps-ai-row ps-ai-row-overdue" : "ps-ai-row";

        const search_val = [item.doctype, item.docname, item.creator, item.role_id, item.state]
            .join(" ").toLowerCase();

        let act_html = "";
        // An ad-hoc approver who was forwarded to with "return to me" gives input only — the
        // server sends the document back to the forwarder instead of advancing it, so showing
        // Approve/Reject here would promise something the engine refuses to do.
        const input_only = !!(item.is_adhoc && item.return_to_originator);
        if (!input_only) {
            (item.available_actions || []).forEach((act_name) => {
                const cls = _action_btn_class(act_name);
                act_html += `<button class="btn btn-xs ${cls} ps-ai-act-btn"
                    data-action="${esc(act_name)}"
                    data-doctype="${esc(item.doctype)}"
                    data-docname="${esc(item.docname)}"
                    title="${esc(act_name)}">${esc(act_name)}</button>`;
            });
        }
        if (!act_html && !input_only && !item.is_waiting) {
            act_html = `<span class="ps-ai-no-action text-muted">${__("No action")}</span>`;
        }
        if (item.is_waiting) {
            // forwarded out: visible so it is not forgotten, but not actionable from here
            act_html += `<span class="ps-ai-adhoc-badge" title="${
                __("Forwarded — waiting on {0}", [item.waiting_with || __("another approver")])
            }">${__("Waiting")}${item.waiting_with ? ": " + esc(item.waiting_with) : ""}</span>`;
        }
        // Forward button — only for non-adhoc actions (can't forward an already-forwarded ad-hoc)
        if (!item.is_adhoc && !item.is_waiting) {
            act_html += `<button class="btn btn-xs btn-default ps-ai-fwd-btn"
                data-name="${esc(item.name)}"
                data-docname="${esc(item.docname)}"
                title="${__("Forward to another approver")}">⇢</button>`;
        } else {
            act_html += `<span class="ps-ai-adhoc-badge" title="${__("Ad-hoc approval — forwarded to you")}">${__("Ad-hoc")}</span>`;
            if (item.return_to_originator) {
                act_html += `<button class="btn btn-xs btn-default ps-ai-return-btn"
                    data-name="${esc(item.name)}"
                    data-docname="${esc(item.docname)}"
                    title="${__("Return to the original approver with your input (no advance)")}">↩</button>`;
            }
        }
        act_html += `<a href="${esc(item.doc_url)}" target="_blank"
            class="btn btn-xs btn-default ps-ai-open-btn" title="${__("Open document")}">→</a>`;

        const COL_COUNT = 11;

        const $row = $(`
            <tr class="${row_class}"
                data-name="${esc(item.name)}"
                data-doctype="${esc(item.doctype)}"
                data-docname="${esc(item.docname)}"
                data-search="${esc(search_val)}"
                data-creation="${esc(item.creation_iso || '')}">
                <td class="ps-ai-col-chk">
                    <input type="checkbox" class="ps-ai-row-chk" />
                </td>
                <td class="ps-ai-col-date ps-ai-preview-trigger" title="${__("Click to preview")}" style="cursor:pointer">
                    ${esc(item.date)}
                    <span class="ps-ai-expand-icon">▸</span>
                </td>
                <td class="ps-ai-col-pri">
                    <span class="ps-ai-pri-badge ${pri_class}">${esc(item.priority)}</span>
                </td>
                <td class="ps-ai-col-trans" title="${esc(item.doctype)}">${esc(item.doctype)}</td>
                <td class="ps-ai-col-num">
                    <a class="ps-ai-doc-link" href="${esc(item.doc_url)}" target="_blank">
                        ${esc(item.docname)}
                    </a>
                </td>
                <td class="ps-ai-col-role">${esc(item.role_id)}</td>
                <td class="ps-ai-col-holder">
                    ${item.holder
                        ? `<span class="ps-ai-holder-name">${esc(item.holder)}</span>`
                        : item.role_id && item.role_id !== "Direct"
                            ? `<span class="text-muted ps-ai-holder-role">${esc(item.role_id)}</span>`
                            : `<span class="text-muted">—</span>`}
                </td>
                <td class="ps-ai-col-state">
                    <span class="ps-ai-state-badge">${esc(item.state)}</span>
                </td>
                <td class="ps-ai-col-days">
                    <span class="ps-ai-days-badge ${days_class}">${item.days}</span>
                </td>
                <td class="ps-ai-col-creator">${esc(item.creator)}</td>
                <td class="ps-ai-col-actions">${act_html}</td>
            </tr>
            <tr class="ps-ai-preview-row" style="display:none">
                <td colspan="${COL_COUNT}" class="ps-ai-preview-cell">
                    <div class="ps-ai-preview-body">
                        <span class="text-muted">${__("Loading…")}</span>
                    </div>
                </td>
            </tr>
        `);

        // Inline preview toggle
        $row.filter(".ps-ai-row").find(".ps-ai-preview-trigger").on("click", () => {
            const $preview_row  = $row.filter(".ps-ai-preview-row");
            const $preview_body = $preview_row.find(".ps-ai-preview-body");
            if ($preview_row.is(":visible")) {
                $preview_row.hide();
                $row.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("▸");
                return;
            }
            $preview_row.show();
            $row.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("▾");
            if ($preview_body.data("loaded")) return;
            $preview_body.data("loaded", true);
            // Separate boxes on purpose: _load_preview replaces the whole of whatever it is
            // given, so sharing one container meant whichever call answered last erased the
            // other. The chain rendered, then vanished when the field preview landed.
            $preview_body.html(
                '<div class="ps-ai-life"></div><div class="ps-ai-fields"></div>'
            );
            this._load_lifecycle($preview_body.find(".ps-ai-life"), item);
            this._load_preview($preview_body.find(".ps-ai-fields"), item.doctype, item.docname);
        });

        $row.filter(".ps-ai-row").find(".ps-ai-act-btn").on("click", (e) => {
            const $btn = $(e.currentTarget);
            this._do_action($btn.data("doctype"), $btn.data("docname"), $btn.data("action"));
        });

        $row.filter(".ps-ai-row").find(".ps-ai-fwd-btn").on("click", (e) => {
            const $btn = $(e.currentTarget);
            this._do_forward($btn.data("name"), $btn.data("docname"));
        });

        $row.filter(".ps-ai-row").find(".ps-ai-return-btn").on("click", (e) => {
            const $btn = $(e.currentTarget);
            this._do_return($btn.data("name"), $btn.data("docname"));
        });

        $tbody.append($row);
    }

    // ── Approval chain ────────────────────────────────────────────────────────
    // Drawn per document, not per workflow: these chains fork on the document itself, so
    // showing every state of the workflow would promise phases this one will never reach.
    _load_lifecycle($life, item, opts) {
        opts = opts || {};
        $life.html(`<div class="ps-ai-life-loading text-muted">${
            __("Loading approval chain…")}</div>`);

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_document_lifecycle",
            args: { doctype: item.doctype, docname: item.docname },
            callback: (r) => {
                const d = (r && r.message) || {};
                const chain = d.chain || [];
                if (!chain.length) {
                    $life.html(`<div class="text-muted">${__("No approval chain for this document.")}</div>`);
                    return;
                }

                let steps = "";
                chain.forEach((ph, i) => {
                    const cls = `ps-ai-ph ps-ai-ph-${ph.status}`;
                    const dot = ph.status === "done" ? "✓" : ph.status === "current" ? "●" : "○";
                    const who = ph.by
                        ? `<span class="ps-ai-ph-by">${esc(ph.by)}</span>`
                        : (ph.roles || []).length
                            ? `<span class="ps-ai-ph-role">${esc(ph.roles.join(" / "))}</span>`
                            : "";
                    steps += `<div class="${cls}" title="${esc(ph.state)}">
                            <div class="ps-ai-ph-dot">${dot}</div>
                            <div class="ps-ai-ph-label">${esc(ph.state)}</div>
                            ${who}
                        </div>`;
                    if (i < chain.length - 1) steps += `<div class="ps-ai-ph-link"></div>`;
                });

                let holders = "";
                const roles = d.roles || [];
                if (roles.length) {
                    const total = roles.reduce((n, r) => n + (r.count || 0), 0);
                    const names = roles.map((r) => `
                        <div class="ps-ai-who-role">
                            <div class="ps-ai-who-role-name">${esc(r.role)} <span class="text-muted">(${r.count})</span></div>
                            ${(r.users || []).length
                                ? (r.users || []).map((u) =>
                                    `<div class="ps-ai-who-user" title="${esc(u.user)}">${esc(u.full_name)}</div>`).join("")
                                : `<div class="ps-ai-who-user text-muted">${__("nobody holds this role")}</div>`}
                        </div>`).join("");
                    holders = `
                        <div class="ps-ai-who">
                            <div class="ps-ai-who-toggle" role="button" tabindex="0">
                                <span class="ps-ai-who-caret">▸</span>
                                ${__("Who can act now")} <span class="text-muted">(${total})</span>
                            </div>
                            <div class="ps-ai-who-body" style="display:none">${names}</div>
                        </div>`;
                }

                // Who actually acted, in order. The chain can only show one name per step;
                // this is the record, and on History it is the point of expanding at all.
                let trail = "";
                const events = d.events || [];
                if (events.length) {
                    // "from → to", not a bare state: the state alone read as though it were
                    // what the person did, which credited rejections to whoever resent them.
                    const lines = events.map((ev) => `
                        <div class="ps-ai-ev">
                            <span class="ps-ai-ev-dot">✓</span>
                            <span class="ps-ai-ev-who">${esc(ev.by || ev.user || __("Unknown"))}</span>
                            ${ev.role ? `<span class="ps-ai-ev-role">${esc(ev.role)}</span>` : ""}
                            <span class="ps-ai-ev-state">${esc(ev.state || __("Draft"))}
                                <span class="ps-ai-ev-arrow">→</span>
                                <b>${esc(ev.to_state || "")}</b></span>
                            <span class="ps-ai-ev-on">${esc(ev.on || "")}</span>
                        </div>`).join("");
                    const open_by_default = !!opts.history;
                    trail = `
                        <div class="ps-ai-who ps-ai-trail">
                            <div class="ps-ai-who-toggle" role="button" tabindex="0">
                                <span class="ps-ai-who-caret">${open_by_default ? "▾" : "▸"}</span>
                                ${__("What happened, in order")} <span class="text-muted">(${events.length})</span>
                            </div>
                            <div class="ps-ai-who-body" style="display:${open_by_default ? "block" : "none"}">${lines}</div>
                        </div>`;
                }

                $life.html(`<div class="ps-ai-life-chain">${steps}</div>${trail}${holders}`);
                $life.find(".ps-ai-who-toggle").on("click keypress", function (e) {
                    if (e.type === "keypress" && e.which !== 13 && e.which !== 32) return;
                    const $b = $(this).siblings(".ps-ai-who-body");
                    $b.toggle();
                    $(this).find(".ps-ai-who-caret").text($b.is(":visible") ? "▾" : "▸");
                });
            },
            error: () => {
                $life.html(`<div class="text-muted">${__("Could not load the approval chain.")}</div>`);
            },
        });
    }

    _load_preview($container, doctype, docname) {
        frappe.call({
            method: "frappe.client.get",
            args: { doctype, name: docname },
            callback: (r) => {
                if (!r.message) {
                    $container.html(`<span class="text-muted">${__("Could not load document.")}</span>`);
                    return;
                }
                const doc  = r.message;
                const meta = frappe.get_meta(doctype);
                if (!meta) {
                    frappe.model.with_doctype(doctype, () => this._load_preview($container, doctype, docname));
                    $container.data("loaded", false);
                    return;
                }

                const SKIP_TYPES = new Set([
                    "Section Break","Column Break","HTML","Button","Tab Break",
                    "Code","JSON","Long Text","Small Text","Text","Text Editor","Signature",
                    "Attach","Attach Image","Barcode","Geolocation",
                    "Table","Table MultiSelect","Password",
                ]);
                // Noisy / technical fieldnames that clutter the preview
                const SKIP_NAMES = new Set([
                    "exchange_rate","conversion_rate","base_exchange_rate",
                    "naming_series","amended_from","amended_to",
                    "docstatus","idx","owner","modified","modified_by","creation","name",
                    "workflow_state","letter_head","select_print_heading",
                    "tc_name","terms","taxes_and_charges","shipping_rule",
                    "discount_amount","additional_discount_percentage",
                    "apply_discount_on","in_words","base_in_words",
                    "language","meta_image","status_field","source",
                    // base/system fields common across ERPNext doctypes
                    "base_grand_total","base_net_total","base_total","base_tax_withholding_net_total",
                    "outstanding_amount","debit_to","credit_to","against_expense_account",
                    "against_income_account","remarks","user_remark","instructions",
                    "total_advance","total_taxes_and_charges","total_billing_amount",
                    "update_stock","set_warehouse","set_target_warehouse",
                    "scan_barcode","barcode","image","company_address_display","customer_address",
                    "contact_display","contact_email","contact_mobile",
                    "shipping_address_name","billing_address",
                ]);

                // Priority: in_preview → bold → in_list_view → any visible field
                const candidates = meta.fields.filter((f) =>
                    !SKIP_TYPES.has(f.fieldtype) &&
                    !SKIP_NAMES.has(f.fieldname) &&
                    !f.hidden &&
                    !f.print_hide &&
                    doc[f.fieldname] != null &&
                    doc[f.fieldname] !== ""
                );
                const priority = (f) => f.in_preview ? 0 : f.bold ? 1 : f.in_list_view ? 2 : 3;
                candidates.sort((a, b) => priority(a) - priority(b));

                const _strip_html = (s) => {
                    const d = document.createElement("div");
                    d.innerHTML = s;
                    return d.textContent || d.innerText || s;
                };
                const _fmt_val = (f, val) => {
                    if (f.fieldtype === "Check")
                        return val ? __("Yes") : __("No");
                    if (f.fieldtype === "Date")
                        return frappe.datetime.str_to_user(val) || val;
                    if (f.fieldtype === "Datetime")
                        return frappe.datetime.str_to_user(val) || val;
                    if (["Currency","Float","Int","Percent"].includes(f.fieldtype))
                        return _strip_html(frappe.format(val, f) || String(val));
                    if (typeof val === "object" || Array.isArray(val))
                        return null; // skip complex objects
                    return String(val);
                };

                const rows = candidates.slice(0, 8)
                    .map((f) => {
                        const rendered = _fmt_val(f, doc[f.fieldname]);
                        if (rendered === null) return "";
                        return `<div class="ps-ai-prev-row">
                            <span class="ps-ai-prev-label">${esc(__(f.label || f.fieldname))}</span>
                            <span class="ps-ai-prev-val">${esc(rendered)}</span>
                        </div>`;
                    })
                    .filter(Boolean);

                $container.html(rows.length
                    ? `<div class="ps-ai-prev-grid">${rows.join("")}</div>`
                    : `<span class="text-muted">${__("No key fields to preview.")}</span>`
                );
            },
            error: () => $container.html(`<span class="text-muted">${__("Preview failed.")}</span>`),
        });
    }

    // ── Single action with comment dialog ─────────────────────────────────────

    _do_action(doctype, docname, action) {
        const dlg = new frappe.ui.Dialog({
            title: `${__(action)}: ${esc(docname)}`,
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "doc_info",
                    options: `<div class="ps-ai-dlg-info">
                        <strong>${__("DocType")}:</strong> ${esc(doctype)}<br>
                        <strong>${__("Document")}:</strong> ${esc(docname)}
                    </div>`,
                },
                {
                    fieldtype: "Select",
                    fieldname: "priority",
                    label: __("Priority"),
                    options: "Low\nMedium\nHigh\nCritical",
                    default: "Medium",
                },
                {
                    fieldtype: "Small Text",
                    fieldname: "comment",
                    label: __("Comment"),
                    description: __("Optional note added to the document."),
                },
            ],
            primary_action_label: __(action),
            primary_action: (vals) => {
                dlg.hide();
                frappe.dom.freeze(__("Applying — {0}…", [action]));
                frappe.call({
                    method: "permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",
                    args: { doctype, docname, action, comment: vals.comment || "", priority: vals.priority || "Medium" },
                    callback: (r) => {
                        frappe.dom.unfreeze();
                        if (r.message?.success) {
                            frappe.show_alert({ message: __("{0} — {1} applied.", [docname, action]), indicator: "green" });
                            this.load();
                        }
                    },
                    error: () => frappe.dom.unfreeze(),
                });
            },
        });
        dlg.show();
    }

    // ── Forward to ad-hoc approver ────────────────────────────────────────────

    _do_forward(action_name, docname) {
        const dlg = new frappe.ui.Dialog({
            title: __("Forward: {0}", [docname]),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "info",
                    options: `<p class="text-muted small">${__("The selected user will receive this action as an ad-hoc approver. Your action will be marked Forwarded.")}</p>`,
                },
                {
                    fieldtype: "Link",
                    fieldname: "to_user",
                    label: __("Forward To"),
                    options: "User",
                    reqd: 1,
                    filters: { enabled: 1, user_type: "System User" },
                },
                {
                    fieldtype: "Small Text",
                    fieldname: "comment",
                    label: __("Note"),
                    description: __("Optional reason for forwarding."),
                },
                {
                    fieldtype: "Check",
                    fieldname: "return_to_originator",
                    label: __("Return to me after their input"),
                    description: __("If ticked, the document comes back to you for final approval after the ad-hoc approver responds — instead of the flow advancing to the next stage."),
                },
            ],
            primary_action_label: __("Forward"),
            primary_action: (vals) => {
                if (!vals.to_user) {
                    frappe.msgprint(__("Please select a user to forward to."));
                    return;
                }
                dlg.hide();
                frappe.dom.freeze(__("Forwarding…"));
                frappe.call({
                    method: "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.forward_workflow_action",
                    args: { action_name, to_user: vals.to_user, comment: vals.comment || "", return_to_originator: vals.return_to_originator ? 1 : 0 },
                    callback: (r) => {
                        frappe.dom.unfreeze();
                        if (r.message?.adhoc_action) {
                            frappe.show_alert({ message: __("{0} forwarded successfully.", [docname]), indicator: "green" });
                            this.load();
                        }
                    },
                    error: () => frappe.dom.unfreeze(),
                });
            },
        });
        dlg.show();
    }

    // ── Return an ad-hoc action to the originator ──────────────────────────────
    _do_return(action_name, docname) {
        const dlg = new frappe.ui.Dialog({
            title: __("Return: {0}", [docname]),
            fields: [
                {
                    fieldtype: "HTML",
                    fieldname: "info",
                    options: `<p class="text-muted small">${__("Send your input back to the original approver for final approval. The workflow does not advance.")}</p>`,
                },
                {
                    fieldtype: "Small Text",
                    fieldname: "comment",
                    label: __("Comment / Recommendation"),
                },
            ],
            primary_action_label: __("Return to Originator"),
            primary_action: (vals) => {
                dlg.hide();
                frappe.dom.freeze(__("Returning…"));
                frappe.call({
                    method: "permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.return_adhoc_to_originator",
                    args: { action_name, comment: vals.comment || "" },
                    callback: (r) => {
                        frappe.dom.unfreeze();
                        if (r.message) {
                            frappe.show_alert({ message: __("Returned to the original approver."), indicator: "blue" });
                            this.load();
                        }
                    },
                    error: () => frappe.dom.unfreeze(),
                });
            },
        });
        dlg.show();
    }

    // ── Bulk action ───────────────────────────────────────────────────────────

    _bulk_action($checked_rows, group_items, action_idx) {
        const rows = $checked_rows.toArray();
        if (!rows.length) return;

        const row_actions = rows.map((row) => {
            const docname = $(row).attr("data-docname");
            const item    = group_items.find((i) => i.docname === docname);
            return {
                doctype: $(row).attr("data-doctype"),
                docname,
                action: item?.available_actions?.[action_idx] || "",
            };
        }).filter((r) => r.action);

        if (!row_actions.length) {
            frappe.show_alert({ message: __("No applicable action found."), indicator: "orange" });
            return;
        }

        frappe.confirm(
            __("Apply <b>{0}</b> to {1} document(s)?", [row_actions[0].action, row_actions.length]),
            () => {
                let done = 0, failed = 0;
                frappe.dom.freeze(__("Processing {0} documents…", [row_actions.length]));
                const process = (idx) => {
                    if (idx >= row_actions.length) {
                        frappe.dom.unfreeze();
                        frappe.show_alert({
                            message: __("{0} applied: {1} succeeded, {2} failed.", [row_actions[0].action, done, failed]),
                            indicator: failed ? "orange" : "green",
                        });
                        this.load();
                        return;
                    }
                    const { doctype, docname, action } = row_actions[idx];
                    frappe.call({
                        method: "permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",
                        args: { doctype, docname, action, comment: "" },
                        callback: () => { done++; process(idx + 1); },
                        error:    () => { failed++; process(idx + 1); },
                    });
                };
                process(0);
            }
        );
    }

    // ── Filter ────────────────────────────────────────────────────────────────

    _apply_filter() {
        const q    = this._search;
        const dt   = this._filter_doctype;
        const from = this._from_date;   // "YYYY-MM-DD" or ""
        const to   = this._to_date;     // "YYYY-MM-DD" or ""

        this.wrapper.find(".ps-ai-row").each((_, row) => {
            const $row = $(row);
            const s    = ($row.attr("data-search") || "").toLowerCase();
            const rdt  = $row.attr("data-doctype") || "";
            const ciso = $row.attr("data-creation") || "";
            const in_date = (!from || ciso >= from) && (!to || ciso <= to);
            const show = (!q || s.includes(q)) && (!dt || rdt === dt) && in_date;
            $row.toggle(show);
            // Hide preview row of hidden main rows too
            $row.next(".ps-ai-preview-row").toggle(show && $row.next(".ps-ai-preview-row").find(".ps-ai-preview-body").data("loaded"));
        });

        this.wrapper.find(".ps-ai-group").each((_, grp) => {
            const $grp   = $(grp);
            const visible = $grp.find(".ps-ai-row:visible").length;
            $grp.find(".ps-ai-grp-count").text(visible);
            $grp.toggle(visible > 0 || (!q && !dt));
        });

        const grand = this.wrapper.find(".ps-ai-row:visible").length;
        this.wrapper.find(".ps-ai-total-badge").text(grand || "").toggle(!!grand);
    }

    // ── History tab ───────────────────────────────────────────────────────────

    _render_history() {
        const $body = this.wrapper.find(".ps-ai-body");
        $body.html(`<div class="ps-loading">${__("Loading history…")}</div>`);

        // Only a System Manager may look beyond their own actions, and the server enforces
        // that too - this just decides whether the box is worth showing.
        const is_sysmgr = (frappe.user_roles || []).includes("System Manager");
        const all_users = is_sysmgr && !!this._history_all_users;

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_my_approval_history",
            // Only send a date when there is one: an empty value reaches the server as the
            // string "null", which is not a date and used to fail the whole request.
            args: Object.assign(
                { limit: 500, all_users: all_users ? 1 : 0 },
                this._from_date ? { from_date: this._from_date } : {},
                this._to_date ? { to_date: this._to_date } : {}
            ),
            callback: (r) => {
                // Kept so the search and transaction filters can repaint without refetching.
                this._history_rows = r.message || [];
                this._history_showed_all = all_users;
                this._paint_history();
            },
            error: (e) => {
                console.error("Approval history failed", e);
                $body.html(`<div class="ps-ai-empty"><p>${__("Failed to load history.")}</p>
                    <p class="text-muted small">${frappe.utils.escape_html(
                        (e && e.message) || (e && e.exc_type) || "")}</p></div>`);
            },
        });
    }

    // Filter what is already loaded. The dates are a server concern - they decide which
    // actions were fetched - but search and transaction only narrow the rows on screen, so
    // typing does not hit the database on every keystroke.
    _paint_history() {
        const $body = this.wrapper.find(".ps-ai-body");
        const is_sysmgr = (frappe.user_roles || []).includes("System Manager");
        const all_users = !!this._history_showed_all;
        const loaded = this._history_rows || [];

        // The dropdown is populated from the Pending tab, so a doctype that only appears in
        // history could not be selected. Add the missing ones rather than rebuild the list,
        // which would drop whatever Pending put there.
        const $dt = this.wrapper.find(".ps-ai-dt-filter");
        const known = new Set($dt.find("option").map((i, o) => $(o).val()).get());
        [...new Set(loaded.map((r) => r.doctype))].sort().forEach((d) => {
            if (d && !known.has(d)) $dt.append(`<option value="${esc(d)}">${esc(d)}</option>`);
        });

        const term = (this._search || "").trim().toLowerCase();
        const dt = this._filter_doctype || "";
        const rows = loaded.filter((row) => {
            if (dt && row.doctype !== dt) return false;
            if (!term) return true;
            return [row.doctype, row.docname, row.completed_by, row.submitted_by,
                    row.action_state, row.current_state, row.role]
                .filter(Boolean).join(" ").toLowerCase().includes(term);
        });

        {
                const window_note = this._from_date || this._to_date
                    ? __("Showing {0} to {1}", [this._from_date || "…", this._to_date || "…"])
                    : __("Showing the last 30 days — set the dates above for another period");

                const toggle = is_sysmgr
                    ? `<label class="ps-ai-allusers">
                           <input type="checkbox" class="ps-ai-allusers-chk" ${all_users ? "checked" : ""} />
                           ${__("All users")}
                       </label>`
                    : "";

                const bar = `<div class="ps-ai-hist-bar">
                        <span class="text-muted">${window_note}${
                            loaded.length >= 500 ? " · " + __("first 500 shown") : ""}${
                            rows.length !== loaded.length
                                ? " · " + __("{0} of {1} match the filters", [rows.length, loaded.length])
                                : ""}</span>
                        ${toggle}
                    </div>`;

                if (!rows.length) {
                    const filtered_out = loaded.length > 0;
                    $body.html(bar + `<div class="ps-ai-empty"><h4>${
                        filtered_out ? __("Nothing matches the filters.")
                            : all_users ? __("No approvals in this period.")
                            : __("No approval history yet.")
                    }</h4><p class="text-muted">${
                        filtered_out
                            ? __("{0} rows were loaded for this period. Clear the search or the transaction filter.",
                                 [loaded.length])
                            : all_users
                                ? __("Nobody completed an approval in the selected dates.")
                                : __("Actions appear here once approvals are processed on your documents.")
                    }</p></div>`);
                    $body.find(".ps-ai-allusers-chk").on("change", (e) => {
                        this._history_all_users = $(e.target).is(":checked");
                        this._render_history();
                    });
                    return;
                }
                const html = `
                    <div class="ps-ai-table-wrap">
                    <table class="ps-matrix-table ps-ai-table">
                        <thead><tr>
                            <th>${__("Date")}</th>
                            <th>${__("Transaction")}</th>
                            <th>${__("#")}</th>
                            <th>${__("Approved At State")}</th>
                            <th>${__("Current State")}</th>
                            <th>${__("Actioned By")}</th>
                            ${all_users ? `<th>${__("Submitted By")}</th>` : ""}
                            <th>${__("Via Role")}</th>
                        </tr></thead>
                        <tbody>
                        ${rows.map((row, i) => `<tr class="ps-ai-hist-row" data-idx="${i}">
                                <td class="ps-ai-hist-trigger" title="${__("Click for the full route and every approval on it")}" style="cursor:pointer">
                                    ${esc(row.date)} <span class="ps-ai-expand-icon">▸</span>
                                </td>
                                <td>${esc(row.doctype)}</td>
                                <td>
                                    <a href="${esc(row.doc_url)}" target="_blank">${esc(row.docname)}</a>
                                    ${row.event_count > 1
                                        ? `<span class="ps-ai-steps" title="${
                                            __("{0} approval steps — expand to see them", [row.event_count])
                                          }">${row.event_count}</span>`
                                        : ""}
                                </td>
                                <td><span class="ps-ai-state-badge">${esc(row.action_state || "—")}</span></td>
                                <td><span class="ps-ai-state-badge ps-ai-state-current">${esc(row.current_state || "—")}</span></td>
                                <td>${esc(row.completed_by || "—")}</td>
                                ${all_users ? `<td>${esc(row.submitted_by || "—")}</td>` : ""}
                                <td>${esc(row.role || "—")}</td>
                            </tr>
                            <tr class="ps-ai-hist-detail" data-idx="${i}" style="display:none">
                                <td colspan="${all_users ? 8 : 7}" class="ps-ai-preview-cell">
                                    <div class="ps-ai-life"></div>
                                </td>
                            </tr>`).join("")}
                        </tbody>
                    </table>
                    </div>
                `;
                $body.html(bar + html);

                $body.find(".ps-ai-allusers-chk").on("change", (e) => {
                    this._history_all_users = $(e.target).is(":checked");
                    this._render_history();
                });

                $body.find(".ps-ai-hist-trigger").on("click", (e) => {
                    const $tr = $(e.currentTarget).closest("tr");
                    const idx = $tr.data("idx");
                    const row = rows[idx];
                    const $detail = $body.find(`tr.ps-ai-hist-detail[data-idx="${idx}"]`);
                    const $icon = $tr.find(".ps-ai-expand-icon");
                    if ($detail.is(":visible")) {
                        $detail.hide();
                        $icon.text("▸");
                        return;
                    }
                    $detail.show();
                    $icon.text("▾");
                    const $life = $detail.find(".ps-ai-life");
                    if ($life.data("loaded")) return;
                    $life.data("loaded", true);
                    this._load_lifecycle($life, row, { history: true });
                });
        }
    }

    // ── Analytics tab ─────────────────────────────────────────────────────────

    _render_analytics() {
        const $body = this.wrapper.find(".ps-ai-body");
        $body.html(`<div class="ps-loading">${__("Loading analytics…")}</div>`);

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_approval_analytics",
            callback: (r) => {
                const d = r.message || {};
                const { summary, volume_by_doctype = [], longest_pending = [], top_approvers = [] } = d;
                if (!summary) {
                    $body.html(`<div class="ps-ai-empty"><h4>${__("No data yet.")}</h4></div>`);
                    return;
                }

                const summary_html = `
                    <div class="ps-ai-analytics-summary">
                        <div class="ps-ai-stat-tile ps-ai-tile-open">
                            <div class="ps-ai-tile-num">${summary.total_open}</div>
                            <div class="ps-ai-tile-label">${__("Currently Open")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-done">
                            <div class="ps-ai-tile-num">${summary.completed_last_30d}</div>
                            <div class="ps-ai-tile-label">${__("Completed (30 days)")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-overdue">
                            <div class="ps-ai-tile-num">${summary.overdue}</div>
                            <div class="ps-ai-tile-label">${__("Overdue (>30 days)")}</div>
                        </div>
                    </div>
                `;

                const volume_html = volume_by_doctype.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Volume & Avg Cycle Time (last 90 days)")}</h5>
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th>${__("DocType")}</th>
                                <th>${__("Completed")}</th>
                                <th>${__("Avg Days")}</th>
                                <th></th>
                            </tr></thead>
                            <tbody>
                            ${volume_by_doctype.map((v) => `
                                <tr>
                                    <td>${esc(v.doctype)}</td>
                                    <td>${v.count}</td>
                                    <td>${v.avg_days}</td>
                                    <td>
                                        <div class="ps-ai-bar-wrap">
                                            <div class="ps-ai-bar" style="width:${Math.min(100, v.avg_days * 5)}%"></div>
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                ` : "";

                const pending_html = longest_pending.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Longest Pending Approvals")}</h5>
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th>${__("Transaction")}</th>
                                <th>${__("#")}</th>
                                <th>${__("State")}</th>
                                <th>${__("Days Waiting")}</th>
                            </tr></thead>
                            <tbody>
                            ${longest_pending.map((a) => `
                                <tr>
                                    <td>${esc(a.doctype)}</td>
                                    <td><a href="${esc(a.doc_url)}" target="_blank">${esc(a.docname)}</a></td>
                                    <td><span class="ps-ai-state-badge">${esc(a.state)}</span></td>
                                    <td><span class="ps-ai-days-badge ${a.days > 30 ? "ps-ai-days-critical" : "ps-ai-days-warn"}">${a.days}</span></td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                ` : "";

                const approvers_html = top_approvers.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Top Approvers (last 30 days)")}</h5>
                        <div class="ps-ai-approver-list">
                        ${top_approvers.map((a, i) => `
                            <div class="ps-ai-approver-row">
                                <span class="ps-ai-approver-rank">#${i + 1}</span>
                                <span class="ps-ai-approver-name">${esc(a.name)}</span>
                                <span class="ps-ai-approver-count">${a.count} ${__("approvals")}</span>
                                <div class="ps-ai-bar-wrap">
                                    <div class="ps-ai-bar ps-ai-bar-green" style="width:${Math.min(100, (a.count / top_approvers[0].count) * 100)}%"></div>
                                </div>
                            </div>
                        `).join("")}
                        </div>
                    </div>
                ` : "";

                $body.html(`
                    <div class="ps-ai-analytics-wrap">
                        ${summary_html}
                        ${volume_html}
                        ${pending_html}
                        ${approvers_html}
                    </div>
                `);
            },
            error: () => $body.html(`<div class="ps-ai-empty"><p>${__("Failed to load analytics.")}</p></div>`),
        });
    }
}
