# permission_manager/permission_manager/api/test_sent_back.py
"""The Sent Back tab: documents an approver rejected or returned for correction.

What is dangerous here is not the list but its edges -- which states count (read from the
workflow, never hardcoded), which documents prove they really came back (a Draft target is also
where an untouched draft sits), and who is allowed to see somebody else's rejected voucher.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api.approvals import (
    _sent_back_reason,
    get_sent_back_documents,
    sent_back_states,
)

ROW_KEYS = {
    "doctype", "transaction", "transaction_filter", "docname", "state",
    "submitted_by", "sent_back_by", "sent_back_on", "role", "reason", "days", "doc_url",
}


class TestSentBack(FrappeTestCase):
    def tearDown(self):
        frappe.set_user("Administrator")

    def test_the_states_come_from_the_workflow_not_from_a_list_in_the_code(self):
        states = sent_back_states()
        self.assertIsInstance(states, dict)
        for doctype, values in states.items():
            with self.subTest(doctype=doctype):
                self.assertIsInstance(values, set)
                self.assertTrue(values, "a doctype with no state is not a doctype to report")
                self.assertNotIn("", values)

    def test_every_reported_state_is_a_transition_target_of_an_active_workflow(self):
        for doctype, values in sent_back_states().items():
            for state in values:
                with self.subTest(doctype=doctype, state=state):
                    self.assertTrue(
                        frappe.db.sql(
                            """SELECT 1 FROM `tabPM Workflow Transition` t
                               JOIN `tabPM Workflow` w ON w.name = t.parent
                               WHERE w.is_active = 1 AND w.document_type = %s
                                 AND t.next_state = %s
                                 AND (t.is_return_for_correction = 1 OR t.action = 'Reject')
                               LIMIT 1""",
                            (doctype, state),
                        )
                    )

    def test_stock_entry_is_left_to_the_warehouse_dashboard(self):
        """Its approvals live there; a storekeeper should not have to look in two places."""
        rows = get_sent_back_documents(all_users=1)
        self.assertEqual([r for r in rows if r["doctype"] == "Stock Entry"], [])

    def test_every_row_carries_what_the_screen_needs(self):
        rows = get_sent_back_documents(all_users=1)
        if not rows:
            self.skipTest("nothing sent back on this site")
        for row in rows:
            with self.subTest(docname=row.get("docname")):
                self.assertTrue(ROW_KEYS.issubset(set(row)), f"missing {ROW_KEYS - set(row)}")
                self.assertGreaterEqual(row["days"], 0)
                self.assertTrue(row["doc_url"].startswith("/app/"))

    def test_the_oldest_comes_first(self):
        """The list is a queue of neglect; the thing waiting longest has to be at the top."""
        rows = get_sent_back_documents(all_users=1)
        if len(rows) < 2:
            self.skipTest("need two rows to compare")
        self.assertEqual([r["days"] for r in rows], sorted((r["days"] for r in rows), reverse=True))

    def test_a_plain_user_cannot_ask_for_everybody(self):
        """all_users is a System Manager's switch, and asking for it is not being granted it."""
        plain = frappe.db.sql(
            """SELECT u.name FROM `tabUser` u
               WHERE u.enabled = 1 AND u.user_type = 'System User'
                 AND u.name NOT IN ('Administrator', 'Guest')
                 AND NOT EXISTS (SELECT 1 FROM `tabHas Role` r
                                 WHERE r.parent = u.name AND r.role = 'System Manager')
               LIMIT 1"""
        )
        if not plain:
            self.skipTest("no non-System-Manager user on this site")

        user = plain[0][0]
        frappe.set_user(user)
        rows = get_sent_back_documents(all_users=1)
        for row in rows:
            with self.subTest(docname=row["docname"]):
                submitter = frappe.db.get_value("User", user, "full_name") or user
                self.assertIn(submitter, (row["submitted_by"], user))

    def test_the_reason_is_read_out_of_either_comment_shape(self):
        """The engine writes "Reason:" when returning and "Note:" on a plain state move."""
        todo = frappe.get_doc({"doctype": "ToDo", "description": "_test sent back reason"}).insert()
        try:
            for html, expected in (
                ("<div><strong>↩ Returned for Correction</strong> by X</div>"
                 "<div><strong>✏ Reason:</strong> <em>vat no. not mentioned</em></div>",
                 "vat no. not mentioned"),
                ("<div><strong>⊙ Moved to</strong> <span>Rejected</span></div>"
                 "<div><strong>💬 Note:</strong> <em>please fill the branch</em></div>",
                 "please fill the branch"),
            ):
                with self.subTest(expected=expected):
                    frappe.db.delete("Comment", {"reference_doctype": "ToDo",
                                                 "reference_name": todo.name})
                    frappe.get_doc({
                        "doctype": "Comment",
                        "comment_type": "Workflow",
                        "reference_doctype": "ToDo",
                        "reference_name": todo.name,
                        "content": html,
                    }).insert(ignore_permissions=True)

                    self.assertEqual(_sent_back_reason("ToDo", todo.name)["reason"], expected)
        finally:
            frappe.db.delete("Comment", {"reference_doctype": "ToDo", "reference_name": todo.name})
            todo.delete()

    def test_a_document_with_no_reason_still_reports_who_and_when(self):
        todo = frappe.get_doc({"doctype": "ToDo", "description": "_test no reason"}).insert()
        try:
            reason = _sent_back_reason("ToDo", todo.name)
            self.assertEqual(reason["reason"], "")
            self.assertEqual(reason["sent_back_by"], "")
            self.assertIsNone(reason["sent_back_on"])
        finally:
            todo.delete()
