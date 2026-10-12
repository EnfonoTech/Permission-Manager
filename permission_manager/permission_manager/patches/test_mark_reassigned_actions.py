# permission_manager/permission_manager/patches/test_mark_reassigned_actions.py
"""The backfill must stamp what an administrator reassigned, and nothing that merely looks like it.

A matrix-routed action is pinned to a named user in exactly the way a reassigned one is, so the
only thing that tells them apart is the audit comment reassign_workflow_approver wrote. Each test
below builds one shape and asserts whether the patch stamps it. Everything happens inside the
test's own transaction, on a real draft document, and is rolled back.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.patches.mark_reassigned_actions import execute

REF_CANDIDATES = ("Payment Advice", "Journal Entry", "Purchase Order", "Purchase Invoice")


def _comment(by, to, doctype, name):
    frappe.get_doc(doctype, name).add_comment(
        "Workflow",
        "<div><strong>🔄 Approver Reassigned</strong><br>"
        "From: <em>(role-based)</em> → To: <em>%s</em><br>By: %s</div>" % (to, by),
    )


class TestMarkReassignedActions(FrappeTestCase):
    def setUp(self):
        if not frappe.db.has_column("PM Workflow Action", "is_reassigned"):
            self.skipTest("this site has not been migrated for the reassignment stamp yet")
        users = frappe.get_all(
            "User",
            filters={"enabled": 1, "name": ["not in", ["Administrator", "Guest"]]},
            pluck="name",
            limit=2,
        )
        if len(users) < 2:
            self.skipTest("need two enabled non-Administrator users on this site")
        self.user, self.other = users
        self.doctype = self.name = None
        for doctype in REF_CANDIDATES:
            if frappe.db.table_exists(doctype):
                self.name = frappe.db.get_value(doctype, {"docstatus": 0}, "name")
                if self.name:
                    self.doctype = doctype
                    break
        if not self.name:
            self.skipTest("no draft document on this site to attach a test action to")
        frappe.db.sql(
            "update `tabPM Workflow Action` set status = 'Completed' "
            "where reference_doctype = %s and reference_name = %s and status = 'Open'",
            (self.doctype, self.name),
        )
        self.state = "_Test Backfill " + frappe.generate_hash(length=8)

    def _action(self, **overrides):
        spec = {
            "doctype": "PM Workflow Action",
            "reference_doctype": self.doctype,
            "reference_name": self.name,
            "workflow_state": self.state,
            "status": "Open",
            "priority": "Medium",
            "assigned_to": self.user,
        }
        spec.update(overrides)
        return frappe.get_doc(spec).insert(ignore_permissions=True)

    def _stamp(self, action):
        return frappe.db.get_value("PM Workflow Action", action.name, ["is_reassigned", "reassigned_by"], as_dict=True)

    def test_stamps_an_action_whose_reassignment_comment_names_its_assignee(self):
        action = self._action()
        _comment("Administrator", self.user, self.doctype, self.name)
        execute()
        stamp = self._stamp(action)
        self.assertEqual(stamp.is_reassigned, 1)
        self.assertEqual(stamp.reassigned_by, "Administrator")

    def test_leaves_a_pinned_action_with_no_reassignment_comment_alone(self):
        """The matrix-routed shape."""
        action = self._action()
        execute()
        self.assertEqual(self._stamp(action).is_reassigned, 0)

    def test_leaves_an_action_when_the_comment_names_someone_else(self):
        action = self._action()
        _comment("Administrator", self.other, self.doctype, self.name)
        execute()
        self.assertEqual(self._stamp(action).is_reassigned, 0)

    def test_ignores_a_comment_written_before_the_action_existed(self):
        _comment("Administrator", self.user, self.doctype, self.name)
        action = self._action()
        execute()
        self.assertEqual(self._stamp(action).is_reassigned, 0)

    def test_does_not_touch_an_unassigned_action(self):
        unassigned = self._action(assigned_to=None)
        _comment("Administrator", self.user, self.doctype, self.name)
        execute()
        self.assertEqual(self._stamp(unassigned).is_reassigned, 0)

    def test_does_not_touch_an_ad_hoc_action(self):
        """A forward has its own authority path; a reassignment comment must not stamp it."""
        original = self._action(assigned_to=None, status="Forwarded")
        adhoc = self._action(is_adhoc=1, adhoc_for=original.name)
        _comment("Administrator", self.user, self.doctype, self.name)
        execute()
        self.assertEqual(self._stamp(adhoc).is_reassigned, 0)

    def test_is_idempotent(self):
        action = self._action()
        _comment("Administrator", self.user, self.doctype, self.name)
        execute()
        execute()
        self.assertEqual(self._stamp(action).is_reassigned, 1)
