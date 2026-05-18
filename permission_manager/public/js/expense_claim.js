// Permission Manager — Multi-level Expense Claim Approval
// Author: siva <siva@enfono.com>
// Injects Forward and Reject buttons on Expense Claim form when
// multi-level approval is enabled and the current user is the assigned approver.

frappe.ui.form.on("Expense Claim", {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		if (frm.doc.expense_approver !== frappe.session.user) return;

		frm.page.clear_primary_action();

		const is_hr = frappe.user.has_role(["HR Manager", "HR User"]);
		const forward_label = is_hr ? __("Approve") : __("Approve & Forward");

		frm.add_custom_button(forward_label, () => {
			frappe.call({
				method: "permission_manager.permission_manager.ladder_approve.expense_claim.api.forward_expense_claim",
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
						method: "permission_manager.permission_manager.ladder_approve.expense_claim.api.reject_expense_claim",
						args: { docname: frm.doc.name, reason: vals.reason },
						callback(r) {
							if (r.message) {
								frappe.show_alert({ message: r.message, indicator: "red" });
								frm.reload_doc();
							}
						},
					});
				},
				__("Reject Expense Claim"),
				__("Reject")
			);
		}, __("Approval"));
	},
});
