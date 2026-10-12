# permission_manager/permission_manager/api/test_reassigned_approver.py
"""An approval an administrator reassigns to a user must be one that user can act on.

Reassign Approver used to move the action to the new user and stop there. The document appeared in
their My Approvals with Approve and Reject drawn beside it, but the engine decides what a user may
do from the roles on the step's transitions, so a user without the role got no actions on the form
and a refusal from the inbox. Three properties are protected here:
  * the stamp reassign_workflow_approver writes is what carries the authority, for that document at
    that step and for nobody else
  * an assignment WITHOUT the stamp carries none: a matrix-routed action is pinned to a named user
    in just the same way, and the chain, not the pin, must keep deciding who may act on it
  * handing an approval to someone who lacks the step's role is a System Manager's call; an HR
    Manager may still redirect it to someone who could already act

Everything is rolled back by FrappeTestCase. The engine's commit and the notification e-mail are
patched out, and the workflow's transitions are supplied in memory, so no approval chain on a
client site is read from or disturbed.
"""

from contextlib import ExitStack
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.workflow import (
    _holds_reassigned_action,
    get_allowed_transitions_for_user,
    get_workflow,
    reassign_workflow_approver,
)

STATE_PREFIX = "_Test Reassigned Step"
NOBODY_ROLE = "_Test Role Nobody Holds"
REF_CANDIDATES = ("Payment Advice", "Journal Entry", "Purchase Order", "Purchase Invoice")


def _new_state():
    return STATE_PREFIX + " " + frappe.generate_hash(length=8)


def _transitions(state, role):
    """Approve and Reject out of `state`, both open to `role` and nobody else."""
    return [
        frappe._dict(
            name="_t%d" % idx, idx=idx, state=state, action=action, next_state="Done",
            approver_type="Role", allowed=role, condition=None, use_approver_matrix=0,
            matrix_level=1, matrix_fallback_role=None, allow_self_approval=0,
        )
        for idx, action in ((1, "Approve"), (2, "Reject"))
    ]


def _action(reference_doctype, reference_name, state, **overrides):
    spec = {
        "doctype": "PM Workflow Action",
        "reference_doctype": reference_doctype,
        "reference_name": reference_name,
        "workflow_state": state,
        "status": "Open",
        "priority": "Medium",
    }
    spec.update(overrides)
    doc = frappe.get_doc(spec)
    doc.insert(ignore_permissions=True)
    return doc


def _two_users():
    return frappe.get_all(
        "User",
        filters={"enabled": 1, "name": ["not in", ["Administrator", "Guest"]]},
        pluck="name",
        limit=2,
    )


def _find_governed_draft():
    """A real draft document that some PM Workflow governs, or (None, None)."""
    for doctype in REF_CANDIDATES:
        if not frappe.db.table_exists(doctype):
            continue
        for name in frappe.get_all(doctype, filters={"docstatus": 0}, pluck="name", limit=5):
            if get_workflow(doctype, name, throw=False):
                return doctype, name
    return None, None


class _Base(FrappeTestCase):
    def setUp(self):
        if not frappe.db.has_column("PM Workflow Action", "is_reassigned"):
            self.skipTest("this site has not been migrated for the reassignment stamp yet")
        users = _two_users()
        if len(users) < 2:
            self.skipTest("need two enabled non-Administrator users on this site")
        self.user, self.other = users
        self.ref_doctype, self.ref_name = _find_governed_draft()
        if not self.ref_name:
            self.skipTest("no draft document governed by a PM Workflow on this site")
        self.state = _new_state()
        # whatever else is waiting on the document would be picked up instead of the test's own row
        frappe.db.sql(
            "update `tabPM Workflow Action` set status = 'Completed' "
            "where reference_doctype = %s and reference_name = %s and status = 'Open'",
            (self.ref_doctype, self.ref_name),
        )
        self.doc = frappe._dict({"doctype": self.ref_doctype, "name": self.ref_name, "owner": "Administrator"})

    def _supplying(self, role, caller_roles=None):
        """Transitions for the test's step supplied in memory; optionally a fixed caller role set."""
        real_get_all, real_get_roles, state = frappe.get_all, frappe.get_roles, self.state

        def fake_get_all(doctype, *args, **kwargs):
            if doctype == "PM Workflow Transition":
                return _transitions(state, role)
            return real_get_all(doctype, *args, **kwargs)

        def fake_get_roles(user=None):
            if user is None and caller_roles is not None:
                return list(caller_roles)
            return real_get_roles(user)

        stack = ExitStack()
        stack.enter_context(patch.object(frappe, "get_all", side_effect=fake_get_all))
        if caller_roles is not None:
            stack.enter_context(patch.object(frappe, "get_roles", side_effect=fake_get_roles))
            stack.enter_context(patch.object(frappe.db, "commit"))
            stack.enter_context(patch.object(frappe, "sendmail"))
        return stack

    def _allowed(self, user, state=None):
        with self._supplying(NOBODY_ROLE):
            return get_allowed_transitions_for_user("_Test Workflow", state or self.state, user, self.doc)


