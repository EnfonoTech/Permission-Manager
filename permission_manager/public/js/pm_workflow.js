// Permission Manager — PM Workflow UI Engine
// Author: siva <siva@enfono.com>
//
// Features:
//   - Injects workflow action buttons on any form with an active PM Workflow
//   - Shows who the current pending approver is (Employee Approver Matrix routing)
//   - Lets System Managers / HR Managers reassign the pending approver

// Take away the native Submit button on a document an approval workflow governs — the
// approval buttons are the only legitimate way forward, and a visible Submit invites people
// to post the document past its own chain. The server refuses such a submit as well; this is
// so nobody is offered a button that will only refuse them.
//
// Two traps this has to survive:
//   * Frappe re-adds Submit every time the form re-renders (a save, for instance), and the
//     workflow lookup below is asynchronous — clearing once inside the callback loses the
//     race, which is why the flag is remembered and re-applied on every later refresh.
//   * clear_primary_action() removes whatever the primary button currently is. On a dirty
//     form that is SAVE, so clearing unconditionally would leave the user unable to save.

// Doctypes seen to be governed by a workflow in this tab. The per-document flag is cleared on
// every navigation (below), so without this memo the native Submit would flash back on screen
// for one round trip each time you open another document of a doctype already known to route.
// If the answer then says this particular document is not governed, _pm_restore_native puts the
// button back.
const _pm_governed_doctypes = new Set();

function _pm_hide_native_submit(frm) {
	if (!frm.__pm_has_workflow && !_pm_governed_doctypes.has(frm.doctype)) return;
	if (frm.doc.docstatus !== 0) return;
	if (frm.is_dirty && frm.is_dirty()) return; // primary action is Save — leave it alone
	frm.page.clear_primary_action();
	frm.__pm_cleared_primary = true;
}

// Frappe keeps ONE form object per doctype and re-points it at each document you open, while
// every lookup below is asynchronous. Without a stamp, the answer for the invoice you just
// left arrives after the next one has rendered and writes its buttons, its approver banner and
// its indicator onto the document now on screen — which is why approved invoices showed action
// items that disappeared on a hard refresh, and why drafts only got theirs after one.
//
// Every refresh takes a ticket. A response is applied only while it is still the current one
// AND still describes the document on screen.
function _pm_ticket(frm) {
	frm.__pm_seq = (frm.__pm_seq || 0) + 1;
	return { seq: frm.__pm_seq, docname: frm.doc.name };
}

function _pm_is_current(frm, ticket) {
	return !!ticket && ticket.seq === frm.__pm_seq && ticket.docname === frm.doc.name;
}

// Everything this file puts on the form, taken back off in one place. Anything added above has
// to be removed here too, or it survives into the next document.
function _pm_teardown(frm) {
	frm.__pm_has_workflow = false;
	frm._pm_transitions = [];
	frm.page.clear_actions_menu();
	frm.$wrapper.find(".pm-approver-info").remove();
	frm.remove_custom_button(__("Reassign Approver"), __("Workflow"));
	frm.remove_custom_button(__("Reassign Approver"));
}

// No workflow governs this document, so give the toolbar back to Frappe — otherwise a document
// we suppressed Submit on earlier keeps a toolbar with no way forward at all.
function _pm_restore_native(frm) {
	if (!frm.__pm_cleared_primary) return;
	frm.__pm_cleared_primary = false;
	try {
		frm.toolbar && frm.toolbar.set_primary_action && frm.toolbar.set_primary_action();
	} catch (err) {
		console.warn("Permission Manager: could not restore the native primary action:", err);
	}
}

