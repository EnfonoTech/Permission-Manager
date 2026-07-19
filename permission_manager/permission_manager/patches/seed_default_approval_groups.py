# Seed the default account-group approval chains (idempotent). Only creates groups
# that don't already exist, so client edits are never overwritten on migrate.
import frappe

DEFAULT_CHAINS = {
	"Vehicle":   ["Vehicle Dept Head", "Accountant"],
	"Payroll":   ["Finance Manager", "Accountant"],
	"Office":    ["Branch Head", "Accountant"],
	"Rent":      ["Branch Head", "Accountant"],
	"Utilities": ["Department Head", "Accountant"],
}
DEFAULT_TEMPLATES = {
	"Vehicle":   ["Fuel Expense JV", "Vehicle Expense JV"],
	"Payroll":   ["Payroll JV"],
	"Office":    ["Office Expense JV"],
	"Rent":      ["Rent JV"],
	"Utilities": ["Utilities JV"],
}


def _ensure_role(role):
	if not frappe.db.exists("Role", role):
		frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def execute():
	if not frappe.db.exists("DocType", "PM Approval Group"):
		return
	frappe.flags.skip_approval_group_sync = True
	created = False
	for group, roles in DEFAULT_CHAINS.items():
		if frappe.db.exists("PM Approval Group", group):
			continue
		for r in roles:
			_ensure_role(r)
		frappe.get_doc({
			"doctype": "PM Approval Group",
			"group_name": group,
			"journal_templates": "\n".join(DEFAULT_TEMPLATES.get(group, [])),
			"stages": [{"approver_role": r} for r in roles],
		}).insert(ignore_permissions=True)
		created = True
	frappe.flags.skip_approval_group_sync = False
	if created:
		from permission_manager.permission_manager.api.approval_group import rebuild_approval_workflows
		try:
			rebuild_approval_workflows()
		except Exception:
			frappe.log_error(frappe.get_traceback(), "seed_default_approval_groups rebuild")
