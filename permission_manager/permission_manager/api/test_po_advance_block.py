"""Tests for the unbilled-advance block on new Purchase Orders.

Run on a scratch site, never on a client site — the suite creates its own company,
warehouse, item, supplier and user:

    bench --site <scratch-site> run-tests --module permission_manager.permission_manager.api.test_po_advance_block
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from permission_manager.permission_manager.api.po_advance_block import (
	blocking_orders,
	check_supplier_advance,
	may_override,
	validate_purchase_order,
)

COMPANY = "_Test PO Advance Block Co"
ABBR = "_TPABC"
SUPPLIER = "_Test PO Advance Block Supplier"
OTHER_SUPPLIER = "_Test PO Advance Block Supplier 2"
OVERRIDE_ROLE = "_Test Advance Override Role"
PLAIN_USER = "_test_po_block_plain@example.com"
OVERRIDE_USER = "_test_po_block_override@example.com"


class TestPOAdvanceBlock(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = cls.make_company()
		cls.warehouse = "Stores - " + ABBR
		cls.cost_center = "Main - " + ABBR
		cls.cash_account = "Cash - " + ABBR
		cls.item_code = cls.make_item()
		cls.make_parties()

	@classmethod
	def make_company(cls):
		if frappe.db.exists("Company", COMPANY):
			return frappe.get_doc("Company", COMPANY)
		return frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": COMPANY,
				"abbr": ABBR,
				"country": "India",
				"default_currency": "INR",
			}
		).insert()

	@classmethod
	def make_item(cls):
		from erpnext.stock.doctype.item.test_item import make_item

		return make_item("PO Advance Block Item", properties={"is_stock_item": 1}).name

	@classmethod
	def make_parties(cls):
		for name in (SUPPLIER, OTHER_SUPPLIER):
			if not frappe.db.exists("Supplier", name):
				frappe.get_doc(
					{
						"doctype": "Supplier",
						"supplier_name": name,
						"supplier_group": "All Supplier Groups",
					}
				).insert()

		if not frappe.db.exists("Role", OVERRIDE_ROLE):
			frappe.get_doc({"doctype": "Role", "role_name": OVERRIDE_ROLE}).insert()

		for email, roles in ((PLAIN_USER, []), (OVERRIDE_USER, [OVERRIDE_ROLE])):
			if not frappe.db.exists("User", email):
				frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": "Buyer",
						"send_welcome_email": 0,
						"roles": [{"role": r} for r in (["Purchase User"] + roles)],
					}
				).insert(ignore_permissions=True)

	# ------------------------------------------------------------------

	def configure(self, enabled=1, threshold=0, overrides=None):
		settings = frappe.get_doc("PM Settings")
		settings.block_po_with_supplier_advance = enabled
		settings.po_advance_block_threshold = threshold
		settings.set("po_advance_block_overrides", [])
		for override_type, override in overrides or []:
			settings.append(
				"po_advance_block_overrides",
				{"override_type": override_type, "override": override},
			)
		settings.save(ignore_permissions=True)
		frappe.clear_cache(doctype="PM Settings")
		return settings

	def make_po(self, supplier=SUPPLIER, qty=10, rate=100, submit=True):
		po = frappe.get_doc(
			{
				"doctype": "Purchase Order",
				"company": COMPANY,
				"supplier": supplier,
				"transaction_date": nowdate(),
				"schedule_date": add_days(nowdate(), 1),
				"currency": "INR",
				"conversion_rate": 1,
				"items": [
					{
						"item_code": self.item_code,
						"qty": qty,
						"rate": rate,
						"warehouse": self.warehouse,
						"cost_center": self.cost_center,
						"schedule_date": add_days(nowdate(), 1),
					}
				],
			}
		)
		po.insert()
		if submit:
			po.submit()
		return po

	def pay_advance(self, po, amount):
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

		pe = get_payment_entry("Purchase Order", po.name, bank_account=self.cash_account)
		pe.references[0].allocated_amount = amount
		pe.paid_amount = amount
		pe.received_amount = amount
		pe.reference_no = "ADV-" + po.name
		pe.reference_date = nowdate()
		pe.insert()
		pe.submit()
		po.reload()
		return pe

	def tearDown(self):
		frappe.set_user("Administrator")
		self.configure(enabled=0)

	# ------------------------------------------------------------------

	def test_off_by_default_lets_everything_through(self):
		self.configure(enabled=0)
		first = self.make_po()
		self.pay_advance(first, 400)

		# no throw
		second = self.make_po(submit=False)
		self.assertTrue(second.name)

	def test_a_second_order_is_refused_while_the_advance_is_unbilled(self):
		self.configure(enabled=1)
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(PLAIN_USER)
		try:
			with self.assertRaises(frappe.ValidationError):
				self.make_po(submit=False)
		finally:
			frappe.set_user("Administrator")

	def test_an_order_for_a_different_supplier_is_unaffected(self):
		self.configure(enabled=1)
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(PLAIN_USER)
		try:
			other = self.make_po(supplier=OTHER_SUPPLIER, submit=False)
			self.assertTrue(other.name)
		finally:
			frappe.set_user("Administrator")

	def test_a_named_role_may_override(self):
		self.configure(enabled=1, overrides=[("Role", OVERRIDE_ROLE)])
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(OVERRIDE_USER)
		try:
			self.assertTrue(may_override())
			second = self.make_po(submit=False)
			self.assertTrue(second.name)
		finally:
			frappe.set_user("Administrator")

	def test_a_named_user_may_override(self):
		self.configure(enabled=1, overrides=[("User", PLAIN_USER)])
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(PLAIN_USER)
		try:
			self.assertTrue(may_override())
			second = self.make_po(submit=False)
			self.assertTrue(second.name)
		finally:
			frappe.set_user("Administrator")

	def test_the_threshold_ignores_small_advances(self):
		"""A trivial balance must not block, or the override gets clicked through daily."""
		self.configure(enabled=1, threshold=500)
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(PLAIN_USER)
		try:
			second = self.make_po(submit=False)
			self.assertTrue(second.name)
		finally:
			frappe.set_user("Administrator")

	def test_invoicing_the_earlier_order_releases_the_block(self):
		self.configure(enabled=1)
		first = self.make_po()
		self.pay_advance(first, 400)
		self.assertTrue(blocking_orders(SUPPLIER, COMPANY))

		from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_invoice

		pi = make_purchase_invoice(first.name)
		pi.bill_no = "BILL-" + first.name
		pi.allocate_advances_automatically = 0
		pi.advances = []
		pi.insert()
		pi.submit()

		self.assertFalse(blocking_orders(SUPPLIER, COMPANY))

		frappe.set_user(PLAIN_USER)
		try:
			second = self.make_po(submit=False)
			self.assertTrue(second.name)
		finally:
			frappe.set_user("Administrator")

	def test_an_order_does_not_block_itself_on_re_save(self):
		"""Excluding the document being saved, or an amend would trip over its own advance."""
		self.configure(enabled=1)
		first = self.make_po()
		self.pay_advance(first, 400)

		self.assertEqual(blocking_orders(SUPPLIER, COMPANY, exclude=first.name), [])

		# and validate on that same order must not throw
		first.reload()
		validate_purchase_order(first)

	def test_the_form_check_reports_what_the_block_will_do(self):
		self.configure(enabled=1)
		first = self.make_po()
		self.pay_advance(first, 400)

		frappe.set_user(PLAIN_USER)
		try:
			answer = check_supplier_advance(SUPPLIER, COMPANY)
			self.assertTrue(answer["enabled"])
			self.assertTrue(answer["blocked"])
			self.assertFalse(answer["can_override"])
			self.assertEqual(len(answer["orders"]), 1)
			self.assertEqual(answer["orders"][0]["purchase_order"], first.name)
		finally:
			frappe.set_user("Administrator")

	def test_the_form_check_is_silent_when_the_feature_is_off(self):
		self.configure(enabled=0)
		first = self.make_po()
		self.pay_advance(first, 400)

		answer = check_supplier_advance(SUPPLIER, COMPANY)
		self.assertFalse(answer["enabled"])
		self.assertFalse(answer["blocked"])