class TestReassignedAuthority(_Base):
    """The engine's gate: what may this user do at this step of this document?"""

    def test_the_assignee_of_a_stamped_action_gets_every_transition_of_the_step(self):
        _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=1)
        self.assertEqual([t.action for t in self._allowed(self.user)], ["Approve", "Reject"])

    def test_an_assignment_without_the_stamp_is_not_authority(self):
        """The matrix-routed shape: pinned to a named user, no stamp."""
        _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=0)
        self.assertEqual(self._allowed(self.user), [])

    def test_nobody_holding_no_action_gets_anything(self):
        self.assertEqual(self._allowed(self.user), [])

    def test_the_stamp_does_not_travel_to_another_user(self):
        _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=1)
        self.assertEqual(self._allowed(self.other), [])

    def test_a_closed_action_grants_nothing(self):
        action = _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=1)
        frappe.db.set_value("PM Workflow Action", action.name, "status", "Completed")
        self.assertEqual(self._allowed(self.user), [])

    def test_the_authority_ends_when_the_document_moves_to_another_step(self):
        _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=1)
        self.assertEqual(self._allowed(self.user, state=_new_state()), [])

    def test_the_helper_answers_no_before_the_column_exists(self):
        _action(self.ref_doctype, self.ref_name, self.state, assigned_to=self.user, is_reassigned=1)
        self.assertTrue(_holds_reassigned_action(self.doc, self.state, self.user))
        with patch.object(frappe.db, "has_column", return_value=False):
            self.assertFalse(_holds_reassigned_action(self.doc, self.state, self.user))

    def test_an_unsaved_document_never_matches(self):
        self.assertFalse(_holds_reassigned_action(frappe._dict({"doctype": self.ref_doctype}), self.state, self.user))
        self.assertFalse(_holds_reassigned_action(None, self.state, self.user))


class TestReassignApprover(_Base):
    """reassign_workflow_approver: who may hand an approval to whom, and what it records."""

    def setUp(self):
        super().setUp()
        self.action = _action(self.ref_doctype, self.ref_name, self.state)
        roles = [r for r in frappe.get_roles(self.user) if r != "Guest"]
        if not roles:
            self.skipTest("the test user holds no role to build a step around")
        self.held_role = roles[0]

    def _row(self):
        return frappe.db.get_value(
            "PM Workflow Action", self.action.name,
            ["assigned_to", "is_reassigned", "reassigned_by", "status"], as_dict=True,
        )

    def _reassign(self, step_role, caller_roles):
        with self._supplying(step_role, caller_roles=caller_roles):
            return reassign_workflow_approver(self.ref_doctype, self.ref_name, self.user, "covering")

    def test_a_system_manager_can_hand_it_to_someone_without_the_role(self):
        result = self._reassign(NOBODY_ROLE, ["System Manager"])
        self.assertTrue(result["grants_authority"])
        row = self._row()
        self.assertEqual(row.assigned_to, self.user)
        self.assertEqual(row.is_reassigned, 1)
        self.assertEqual(row.reassigned_by, frappe.session.user)
        self.assertEqual(row.status, "Open")
        # and from now on the engine lets them act on exactly that step
        self.assertTrue(_holds_reassigned_action(self.doc, self.state, self.user))

    def test_the_audit_comment_says_the_role_is_no_longer_needed(self):
        self._reassign(NOBODY_ROLE, ["System Manager"])
        self.assertTrue(frappe.db.exists("Comment", {
            "reference_doctype": self.ref_doctype,
            "reference_name": self.ref_name,
            "comment_type": "Workflow",
            "content": ["like", "%without holding its role%"],
        }))

    def test_an_hr_manager_cannot_hand_it_to_someone_without_the_role(self):
        with self.assertRaises(frappe.ValidationError):
            self._reassign(NOBODY_ROLE, ["HR Manager"])
        row = self._row()
        self.assertFalse(row.assigned_to)
        self.assertEqual(row.is_reassigned, 0)

    def test_an_hr_manager_can_still_redirect_it_to_someone_who_could_act(self):
        result = self._reassign(self.held_role, ["HR Manager"])
        self.assertFalse(result["grants_authority"])
        self.assertEqual(self._row().assigned_to, self.user)

    def test_a_user_who_cannot_reassign_at_all_is_still_refused(self):
        with self.assertRaises(frappe.ValidationError):
            self._reassign(self.held_role, ["Desk User"])
        self.assertFalse(self._row().assigned_to)
