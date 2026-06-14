// Permission Manager — Approval Inbox Component
// Author: siva <siva@enfono.com>

import { esc } from "../utils/helpers";

const CATEGORY_META = {
    "Approval Pending":        { color: "ps-ai-grp-approval", icon: "review"  },
    "Decision Pending":        { color: "ps-ai-grp-decision", icon: "branch"  },
    "Acknowledgement Pending": { color: "ps-ai-grp-ack",      icon: "tick"    },
};

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
        });

        this.wrapper.find(".ps-ai-dt-filter").on("change", (e) => {
            this._filter_doctype = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
        });

        this.wrapper.find(".ps-ai-from-date").on("change", (e) => {
            this._from_date = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
        });

        this.wrapper.find(".ps-ai-to-date").on("change", (e) => {
            this._to_date = $(e.target).val();
            if (this._active_tab === "pending") this._apply_filter();
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
        (item.available_actions || []).forEach((act_name, idx) => {
            const cls = idx === 0 ? "btn-success" : idx === 1 ? "btn-danger" : "btn-default";
            act_html += `<button class="btn btn-xs ${cls} ps-ai-act-btn"
                data-action="${esc(act_name)}"
                data-doctype="${esc(item.doctype)}"
                data-docname="${esc(item.docname)}"
                title="${esc(act_name)}">${esc(act_name)}</button>`;
        });
        if (!act_html) act_html = `<span class="ps-ai-no-action text-muted">${__("No action")}</span>`;
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
                        : `<span class="text-muted ps-ai-holder-role">${esc(item.role_id || "—")}</span>`}
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
            this._load_preview($preview_body, item.doctype, item.docname);
        });

        $row.filter(".ps-ai-row").find(".ps-ai-act-btn").on("click", (e) => {
            const $btn = $(e.currentTarget);
            this._do_action($btn.data("doctype"), $btn.data("docname"), $btn.data("action"));
        });

        $tbody.append($row);
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

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_my_approval_history",
            args: { limit: 100 },
            callback: (r) => {
                const rows = r.message || [];
                if (!rows.length) {
                    $body.html(`<div class="ps-ai-empty"><h4>${__("No history yet.")}</h4></div>`);
                    return;
                }
                const html = `
                    <div class="ps-ai-table-wrap">
                    <table class="ps-matrix-table ps-ai-table">
                        <thead><tr>
                            <th>${__("Date")}</th>
                            <th>${__("Transaction")}</th>
                            <th>${__("#")}</th>
                            <th>${__("Final State")}</th>
                            <th>${__("Via Role")}</th>
                        </tr></thead>
                        <tbody>
                        ${rows.map((r) => `
                            <tr>
                                <td>${esc(r.date)}</td>
                                <td>${esc(r.doctype)}</td>
                                <td><a href="${esc(r.doc_url)}" target="_blank">${esc(r.docname)}</a></td>
                                <td><span class="ps-ai-state-badge">${esc(r.state)}</span></td>
                                <td>${esc(r.role)}</td>
                            </tr>
                        `).join("")}
                        </tbody>
                    </table>
                    </div>
                `;
                $body.html(html);
            },
            error: () => $body.html(`<div class="ps-ai-empty"><p>${__("Failed to load history.")}</p></div>`),
        });
    }

    // ── Analytics tab ─────────────────────────────────────────────────────────

    _render_analytics() {
        const $body = this.wrapper.find(".ps-ai-body");
        $body.html(`<div class="ps-loading">${__("Loading analytics…")}</div>`);

        frappe.call({
            method: "permission_manager.permission_manager.api.approvals.get_approval_analytics",
            callback: (r) => {
                const d = r.message || {};
                if (!d.summary) {
                    $body.html(`<div class="ps-ai-empty"><h4>${__("No data yet.")}</h4></div>`);
                    return;
                }

                const { summary, volume_by_doctype, longest_pending, top_approvers } = d;

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
