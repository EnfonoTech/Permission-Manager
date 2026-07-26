# permission_manager/permission_manager/api/test_approval_group.py
"""Rebuild safety for the generated PM Workflows.

`rebuild_approval_workflows()` deletes each generated PM Workflow and re-inserts it from
PM Approval Group config. Routes a site added by hand exist only in the database, so the
rebuild used to delete them with no trace — that is how Steel Force lost the Counter Sale
route on Journal Entry (2026-07-25). These tests pin the carry-over behaviour.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api.approval_group import _build

TARGET = "ToDo"  # any doctype will do: the workflow only needs something to point at
WF = "Test Carry Over Workflow"


def _states(*names):
	return [{"state": n, "doc_status": "0", "edit_permission_type": "Role",
	         "allow_edit": "System Manager"} for n in names]


def _tx(state, action, nxt, role, cond=None):
	row = {"state": state, "action": action, "next_state": nxt,
	       "approver_type": "Role", "allowed": role}
	if cond:
		row["condition"] = cond
	return row


def _signatures(workflow_name):
	return {(t.state, t.action, t.next_state, t.allowed, t.condition or "")
	        for t in frappe.get_all("PM Workflow Transition",
	                                filters={"parent": workflow_name, "parenttype": "PM Workflow"},
	                                fields=["state", "action", "next_state", "allowed", "condition"])}


class TestRebuildCarriesManualRows(FrappeTestCase):
	def setUp(self):
		self._drop()
		self.states = _states("Draft", "Pending", "Approved", "Rejected")
		self.generated = [
			_tx("Draft", "Send for Approval", "Pending", "System Manager"),
			_tx("Pending", "Approve", "Approved", "Accounts User", cond="not doc.description"),
		]
		_build(TARGET, WF, self.states, self.generated)

	def tearDown(self):
		self._drop()

	def _drop(self):
		for name in frappe.get_all("PM Workflow", filters={"document_type": TARGET}, pluck="name"):
			frappe.delete_doc("PM Workflow", name, force=1)
		# PM Workflow.on_update creates the state field on its target; that is a schema change
		# and would outlive the test transaction, so take it back out
		cf = frappe.db.get_value("Custom Field", {"dt": TARGET, "fieldname": "workflow_state"})
		if cf:
			frappe.delete_doc("Custom Field", cf, force=1)
		frappe.db.commit()

	def _add_manual(self, row, ignore_links=False):
		doc = frappe.get_doc("PM Workflow", WF)
		if ignore_links:
			# a row naming a role that does not exist cannot go through link validation
			child = frappe.get_doc(dict(row, doctype="PM Workflow Transition", parent=WF,
			                            parenttype="PM Workflow", parentfield="transitions",
			                            idx=len(doc.transitions) + 1))
			child.db_insert()
			frappe.db.commit()
			return
		doc.append("transitions", row)
		doc.save(ignore_permissions=True)
		frappe.db.commit()

	# ── the regression that started this ──────────────────────────────────────
	def test_hand_added_role_survives_rebuild(self):
		manual = _tx("Draft", "Send for Approval", "Pending", "Accounts User",
		             cond="doc.description")
		self._add_manual(manual)

		_build(TARGET, WF, self.states, self.generated)  # rebuild, same config

		sigs = _signatures(WF)
		self.assertIn(("Draft", "Send for Approval", "Pending", "Accounts User", "doc.description"),
		              sigs, "hand-added route was dropped by the rebuild")
		self.assertIn(("Pending", "Approve", "Approved", "Accounts User", "not doc.description"), sigs)
		self.assertEqual(len(sigs), 3)

	def test_generated_row_wins_over_restated_manual_row(self):
		# same state/action/role as a generated row but a different condition: the generator's
		# version must win, or the user is offered the same action twice
		self._add_manual(_tx("Pending", "Approve", "Approved", "Accounts User",
		                     cond='not (doc.get("description") or "")'))

		_build(TARGET, WF, self.states, self.generated)

		approvals = [s for s in _signatures(WF) if s[1] == "Approve"]
		self.assertEqual(len(approvals), 1, "restated row duplicated the Approve action")
		self.assertEqual(approvals[0][4], "not doc.description")

	def test_carried_row_brings_its_state_along(self):
		# PM Workflow.validate_docstatus throws on a transition whose state is not in the
		# states table, so a carried row has to drag its state back in with it
		self._add_manual(_tx("Pending", "Hold", "On Hold", "Accounts User"))
		doc = frappe.get_doc("PM Workflow", WF)
		doc.append("states", _states("On Hold")[0])
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		_build(TARGET, WF, self.states, self.generated)  # generated set has no On Hold

		self.assertIn("On Hold", frappe.get_all("PM Workflow Document State",
		                                        filters={"parent": WF}, pluck="state"))
		self.assertIn(("Pending", "Hold", "On Hold", "Accounts User", ""), _signatures(WF))

	def test_row_for_deleted_role_is_dropped_not_fatal(self):
		self._add_manual(_tx("Draft", "Send for Approval", "Pending", "No Such Role Here"),
		                 ignore_links=True)

		_build(TARGET, WF, self.states, self.generated)  # must not raise

		self.assertEqual(len(_signatures(WF)), 2)
