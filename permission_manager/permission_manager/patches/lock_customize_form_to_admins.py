# permission_manager/permission_manager/patches/lock_customize_form_to_admins.py
"""GS Issue 29: page/form customisation must be admin-only.

Core already restricts the Customize Form screen to System Manager by default -- so if any other
role can reach it today, that access was granted explicitly as a Custom DocPerm row on the
"Customize Form" doctype, or a user has been given the System Manager role directly. This patch
fixes the first (deterministic, safe to do without knowing which role it was): delete every Custom
DocPerm on "Customize Form" for a role outside the allow-list below.

It deliberately does NOT touch which users hold the System Manager role -- that is an org-chart
question this code cannot answer safely (removing it from the wrong account would lock someone out
of things far beyond form customisation). "Roles With System Manager" (a companion report shipped
alongside this patch) surfaces that list instead, for a human to review.

Idempotent: re-running finds nothing to delete once the offending rows are gone.
"""

import frappe

_ALLOWED_ROLES = {"System Manager", "Administrator"}


def execute():
	offending = frappe.get_all(
		"Custom DocPerm",
		filters={"parent": "Customize Form", "role": ["not in", list(_ALLOWED_ROLES)]},
		pluck="name",
	)
	for name in offending:
		frappe.delete_doc("Custom DocPerm", name, ignore_permissions=True, force=True)

	if offending:
		frappe.clear_cache(doctype="Customize Form")
