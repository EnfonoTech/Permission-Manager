# Copyright (c) 2026, Enfono Technologies and contributors
# For license information, please see license.txt

"""Refuse a sales return raised outside the window the business allows.

A return taken months after the sale is a different decision from one taken the same week --
the stock has moved on, the price has changed, and on a VAT-registered site the period it
belongs to may already be filed. The rule is a count of days, and PM Settings decides what the
days are counted from:

* **Original Invoice Date** (the default, and the usual retail rule): how old the invoice being
  returned is. A return naming no invoice -- a standalone credit note -- has nothing to measure
  against and is left alone; that is a deliberate write-off, not a return.
* **Return Posting Date**: how far back the return itself is dated, counted from today.

Enforced on `validate` and only while the document is a draft, so a return cannot be parked in
drafts to be submitted later either. Roles or users named in PM Settings may raise one anyway,
the same override table the purchase-advance block uses.

Doctype-agnostic on purpose: anything with `is_return` and `return_against` works, so covering
Delivery Note returns as well is a line in hooks.py rather than a second module.
"""

import frappe
from frappe import _
from frappe.utils import cint, date_diff, getdate, nowdate

OVERRIDE_FIELD = "sales_return_overrides"
FROM_INVOICE = "Original Invoice Date"
FROM_POSTING = "Return Posting Date"


def settings():
    return frappe.get_cached_doc("PM Settings")


def is_enabled() -> bool:
    return bool(cint(settings().get("restrict_sales_return")))


def allowed_days() -> int:
    return cint(settings().get("sales_return_days"))


def counted_from() -> str:
    return settings().get("sales_return_days_from") or FROM_INVOICE


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


def _return_date(doc):
    """The return's own date, whichever field this doctype keeps it in."""
    return getdate(doc.get("posting_date") or doc.get("transaction_date") or nowdate())


def _original_date(doc):
    """The date of the document being returned, or nothing when it names none."""
    against = doc.get("return_against")
    if not against:
        return None
    date = frappe.db.get_value(doc.doctype, against, "posting_date") or frappe.db.get_value(
        doc.doctype, against, "transaction_date"
    )
    return getdate(date) if date else None


def age_in_days(doc) -> int | None:
    """How many days old this return is, by whichever basis PM Settings names.

    None means the rule has nothing to measure -- a return naming no original document while
    the invoice-date basis is in force.
    """
    if counted_from() == FROM_POSTING:
        return date_diff(getdate(nowdate()), _return_date(doc))

    original = _original_date(doc)
    if not original:
        return None
    return date_diff(_return_date(doc), original)


def validate_return_window(doc, method=None):
    """validate: stop the save of a return raised outside the window."""
    if not cint(doc.get("is_return")):
        return
    if doc.docstatus != 0:
        return
    if not is_enabled():
        return

    days = allowed_days()
    age = age_in_days(doc)
    if age is None or age <= days:
        return

    # Somebody allowed to override is still told the rule fired. Silence here is why the control
    # looks broken to whoever is testing it as Administrator: the window had passed, the return
    # was theirs to raise, and nothing on screen said either thing.
    if may_override():
        frappe.msgprint(
            _("This return is {0} day(s) old and the window is {1} day(s). Allowed because you may "
              "override the sales return window.").format(age, days),
            title=_("Return Window Overridden"),
            indicator="orange",
        )
        return

    basis = (
        _("the invoice being returned")
        if counted_from() == FROM_INVOICE
        else _("the return's own posting date")
    )
    frappe.throw(
        _("A {0} may only be raised within {1} day(s) of {2}. This one is {3} day(s) old.").format(
            _(doc.doctype), days, basis, age
        )
        + "<br><br>"
        + _("Ask someone authorised to override the sales return window."),
        title=_("Return Window Has Passed"),
    )


@frappe.whitelist()
def check_source_return_window(doctype: str, docname: str) -> dict:
    """Would a return raised today against this document be refused?

    Asked by the form of the *invoice*, not of the return, so the Return / Credit Note action can
    be taken away before somebody fills a whole credit note in and only then gets refused.
    """
    frappe.has_permission(doctype, "read", doc=docname, throw=True)

    if not is_enabled():
        return {"enabled": False, "blocked": False}

    probe = frappe._dict(
        doctype=doctype, docstatus=0, is_return=1, return_against=docname, posting_date=nowdate()
    )
    age = age_in_days(probe)
    days = allowed_days()
    can_override = may_override()

    return {
        "enabled": True,
        "days": days,
        "age": age,
        "can_override": can_override,
        "past_window": bool(age is not None and age > days),
        "blocked": bool(age is not None and age > days and not can_override),
        "basis": counted_from(),
    }


@frappe.whitelist()
def check_return_window(doctype: str, docname: str) -> dict:
    """What the form asks so it can warn before the save is refused."""
    frappe.has_permission(doctype, "read", doc=docname, throw=True)

    if not is_enabled():
        return {"enabled": False, "blocked": False}

    doc = frappe.get_doc(doctype, docname)
    age = age_in_days(doc)
    return {
        "enabled": True,
        "days": allowed_days(),
        "age": age,
        "can_override": may_override(),
        "blocked": bool(age is not None and age > allowed_days() and not may_override()),
    }
