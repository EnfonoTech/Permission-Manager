# permission_manager/permission_manager/patches/mark_reassigned_actions.py
"""Stamp the approvals an administrator reassigned before the stamp existed.

reassign_workflow_approver now records `is_reassigned` on the action it moves, and that stamp is
what lets the new approver act on the document without holding the role its step asks for. An
approval reassigned earlier carries no stamp, so its assignee has the document in their inbox and
no buttons on the form.

The only record of an old reassignment is the audit comment the function always wrote on the
document ("Approver Reassigned ... To: <user> By: <user>"), so read that back. An action is
stamped only when the newest such comment, written after the action was created, names the action's
current assignee. A matrix-routed action is pinned to a named user in exactly the same way and has
no such comment, so it is left alone: the Employee Approval Chain keeps deciding who may act on it.

Idempotent: a stamped action is no longer selected, so a re-run finds nothing to do.
"""

import re

import frappe


def execute():
	if not frappe.db.has_column("PM Workflow Action", "is_reassigned"):
		return

	actions = frappe.get_all(
		"PM Workflow Action",
		filters={
			"status": "Open",
			"is_adhoc": 0,
			"is_reassigned": 0,
			"assigned_to": ["is", "set"],
		},
		fields=["name", "reference_doctype", "reference_name", "assigned_to", "creation"],
	)

	for action in actions:
		by = _reassigned_by(action)
		if by is None:
			continue
		values = {"is_reassigned": 1}
		if by and frappe.db.exists("User", by):
			values["reassigned_by"] = by
		frappe.db.set_value("PM Workflow Action", action.name, values, update_modified=False)


def _reassigned_by(action):
	"""Who reassigned this action to its current assignee: a user id, "" if the comment does not
	say, or None if nobody did."""
	comments = frappe.get_all(
		"Comment",
		filters={
			"comment_type": "Workflow",
			"reference_doctype": action.reference_doctype,
			"reference_name": action.reference_name,
			"content": ["like", "%Approver Reassigned%"],
			"creation": [">=", action.creation],
		},
		fields=["content"],
		order_by="creation desc",
		limit=1,
	)
	if not comments:
		return None

	# tags become spaces so "<em>user</em><br>By:" cannot run together into one token
	text = re.sub(r"<[^>]*>", " ", comments[0].content or "")
	match = re.search(r"To:\s*(\S+)\s+By:\s*(\S+)", text)
	if not match or match.group(1) != action.assigned_to:
		return None
	return match.group(2)
