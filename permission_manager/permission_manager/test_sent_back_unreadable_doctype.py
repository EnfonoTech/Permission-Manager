# permission_manager/permission_manager/test_sent_back_unreadable_doctype.py
"""Sent back must not die because the user cannot read ONE document type.

`get_sent_back_documents` walks every document type that has a "sent back" state and reads
each with `frappe.get_list`, which enforces the user's permissions. For a user who may not
read one of those types (an approver with no Journal Entry role, say) `get_list` raises
PermissionError, and the whole call failed: the Sent back list was unavailable to every
non-System-Manager approver. A type the user cannot read has no documents for them to see,
so it is skipped, and the "No permission" message the check queued is dropped with it.

Nothing here touches a database: every collaborator is replaced, so the test runs without
a site (`python -m unittest permission_manager.permission_manager.test_sent_back_unreadable_doctype`).
"""

import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

import frappe

from permission_manager.permission_manager.api import approvals

USER = "approver@example.com"


def _doc(name: str, owner: str = USER):
    return frappe._dict(name=name, owner=owner, modified=datetime(2026, 11, 1, 10, 0), workflow_state="Draft")


class TestSentBackSkipsUnreadableTypes(unittest.TestCase):
    def setUp(self):
        self._saved = {
            key: getattr(frappe.local, key, None) for key in ("db", "session", "message_log", "flags")
        }
        frappe.local.db = MagicMock()
        frappe.local.session = frappe._dict(user=USER)
        frappe.local.message_log = []
        frappe.local.flags = frappe._dict()

        meta = MagicMock()
        meta.get_field.side_effect = lambda field: object() if field == "workflow_state" else None

        def get_list(doctype, **kwargs):
            if doctype == "Journal Entry":
                frappe.local.message_log.append({"message": "No permission for Journal Entry"})
                raise frappe.PermissionError("No permission for Journal Entry")
            return [_doc("PINV-1")]

        patches = [
            patch.object(approvals, "_hidden_doctypes", return_value=[]),
            patch.object(
                approvals,
                "sent_back_states",
                return_value={"Journal Entry": ["Draft"], "Purchase Invoice": ["Draft"]},
            ),
            patch.object(approvals, "_sent_back_reason", return_value={}),
            patch.object(approvals, "_returns_among", return_value=set()),
            patch.object(approvals, "transaction_label", side_effect=lambda doctype, is_return: doctype),
            patch.object(approvals, "transaction_filter_value", side_effect=lambda doctype, is_return: doctype),
            patch.object(frappe, "get_meta", return_value=meta),
            patch.object(frappe, "get_roles", return_value=["Accounts User"]),
            patch.object(frappe, "get_list", side_effect=get_list),
            patch.object(frappe, "get_all", return_value=[frappe._dict(for_submitter=USER)]),
            # The age in days reads System Settings (cache + db); the walk under test does not need it.
            patch.object(approvals, "nowdate", return_value="2026-11-19"),
            patch.object(approvals, "date_diff", return_value=18),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        frappe.local.db.table_exists.return_value = True
        frappe.local.db.get_value.return_value = "Ali Approver"

    def tearDown(self):
        for key, value in self._saved.items():
            setattr(frappe.local, key, value)

    def test_a_type_the_user_cannot_read_is_skipped_not_fatal(self):
        rows = approvals.get_sent_back_documents()

        self.assertEqual([(r["doctype"], r["docname"]) for r in rows], [("Purchase Invoice", "PINV-1")])

    def test_the_permission_message_it_queued_is_dropped(self):
        frappe.local.message_log.append({"message": "an earlier message that must survive"})

        approvals.get_sent_back_documents()

        self.assertEqual(
            [m["message"] for m in frappe.local.message_log], ["an earlier message that must survive"]
        )

    def test_a_type_the_user_can_read_is_still_listed_when_it_comes_first(self):
        # Order of the walk must not matter: the readable type is kept either way.
        with patch.object(
            approvals,
            "sent_back_states",
            return_value={"Purchase Invoice": ["Draft"], "Journal Entry": ["Draft"]},
        ):
            rows = approvals.get_sent_back_documents()

        self.assertEqual([r["docname"] for r in rows], ["PINV-1"])


if __name__ == "__main__":
    unittest.main()
