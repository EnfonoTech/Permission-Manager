# permission_manager/permission_manager/api/test_material_request_transfers.py
"""Transfer position of a Material Request, counting what ERPNext will not.

ERPNext sums only submitted Stock Entry rows towards ordered_qty, so these tests deliberately
build Stock Entries that stay in DRAFT — the state that caused five duplicate transfers against
MAT-MR-2026-00156-1 while the request still read Pending / 0% ordered.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from permission_manager.permission_manager.api.material_request_transfers import (
	COVERED,
	NONE,
	OVER,
	PARTIAL,
	get_transfer_summary,
)

ITEM = "_Test PM Transfer Item"
SRC = "_Test PM Source - _TC"
DST = "_Test PM Target - _TC"


def _company():
	return frappe.db.get_value("Company", {}, "name")


def _abbr(company):
	return frappe.db.get_value("Company", company, "abbr")


def _warehouse(name, company):
	full = "%s - %s" % (name, _abbr(company))
	if not frappe.db.exists("Warehouse", full):
		frappe.get_doc({"doctype": "Warehouse", "warehouse_name": name, "company": company,
		                "is_group": 0}).insert(ignore_permissions=True)
	return full


class TestMaterialRequestTransfers(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = _company()
		cls.src = _warehouse("_Test PM Source", cls.company)
		cls.dst = _warehouse("_Test PM Target", cls.company)
		if not frappe.db.exists("Item", ITEM):
			frappe.get_doc({"doctype": "Item", "item_code": ITEM, "item_name": ITEM,
			                "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
			                "stock_uom": "Nos", "is_stock_item": 1}).insert(ignore_permissions=True)

	def setUp(self):
		self.mr = self._material_request(qty=100)
		self._extra_entries = []

	def tearDown(self):
		for name in self._extra_entries:
			doc = frappe.get_doc("Stock Entry", name)
			if doc.docstatus == 1:
				doc.cancel()
			doc.delete(force=True)
		for se in frappe.get_all("Stock Entry Detail", filters={"material_request": self.mr.name},
		                         pluck="parent", distinct=True):
			doc = frappe.get_doc("Stock Entry", se)
			if doc.docstatus == 1:
				doc.cancel()
			doc.delete(force=True)
		self.mr.reload()
		if self.mr.docstatus == 1:
			self.mr.cancel()
		self.mr.delete(force=True)
		frappe.db.commit()

	def _material_request(self, qty):
		mr = frappe.get_doc({
			"doctype": "Material Request", "material_request_type": "Material Transfer",
			"company": self.company, "transaction_date": today(), "schedule_date": today(),
			"items": [{"item_code": ITEM, "qty": qty, "warehouse": self.dst,
			           "from_warehouse": self.src, "schedule_date": today()}],
		}).insert(ignore_permissions=True)
		mr.submit()
		frappe.db.commit()
		return mr

	def _draft_transfer(self, qty):
		"""A transfer left in Draft — invisible to ERPNext's ordered_qty, which is the point."""
		row = self.mr.items[0]
		se = frappe.get_doc({
			"doctype": "Stock Entry", "stock_entry_type": "Material Transfer",
			"purpose": "Material Transfer", "company": self.company, "posting_date": today(),
			"from_warehouse": self.src, "to_warehouse": self.dst,
			# the test item has never been received anywhere, so ERPNext has no valuation rate
			# to work from and refuses the entry; the quantities are what these tests care about
			"items": [{"item_code": ITEM, "qty": qty, "s_warehouse": self.src,
			           "t_warehouse": self.dst, "material_request": self.mr.name,
			           "material_request_item": row.name, "basic_rate": 1,
			           "allow_zero_valuation_rate": 1}],
		}).insert(ignore_permissions=True)
		frappe.db.commit()
		return se

	def _receive_stock(self, qty):
		"""Put real stock in the source warehouse so a transfer can actually be submitted."""
		se = frappe.get_doc({
			"doctype": "Stock Entry", "stock_entry_type": "Material Receipt",
			"purpose": "Material Receipt", "company": self.company, "posting_date": today(),
			"to_warehouse": self.src,
			"items": [{"item_code": ITEM, "qty": qty, "t_warehouse": self.src,
			           "basic_rate": 1, "allow_zero_valuation_rate": 1}],
		}).insert(ignore_permissions=True)
		se.submit()
		frappe.db.commit()
		self._extra_entries.append(se.name)
		return se

	# ── the verdicts ──────────────────────────────────────────────────────────
	def test_no_transfer_is_not_flagged(self):
		self.assertEqual(get_transfer_summary(self.mr.name)["verdict"], NONE)

	def test_partial_transfer_leaves_room_for_another(self):
		self._draft_transfer(40)

		summary = get_transfer_summary(self.mr.name)

		self.assertEqual(summary["verdict"], PARTIAL)
		self.assertEqual(summary["totals"]["remaining"], 60)
		self.assertEqual(summary["totals"]["pending"], 40)
		self.assertEqual(summary["totals"]["submitted"], 0)

	def test_two_partials_that_together_cover_it_are_covered(self):
		# splitting one request across several transfers is legitimate; the warning must only
		# harden once the full quantity is accounted for
		self._draft_transfer(40)
		self._draft_transfer(60)

		summary = get_transfer_summary(self.mr.name)

		self.assertEqual(summary["verdict"], COVERED)
		self.assertEqual(summary["totals"]["remaining"], 0)
		self.assertEqual(len(summary["stock_entries"]), 2)

	def test_duplicate_of_the_full_quantity_is_over(self):
		# the Steel Force case in miniature: the same full-quantity transfer raised twice
		self._draft_transfer(100)
		self._draft_transfer(100)

		summary = get_transfer_summary(self.mr.name)

		self.assertEqual(summary["verdict"], OVER)
		self.assertEqual(summary["totals"]["pending"], 200)
		self.assertEqual(len(summary["over_lines"]), 1)

	def test_pending_qty_is_reported_separately_from_submitted(self):
		# the banner says "N of that is awaiting approval", so the split has to be real
		self._draft_transfer(30)

		totals = get_transfer_summary(self.mr.name)["totals"]

		self.assertEqual(totals["pending"], 30)
		self.assertEqual(totals["submitted"], 0)
		# and ERPNext still disagrees, which is the whole reason this module exists
		self.mr.reload()
		self.assertEqual(self.mr.items[0].ordered_qty, 0)
		self.assertEqual(self.mr.status, "Pending")

	def test_cancelled_transfer_does_not_count(self):
		self._receive_stock(100)          # submitting a transfer needs stock to move
		se = self._draft_transfer(100)
		se.submit()
		se.cancel()
		frappe.db.commit()

		self.assertEqual(get_transfer_summary(self.mr.name)["verdict"], NONE)

	def test_a_draft_material_request_is_never_flagged(self):
		draft = frappe.get_doc({
			"doctype": "Material Request", "material_request_type": "Material Transfer",
			"company": self.company, "transaction_date": today(), "schedule_date": today(),
			"items": [{"item_code": ITEM, "qty": 5, "warehouse": self.dst,
			           "from_warehouse": self.src, "schedule_date": today()}],
		}).insert(ignore_permissions=True)
		try:
			self.assertEqual(get_transfer_summary(draft.name)["verdict"], NONE)
		finally:
			draft.delete(force=True)
			frappe.db.commit()

	def test_duplicate_report_is_administrator_only(self):
		# the dashboard banner tells the one person who can delete the extra transfers; everyone
		# else is warned on the Material Request instead
		from permission_manager.permission_manager.api.warehouse_dashboard import (
			get_warehouse_dashboard_data,
		)

		self._draft_transfer(100)
		self._draft_transfer(100)

		as_admin = get_warehouse_dashboard_data()
		self.assertIn(self.mr.name,
		              [d["material_request"] for d in as_admin["duplicate_transfers"]])
		self.assertEqual(as_admin["kpis"]["duplicate_transfer_count"],
		                 len(as_admin["duplicate_transfers"]))

		other = frappe.db.get_value("User", {"name": ["not in", ["Administrator", "Guest"]],
		                                     "enabled": 1}, "name")
		if not other:
			return
		frappe.set_user(other)
		try:
			as_other = get_warehouse_dashboard_data()
			self.assertEqual(as_other["duplicate_transfers"], [])
			self.assertEqual(as_other["kpis"]["duplicate_transfer_count"], 0)
		finally:
			frappe.set_user("Administrator")

	def test_every_verdict_returns_the_same_keys(self):
		# a caller reading summary["headline"] must not have to know which branch ran; the
		# early returns used to drop headline and totals
		expected = {"verdict", "material_request", "status", "lines", "outstanding",
		            "over_lines", "stock_entries", "totals", "headline"}
		self.assertEqual(set(get_transfer_summary(self.mr.name)), expected)  # none
		self._draft_transfer(40)
		self.assertEqual(set(get_transfer_summary(self.mr.name)), expected)  # partial
		self._draft_transfer(60)
		self.assertEqual(set(get_transfer_summary(self.mr.name)), expected)  # covered
		self._draft_transfer(10)
		self.assertEqual(set(get_transfer_summary(self.mr.name)), expected)  # over
		self.assertEqual(set(get_transfer_summary("NO-SUCH-MR-0001")), expected)  # missing

	def test_purchase_request_is_out_of_scope(self):
		mr = frappe.get_doc({
			"doctype": "Material Request", "material_request_type": "Purchase",
			"company": self.company, "transaction_date": today(), "schedule_date": today(),
			"items": [{"item_code": ITEM, "qty": 5, "warehouse": self.dst,
			           "schedule_date": today()}],
		}).insert(ignore_permissions=True)
		mr.submit()
		frappe.db.commit()
		try:
			self.assertEqual(get_transfer_summary(mr.name)["verdict"], NONE)
		finally:
			mr.cancel()
			mr.delete(force=True)
			frappe.db.commit()
