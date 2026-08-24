"""Tests for the sales return window in PM Settings.

The window is arithmetic over two dates and an override table, so the documents here are plain
dicts rather than real invoices — the point under test is the rule, not ERPNext's invoicing.

    bench --site <scratch-site> run-tests --module permission_manager.permission_manager.api.test_sales_return_control
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, getdate, nowdate

from permission_manager.permission_manager.api import sales_return_control as control

OVERRIDE_ROLE = "_Test Return Override Role"
OVERRIDE_USER = "_test_return_override@example.com"
PLAIN_USER = "_test_return_plain@example.com"


class TestSalesReturnControl(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not frappe.db.exists("Role", OVERRIDE_ROLE):
            frappe.get_doc({"doctype": "Role", "role_name": OVERRIDE_ROLE}).insert()
        for email in (OVERRIDE_USER, PLAIN_USER):
            if not frappe.db.exists("User", email):
                user = frappe.get_doc(
                    {
                        "doctype": "User",
                        "email": email,
                        "first_name": email.split("@")[0],
                        "send_welcome_email": 0,
                    }
                )
                user.insert(ignore_permissions=True)

    def tearDown(self):
        frappe.set_user("Administrator")
        self.configure(enabled=0)

    def configure(self, enabled=1, days=7, counted_from=control.FROM_INVOICE, overrides=None):
        settings = frappe.get_doc("PM Settings")
        settings.restrict_sales_return = enabled
        settings.sales_return_days = days
        settings.sales_return_days_from = counted_from
        settings.set("sales_return_overrides", [])
        for override_type, override in overrides or []:
            settings.append(
                "sales_return_overrides", {"override_type": override_type, "override": override}
            )
        settings.save(ignore_permissions=True)
        frappe.clear_cache(doctype="PM Settings")

    def make_return(self, posting_date=None, against="SINV-TEST-0001"):
        return frappe._dict(
            doctype="Sales Invoice",
            docstatus=0,
            is_return=1,
            return_against=against,
            posting_date=posting_date or nowdate(),
        )

    # ── the switch ───────────────────────────────────────────────────────────
    def test_off_by_default_lets_anything_through(self):
        self.configure(enabled=0)
        doc = self.make_return(posting_date=nowdate())
        with patch.object(control, "_original_date", return_value=getdate(add_days(nowdate(), -400))):
            control.validate_return_window(doc)  # must not raise

    # ── invoice-date basis ───────────────────────────────────────────────────
    def test_inside_the_window_is_allowed(self):
        self.configure(days=7)
        doc = self.make_return()
        with patch.object(control, "_original_date", return_value=getdate(add_days(nowdate(), -3))):
            self.assertEqual(control.age_in_days(doc), 3)
            control.validate_return_window(doc)

    def test_on_the_last_allowed_day_is_allowed(self):
        self.configure(days=7)
        doc = self.make_return()
        with patch.object(control, "_original_date", return_value=getdate(add_days(nowdate(), -7))):
            control.validate_return_window(doc)

    def test_past_the_window_is_refused(self):
        self.configure(days=7)
        doc = self.make_return()
        with patch.object(control, "_original_date", return_value=getdate(add_days(nowdate(), -8))):
            self.assertRaises(frappe.ValidationError, control.validate_return_window, doc)

    def test_a_return_naming_no_invoice_is_left_alone(self):
        """A standalone credit note has no original date to measure against."""
        self.configure(days=0)
        doc = self.make_return(against=None)
        self.assertIsNone(control.age_in_days(doc))
        control.validate_return_window(doc)

    # ── posting-date basis ───────────────────────────────────────────────────
    def test_posting_date_basis_measures_from_today(self):
        self.configure(days=2, counted_from=control.FROM_POSTING)
        self.assertEqual(control.age_in_days(self.make_return(posting_date=add_days(nowdate(), -2))), 2)
        control.validate_return_window(self.make_return(posting_date=add_days(nowdate(), -2)))
        self.assertRaises(
            frappe.ValidationError,
            control.validate_return_window,
            self.make_return(posting_date=add_days(nowdate(), -3)),
        )

    # ── who may ignore it ────────────────────────────────────────────────────
    def test_a_named_role_may_override(self):
        self.configure(days=1, overrides=[("Role", OVERRIDE_ROLE)])
        user = frappe.get_doc("User", OVERRIDE_USER)
        user.add_roles(OVERRIDE_ROLE)
        frappe.set_user(OVERRIDE_USER)
        self.assertTrue(control.may_override())
        doc = self.make_return()
        with patch.object(control, "_original_date", return_value=getdate(add_days(nowdate(), -90))):
            control.validate_return_window(doc)

    def test_a_user_not_named_may_not(self):
        self.configure(days=1, overrides=[("User", OVERRIDE_USER)])
        frappe.set_user(PLAIN_USER)
        self.assertFalse(control.may_override())

    # ── non-returns are none of its business ─────────────────────────────────
    def test_an_ordinary_invoice_is_untouched(self):
        self.configure(days=0)
        doc = frappe._dict(doctype="Sales Invoice", docstatus=0, is_return=0, posting_date=nowdate())
        control.validate_return_window(doc)
