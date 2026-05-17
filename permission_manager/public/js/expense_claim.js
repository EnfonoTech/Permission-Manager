// Permission Manager — Multi-level Expense Claim Approval UI
// Author: siva <siva@enfono.com>

frappe.ui.form.on("Expense Claim", {
	async refresh(frm) {
		const current_user = frappe.session.user;

		// Check if multi-level approval is enabled
		const is_enabled = await frappe.db.get_single_value(
			"HR Settings",
			"enable_multi_level_expense_claim_approval"
		);
		if (!is_enabled) return;

		// Check if employee opted out
		const res = await frappe.db.get_value(
			"Employee",
			frm.doc.employee,
			"custom_disable_multilevel_approval"
		);
		if (res?.message?.custom_disable_multilevel_approval) return;

		// Make approval_status read-only
		if (frm.doc.approval_status) {
			frm.set_df_property("approval_status", "read_only", 1);
			frm.refresh_field("approval_status");
		}

		document.querySelector(".form-message.blue")?.remove();

		// New document — allow save
		if (frm.is_new()) {
			frm.enable_save();
			frm.page.btn_primary?.show();
			frm.remove_custom_button("Approve");
			frm.remove_custom_button("Reject");
			return;
		}

		// Not a draft or no approver assigned
		if (frm.doc.docstatus !== 0 || !frm.doc.expense_approver) return;

		const is_hr_manager = await frappe.user.has_role("HR Manager");
		const is_admin = current_user === "Administrator";

		// ── Final approver (HR Manager / Administrator) ─────────────────────
		if ((is_hr_manager || is_admin) && current_user !== frm.doc.owner) {
			frm.disable_save();
			frm.page.btn_primary?.hide();
			_add_expense_buttons(frm, true);
			return;
		}

		// ── Mid-level approver ───────────────────────────────────────────────
		if (current_user === frm.doc.expense_approver && current_user !== frm.doc.owner) {
			frm.disable_save();
			frm.page.btn_primary?.hide();
			_add_expense_buttons(frm, false);
			return;
		}

		// ── Applicant ────────────────────────────────────────────────────────
		if (current_user === frm.doc.owner && current_user !== frm.doc.expense_approver) {
			frm.remove_custom_button("Approve");
			frm.remove_custom_button("Reject");
			frm.disable_save();
			frm.page.btn_primary?.hide();
		}
	},

	payable_account(frm) {
		frm.page.btn_primary?.show();
		frm.enable_save();
		frm.remove_custom_button("Approve");
		frm.remove_custom_button("Reject");
	},

	after_save(frm) {
		frm.page.btn_primary?.hide();
		frm.disable_save();
		_add_expense_buttons(frm, false);
	},
});

function _add_expense_buttons(frm, is_final) {
	// Approve
	frm
		.add_custom_button(__("Approve"), () => {
			frappe.confirm(__("Are you sure you want to approve this expense claim?"), () => {
				frappe.call({
					method: "permission_manager.permission_manager.ladder_approve.expense_claim.api.forward_expense_claim",
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

	// Reject
	frm
		.add_custom_button(__("Reject"), () => {
			frappe.prompt(
				[{ fieldtype: "Data", fieldname: "rejection_reason", label: __("Rejection Reason"), reqd: 1 }],
				(data) => {
					frappe.call({
						method: "permission_manager.permission_manager.ladder_approve.expense_claim.api.reject_expense_claim",
						args: { docname: frm.doc.name, reason: data.rejection_reason },
						callback(r) {
							if (!r.exc) {
								frappe.msgprint(r.message);
								frm.reload_doc();
							}
						},
					});
				},
				__("Reject Expense Claim")
			);
		})
		.css({ "background-color": "#ff4444", color: "white", "border-color": "#ff4444" });
}
