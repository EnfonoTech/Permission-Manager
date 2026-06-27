frappe.ui.form.on("PM Workflow", {
    refresh(frm) {
        frm.add_custom_button(__("View Diagram"), () => {
            if (!frm.doc.name || frm.doc.__islocal) {
                frappe.msgprint(__("Save the workflow before viewing the diagram."));
                return;
            }
            const diag = new window.permission_manager_studio.WorkflowDiagram({
                wrapper: $("<div>"),
                workflow_name: frm.doc.name,
            });
            diag.show_dialog();
        }, __("Actions"));

        frm.add_custom_button(__("Generate from Requirement"), () => {
            _show_generate_dialog(frm);
        }, __("Actions"));
    },
});

// ── AI Workflow Generator ─────────────────────────────────────────────────────

function _show_generate_dialog(frm) {
    const dlg = new frappe.ui.Dialog({
        title: __("Generate Workflow from Requirement"),
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "intro",
                options: `<div class="alert alert-info" style="margin-bottom:12px;">
                    <strong>${__("AI Workflow Generator")}</strong><br>
                    ${__("Describe your approval requirement in plain English. The AI will generate the workflow states and transitions automatically.")}
                    <br><span class="text-muted small">${__("Provider and API key are configured in PM Settings.")}</span>
                </div>`,
            },
            {
                fieldtype: "Small Text",
                fieldname: "requirement",
                label: __("Requirement"),
                reqd: 1,
                description: __("Example: Stock Entry Material Transfer needs to be accepted by the person at the target warehouse before it is submitted. On reject, it should go back to the creator."),
            },
        ],
        primary_action_label: __("Generate"),
        primary_action(vals) {
            if (!vals.requirement) {
                frappe.msgprint(__("Please describe the workflow requirement."));
                return;
            }
            dlg.hide();
            frappe.dom.freeze(__("Generating workflow…"));

            frappe.call({
                method: "permission_manager.permission_manager.api.generate.generate_workflow_from_requirement",
                args: { requirement: vals.requirement },
                callback(r) {
                    frappe.dom.unfreeze();
                    if (!r.message) return;
                    _show_preview_dialog(frm, r.message);
                },
                error() {
                    frappe.dom.unfreeze();
                },
            });
        },
    });
    dlg.show();
}

