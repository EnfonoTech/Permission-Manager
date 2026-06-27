// Permission Manager — PM Workflow UI Engine
// Author: siva <siva@enfono.com>
//
// Features:
//   - Injects workflow action buttons on any form with an active PM Workflow
//   - Shows who the current pending approver is (Employee Approver Matrix routing)
//   - Lets System Managers / HR Managers reassign the pending approver

$(document).on("form-refresh", function (event, frm) {
	if (!frm || !frm.doctype) return;
	if (frm.doc.__islocal) return;

	try {
		frappe.call({
			method: "permission_manager.permission_manager.workflow.get_workflow_info",
			args: { doc: frm.doc },
			callback(res) {
				if (!res?.message?.workflow && !res?.message?.current_state) return;

				const workflow = res.message.workflow;
				const workflow_name = res.message.workflow.name;
				const current_state = res.message.current_state;

				if (!res.message.allow_edit) {
					frm.set_read_only(true);
				}

				if (workflow_name) {
					frm.page.clear_primary_action();
					if (!workflow.override_status) {
						_override_document_status(frm, current_state, workflow.workflow_state_field);
					}
					_load_allowed_transitions(frm, workflow, current_state);
					_load_pending_approver_info(frm);
				}
			},
		});
	} catch (err) {
		console.error("Permission Manager: Error initialising PM Workflow:", err);
	}
});

// ─── Mandatory field check (Frappe v13 compat + v14/v15 fallback) ─────────────

function _check_mandatory(frm) {
	const skip_types = ["Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Fold", "Button"];
	const skip_fields = ["name", "owner", "modified_by", "creation", "modified", "docstatus", "idx"];
	const missing = [];

	(frm.fields || []).forEach((f) => {
		const df = f && f.df;
		if (!df || !df.reqd) return;
		if (skip_types.includes(df.fieldtype)) return;
		if (skip_fields.includes(df.fieldname)) return;
		if (df.hidden || df.read_only) return;
		// Skip fields whose display status is None (hidden by depends_on)
		if (f.disp_status === "None") return;

		const val = frm.doc[df.fieldname];
		if (val === undefined || val === null || val === "") {
			missing.push(__(df.label || df.fieldname));
		}
	});

	if (missing.length) {
		frappe.msgprint({
			title: __("Mandatory Fields Required"),
			message:
				__("Please fill in the following required fields:") +
				"<br><ul><li>" + missing.join("</li><li>") + "</li></ul>",
			indicator: "red",
		});
		return false;
	}
	return true;
}

// ─── Load transitions ─────────────────────────────────────────────────────────

function _load_allowed_transitions(frm, workflow, current_state) {
	frappe.call({
		method: "permission_manager.permission_manager.workflow.get_transitions",
		args: { doc: frm.doc, workflow: workflow.name, current_state: current_state },
		callback(r) {
			const transitions = r.message || [];
			frm.page.clear_actions_menu();
			if (!transitions.length) return;

			transitions.forEach((t) => {
				frm.page.add_action_item(__(t.action), function () {
					frm.selected_workflow_action = t.action;
					if (!_check_mandatory(frm)) return;
					_open_comment_dialog(frm, t);
				});
			});

			_add_workflow_help_action(frm, transitions, current_state);
		},
	});
}

// ─── Pending approver info + reassign ────────────────────────────────────────

function _load_pending_approver_info(frm) {
	if (frm.doc.docstatus !== 0) return;

	frappe.call({
		method: "permission_manager.permission_manager.workflow.get_pending_workflow_action",
		args: { doctype: frm.doctype, docname: frm.doc.name },
		callback(r) {
			const action = r.message;
			if (!action) return;

			const assigned_to   = action.assigned_to;
			const assigned_name = action.assigned_to_name || (assigned_to || "").split("@")[0];
			const pending_roles = action.pending_roles || [];

			// Prefer the resolved user name; fall back to the role name(s) for role-based routing.
			const display_name = assigned_name || pending_roles.join(", ");

			if (display_name) {
				if (!frm.$wrapper.find(".pm-approver-info").length) {
					const $info = $(`
						<div class="pm-approver-info">
							${frappe.utils.icon("users", "xs")}
							<span>${__("Pending approval from:")}</span>
							<strong class="pm-approver-name">${frappe.utils.escape_html(display_name)}</strong>
						</div>
					`);
					frm.$wrapper.find(".page-head").after($info);
				} else {
					frm.$wrapper.find(".pm-approver-name").text(display_name);
				}
			}

			// Show Reassign button only to System Managers / HR Managers
			// frappe.user.has_role() is synchronous — returns true or undefined
			if (frappe.user.has_role(["System Manager", "HR Manager"])) {
				frm.remove_custom_button(__("Reassign Approver"));
				frm.add_custom_button(__("Reassign Approver"), () => {
					_show_reassign_dialog(frm, action);
				}, __("Workflow"));
			}
		},
	});
}

