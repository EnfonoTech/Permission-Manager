# Copyright (c) 2026, Enfono Technologies and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PMApprovalGroup(Document):
	def validate(self):
		if not self.stages:
			frappe.throw(frappe._("Add at least one approval stage."))

	def on_update(self):
		# Auto-rebuild the approval workflows from all group configs, unless a bulk
		# operation (patch / migrate / seed) asked to defer it to a single rebuild.
		if frappe.flags.get("skip_approval_group_sync"):
			return
		from permission_manager.permission_manager.api.approval_group import rebuild_approval_workflows
		rebuild_approval_workflows()

	def on_trash(self):
		if frappe.flags.get("skip_approval_group_sync"):
			return
		from permission_manager.permission_manager.api.approval_group import rebuild_approval_workflows
		# rebuild after the row is gone
		frappe.enqueue(rebuild_approval_workflows, enqueue_after_commit=True, queue="short")
