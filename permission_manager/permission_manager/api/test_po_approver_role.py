# permission_manager/permission_manager/api/test_po_approver_role.py
"""A normal Purchase Order is approved by `PO Approver` where the site has that role, else `Branch Head`.

Protects the rebuild: `rebuild_approval_workflows()` regenerates the Purchase Order PM Workflow, so a
site that moved its PO approval to PO Approver must not be put back on Branch Head by the next rebuild,
and a site without the role must not get a transition naming a Role that does not exist.

`_build` (delete + re-insert of the PM Workflow) is replaced by a recorder, so nothing is written.
"""

from unittest.mock import patch

from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api import approval_group as ag


def _generate(role_exists: bool):
    """(states, transitions) _build_po would hand to _build, with the PO Approver role present or not."""
    seen = {}

    def record(document_type, workflow_name, states, transitions):
        seen["states"], seen["transitions"] = states, transitions

    with patch.object(ag.frappe.db, "exists", return_value=role_exists), patch.object(ag, "_build", record):
        ag._build_po({})
    return seen["states"], seen["transitions"]


class TestPOApproverRole(FrappeTestCase):
    def test_role_resolves_by_site(self):
        with patch.object(ag.frappe.db, "exists", return_value=True):
            self.assertEqual(ag.po_approver_role(), "PO Approver")
        with patch.object(ag.frappe.db, "exists", return_value=False):
            self.assertEqual(ag.po_approver_role(), "Branch Head")

    def test_site_with_the_role_routes_pending_to_it(self):
        states, tx = _generate(True)
        pending = {s["state"]: s["allow_edit"] for s in states}["Pending"]
        self.assertEqual(pending, "PO Approver")
        decisions = [t for t in tx if t["state"] == "Pending" and t["action"] in ("Approve", "Reject")]
        self.assertEqual({t["allowed"] for t in decisions}, {"PO Approver"})
        self.assertEqual(len(decisions), 2)

    def test_site_without_the_role_keeps_branch_head(self):
        states, tx = _generate(False)
        pending = {s["state"]: s["allow_edit"] for s in states}["Pending"]
        self.assertEqual(pending, "Branch Head")
        decisions = [t for t in tx if t["state"] == "Pending" and t["action"] in ("Approve", "Reject")]
        self.assertEqual({t["allowed"] for t in decisions}, {"Branch Head"})

    def test_raising_a_po_is_not_the_approvers_job(self):
        _, tx = _generate(True)
        sends = [t for t in tx if t["action"] == "Send for Approval"]
        self.assertTrue(sends)
        self.assertEqual({t["allowed"] for t in sends}, {"Purchase User"})
