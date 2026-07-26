# permission_manager/permission_manager/api/test_dues_inbox.py
"""Dues Inbox: configuration drives the query, so configuration is what these tests attack.

The dangerous property of this feature is that field names come from a DocType an admin edits.
Tests below cover the honest cases (buckets, follow-up state, role scoping) and the dishonest
one — a source configured with a field name that does not exist, or one carrying SQL.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate, today

from permission_manager.permission_manager.api.dues_inbox import (
    _bucket_of,
    get_dues_inbox,
    save_follow_up,
)

SOURCE = "_Test Dues Source SI"


def _make_source(**overrides):
    if frappe.db.exists("PM Dues Source", SOURCE):
        frappe.delete_doc("PM Dues Source", SOURCE, force=True)
    spec = {
        "doctype": "PM Dues Source",
        "source_name": SOURCE,
        "label": "Test receivables",
        "direction": "Receivable",
        "voucher_doctype": "Sales Invoice",
        "date_field": "due_date",
        "amount_field": "outstanding_amount",
        "party_field": "customer",
        "party_type": "Customer",
        "company_field": "company",
        "branch_field": None,
        "enabled": 1,
    }
    spec.update(overrides)
    return frappe.get_doc(spec).insert(ignore_permissions=True)


class TestDuesInboxConfig(FrappeTestCase):
    def tearDown(self):
        if frappe.db.exists("PM Dues Source", SOURCE):
            frappe.delete_doc("PM Dues Source", SOURCE, force=True)
        frappe.db.commit()

    # ── configuration is validated, not trusted ───────────────────────────────
    def test_unknown_field_is_refused_on_save(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(date_field="no_such_field_here")

    def test_field_of_the_wrong_type_is_refused(self):
        # customer is a Link, not a date — accepting it would produce plausible nonsense
        with self.assertRaises(frappe.ValidationError):
            _make_source(date_field="customer")
        with self.assertRaises(frappe.ValidationError):
            _make_source(amount_field="customer")

    def test_sql_in_a_field_name_never_reaches_the_query(self):
        # the guard is that field names are resolved through the meta; anything else is refused
        with self.assertRaises(frappe.ValidationError):
            _make_source(amount_field="outstanding_amount from `tabSales Invoice` where 1=1 --")

    def test_child_table_is_refused_as_a_source(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(voucher_doctype="Sales Invoice Item", date_field="creation",
                         amount_field="amount", party_field=None, party_type=None)

    def test_bad_json_in_extra_filters_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(extra_filters="{not json")

    def test_extra_filters_naming_a_missing_field_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(extra_filters=json.dumps({"nope_not_here": 1}))

    def test_both_party_type_and_party_type_field_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(party_type="Customer", party_type_field="party_type")

    # ── the inbox itself ──────────────────────────────────────────────────────
    def test_inbox_returns_the_configured_source(self):
        _make_source()

        data = get_dues_inbox()

        names = [s["name"] for s in data["sources"]]
        self.assertIn(SOURCE, names)
        self.assertEqual(data["as_on"], str(nowdate()))
        for row in data["rows"]:
            if row["source"] != SOURCE:
                continue
            self.assertEqual(row["voucher_doctype"], "Sales Invoice")
            self.assertEqual(row["direction"], "Receivable")
            self.assertGreater(row["amount"], 0)
            self.assertIn(row["bucket"], ("not_due", "0-30", "31-60", "61-90", "90+"))
            self.assertIn(row["worklist"], ("untouched", "promised", "snoozed", "touched"))

    def test_disabled_source_disappears(self):
        src = _make_source()
        self.assertIn(SOURCE, [s["name"] for s in get_dues_inbox()["sources"]])

        src.enabled = 0
        src.save(ignore_permissions=True)

        self.assertNotIn(SOURCE, [s["name"] for s in get_dues_inbox()["sources"]])

    def test_role_scoping_hides_a_source(self):
        src = _make_source()
        src.append("roles", {"role": "_Test Dues Role"})
        if not frappe.db.exists("Role", "_Test Dues Role"):
            frappe.get_doc({"doctype": "Role", "role_name": "_Test Dues Role"}).insert(
                ignore_permissions=True
            )
        src.save(ignore_permissions=True)

        other = frappe.db.get_value("User", {"name": ["not in", ["Administrator", "Guest"]],
                                             "enabled": 1}, "name")
        if not other:
            return
        frappe.set_user(other)
        try:
            visible = [s["name"] for s in get_dues_inbox()["sources"]]
            self.assertNotIn(SOURCE, visible, "a role-gated source leaked to a user without it")
        finally:
            frappe.set_user("Administrator")

    def test_counts_match_the_rows(self):
        _make_source()

        data = get_dues_inbox()

        live = [r for r in data["rows"] if not r["snoozed"]]
        self.assertEqual(data["kpis"]["live_rows"], len(live))
        self.assertEqual(data["kpis"]["total_rows"], len(data["rows"]))
        self.assertEqual(
            sum(b["count"] for b in data["buckets"].values()),
            len(live),
            "bucket counts and live rows disagree",
        )
        # amounts are kept per currency, never summed across them
        for bucket in data["buckets"].values():
            self.assertIsInstance(bucket["amounts"], dict)

    # ── follow-up state ───────────────────────────────────────────────────────
    def test_follow_up_attaches_and_snooze_hides_the_row(self):
        _make_source()
        data = get_dues_inbox()
        row = next((r for r in data["rows"] if r["source"] == SOURCE), None)
        if not row:
            return  # no outstanding invoice on this site to hang a follow-up on

        save_follow_up(
            voucher_doctype=row["voucher_doctype"], voucher=row["voucher"],
            state="Promised", promised_date=add_days(today(), 3), note="rang the customer",
            source=SOURCE, party=row["party"], company=row["company"],
        )
        again = next(
            r for r in get_dues_inbox()["rows"]
            if r["voucher"] == row["voucher"] and r["source"] == SOURCE
        )
        self.assertEqual(again["state"], "Promised")
        self.assertEqual(again["worklist"], "promised")
        self.assertEqual(again["note"], "rang the customer")

        save_follow_up(
            voucher_doctype=row["voucher_doctype"], voucher=row["voucher"],
            state="Snoozed", snooze_until=add_days(today(), 5),
        )
        rows = get_dues_inbox()["rows"]
        snoozed = next(r for r in rows if r["voucher"] == row["voucher"] and r["source"] == SOURCE)
        self.assertTrue(snoozed["snoozed"])
        self.assertEqual(snoozed["worklist"], "snoozed")
        # and it drops out of every live tally
        self.assertNotIn(row["voucher"], [
            r["voucher"] for r in rows if not r["snoozed"] and r["source"] == SOURCE
        ])

        frappe.delete_doc(
            "PM Dues Follow Up",
            frappe.db.get_value("PM Dues Follow Up", {"voucher": row["voucher"]}, "name"),
            force=True,
        )
        frappe.db.commit()

    def test_snooze_in_the_past_is_refused(self):
        _make_source()
        data = get_dues_inbox()
        row = next((r for r in data["rows"] if r["source"] == SOURCE), None)
        if not row:
            return
        with self.assertRaises(frappe.ValidationError):
            save_follow_up(
                voucher_doctype=row["voucher_doctype"], voucher=row["voucher"],
                state="Snoozed", snooze_until=add_days(today(), -1),
            )

    def test_unknown_state_is_refused(self):
        _make_source()
        with self.assertRaises(frappe.ValidationError):
            save_follow_up(voucher_doctype="Sales Invoice", voucher="NO-SUCH-INVOICE",
                           state="Whatever")

    # ── bucket maths ──────────────────────────────────────────────────────────
    def test_field_with_no_column_is_refused(self):
        # a Table field passes meta.get_field() but has no column: accepting it saves cleanly and
        # then throws 1054 at read time, taking the whole stream down
        with self.assertRaises(frappe.ValidationError):
            _make_source(company_field="items")

    def test_default_field_that_is_not_a_column_is_refused(self):
        # "doctype" is in frappe.model.default_fields but is stripped before the query
        with self.assertRaises(frappe.ValidationError):
            _make_source(date_field="doctype")

    def test_extra_filters_naming_a_table_field_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            _make_source(extra_filters=json.dumps({"items": 1}))

    def test_amount_carries_its_own_currency(self):
        # Sales Invoice.outstanding_amount is bound to party_account_currency, not the company
        # currency, so each row must report the currency of its own amount
        _make_source()

        data = get_dues_inbox()

        rows = [r for r in data["rows"] if r["source"] == SOURCE]
        if not rows:
            return
        for row in rows:
            self.assertTrue(row["currency"], "a row came back with no currency")
        # and the KPI totals are keyed by currency rather than added together
        for entry in data["kpis"]["by_direction"].values():
            self.assertIsInstance(entry["amounts"], dict)

    def test_company_currency_amount_field_is_labelled_with_company_currency(self):
        # base_paid_amount declares Company:company:default_currency
        src = _make_source(source_name=SOURCE, voucher_doctype="Payment Entry",
                           date_field="posting_date", amount_field="base_paid_amount",
                           party_field="party", party_type=None, party_type_field="party_type",
                           direction="Instrument")
        try:
            data = get_dues_inbox()
            company_currency = data["company_currency"]
            for row in [r for r in data["rows"] if r["source"] == SOURCE]:
                self.assertEqual(row["currency"], company_currency)
        finally:
            frappe.delete_doc("PM Dues Source", src.name, force=True)
            frappe.db.commit()

    def test_follow_up_on_a_voucher_type_that_is_not_a_source_is_refused(self):
        # read access on some unrelated doctype must not be a way into writing follow-ups
        _make_source()
        with self.assertRaises(frappe.PermissionError):
            save_follow_up(voucher_doctype="ToDo", voucher="whatever", state="Contacted")

    def test_an_omitted_note_does_not_wipe_the_existing_one(self):
        _make_source()
        row = next((r for r in get_dues_inbox()["rows"] if r["source"] == SOURCE), None)
        if not row:
            return
        save_follow_up(voucher_doctype=row["voucher_doctype"], voucher=row["voucher"],
                       state="Contacted", note="spoke to accounts")
        save_follow_up(voucher_doctype=row["voucher_doctype"], voucher=row["voucher"],
                       state="Escalated")

        again = next(r for r in get_dues_inbox()["rows"]
                     if r["voucher"] == row["voucher"] and r["source"] == SOURCE)
        self.assertEqual(again["note"], "spoke to accounts")
        self.assertEqual(again["state"], "Escalated")

        frappe.delete_doc("PM Dues Follow Up",
                          frappe.db.get_value("PM Dues Follow Up", {"voucher": row["voucher"]}, "name"),
                          force=True)
        frappe.db.commit()

    def test_bucket_boundaries(self):
        self.assertEqual(_bucket_of(-1), "not_due")
        self.assertEqual(_bucket_of(0), "0-30")
        self.assertEqual(_bucket_of(30), "0-30")
        self.assertEqual(_bucket_of(31), "31-60")
        self.assertEqual(_bucket_of(60), "31-60")
        self.assertEqual(_bucket_of(61), "61-90")
        self.assertEqual(_bucket_of(90), "61-90")
        self.assertEqual(_bucket_of(91), "90+")
