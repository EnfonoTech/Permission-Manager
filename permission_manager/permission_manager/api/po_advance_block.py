# Copyright (c) 2026, Enfono Technologies and contributors
# For license information, please see license.txt

"""Refuse a new Purchase Order for a supplier who is already holding an unbilled advance.

The point is cash exposure, not bookkeeping: once money has gone to a supplier against an
order they have not yet invoiced, a second order stacks more of the same risk. The buyer
is warned the moment the supplier is chosen and the order cannot be saved, unless PM
Settings names their role or their user as allowed to override.

Where the advance figure comes from
----------------------------------
`Purchase Order.advance_paid`, which ERPNext refreshes from the `Advance Payment Ledger
Entry` table via `set_total_advance_paid` -> `calculate_total_advance_from_ledger`.
Nothing is written to `GL Entry` or `Payment Ledger Entry` against a Purchase Order, so
neither of those tables can answer this question -- query them and every supplier looks
clean. "Not yet invoiced" means no *submitted* Purchase Invoice names the order, by any of
the three routes an invoice can name one, which is deliberately the same test the
Pending Advance PO report applies so the block and the report can never disagree.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money

OVERRIDE_FIELD = "po_advance_block_overrides"


def settings():
	return frappe.get_cached_doc("PM Settings")


def is_enabled() -> bool:
	return bool(cint(settings().get("block_po_with_supplier_advance")))


def may_override(user: str | None = None) -> bool:
	"""Whether this user is named in PM Settings, by role or by name."""
	user = user or frappe.session.user
	if user == "Administrator":
		return True

	rows = settings().get(OVERRIDE_FIELD) or []
	if not rows:
		return False

	user_roles = set(frappe.get_roles(user))
	for row in rows:
		if not row.override:
			continue
		if row.override_type == "User" and row.override == user:
			return True
		if row.override_type == "Role" and row.override in user_roles:
			return True
	return False


def blocking_orders(supplier: str, company: str, exclude: str | None = None) -> list[dict]:
	"""Submitted orders for this supplier carrying an advance that no invoice has settled.

	`exclude` drops the order being saved, so amending or re-saving an order does not
	trip over its own advance.
	"""
	if not (supplier and company):
		return []

	threshold = flt(settings().get("po_advance_block_threshold"))

	po = frappe.qb.DocType("Purchase Order")
	query = (
		frappe.qb.from_(po)
		.select(po.name, po.transaction_date, po.advance_paid, po.status)
		.where(
			(po.docstatus == 1)
			& (po.supplier == supplier)
			& (po.company == company)
			& (po.advance_paid > threshold)
		)
		.orderby(po.advance_paid, order=frappe.qb.desc)
	)
	if exclude:
		query = query.where(po.name != exclude)

	candidates = query.run(as_dict=True)
	if not candidates:
		return []

	settled = invoiced_orders([row.name for row in candidates])
	return [
		{
			"purchase_order": row.name,
			"transaction_date": str(row.transaction_date),
			"advance_paid": flt(row.advance_paid),
			"status": row.status,
		}
		for row in candidates
		if row.name not in settled
	]


def invoiced_orders(orders: list[str]) -> set:
	"""Which of these orders a submitted purchase invoice already names.

	All three routes are read, because an invoice reaches an order by any of them: naming
	it directly, naming its order row, or naming only the receipt row when the invoice was
	raised from a Purchase Receipt.
	"""
	if not orders:
		return set()

	pii = frappe.qb.DocType("Purchase Invoice Item")
	pi = frappe.qb.DocType("Purchase Invoice")
	poi = frappe.qb.DocType("Purchase Order Item")
	pri = frappe.qb.DocType("Purchase Receipt Item")

	rows = (
		frappe.qb.from_(pii)
		.join(pi)
		.on(pi.name == pii.parent)
		.left_join(poi)
		.on(poi.name == pii.po_detail)
		.left_join(pri)
		.on(pri.name == pii.pr_detail)
		.select(pii.purchase_order, poi.parent.as_("linked_order"), pri.purchase_order.as_("receipt_order"))
		.where(
			(pi.docstatus == 1)
			& (
				pii.purchase_order.isin(orders)
				| poi.parent.isin(orders)
				| pri.purchase_order.isin(orders)
			)
		)
		.run(as_dict=True)
	)

	wanted = set(orders)
	settled = set()
	for row in rows:
		order = row.purchase_order or row.linked_order or row.receipt_order
		if order in wanted:
			settled.add(order)
	return settled


def describe(orders: list[dict], company: str) -> str:
	currency = frappe.get_cached_value("Company", company, "default_currency")
	lines = [
		"{0} ({1}) — {2}".format(
			frappe.bold(row["purchase_order"]),
			row["transaction_date"],
			fmt_money(row["advance_paid"], currency=currency),
		)
		for row in orders
	]
	total = fmt_money(sum(flt(row["advance_paid"]) for row in orders), currency=currency)
	return "<br>".join(lines) + "<br><br>" + _("Total advance held: {0}").format(frappe.bold(total))


@frappe.whitelist()
def check_supplier_advance(supplier: str, company: str, purchase_order: str | None = None) -> dict:
	"""What the Purchase Order form asks as soon as a supplier is chosen."""
	frappe.has_permission("Purchase Order", "read", throw=True)

	if not is_enabled():
		return {"enabled": False, "blocked": False, "orders": []}

	orders = blocking_orders(supplier, company, exclude=purchase_order)
	override = may_override()

	return {
		"enabled": True,
		"blocked": bool(orders) and not override,
		"can_override": override,
		"orders": orders,
		"message": describe(orders, company) if orders else "",
	}


def validate_purchase_order(doc, method=None):
	"""Stop the save. Runs on validate, so a draft cannot be parked either."""
	if doc.docstatus != 0 or not is_enabled():
		return

	if may_override():
		return

	orders = blocking_orders(doc.supplier, doc.company, exclude=doc.name)
	if not orders:
		return

	frappe.throw(
		_("{0} is already holding an advance against {1} order(s) that no invoice has been raised against yet:").format(
			frappe.bold(doc.supplier), len(orders)
		)
		+ "<br><br>"
		+ describe(orders, doc.company)
		+ "<br><br>"
		+ _("Raise the purchase invoice against the earlier order, or ask someone authorised to override this."),
		title=_("Supplier Holds an Unbilled Advance"),
	)
