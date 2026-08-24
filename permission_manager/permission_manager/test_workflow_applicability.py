"""Tests for the workflow applicability hook — the extension point itself, not any client policy."""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager import workflow as wf

CALLS = []


def resolver_says_no(doctype, doc=None):
	CALLS.append((doctype, bool(doc)))
	if doctype != "Sales Invoice":
		return None
	if doc is None:
		return {"conditional": True}
	return {"applies": False, "conditional": True}


def resolver_guards(doctype, doc=None):
	if doctype != "Sales Invoice" or doc is None:
		return None
	return {"applies": True, "guard_submit": True, "require_workflow": True, "message": "needs approval"}


def resolver_explodes(doctype, doc=None):
	raise ValueError("this resolver is broken")


class TestWorkflowApplicability(FrappeTestCase):
	def setUp(self):
		CALLS.clear()

	def hook(self, *methods):
		"""Point the hook at test resolvers for the length of one test."""
		frappe.flags.hooks = None
		return self.patch_hooks({wf.APPLICABILITY_HOOK: list(methods)})

	def patch_hooks(self, hooks):
		from unittest.mock import patch

		original = frappe.get_hooks

		def fake(hook=None, default="_KEEP_DEFAULT_LIST", app_name=None):
			if hook in hooks:
				return hooks[hook]
			return original(hook, default, app_name)

		return patch.object(frappe, "get_hooks", side_effect=fake)

	def test_no_resolver_means_everything_is_routed(self):
		with self.hook():
			self.assertTrue(wf.workflow_applies("Sales Invoice", frappe._dict(doctype="Sales Invoice")))

	def test_a_resolver_can_unroute_a_document(self):
		with self.hook(f"{__name__}.resolver_says_no"):
			self.assertFalse(wf.workflow_applies("Sales Invoice", frappe._dict(doctype="Sales Invoice")))
			# and holds no opinion about anything else
			self.assertTrue(wf.workflow_applies("Journal Entry", frappe._dict(doctype="Journal Entry")))

	def test_a_broken_resolver_is_skipped_not_fatal(self):
		"""A bad answer must never silently unroute an approval chain."""
		with self.hook(f"{__name__}.resolver_explodes"):
			self.assertTrue(wf.workflow_applies("Sales Invoice", frappe._dict(doctype="Sales Invoice")))

	def test_guard_verdicts_are_collected(self):
		with self.hook(f"{__name__}.resolver_guards"):
			guard = wf._guard_verdict(frappe._dict(doctype="Sales Invoice", name="SINV-1"))
			self.assertTrue(guard["guard_submit"])
			self.assertTrue(guard["require_workflow"])
			self.assertEqual(guard["message"], "needs approval")

	def test_a_doctype_question_reaches_the_resolver_without_a_document(self):
		with self.hook(f"{__name__}.resolver_says_no"):
			verdicts = wf.applicability_verdicts("Sales Invoice")
			self.assertEqual(verdicts, [{"conditional": True}])
			self.assertIn(("Sales Invoice", False), CALLS)
