# permission_manager/permission_manager/api/customize_form_audit.py
"""Companion to the lock_customize_form_to_admins patch (GS Issue 29).

The patch removes any explicit Custom DocPerm grant on the Customize Form doctype. The other way
in -- a user holding the System Manager role directly -- is an org-chart question, not a permission
bug, so it is surfaced here for a human to review rather than auto-revoked.
"""

from __future__ import annotations

import frappe


@frappe.whitelist()
def users_with_system_manager_role() -> list[dict]:
	"""System Manager access: which of your own team currently has it, System Manager check-only."""
	frappe.only_for("System Manager")

	return frappe.get_all(
		"Has Role",
		filters={"role": "System Manager", "parenttype": "User"},
		fields=["parent as user"],
		order_by="parent",
	)
