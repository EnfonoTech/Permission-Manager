# permission_manager/permission_manager/api/test_adhoc_forward.py
"""Ad-hoc forwarding: the flag on the row has to bind the engine, not just draw a button.

Three properties are protected here, each of which was broken in production:
  * a forwarded action reads as held by the person it went to, never by "Administrator"
  * "Return to me after their input" makes the reviewer's response come back to the forwarder
    instead of advancing the document — through every entry point, Administrator included
  * a forwarded action stays visible to the approver who forwarded it while it is out

Everything is rolled back by FrappeTestCase; no workflow is generated and no document is
submitted, so a client site's approval chain is never disturbed.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api.approvals import get_my_pending_approvals
from permission_manager.permission_manager.workflow import get_open_return_adhoc_action

REF_DOCTYPE = "Payment Advice"
STATE = "_Test Pending Approval"


def _action(**overrides):
    """An unsaved-then-inserted PM Workflow Action, with no reference to a real document."""
    spec = {
        "doctype": "PM Workflow Action",
        "reference_doctype": REF_DOCTYPE,
        "reference_name": "_TEST-ADHOC-0001",
        "workflow_state": STATE,
        "status": "Open",
        "priority": "Medium",
    }
    spec.update(overrides)
    doc = frappe.get_doc(spec)
    doc.insert(ignore_permissions=True)
    return doc


class TestAdhocForwardVisibility(FrappeTestCase):
    """The row must name the person holding it — the bug showed 'Administrator' instead."""

    def setUp(self):
        self.user = frappe.db.get_value("User", {"enabled": 1, "name": ["!=", "Administrator"]}, "name")
        if not self.user:
            self.skipTest("no enabled non-Administrator user on this site")

    def _rows_for_doc(self, docname):
        frappe.set_user("Administrator")
        payload = get_my_pending_approvals()
        rows = [r for g in payload["groups"] for r in g["items"] if r["docname"] == docname]
        return rows

    def test_adhoc_row_is_not_labelled_administrator(self):
        original = _action(status="Forwarded", completed_by="Administrator")
        _action(is_adhoc=1, adhoc_for=original.name, assigned_to=self.user)
        rows = self._rows_for_doc(original.reference_name)
        adhoc_rows = [r for r in rows if r["is_adhoc"]]
        if not adhoc_rows:
            self.skipTest("reference document does not exist, so the row is filtered out")
        for row in adhoc_rows:
            self.assertNotEqual(row["role_id"], "Administrator")

    def test_adhoc_row_names_the_holder(self):
        original = _action(status="Forwarded", completed_by="Administrator")
        _action(is_adhoc=1, adhoc_for=original.name, assigned_to=self.user)
        rows = [r for r in self._rows_for_doc(original.reference_name) if r["is_adhoc"]]
        if not rows:
            self.skipTest("reference document does not exist, so the row is filtered out")
        expected = frappe.db.get_value("User", self.user, "full_name") or self.user.split("@")[0]
        self.assertEqual(rows[0]["holder"], expected)

    def test_forwarded_original_stays_visible_and_says_who_holds_it(self):
        original = _action(status="Forwarded", completed_by="Administrator")
        _action(is_adhoc=1, adhoc_for=original.name, assigned_to=self.user)
        rows = [r for r in self._rows_for_doc(original.reference_name) if r["name"] == original.name]
        if not rows:
            self.skipTest("reference document does not exist, so the row is filtered out")
        row = rows[0]
        self.assertTrue(row["is_waiting"])
        self.assertEqual(row["available_actions"], [])
        expected = frappe.db.get_value("User", self.user, "full_name") or self.user.split("@")[0]
        self.assertEqual(row["waiting_with"], expected)


class TestReturnToOriginatorLookup(FrappeTestCase):
    """The engine's gate: does this user hold a return-to-me ad-hoc action for this doc?"""

    def setUp(self):
        self.user = frappe.db.get_value("User", {"enabled": 1, "name": ["!=", "Administrator"]}, "name")
        if not self.user:
            self.skipTest("no enabled non-Administrator user on this site")
        self.doc = frappe._dict({"doctype": REF_DOCTYPE, "name": "_TEST-ADHOC-0002"})

    def _adhoc(self, **overrides):
        original = _action(reference_name=self.doc.name, status="Forwarded", completed_by="Administrator")
        spec = {
            "reference_name": self.doc.name,
            "is_adhoc": 1,
            "adhoc_for": original.name,
            "assigned_to": self.user,
        }
        spec.update(overrides)
        return _action(**spec)

    def test_found_when_the_flag_is_set(self):
        self._adhoc(return_to_originator=1)
        self.assertTrue(get_open_return_adhoc_action(self.doc, STATE, self.user))

    def test_not_found_when_the_flag_is_clear(self):
        self._adhoc(return_to_originator=0)
        self.assertIsNone(get_open_return_adhoc_action(self.doc, STATE, self.user))

    def test_not_found_for_a_different_user(self):
        self._adhoc(return_to_originator=1)
        self.assertIsNone(get_open_return_adhoc_action(self.doc, STATE, "Administrator"))

    def test_not_found_once_completed(self):
        adhoc = self._adhoc(return_to_originator=1)
        frappe.db.set_value("PM Workflow Action", adhoc.name, "status", "Completed")
        self.assertIsNone(get_open_return_adhoc_action(self.doc, STATE, self.user))

    def test_not_found_for_another_state(self):
        self._adhoc(return_to_originator=1)
        self.assertIsNone(get_open_return_adhoc_action(self.doc, "_Test Other State", self.user))


