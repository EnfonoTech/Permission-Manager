// Permission Manager — Multi-level Leave Application Approval UI
// Author: siva <siva@enfono.com>

frappe.ui.form.on("Leave Application", {
	async refresh(frm) {
		const current_user = frappe.session.user;

		// Check if multi-level approval is enabled in HR Settings
		const is_enabled = await frappe.db.get_single_value(
			"HR Settings",
			"enable_multi_level_leave_approval"
		);
		if (!is_enabled) return;

		// Check if this employee has opted out
		const res = await frappe.db.get_value(
			"Employee",
			frm.doc.employee,
			"custom_disable_multilevel_approval"
		);
		if (res?.message?.custom_disable_multilevel_approval) return;

		// Always make status read-only when feature is on
		frm.set_df_property("status", "read_only", 1);
		frm.refresh_field("status");
		document.querySelector(".form-message.blue")?.remove();

		// New document — allow save, no approve/reject
		if (frm.is_new()) {
			frm.enable_save();
			frm.page.btn_primary?.show();
			frm.remove_custom_button("Approve");
			frm.remove_custom_button("Reject");
			return;
		}

		// Not a draft or no approver assigned
		if (frm.doc.docstatus !== 0 || !frm.doc.leave_approver) return;

		const is_hr_manager = await frappe.user.has_role("HR Manager");
		const is_admin = current_user === "Administrator";

		// ── Final approver (HR Manager / Administrator) ─────────────────────
		if (is_hr_manager || is_admin) {
			frm.disable_save();
			frm.page.btn_primary?.hide();
			_add_approve_button(frm, true);
			_add_reject_button(frm);
			return;
		}

		// ── Mid-level approver ───────────────────────────────────────────────
		if (current_user === frm.doc.leave_approver && current_user !== frm.doc.owner) {
			frm.disable_save();
			frm.page.btn_primary?.hide();
			_add_approve_button(frm, false);
			_add_reject_button(frm);
			return;
		}

		// ── Applicant (owner, not approver) ──────────────────────────────────
		if (current_user === frm.doc.owner && current_user !== frm.doc.leave_approver) {
			frm.remove_custom_button("Approve");
			frm.remove_custom_button("Reject");
			frm.disable_save();
			frm.page.btn_primary?.hide();
		}
	},
});

function _add_approve_button(frm, is_final) {
	frm
		.add_custom_button(__("Approve"), () => {
			frappe.confirm(__("Are you sure you want to approve this leave application?"), () => {
				frappe.call({
					method: "permission_manager.permission_manager.ladder_approve.leave_application.api.forward_leave",
					args: { docname: frm.doc.name, designation: is_final ? "hr" : undefined },
					callback(r) {
						if (!r.exc) {
							frappe.msgprint(r.message);
							frm.reload_doc();
						}
					},
				});
			});
		})
		.css({ "background-color": "#1a1a1a", color: "white", "border-color": "#45a049" });
}

function _add_reject_button(frm) {
	frm
		.add_custom_button(__("Reject"), () => {
			frappe.prompt(
				[{ fieldtype: "Data", fieldname: "rejection_reason", label: __("Rejection Reason"), reqd: 1 }],
				(data) => {
					frappe.call({
						method: "permission_manager.permission_manager.ladder_approve.leave_application.api.reject_leave",
						args: { docname: frm.doc.name, reason: data.rejection_reason },
						callback(r) {
							if (!r.exc) {
								frappe.msgprint(r.message);
								frm.reload_doc();
							}
						},
					});
				},
				__("Reject Leave Application")
			);
		})
		.css({ "background-color": "#ff4444", color: "white", "border-color": "#ff4444" });
}
