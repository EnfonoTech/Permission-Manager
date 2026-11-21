// Permission Manager — Multi-level Leave Application Approval
// Author: siva <siva@enfono.com>
// Injects Forward and Reject buttons on Leave Application form when
// multi-level approval is enabled and the current user is the assigned approver.

frappe.ui.form.on("Leave Application", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		// Approved/Rejected but still in Draft (the old Approve only saved): keep the
		// standard Submit button instead of offering the decision again
		if (frm.doc.status !== "Open") return;
		if (frm.doc.leave_approver !== frappe.session.user) return;

		frm.page.clear_primary_action();

		// ── Forward / Final Approve ───────────────────────────────────────────
		// has_role returns true or undefined (never a promise): reading .then on
		// undefined threw for every non-HR approver, so line managers got no buttons
		_add_buttons(frm, !!frappe.user.has_role(["HR Manager", "HR User"]));
	},
});

function _add_buttons(frm, is_hr) {
	const forward_label = is_hr ? __("Approve") : __("Approve & Forward");

	frm.add_custom_button(forward_label, () => {
		frappe.call({
			method: "permission_manager.permission_manager.ladder_approve.leave_application.api.forward_leave",
			args: { docname: frm.doc.name, designation: is_hr ? "hr" : null },
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