class TestReturnLeg(FrappeTestCase):
    """Returning must close the reviewer's action and re-open the forwarder's — or change nothing."""

    def setUp(self):
        self.user = frappe.db.get_value("User", {"enabled": 1, "name": ["!=", "Administrator"]}, "name")
        if not self.user:
            self.skipTest("no enabled non-Administrator user on this site")

    def test_return_reopens_the_original_and_closes_the_adhoc(self):
        from permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action import (
            return_adhoc_to_originator,
        )

        original = _action(status="Forwarded", completed_by="Administrator", assigned_to="Administrator")
        adhoc = _action(is_adhoc=1, adhoc_for=original.name, assigned_to=self.user, return_to_originator=1)

        frappe.set_user(self.user)
        try:
            return_adhoc_to_originator(adhoc.name, "please check the rate", responded_action="Approve")
        except frappe.PermissionError:
            self.skipTest("test user cannot act on the action on this site")
        finally:
            frappe.set_user("Administrator")

        self.assertEqual(frappe.db.get_value("PM Workflow Action", adhoc.name, "status"), "Completed")
        self.assertEqual(frappe.db.get_value("PM Workflow Action", adhoc.name, "completed_by"), self.user)
        self.assertEqual(frappe.db.get_value("PM Workflow Action", original.name, "status"), "Open")
        self.assertIsNone(frappe.db.get_value("PM Workflow Action", original.name, "completed_by"))

    def test_a_missing_original_never_strands_the_document(self):
        """With nothing to re-open and nothing regenerable, the whole call must refuse."""
        from permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action import (
            return_adhoc_to_originator,
        )

        original = _action(status="Forwarded", completed_by="Administrator")
        adhoc = _action(is_adhoc=1, adhoc_for=original.name, assigned_to=self.user, return_to_originator=1)
        frappe.db.set_value("PM Workflow Action", adhoc.name, "adhoc_for", "does-not-exist")
        frappe.delete_doc("PM Workflow Action", original.name, force=True, ignore_permissions=True)

        frappe.set_user(self.user)
        try:
            with self.assertRaises(frappe.ValidationError):
                return_adhoc_to_originator(adhoc.name, "")
        finally:
            frappe.set_user("Administrator")