function _show_preview_dialog(frm, config) {
    const e  = frappe.utils.escape_html;
    const tk = (v) => v ? `<span style="color:#28a745;font-weight:600">✓</span>`
                        : `<span style="color:#ccc">—</span>`;

    const status_badge = (s) => {
        const map = { "1": ["#d4edda","#155724","Submitted"],
                      "2": ["#f8d7da","#721c24","Cancelled"],
                      "0": ["#fff3cd","#856404","Draft"] };
        const [bg, fg, label] = map[s] || map["0"];
        return `<span style="background:${bg};color:${fg};padding:1px 6px;border-radius:3px;font-size:11px;white-space:nowrap">${label}</span>`;
    };

    const approver_cell = (t) => {
        if (t.use_approver_matrix) {
            const lvl  = t.matrix_level || 1;
            const fall = t.matrix_fallback_role
                ? `<div style="font-size:10px;color:#666;margin-top:2px">Fallback: ${e(t.matrix_fallback_role)}</div>` : "";
            return `<span style="background:#e8f4fd;color:#0c5fa5;padding:1px 5px;border-radius:3px;font-size:11px">Matrix L${lvl}</span>${fall}`;
        }
        const type  = t.approver_type || "Role";
        const color = type === "Role" ? "#e9f5eb" : "#f0e9fa";
        const fg    = type === "Role" ? "#1a6b2e" : "#5a1a8a";
        return `<span style="background:${color};color:${fg};padding:1px 5px;border-radius:3px;font-size:11px">${e(type)}</span>
                <div style="font-size:11px;margin-top:2px">${e(t.allowed || "—")}</div>`;
    };

    const states_rows = (config.states || []).map((s) => `
        <tr>
            <td style="font-weight:500">${e(s.state)}</td>
            <td style="text-align:center">${status_badge(String(s.doc_status ?? "0"))}</td>
            <td>
                ${s.edit_permission_type
                    ? `<span style="font-size:10px;color:#888">${e(s.edit_permission_type)}</span>&nbsp;`
                    : ""}
                <span style="font-size:12px">${e(s.allow_edit || "—")}</span>
            </td>
            <td style="text-align:center">${tk(s.is_optional_state)}</td>
            <td style="text-align:center">${tk(s.send_email)}</td>
        </tr>`).join("");

    const trans_rows = (config.transitions || []).map((t) => `
        <tr ${t.is_return_for_correction ? 'style="background:#fff8f8"' : ""}>
            <td style="font-size:12px;color:#555">${e(t.state)}</td>
            <td style="font-weight:600;white-space:nowrap">${e(t.action)}</td>
            <td style="font-size:12px;color:#555">${e(t.next_state)}</td>
            <td>${approver_cell(t)}</td>
            <td style="text-align:center">${tk(t.allow_self_approval)}</td>
            <td style="text-align:center">${tk(t.require_comment)}</td>
            <td style="text-align:center">${tk(t.is_return_for_correction)}</td>
            <td style="font-size:10px;color:#555;font-family:monospace;max-width:160px;word-break:break-all">
                ${t.condition ? e(t.condition) : '<span style="color:#ccc">—</span>'}
            </td>
        </tr>`).join("");

    const th = (label, title="") =>
        `<th style="background:#f7f7f7;font-size:11px;padding:5px 8px;white-space:nowrap;border:1px solid #e0e0e0"
             ${title ? `title="${e(title)}"` : ""}>${label}</th>`;

    const td_style = `style="padding:5px 8px;border:1px solid #e8e8e8;vertical-align:middle"`;

    const preview_html = `
        <style>
            .pmg-section { margin-bottom:16px }
            .pmg-title   { font-size:12px;font-weight:600;color:#6c757d;text-transform:uppercase;
                           letter-spacing:.5px;margin-bottom:6px;padding-bottom:4px;
                           border-bottom:2px solid #e9ecef }
            .pmg-wrap    { overflow-x:auto }
            .pmg-tbl     { width:100%;border-collapse:collapse;font-size:12px }
            .pmg-tbl td  { padding:5px 8px;border:1px solid #e8e8e8;vertical-align:middle }
            .pmg-tbl tr:hover td { background:#fafafa }
        </style>

        <div class="pmg-section">
            <div class="pmg-title">States</div>
            <div class="pmg-wrap">
                <table class="pmg-tbl">
                    <thead><tr>
                        ${th("State")} ${th("Doc Status")} ${th("Edit Permission For")}
                        ${th("Opt","Is Optional State")} ${th("Email","Send Email on State")}
                    </tr></thead>
                    <tbody>${states_rows}</tbody>
                </table>
            </div>
        </div>

        <div class="pmg-section">
            <div class="pmg-title">Transitions</div>
            <div class="pmg-wrap">
                <table class="pmg-tbl">
                    <thead><tr>
                        ${th("From")} ${th("Action")} ${th("To")}
                        ${th("Approver / Matrix")}
                        ${th("Self","Allow Self Approval")}
                        ${th("Cmt","Require Comment")}
                        ${th("↩","Return for Correction")}
                        ${th("Condition")}
                    </tr></thead>
                    <tbody>${trans_rows}</tbody>
                </table>
            </div>
        </div>
    `;

    const preview_dlg = new frappe.ui.Dialog({
        title: __("Preview — {0}", [config.suggested_workflow_name || "Generated Workflow"]),
        size: "extra-large",
        fields: [
            { fieldtype: "HTML", fieldname: "preview", options: preview_html },
        ],
        primary_action_label: __("Apply to Form"),
        secondary_action_label: __("Back"),
        secondary_action() {
            preview_dlg.hide();
            _show_generate_dialog(frm);
        },
        primary_action() {
            preview_dlg.hide();
            frappe.dom.freeze(__("Creating Workflow States and Actions…"));

            frappe.call({
                method: "permission_manager.permission_manager.api.generate.create_workflow_from_config",
                args: { config: JSON.stringify(config) },
                callback(r) {
                    frappe.dom.unfreeze();
                    if (!r.message) return;

                    const { created_states, created_actions } = r.message;
                    _fill_form(frm, config);

                    let msg = __("Workflow configuration applied to the form.");
                    if (created_states.length)
                        msg += `<br>${__("Created States:")} <strong>${created_states.join(", ")}</strong>`;
                    if (created_actions.length)
                        msg += `<br>${__("Created Actions:")} <strong>${created_actions.join(", ")}</strong>`;
                    msg += `<br><br>${__("Review and save when ready.")}`;

                    frappe.msgprint({ title: __("Done"), message: msg, indicator: "green" });
                },
                error() { frappe.dom.unfreeze(); },
            });
        },
    });
    preview_dlg.show();
}

function _fill_form(frm, config) {
    if (config.suggested_workflow_name && !frm.doc.workflow_name)
        frm.set_value("workflow_name", config.suggested_workflow_name);

    if (config.document_type && !frm.doc.document_type)
        frm.set_value("document_type", config.document_type);

    // Clear existing child rows
    frm.set_value("states", []);
    frm.set_value("transitions", []);

    (config.states || []).forEach((s) => {
        const row = frm.add_child("states");
        row.state               = s.state;
        row.doc_status          = s.doc_status || "0";
        row.edit_permission_type = s.edit_permission_type || "Role";
        row.allow_edit          = s.allow_edit || "";
        row.is_optional_state   = s.is_optional_state ? 1 : 0;
        row.send_email          = s.send_email ? 1 : 0;
    });

    (config.transitions || []).forEach((t) => {
        const row = frm.add_child("transitions");
        row.state                    = t.state;
        row.action                   = t.action;
        row.next_state               = t.next_state;
        row.use_approver_matrix      = t.use_approver_matrix ? 1 : 0;
        row.matrix_level             = t.matrix_level || (t.use_approver_matrix ? 1 : null);
        row.matrix_fallback_role     = t.matrix_fallback_role || "";
        row.approver_type            = t.use_approver_matrix ? "" : (t.approver_type || "Role");
        row.allowed                  = t.use_approver_matrix ? "" : (t.allowed || "");
        row.condition                = t.condition || "";
        row.is_return_for_correction = t.is_return_for_correction ? 1 : 0;
        row.allow_self_approval      = t.allow_self_approval ? 1 : 0;
        row.require_comment          = t.require_comment ? 1 : 0;
    });

    frm.refresh_field("states");
    frm.refresh_field("transitions");
}