function _show_reassign_dialog(frm, current_action) {
	const dlg = new frappe.ui.Dialog({
		title: __("Reassign Approver"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "current_info",
				options: current_action.assigned_to
					? `<div class="pm-reassign-current">
						<strong>${__("Current Approver")}:</strong>
						${frappe.utils.escape_html(current_action.assigned_to_name || current_action.assigned_to)}
					   </div>`
					: `<div class="pm-reassign-current">${__("Currently routed by role (no specific user assigned).")}</div>`,
			},
			{
				fieldtype: "Link",
				fieldname: "new_approver",
				label: __("Reassign To"),
				options: "User",
				reqd: 1,
				filters: { enabled: 1 },
				description: __("This user will receive the pending approval notification."),
			},
			{
				fieldtype: "Small Text",
				fieldname: "reason",
				label: __("Reason"),
				description: __("Optional. Added as a comment on the document."),
			},
		],
		primary_action_label: __("Reassign"),
		primary_action(vals) {
			dlg.hide();
			frappe.call({
				method: "permission_manager.permission_manager.workflow.reassign_workflow_approver",
				args: {
					doctype: frm.doctype,
					docname: frm.doc.name,
					new_approver: vals.new_approver,
					reason: vals.reason || "",
				},
				callback(r) {
					if (r.message?.success) {
						frappe.show_alert({
							message: __("Approver reassigned to {0}.", [vals.new_approver]),
							indicator: "green",
						});
						frm.reload_doc();
					}
				},
			});
		},
	});
	dlg.show();
}

// ─── Workflow help menu item ──────────────────────────────────────────────────

function _add_workflow_help_action(frm, transitions, current_state) {
	try {
		frm.page.add_action_item(__("Workflow Help"), function () {
			const state = current_state || __("Unknown");
			const next_actions = transitions.length
				? transitions.map((d) => `${d.action.bold()} (${d.allowed || __("matrix")})`).join(", ")
				: __("None — End of Workflow").bold();

			new frappe.ui.Dialog({
				title: __("Workflow: {0}", [frm.doctype]),
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "info",
						options: `
							<p>${__("Current status")}: ${state.bold()}</p>
							<p>${__("Next actions")}: ${next_actions}</p>
							<p>${__("Only authorised users can perform these transitions.")}</p>
						`,
					},
				],
			}).show();
		});
	} catch (err) {
		console.warn("Permission Manager: Failed to add Workflow Help action:", err);
	}
}

// ─── Document status indicator ────────────────────────────────────────────────

function _override_document_status(frm, current_state, workflow_state_field) {
	try {
		const doc = frm.doc;
		const doctype = frm.doctype;
		if (!doc || !doctype) return;
		const meta = frappe.get_meta(doctype);
		const is_submittable = meta?.is_submittable;

		if (doc.__unsaved) {
			frm.page.set_indicator?.(__("Not Saved"), "orange");
			return;
		}

		if (current_state) {
			frappe.call({
				method: "frappe.client.get_value",
				args: { doctype: "Workflow State", fieldname: "style", filters: { name: current_state } },
				callback(r) {
					const color_map = {
						Success: "green", Warning: "orange", Danger: "red",
						Primary: "blue", Inverse: "black", Info: "light-blue",
					};
					const color = color_map[r?.message?.style] || "gray";
					frm.page.set_indicator?.(__(current_state), color, `${workflow_state_field},=,${current_state}`);
				},
			});
			return;
		}

		if (is_submittable) {
			const m = { 0: ["Draft", "red"], 1: ["Submitted", "blue"], 2: ["Cancelled", "red"] };
			const [label, color] = m[doc.docstatus] || ["Unknown", "gray"];
			frm.page.set_indicator?.(__(label), color, `docstatus,=,${doc.docstatus}`);
		}
	} catch (err) {
		console.warn("Permission Manager: Failed to override document status:", err);
	}
}

// ─── Comment dialog before applying transition ───────────────────────────────

function _open_comment_dialog(frm, transition) {
	const require_comment = !!transition.require_comment;

	const d = new frappe.ui.Dialog({
		title: __("Workflow Action: {0}", [transition.action]),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "priority",
				label: __("Priority"),
				options: ["Low", "Medium", "High", "Critical"].join("\n"),
				default: "Medium",
			},
			{
				fieldtype: "Small Text",
				fieldname: "comment",
				label: __("Comment"),
				reqd: require_comment,
				description: require_comment
					? __("A comment is required for this transition.")
					: __("Optional"),
			},
		],
		primary_action_label: __("Apply"),
		primary_action(values) {
			if (require_comment && !values.comment) {
				frappe.msgprint(__("Comment is required."));
				return;
			}
			d.hide();
			_apply_workflow_with_comment(frm, transition.action, values.comment, values.priority);
		},
	});

	d.show();
}

function _apply_workflow_with_comment(frm, action, comment, priority) {
	frappe.dom.freeze();
	frappe
		.xcall("permission_manager.permission_manager.workflow.apply_workflow", {
			doc: frm.doc,
			action: action,
			comment: comment,
			priority: priority || "Medium",
		})
		.then((doc) => {
			frappe.model.sync(doc);
			frm.refresh();
			frappe.show_alert({
				message: __("Workflow action applied: {0}", [action]),
				indicator: "green",
			});
		})
		.finally(() => frappe.dom.unfreeze());
}
