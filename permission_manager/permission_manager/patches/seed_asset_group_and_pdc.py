# Seed the Asset approval chain, ensure Payment Entry workflow roles exist, and create
# the PDC cheque-date notification. Idempotent — safe on replay; never overwrites edits.
import frappe


def _ensure_role(role):
	if not frappe.db.exists("Role", role):
		frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def _ensure_asset_group():
	if not frappe.db.exists("DocType", "PM Approval Group"):
		return
	if frappe.db.exists("PM Approval Group", "Asset"):
		return
	roles = ["Department Head", "General Manager", "Accountant"]
	for r in roles:
		_ensure_role(r)
	frappe.flags.skip_approval_group_sync = True
	frappe.get_doc({
		"doctype": "PM Approval Group",
		"group_name": "Asset",
		"stages": [{"approver_role": r} for r in roles],
	}).insert(ignore_permissions=True)
	frappe.flags.skip_approval_group_sync = False


def _ensure_pe_roles():
	# Roles the Payment Entry workflow routes to (chains are code-defined, not group-based).
	for r in ["Accounts User", "Purchase Manager", "Finance Manager", "Accountant"]:
		_ensure_role(r)


def _ensure_pdc_notification():
	"""PDC = post-dated cheque. No approval workflow — instead notify Accounts on the
	cheque date (Payment Entry.reference_date). Fires via the daily notification scheduler."""
	name = "PDC Cheque Date Reminder"
	if frappe.db.exists("Notification", name):
		return
	frappe.get_doc({
		"doctype": "Notification",
		"name": name,
		"subject": "Post-dated cheque due today: {{ doc.name }}",
		"document_type": "Payment Entry",
		"is_standard": 0,
		"enabled": 1,
		"channel": "System Notification",
		"event": "Days Before",
		"date_changed": "reference_date",
		"days_in_advance": 0,
		"condition": "doc.reference_no and doc.docstatus < 2",
		"recipients": [{"receiver_by_role": "Accounts User"}],
		"message": (
			"Post-dated cheque {{ doc.reference_no }} dated {{ doc.reference_date }} "
			"for {{ doc.party_name or doc.party }} ({{ doc.paid_amount }}) is due today. "
			"Please action."
		),
	}).insert(ignore_permissions=True)


def execute():
	_ensure_asset_group()
	_ensure_pe_roles()
	_ensure_pdc_notification()
	frappe.db.commit()
	try:
		from permission_manager.permission_manager.api.approval_group import rebuild_approval_workflows
		rebuild_approval_workflows()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "seed_asset_group_and_pdc rebuild")
