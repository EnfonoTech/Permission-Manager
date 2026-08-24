# Copyright (c) 2026, Enfono Technologies and contributors
# For license information, please see license.txt

"""Send a big sales return through an approval chain, and let a small one straight through.

A credit note is money leaving the company on somebody's word, so above a size the business
decides it should carry an approval. Below it, making every counter return wait on a manager
would stop the shop.

Everything is a switch in PM Settings, so a site that wants none of it changes nothing:

* **Sales Return Approval Enabled** -- off by default. While it is off this module answers
  "no" to every question and the PM Workflow engine behaves exactly as it did.
* **Restrict by Return Amount** -- on, only returns above the threshold need approval; off,
  every return does.
* **Approval Threshold** -- the amount, in company currency (BHD 500 as shipped).
* **PM Workflow Approval Mandatory Above the Threshold** -- a return that needs approval is
  refused outright when no active PM Workflow covers Sales Invoice, rather than slipping
  through unapproved because nobody finished configuring the workflow.

How it reaches the Submit button
-------------------------------
A PM Workflow is defined per *doctype*, so a workflow on Sales Invoice would ordinarily govern
every invoice on the site -- which would take the Submit button off ordinary sales as well.
`workflow.get_workflow_name` therefore asks this module whether the document in hand is one the
workflow is meant for, and gets `None` for an ordinary invoice and for a return under the
threshold. That single answer settles the whole surface at once: `get_workflow_info` restores
the native Submit on the form, and `validate_submit_state` has no state to refuse.

The amount read is `base_grand_total` -- company currency, so a threshold set in BHD means the
same thing on a return raised in any currency -- and its absolute value, because a credit note
carries its totals negative.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money

RETURN_DOCTYPE = "Sales Invoice"


def settings():
    return frappe.get_cached_doc("PM Settings")


def is_enabled() -> bool:
    """Read straight off the cached Single.

    No table_exists guard: this is asked on every submit of every doctype, so it must not cost
    a query. The one moment PM Settings is genuinely absent is mid-install, and that raises
    DoesNotExistError, which is answered here rather than by a lookup on the happy path.
    """
    try:
        return bool(cint(settings().get("si_return_approval_enabled")))
    except frappe.DoesNotExistError:
        return False


def threshold() -> float:
    return flt(settings().get("si_return_approval_threshold"))


def restricts_by_amount() -> bool:
    return bool(cint(settings().get("si_return_amount_restriction")))


def workflow_is_mandatory() -> bool:
    return bool(cint(settings().get("si_return_requires_workflow")))


def is_sales_return(doc) -> bool:
    """A Sales Invoice that is a return. `doc` may be a document or a plain dict."""
    if not doc:
        return False
    doctype = doc.get("doctype") if hasattr(doc, "get") else None
    return doctype == RETURN_DOCTYPE and bool(cint(doc.get("is_return")))


def return_amount(doc) -> float:
    """The return's value in company currency, positive."""
    return abs(
        flt(doc.get("base_rounded_total") or doc.get("base_grand_total") or doc.get("grand_total"))
    )


def needs_approval(doc) -> bool:
    """Whether this document may only be submitted through the approval chain.

    The cheap test first: this runs on the submit of every document of every doctype, and all
    but a handful are not sales returns at all.
    """
    if not is_sales_return(doc) or not is_enabled():
        return False
    if not restricts_by_amount():
        return True
    return return_amount(doc) - threshold() > 0.0001


def workflow_applies(doctype: str, doc) -> bool:
    """Whether a PM Workflow on `doctype` governs this particular document.

    Only Sales Invoice is ever narrowed, and only while the feature is on. `doc` is None on the
    paths that ask about a doctype rather than a document (a list view, a boot lookup); those
    are answered permissively, because the authority on a single document is the check that
    runs with the document in hand.
    """
    if doctype != RETURN_DOCTYPE or not is_enabled():
        return True
    if doc is None:
        return True
    return needs_approval(doc)


def must_have_workflow(doc) -> bool:
    """Whether a missing workflow is a refusal rather than a free pass."""
    return needs_approval(doc) and workflow_is_mandatory()


def no_workflow_message(doc) -> str:
    return _(
        "{0} is a return of {1}, which needs approval, but no active PM Workflow covers {2}."
    ).format(
        frappe.bold(doc.name),
        frappe.bold(
            fmt_money(
                return_amount(doc),
                currency=frappe.get_cached_value("Company", doc.company, "default_currency"),
            )
        ),
        _(RETURN_DOCTYPE),
    )


@frappe.whitelist()
def get_return_approval_state(sales_invoice: str) -> dict:
    """What the Sales Invoice form asks so it can say why Submit is not on offer."""
    frappe.has_permission(RETURN_DOCTYPE, "read", doc=sales_invoice, throw=True)

    doc = frappe.get_doc(RETURN_DOCTYPE, sales_invoice)
    if not is_enabled() or not is_sales_return(doc):
        return {"enabled": is_enabled(), "needs_approval": False}

    return {
        "enabled": True,
        "needs_approval": needs_approval(doc),
        "amount": return_amount(doc),
        "threshold": threshold() if restricts_by_amount() else None,
        "currency": frappe.get_cached_value("Company", doc.company, "default_currency"),
    }
