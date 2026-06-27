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
                </div>`,
            },
            {
                fieldtype: "Small Text",
                fieldname: "requirement",
                label: __("Requirement"),
                reqd: 1,
                description: __("Example: Stock Entry Material Transfer needs to be accepted by the person at the target warehouse before it is submitted. On reject, it should go back to the creator."),
            },
            {
                fieldtype: "Select",
                fieldname: "provider",
                label: __("AI Provider"),
                options: "Claude (Anthropic)\nDeepClaude",
                default: "Claude (Anthropic)",
            },
            {
                fieldtype: "Password",
                fieldname: "claude_api_key",
                label: __("Claude API Key (optional)"),
                description: __("Leave blank to use the key saved in PM Settings."),
                depends_on: "eval: doc.provider === 'Claude (Anthropic)'",
            },
            {
                fieldtype: "Password",
                fieldname: "deepclaude_api_key",
                label: __("DeepClaude API Key (optional)"),
                description: __("Leave blank to use the key saved in PM Settings."),
                depends_on: "eval: doc.provider === 'DeepClaude'",
            },
        ],
        primary_action_label: __("Generate"),
        primary_action(vals) {
            if (!vals.requirement) {
                frappe.msgprint(__("Please describe the workflow requirement."));
                return;
            }

            const is_deepclaude = vals.provider === "DeepClaude";
            const provider      = is_deepclaude ? "deepclaude" : "claude";
            const api_key       = is_deepclaude
                ? (vals.deepclaude_api_key || "")
                : (vals.claude_api_key || "");
            const label         = is_deepclaude ? "DeepClaude" : "Claude";

            dlg.hide();
            frappe.dom.freeze(__("Asking {0} to generate the workflow…", [label]));

            frappe.call({
                method: "permission_manager.permission_manager.api.generate.generate_workflow_from_requirement",
                args: { requirement: vals.requirement, provider, api_key },
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
    const states_html = (config.states || []).map((s) =>
        `<tr>
            <td>${frappe.utils.escape_html(s.state)}</td>
            <td>${s.doc_status === "1" ? "Submitted" : s.doc_status === "2" ? "Cancelled" : "Draft"}</td>
            <td>${frappe.utils.escape_html(s.allow_edit || "")}</td>
        </tr>`
    ).join("");

    const trans_html = (config.transitions || []).map((t) =>
        `<tr>
            <td>${frappe.utils.escape_html(t.state)}</td>
            <td><strong>${frappe.utils.escape_html(t.action)}</strong></td>
            <td>${frappe.utils.escape_html(t.next_state)}</td>
            <td>${frappe.utils.escape_html(t.allowed || "")}</td>
            <td class="text-muted small">${frappe.utils.escape_html(t.condition || "—")}</td>
        </tr>`
    ).join("");

    const preview_html = `
        <h6>${__("States")}</h6>
        <table class="table table-bordered table-sm" style="font-size:12px">
            <thead><tr>
                <th>${__("State")}</th><th>${__("Doc Status")}</th><th>${__("Edit For")}</th>
            </tr></thead>
            <tbody>${states_html}</tbody>
        </table>
        <h6 style="margin-top:12px">${__("Transitions")}</h6>
        <table class="table table-bordered table-sm" style="font-size:12px">
            <thead><tr>
                <th>${__("From")}</th><th>${__("Action")}</th><th>${__("To")}</th>
                <th>${__("Approver")}</th><th>${__("Condition")}</th>
            </tr></thead>
            <tbody>${trans_html}</tbody>
        </table>
    `;

    const preview_dlg = new frappe.ui.Dialog({
        title: __("Preview: {0}", [config.suggested_workflow_name || "Generated Workflow"]),
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "preview",
                options: preview_html,
            },
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
                        msg += `<br>${__("Created Workflow States:")} <strong>${created_states.join(", ")}</strong>`;
                    if (created_actions.length)
                        msg += `<br>${__("Created Workflow Actions:")} <strong>${created_actions.join(", ")}</strong>`;
                    msg += `<br><br>${__("Review the form and save when ready.")}`;

                    frappe.msgprint({ title: __("Done"), message: msg, indicator: "green" });
                },
                error() {
                    frappe.dom.unfreeze();
                },
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
        row.approver_type            = t.approver_type || "Role";
        row.allowed                  = t.allowed || "";
        row.condition                = t.condition || "";
        row.is_return_for_correction = t.is_return_for_correction ? 1 : 0;
        row.allow_self_approval      = t.allow_self_approval ? 1 : 0;
        row.require_comment          = t.require_comment ? 1 : 0;
    });

    frm.refresh_field("states");
    frm.refresh_field("transitions");
}
