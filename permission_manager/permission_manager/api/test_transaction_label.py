# permission_manager/permission_manager/api/test_transaction_label.py
"""What the approval inbox calls a transaction, and what the filter behind that label means.

The label is the whole point of the feature -- an approver of credit notes was reading rows
headed "Sales Invoice" -- but the filter value is where it can go wrong quietly: it has to carry
the doctype, because "Sales Return" names three different tables, and a document type with no
returns must keep the bare value it has always had so an older client keeps filtering.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api.approvals import (
    RETURN_LABELS,
    _returns_among,
    split_transaction_filter,
    transaction_filter_value,
    transaction_label,
)


class TestTransactionLabel(FrappeTestCase):
    def test_a_return_is_called_a_return(self):
        self.assertEqual(transaction_label("Sales Invoice", True), "Sales Return")
        self.assertEqual(transaction_label("Delivery Note", True), "Sales Return")
        self.assertEqual(transaction_label("Purchase Invoice", True), "Purchase Return")
        self.assertEqual(transaction_label("Purchase Receipt", True), "Purchase Return")

    def test_everything_else_keeps_its_own_name(self):
        self.assertEqual(transaction_label("Sales Invoice", False), "Sales Invoice")
        self.assertEqual(transaction_label("Payment Entry", False), "Payment Entry")
        # a doctype with no return reading is unaffected by the flag
        self.assertEqual(transaction_label("Journal Entry", True), "Journal Entry")

    def test_the_filter_value_carries_the_doctype(self):
        """"Sales Return" alone names three tables; the server has to know which."""
        self.assertEqual(transaction_filter_value("Sales Invoice", True), "Sales Invoice::1")
        self.assertEqual(transaction_filter_value("Sales Invoice", False), "Sales Invoice::0")
        self.assertEqual(
            split_transaction_filter("Sales Invoice::1"), ("Sales Invoice", 1)
        )
        self.assertEqual(
            split_transaction_filter("Sales Invoice::0"), ("Sales Invoice", 0)
        )

    def test_a_doctype_without_returns_keeps_the_bare_value(self):
        """An older client sending a plain doctype must keep working, and does: either reading."""
        self.assertEqual(transaction_filter_value("Payment Entry", False), "Payment Entry")
        self.assertEqual(split_transaction_filter("Payment Entry"), ("Payment Entry", None))
        self.assertEqual(split_transaction_filter("Sales Invoice"), ("Sales Invoice", None))

    def test_no_filter_at_all(self):
        for empty in ("", None, "null", "undefined"):
            with self.subTest(value=empty):
                self.assertEqual(split_transaction_filter(empty), (None, None))

    def test_returns_among_ignores_doctypes_that_cannot_have_returns(self):
        found = _returns_among([("Journal Entry", "JV-0001"), ("User", "Administrator")])
        self.assertEqual(found, set())

    def test_returns_among_survives_a_doctype_that_is_not_there(self):
        """An app removed from the site must not take the whole inbox down."""
        RETURN_LABELS["_Test Vanished Doctype"] = "Ghost Return"
        try:
            self.assertEqual(_returns_among([("_Test Vanished Doctype", "X-0001")]), set())
        finally:
            RETURN_LABELS.pop("_Test Vanished Doctype", None)

    def test_a_real_return_is_found(self):
        name = frappe.db.get_value("Sales Invoice", {"is_return": 1, "docstatus": ["<", 2]}, "name")
        if not name:
            self.skipTest("no credit note on this site")
        self.assertIn(("Sales Invoice", name), _returns_among([("Sales Invoice", name)]))
        plain = frappe.db.get_value("Sales Invoice", {"is_return": 0, "docstatus": ["<", 2]}, "name")
        if plain:
            self.assertNotIn(("Sales Invoice", plain), _returns_among([("Sales Invoice", plain)]))
