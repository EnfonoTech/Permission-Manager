# permission_manager/permission_manager/patches/test_lock_customize_form_to_admins.py
"""GS Issue 29: Customize Form access must not be grantable to a non-admin role.

Only the patch's own deletion logic is under test here -- creating and deleting a real Custom
DocPerm row, not any live client data, and always inside the test's own transaction.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.patches.lock_customize_form_to_admins import (
    _ALLOWED_ROLES,
    execute,
)

TEST_ROLE = "_Test SF Non Admin Role"


class TestLockCustomizeFormToAdmins(FrappeTestCase):
    def setUp(self):
        if not frappe.db.exists("Role", TEST_ROLE):
            frappe.get_doc({"doctype": "Role", "role_name": TEST_ROLE}).insert(
                ignore_permissions=True
            )

    def tearDown(self):
        frappe.db.rollback()

    def test_removes_a_grant_on_a_non_admin_role(self):
        perm = frappe.get_doc(
            {
                "doctype": "Custom DocPerm",
                "parent": "Customize Form",
                "parenttype": "DocType",
                "parentfield": "permissions",
                "role": TEST_ROLE,
                "read": 1,
            }
        ).insert(ignore_permissions=True)

        execute()

        self.assertFalse(frappe.db.exists("Custom DocPerm", perm.name))

    def test_leaves_an_allowed_role_untouched(self):
        for role in _ALLOWED_ROLES:
            if not frappe.db.exists(
                "Custom DocPerm", {"parent": "Customize Form", "role": role}
            ):
                perm = frappe.get_doc(
                    {
                        "doctype": "Custom DocPerm",
                        "parent": "Customize Form",
                        "parenttype": "DocType",
                        "parentfield": "permissions",
                        "role": role,
                        "read": 1,
                    }
                ).insert(ignore_permissions=True)

                execute()

                self.assertTrue(frappe.db.exists("Custom DocPerm", perm.name))
                return
