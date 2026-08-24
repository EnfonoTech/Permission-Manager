"""Tests for threshold-based approval of Sales Invoice returns.

Every question this module answers is a function of PM Settings and three fields on the
document, so the documents here are plain dicts. What is being tested is the decision — and,
importantly, that the decision reaches the PM Workflow engine: a workflow on Sales Invoice must
govern returns above the threshold and nothing else.

    bench --site <scratch-site> run-tests --module permission_manager.permission_manager.api.test_sales_return_approval
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api import sales_return_approval as approval
from permission_manager.permission_manager.workflow import workflow_applies


class TestSalesReturnApproval(FrappeTestCase):
    def tearDown(self):
        self.configure(enabled=0)

    def configure(self, enabled=1, by_amount=1, threshold=500, mandatory=1):
        settings = frappe.get_doc("PM Settings")
        settings.si_return_approval_enabled = enabled
        settings.si_return_amount_restriction = by_amount
        settings.si_return_approval_threshold = threshold
        settings.si_return_requires_workflow = mandatory
        settings.save(ignore_permissions=True)
        frappe.clear_cache(doctype="PM Settings")

    def make_return(self, amount):
        # a credit note carries its totals negative; the rule reads the absolute value
        return frappe._dict(
            doctype="Sales Invoice", is_return=1, base_grand_total=-amount, company="_Test Company"
        )

    def make_invoice(self, amount=10000):
        return frappe._dict(
            doctype="Sales Invoice", is_return=0, base_grand_total=amount, company="_Test Company"
        )

    # ── the switch ───────────────────────────────────────────────────────────
    def test_off_by_default(self):
        self.configure(enabled=0)
        self.assertFalse(approval.needs_approval(self.make_return(100000)))
        # and a workflow on Sales Invoice keeps governing the whole doctype, as before
        self.assertTrue(workflow_applies("Sales Invoice", self.make_invoice()))

    # ── the threshold ────────────────────────────────────────────────────────
    def test_above_the_threshold_needs_approval(self):
        self.configure(threshold=500)
        self.assertTrue(approval.needs_approval(self.make_return(500.001)))
        self.assertTrue(approval.needs_approval(self.make_return(1000)))

    def test_on_and_under_the_threshold_does_not(self):
        self.configure(threshold=500)
        self.assertFalse(approval.needs_approval(self.make_return(500)))
        self.assertFalse(approval.needs_approval(self.make_return(499.999)))

    def test_without_the_amount_restriction_every_return_needs_approval(self):
        self.configure(by_amount=0, threshold=500)
        self.assertTrue(approval.needs_approval(self.make_return(1)))

    def test_the_threshold_is_configurable(self):
        self.configure(threshold=50)
        self.assertTrue(approval.needs_approval(self.make_return(51)))
        self.configure(threshold=5000)
        self.assertFalse(approval.needs_approval(self.make_return(51)))

    # ── an ordinary invoice is never routed by this ───────────────────────────
    def test_an_ordinary_invoice_never_needs_approval(self):
        self.configure(by_amount=0)
        self.assertFalse(approval.needs_approval(self.make_invoice(1000000)))

    def test_a_workflow_on_sales_invoice_governs_returns_only(self):
        self.configure(threshold=500)
        self.assertFalse(workflow_applies("Sales Invoice", self.make_invoice()))
        self.assertFalse(workflow_applies("Sales Invoice", self.make_return(100)))
        self.assertTrue(workflow_applies("Sales Invoice", self.make_return(600)))
        # other doctypes are untouched by any of this
        self.assertTrue(workflow_applies("Journal Entry", frappe._dict(doctype="Journal Entry")))

    def test_a_doctype_level_question_is_answered_permissively(self):
        """No document in hand means no basis to unroute anything."""
        self.configure()
        self.assertTrue(workflow_applies("Sales Invoice", None))

    # ── mandatory workflow ───────────────────────────────────────────────────
    def test_mandatory_workflow_only_binds_returns_that_need_approval(self):
        self.configure(threshold=500, mandatory=1)
        self.assertTrue(approval.must_have_workflow(self.make_return(600)))
        self.assertFalse(approval.must_have_workflow(self.make_return(100)))

    def test_mandatory_can_be_turned_off(self):
        self.configure(threshold=500, mandatory=0)
        self.assertTrue(approval.needs_approval(self.make_return(600)))
        self.assertFalse(approval.must_have_workflow(self.make_return(600)))
