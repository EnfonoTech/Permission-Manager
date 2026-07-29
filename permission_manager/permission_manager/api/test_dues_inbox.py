# permission_manager/permission_manager/api/test_dues_inbox.py
"""Dues Inbox: configuration drives the query, so configuration is what these tests attack.

The dangerous property of this feature is that field names come from a DocType an admin edits.
Tests below cover the honest cases (buckets, advices already raised, role scoping) and the dishonest
one — a source configured with a field name that does not exist, or one carrying SQL.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate, today

from permission_manager.permission_manager.api.dues_inbox import (
    _bucket_of,
    get_dues_inbox,
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
            self.assertIsInstance(row["advices"], list)

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

        live = data["rows"]
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

    def test_bucket_boundaries(self):
        self.assertEqual(_bucket_of(-1), "not_due")
        self.assertEqual(_bucket_of(0), "0-30")
        self.assertEqual(_bucket_of(30), "0-30")
        self.assertEqual(_bucket_of(31), "31-60")
        self.assertEqual(_bucket_of(60), "31-60")
        self.assertEqual(_bucket_of(61), "61-90")
        self.assertEqual(_bucket_of(90), "61-90")
        self.assertEqual(_bucket_of(91), "90+")


class TestDuesInboxAdvices(FrappeTestCase):
    """The row shows any Payment Advice already raised, and refuses to raise a second one."""

    def test_every_row_carries_an_advices_list(self):
        data = get_dues_inbox()
        for row in data["rows"]:
            self.assertIn("advices", row)
            self.assertIsInstance(row["advices"], list)

    def test_flag_matches_what_the_bench_can_actually_do(self):
        from permission_manager.permission_manager.api.dues_inbox import _payment_advice_available

        data = get_dues_inbox()
        self.assertEqual(bool(data["can_make_payment_advice"]), bool(_payment_advice_available()))

    def test_an_existing_advice_shows_on_its_voucher(self):
        from permission_manager.permission_manager.api.dues_inbox import _payment_advice_available

        if not _payment_advice_available():
            self.skipTest("Payment Advice is not available on this bench")
        ref = frappe.db.sql(
            """select r.reference_doctype, r.reference_record, r.parent
               from `tabPayment Advice Reference` r
               where r.parenttype='Payment Advice' and r.docstatus < 2 limit 1""",
            as_dict=True,
        )
        if not ref:
            self.skipTest("no live Payment Advice on this site")
        ref = ref[0]
        rows = get_dues_inbox()["rows"]
        row = next(
            (r for r in rows if r["voucher"] == ref.reference_record
             and r["voucher_doctype"] == ref.reference_doctype),
            None,
        )
        if not row:
            self.skipTest("that voucher is not currently a due row")
        self.assertIn(ref.parent, [a["advice"] for a in row["advices"]])

    def test_advice_is_refused_on_a_doctype_that_is_not_a_source(self):
        from permission_manager.permission_manager.api.dues_inbox import make_payment_advice

        with self.assertRaises(frappe.PermissionError):
            make_payment_advice("Journal Entry", "whatever")

    def test_advice_is_refused_on_an_instrument_row(self):
        from permission_manager.permission_manager.api.dues_inbox import make_payment_advice

        # Payment Entry is a dues source (post-dated cheques) but an advice cannot be raised on one
        if not frappe.db.exists("PM Dues Source", {"voucher_doctype": "Payment Entry"}):
            self.skipTest("no Payment Entry dues source configured")
        with self.assertRaises(frappe.ValidationError):
            make_payment_advice("Payment Entry", "whatever")
