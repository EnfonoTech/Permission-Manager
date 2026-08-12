# permission_manager/permission_manager/api/test_approval_group.py
"""Rebuild safety for the generated PM Workflows.

`rebuild_approval_workflows()` deletes each generated PM Workflow and re-inserts it from
PM Approval Group config. Routes a site added by hand exist only in the database, so the
rebuild used to delete them with no trace — that is how Steel Force lost the Counter Sale
route on Journal Entry (2026-07-25).

Which rows survive is decided by provenance: `_t()` stamps every generated row with
is_generated=1, so the rebuild knows what it owns and what a human added.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api.approval_group import (
	_build, _group_stage_transitions, _st, _t)

TARGET = "ToDo"  # any doctype will do: the workflow only needs something to point at
WF = "Test Carry Over Workflow"


def _manual(state, action, nxt, role, cond=None):
	"""A row as the UI would add it — no is_generated stamp."""
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
		# state and action on a transition are Links, so the masters have to exist first —
		# the same thing _ensure_masters() does for the generated states
		self._masters = []
		for dt, field, value in (("Workflow State", "workflow_state_name", "On Hold"),
		                         ("Workflow Action Master", "workflow_action_name", "Hold")):
			if not frappe.db.exists(dt, value):
				frappe.get_doc({"doctype": dt, field: value}).insert(ignore_permissions=True)
				self._masters.append((dt, value))
		self.states = [_st("Draft", "0", "System Manager"), _st("Pending", "0", "System Manager"),
		               _st("Approved", "0", "System Manager"), _st("Rejected", "0", "System Manager")]
		self.generated = [
			_t("Draft", "Send for Approval", "Pending", "System Manager"),
			_t("Pending", "Approve", "Approved", "Accounts User", cond="not doc.description"),
		]
		_build(TARGET, WF, self.states, self.generated)

	def tearDown(self):
		self._drop()
		for dt, value in getattr(self, "_masters", []):
			frappe.delete_doc(dt, value, force=1, ignore_missing=True)
		frappe.db.commit()

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
		self._add_manual(_manual("Draft", "Send for Approval", "Pending", "Accounts User",
		                         cond="doc.description"))

		_build(TARGET, WF, self.states, self.generated)  # rebuild, same config

		sigs = _signatures(WF)
		self.assertIn(("Draft", "Send for Approval", "Pending", "Accounts User", "doc.description"),
		              sigs, "hand-added route was dropped by the rebuild")
		self.assertIn(("Pending", "Approve", "Approved", "Accounts User", "not doc.description"), sigs)
		self.assertEqual(len(sigs), 3)

	def test_hand_added_row_overlapping_config_is_still_kept(self):
		# Same state/action/role as a generated row but a broader condition. The rebuild must not
		# narrow it: at Steel Force the equivalent row covered three journal templates where the
		# generated one covered a single template, so dropping it removed live routing.
		self._add_manual(_manual("Pending", "Approve", "Approved", "Accounts User",
		                         cond="doc.description in ('a', 'b')"))

		_build(TARGET, WF, self.states, self.generated)

		sigs = _signatures(WF)
		self.assertIn(("Pending", "Approve", "Approved", "Accounts User", "doc.description in ('a', 'b')"),
		              sigs, "hand-added row was narrowed to the generated one")
		self.assertIn(("Pending", "Approve", "Approved", "Accounts User", "not doc.description"), sigs)

	def test_generated_rows_are_replaced_not_accumulated(self):
		# the other half of the contract: config still owns its own rows, so editing a group
		# actually changes routing instead of piling a second row on top
		changed = [_t("Draft", "Send for Approval", "Pending", "System Manager"),
		           _t("Pending", "Approve", "Approved", "Purchase Manager", cond="not doc.description")]

		_build(TARGET, WF, self.states, changed)

		sigs = _signatures(WF)
		self.assertIn(("Pending", "Approve", "Approved", "Purchase Manager", "not doc.description"), sigs)
		self.assertNotIn(("Pending", "Approve", "Approved", "Accounts User", "not doc.description"),
		                 sigs, "superseded generated row survived, so config edits do nothing")
		self.assertEqual(len(sigs), 2)

	def test_carried_row_brings_its_state_along(self):
		# state and transition have to go in together: validate_docstatus rejects a transition
		# whose state is not already in the table, so two separate saves cannot get there
		doc = frappe.get_doc("PM Workflow", WF)
		doc.append("states", _st("On Hold", "0", "System Manager"))
		doc.append("transitions", _manual("Pending", "Hold", "On Hold", "Accounts User"))
		doc.save(ignore_permissions=True)
		frappe.db.commit()

		_build(TARGET, WF, self.states, self.generated)  # generated set has no On Hold

		self.assertIn("On Hold", frappe.get_all("PM Workflow Document State",
		                                        filters={"parent": WF}, pluck="state"))
		self.assertIn(("Pending", "Hold", "On Hold", "Accounts User", ""), _signatures(WF))

	def test_unstamped_copy_of_a_generated_row_is_not_duplicated(self):
		# every row predating the is_generated field looks hand-added. A rebuild must not
		# re-attach one that is identical to a row it just generated, or the first rebuild
		# after this field ships would double every inherited row.
		legacy = dict(self.generated[1])
		legacy.pop("is_generated")
		self._add_manual(legacy)
		self.assertEqual(len(_signatures(WF)), 2)  # same signature, so still two distinct rows

		_build(TARGET, WF, self.states, self.generated)

		rows = frappe.get_all("PM Workflow Transition",
		                      filters={"parent": WF, "parenttype": "PM Workflow"},
		                      fields=["state", "action", "allowed"])
		approvals = [r for r in rows if r.action == "Approve"]
		self.assertEqual(len(approvals), 1, "legacy copy of a generated row was duplicated")
		self.assertEqual(len(rows), 2)

	def test_the_same_hand_added_route_twice_is_carried_once(self):
		row = _manual("Draft", "Send for Approval", "Pending", "Accounts User", cond="doc.description")
		self._add_manual(row)
		self._add_manual(row)

		_build(TARGET, WF, self.states, self.generated)

		matches = frappe.get_all("PM Workflow Transition",
		                         filters={"parent": WF, "allowed": "Accounts User",
		                                  "action": "Send for Approval"})
		self.assertEqual(len(matches), 1, "duplicate hand-added rows accumulated across rebuilds")

	def test_email_alert_switch_is_not_flipped_back_on(self):
		frappe.db.set_value("PM Workflow", WF, "send_email_alert", 0)
		frappe.clear_document_cache("PM Workflow", WF)
		frappe.db.commit()

		_build(TARGET, WF, self.states, self.generated)

		self.assertEqual(frappe.db.get_value("PM Workflow", WF, "send_email_alert"), 0,
		                 "rebuild re-enabled approval emails the site had turned off")

	def test_row_for_deleted_role_is_dropped_not_fatal(self):
		self._add_manual(_manual("Draft", "Send for Approval", "Pending", "No Such Role Here"),
		                 ignore_links=True)

		_build(TARGET, WF, self.states, self.generated)  # must not raise

		self.assertEqual(len(_signatures(WF)), 2)


def _stage(role, self_appr=0, attach=0):
	return {"approver_role": role, "require_attachment": attach,
	        "require_comment": 0, "allow_self_approval": self_appr}


def _approve_row(rows, state):
	return next(r for r in rows if r["state"] == state and r["action"] == "Approve")


class TestStageSelfApproval(FrappeTestCase):
	"""Self-approval is opt-in per stage.

	Every generated approver row used to be allow_self_approval=0 with no way to change it:
	the field was not on PM Approval Group Stage, ticking the generated row was undone by the
	next rebuild, and a hand-added copy was dropped because allow_self_approval is not part of
	_ROW_KEY. Stages carry the flag now, so the generator has to honour it.
	"""

	GROUPS = {"Telecom": {
		"stages": [_stage("IT Head"), _stage("Bahrain Accountant", self_appr=1)],
		"templates": ["Telecommunication"]}}

	def _rows(self):
		return _group_stage_transitions(
			self.GROUPS,
			lambda g, c: "doc.from_template in ('Telecommunication',)",
			"Pending Dept", ["Pending Accounts"])

	def test_stage_without_the_flag_still_needs_a_second_person(self):
		self.assertEqual(_approve_row(self._rows(), "Pending Dept")["allow_self_approval"], 0)

	def test_flagged_stage_may_clear_its_own_document(self):
		self.assertEqual(_approve_row(self._rows(), "Pending Accounts")["allow_self_approval"], 1)

	def test_reject_is_never_self_approving(self):
		for r in self._rows():
			if r["action"] == "Reject":
				self.assertEqual(r["allow_self_approval"], 0)

	def test_default_is_off_when_the_stage_omits_the_field(self):
		rows = _group_stage_transitions(
			{"Legacy": {"stages": [{"approver_role": "Accountant"}], "templates": ["X"]}},
			lambda g, c: "doc.from_template in ('X',)", "Pending Dept", ["Pending Accounts"])
		self.assertEqual(_approve_row(rows, "Pending Dept")["allow_self_approval"], 0)


class TestPIImportApprover(FrappeTestCase):
	"""Foreign-currency purchase invoices route to the dedicated approver role.

	`Purchase Manager` is an ERPNext built-in held by everyone who touches buying, so using it
	as the import approver defeats the point of having a dedicated approval role — which is why
	the local path already uses one (`Purchase Assistant`). The resolver keeps sites that never
	created the dedicated role on the built-in, so a rebuild there cannot emit a transition
	naming a Role that does not exist.
	"""

	def test_dedicated_role_is_used_when_it_exists(self):
		from permission_manager.permission_manager.api.approval_group import (
			PI_IMPORT_ROLE, pi_import_role)

		if not frappe.db.exists("Role", PI_IMPORT_ROLE):
			frappe.get_doc({"doctype": "Role", "role_name": PI_IMPORT_ROLE}).insert(
				ignore_permissions=True, ignore_if_duplicate=True)
		self.assertEqual(pi_import_role(), PI_IMPORT_ROLE)

	def test_falls_back_to_the_builtin_when_the_role_is_absent(self):
		from permission_manager.permission_manager.api import approval_group

		original = approval_group.PI_IMPORT_ROLE
		approval_group.PI_IMPORT_ROLE = "_Test Role That Does Not Exist"
		try:
			self.assertEqual(approval_group.pi_import_role(),
			                 approval_group.PI_IMPORT_ROLE_FALLBACK)
		finally:
			approval_group.PI_IMPORT_ROLE = original

	def test_the_two_paths_do_not_share_a_role(self):
		"""The whole point: local and import must not collapse onto one approver."""
		from permission_manager.permission_manager.api.approval_group import (
			PI_LOCAL_ROLE, pi_import_role)

		self.assertNotEqual(PI_LOCAL_ROLE, pi_import_role())