$(document).on("form-refresh", function (event, frm) {
	if (!frm || !frm.doctype) return;
	if (frm.doc.__islocal) return;

	// A different document on the same reused form object: strip the previous one's buttons
	// before anything is fetched. On a refresh of the SAME document the existing items are left
	// in place until the fresh answer arrives, so saving does not make them blink.
	if (frm.__pm_last_docname !== frm.doc.name) {
		_pm_teardown(frm);
		frm.__pm_cleared_primary = false;
	}
	frm.__pm_last_docname = frm.doc.name;

	const ticket = _pm_ticket(frm);

	// already known to be under a workflow: clear now, before the round-trip below, and once
	// more on the next tick in case Frappe re-renders the toolbar after this handler
	_pm_hide_native_submit(frm);
	setTimeout(() => _pm_hide_native_submit(frm), 0);

	try {
		frappe.call({
			method: "permission_manager.permission_manager.workflow.get_workflow_info",
			args: { doc: frm.doc },
			callback(res) {
				if (!_pm_is_current(frm, ticket)) return;

				const workflow = res?.message?.workflow;
				const workflow_name = workflow?.name;
				const current_state = res?.message?.current_state;

				// Nothing routes this document — most often a submitted one whose state no
				// longer matches its docstatus. Clear ours out rather than leaving the last
				// document's approval furniture standing on it.
				if (!workflow_name) {
					_pm_teardown(frm);
					_pm_restore_native(frm);
					return;
				}

				if (!res.message.allow_edit) {
					frm.set_read_only(true);
				}

				frm.__pm_has_workflow = true;
				_pm_governed_doctypes.add(frm.doctype);
				_pm_hide_native_submit(frm);
				setTimeout(() => _pm_hide_native_submit(frm), 0);
				if (!workflow.override_status) {
					_override_document_status(frm, current_state, workflow.workflow_state_field, ticket);
				}
				// The server sends the transitions with the workflow now; the separate lookup
				// stays as a fallback so an older bundle and a newer server still agree.
				if (Array.isArray(res.message.transitions)) {
					_apply_transitions(frm, res.message.transitions, current_state, ticket);
				} else {
					_load_allowed_transitions(frm, workflow, current_state, ticket);
				}
				_load_pending_approver_info(frm, ticket);
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

function _load_allowed_transitions(frm, workflow, current_state, ticket) {
	frappe.call({
		method: "permission_manager.permission_manager.workflow.get_transitions",
		args: { doc: frm.doc, workflow: workflow.name, current_state: current_state },
		callback(r) {
			if (!_pm_is_current(frm, ticket)) return;
			_apply_transitions(frm, r.message || [], current_state, ticket);
		},
	});
}

function _apply_transitions(frm, transitions, current_state, ticket) {
	if (!_pm_is_current(frm, ticket)) return;

	frm.page.clear_actions_menu();
	frm._pm_transitions = transitions;
	if (!transitions.length) return;

	transitions.forEach((t) => {
		frm.page.add_action_item(__(t.action), function () {
			frm.selected_workflow_action = t.action;
			if (!_check_mandatory(frm)) return;
			_open_comment_dialog(frm, t);
		});
	});

	// Nudge the user to act after they attach a supporting file
	_pm_hook_attachment_announcement(frm);

	_add_workflow_help_action(frm, transitions, current_state);
}

// ─── Pending approver info + reassign ────────────────────────────────────────

function _load_pending_approver_info(frm, ticket) {
	// A submitted or cancelled document has nobody pending on it. Take the banner down rather
	// than returning early — it is the reason an approved invoice still read
	// "Pending approval from: Purchase User" until the page was reloaded.
	if (frm.doc.docstatus !== 0) {
		frm.$wrapper.find(".pm-approver-info").remove();
		frm.remove_custom_button(__("Reassign Approver"), __("Workflow"));
		return;
	}

	frappe.call({
		method: "permission_manager.permission_manager.workflow.get_pending_workflow_action",
		args: { doctype: frm.doctype, docname: frm.doc.name },
		callback(r) {
			if (!_pm_is_current(frm, ticket)) return;

			const action = r.message;
			if (!action) {
				frm.$wrapper.find(".pm-approver-info").remove();
				frm.remove_custom_button(__("Reassign Approver"), __("Workflow"));
				return;
			}

			const assigned_to   = action.assigned_to;
			const assigned_name = action.assigned_to_name || (assigned_to || "").split("@")[0];
			const pending_roles = action.pending_roles || [];

			// Show role(s) when the workflow is role-based; fall back to user name for direct assignments.
			const display_name = pending_roles.length ? pending_roles.join(", ") : assigned_name;

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

const _PM_STATE_COLOURS = {
	Success: "green", Warning: "orange", Danger: "red",
	Primary: "blue", Inverse: "black", Info: "light-blue",
};

// Workflow State styles never change while a tab is open, so look each one up once instead of
// on every form refresh — one fewer round trip in the window where the toolbar is unsettled.
const _pm_state_style_cache = {};

function _override_document_status(frm, current_state, workflow_state_field, ticket) {
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
			const paint = (style) => {
				if (!_pm_is_current(frm, ticket)) return;
				const color = _PM_STATE_COLOURS[style] || "gray";
				frm.page.set_indicator?.(__(current_state), color, `${workflow_state_field},=,${current_state}`);
			};

			if (Object.prototype.hasOwnProperty.call(_pm_state_style_cache, current_state)) {
				paint(_pm_state_style_cache[current_state]);
				return;
			}

			frappe.call({
				method: "frappe.client.get_value",
				args: { doctype: "Workflow State", fieldname: "style", filters: { name: current_state } },
				callback(r) {
					const style = r?.message?.style || null;
					_pm_state_style_cache[current_state] = style;
					paint(style);
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
	frappe.call({
		method: "permission_manager.permission_manager.workflow.apply_workflow",
		args: {
			doc: frm.doc,
			action: action,
			comment: comment || "",
			priority: priority || "Medium",
		},
		callback(r) {
			frappe.dom.unfreeze();
			frm._pm_pending_action = null;
			frm.dashboard.clear_headline();
			frappe.model.sync(r.message);
			frm.refresh();
			frappe.show_alert({
				message: __("Workflow action applied: {0}", [action]),
				indicator: "green",
			});
		},
		error(xhr) {
			frappe.dom.unfreeze();
			if (_pm_is_attachment_error(xhr)) {
				frm._pm_pending_action = { action, comment, priority };
				_pm_hook_attachment_announcement(frm);
			}
			// Always show the original server error message
			frappe.request.report_error(xhr, {});
		},
	});
}

// Detect whether the server rejected with an attachment-mandatory error.
function _pm_is_attachment_error(xhr) {
	try {
		const resp = JSON.parse(xhr.responseText || "{}");
		const msgs = JSON.parse(resp._server_messages || "[]");
		return msgs.some(function (m) {
			const text = typeof m === "string" ? m : (m.message || "");
			return text.toLowerCase().includes("attachment");
		});
	} catch (_) {
		return false;
	}
}

// Install a one-time hook on the form's attachment-upload event. After a file
// is uploaded we surface an announcement so the user doesn't forget to click
// the workflow action. Used both proactively (whenever transitions are
// available) and reactively (after a "require attachment" block).
//
// The "already hooked" flag lives on the attachments object — not on frm —
// because render_form() recreates frm.attachments on every re-render, which
// would otherwise drop our patch while a frm-level flag stayed set.
function _pm_hook_attachment_announcement(frm) {
	const att = frm.attachments;
	if (!att || typeof att.attachment_uploaded !== "function") return;
	if (att._pm_hooked) return;
	att._pm_hooked = true;

	const _orig = att.attachment_uploaded.bind(att);
	att.attachment_uploaded = function (file_doc) {
		_orig(file_doc);
		_pm_on_attachment(frm);
	};
}

function _pm_on_attachment(frm) {
	// A specific action was just blocked for a missing attachment — offer that
	// exact action so one click completes it (comment/priority already captured).
	if (frm._pm_pending_action) {
		_pm_show_attachment_banner(frm, frm._pm_pending_action);
		return;
	}
	// Otherwise proactively remind the user of the actions now available.
	const transitions = frm._pm_transitions || [];
	if (transitions.length) {
		_pm_show_action_announcement(frm, transitions);
	}
}

// Reactive banner — the exact action that was blocked, one click to proceed.
function _pm_show_attachment_banner(frm, pending) {
	const label = __(pending.action);
	frm.dashboard.clear_headline();
	frm.dashboard.set_headline(
		`<span style="color:#dc3545;font-weight:bold">⚠</span>&nbsp;&nbsp;` +
		`<strong>${__("File attached.")}</strong>&nbsp;` +
		`${__("Click to continue:")}&nbsp;` +
		`<button class="btn btn-xs btn-danger pm-wf-proceed-btn" style="margin-left:4px">` +
		`${label} &rarr;</button>`,
		"red"
	);
	// Bind after the headline is written to the DOM
	setTimeout(function () {
		frm.$wrapper.find(".pm-wf-proceed-btn").off("click").on("click", function () {
			frm._pm_pending_action = null;
			frm.dashboard.clear_headline();
			_apply_workflow_with_comment(frm, pending.action, pending.comment, pending.priority);
		});
	}, 0);
}

// Proactive announcement — file attached, here are the next workflow actions.
function _pm_show_action_announcement(frm, transitions) {
	const e = frappe.utils.escape_html;
	let btns = "";
	transitions.forEach(function (t, i) {
		btns +=
			`<button class="btn btn-xs btn-primary pm-wf-ann-btn" data-idx="${i}" ` +
			`style="margin-left:6px;margin-top:2px">${e(__(t.action))} &rarr;</button>`;
	});

	frm.dashboard.clear_headline();
	frm.dashboard.set_headline(
		`<span style="font-size:15px">📎</span>&nbsp;&nbsp;` +
		`<strong>${__("File attached.")}</strong>&nbsp;` +
		`${__("Don't forget to apply the next step:")}${btns}`,
		"orange"
	);

	// Bind after the headline is written to the DOM
	setTimeout(function () {
		frm.$wrapper.find(".pm-wf-ann-btn").off("click").on("click", function () {
			const t = transitions[parseInt($(this).attr("data-idx"), 10)];
			if (!t) return;
			frm.dashboard.clear_headline();
			frm.selected_workflow_action = t.action;
			if (!_check_mandatory(frm)) return;
			_open_comment_dialog(frm, t);
		});
	}, 0);
}
