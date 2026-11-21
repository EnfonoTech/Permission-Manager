// Permission Manager — Multi-level Leave Application Approval
// Author: siva <siva@enfono.com>
// Puts a leave on the form the way its approval chain sees it:
//   * while the chain is deciding, the native Submit is taken away from everybody (it is
//     refused on the server anyway, so nobody should be offered it) and whoever may act gets
//     Approve / Approve & Forward and Reject; everyone else is told who has it;
//   * once the chain has approved or rejected it, Submit is left alone for HR to use.
// The state comes with the document (__onload.pm_ladder, set by the server), so there is no
// lookup to race a re-render.

frappe.ui.form.on("Leave Application", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;

		const ladder = (frm.doc.__onload || {}).pm_ladder;

		if (ladder) {
			if (!ladder.active) return; // decided on the chain: Submit is HR's to press

			_hide_submit(frm);
			const level = ladder.level ? __(" (level {0})", [ladder.level]) : "";
			if (ladder.can_act) {
				_add_buttons(frm, ladder.final);
				// replaces core's "Submit this ... to confirm", which is not what happens next
				frm.set_intro(
					ladder.holder === frappe.session.user
						? __("This leave is waiting for your approval{0}.", [level])
						: __("Waiting for approval from {0}{1}. You may act on their behalf.", [ladder.holder_name, level]),
					"orange"
				);
			} else {
				frm.set_intro(
					__("Waiting for approval from {0}{1}. Submit becomes available once the leave is approved.", [ladder.holder_name, level]),
					"orange"
				);
			}
			return;
		}

		// No chain on this leave (or an older server): the approver the form names gets the buttons.
		if (frm.doc.leave_approver !== frappe.session.user) return;
		frm.page.clear_primary_action();
		_add_buttons(frm, frappe.user.has_role(["HR Manager", "HR User"]));
	},
});

// Dirty means the primary action is SAVE and the user has work to keep: never touch it.
function _hide_submit(frm) {
	if (frm.is_dirty && frm.is_dirty()) return;
	frm.page.clear_primary_action();
}

function _add_buttons(frm, is_final) {
	const forward_label = is_final ? __("Approve") : __("Approve & Forward");

	frm.add_custom_button(forward_label, () => {
		frappe.call({
			method: "permission_manager.permission_manager.ladder_approve.leave_application.api.forward_leave",
			args: { docname: frm.doc.name, designation: is_final ? "hr" : null },
			callback(r) {
				if (r.message) {
					frappe.show_alert({ message: r.message, indicator: "green" });
					frm.reload_doc();
				}
			},
		});
	}, __("Approval"));

	frm.add_custom_button(__("Reject"), () => {
		frappe.prompt(
			{
				fieldtype: "Small Text",
				fieldname: "reason",
				label: __("Rejection Reason"),
				reqd: 1,
			},
			(vals) => {
				frappe.call({
					method: "permission_manager.permission_manager.ladder_approve.leave_application.api.reject_leave",
					args: { docname: frm.doc.name, reason: vals.reason },
					callback(r) {
						if (r.message) {
							frappe.show_alert({ message: r.message, indicator: "red" });
							frm.reload_doc();
						}
					},
				});
			},
			__("Reject Leave Application"),
			__("Reject")
		);
	}, __("Approval"));
}
