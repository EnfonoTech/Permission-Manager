"""Limit how far back a document may be dated, by role or by user, per doctype.

ERPNext already ships two neighbours of this: `Accounts Settings.acc_frozen_upto` with
`frozen_accounts_modifier` freezes everything before a fixed date for all but one role, and
`Stock Settings.stock_frozen_upto_days` does a rolling window for stock alone. Neither is
per-doctype and per-role at the same time, which is what this adds.

Nothing is enforced until PM Settings has the switch on AND a rule names the doctype, so
installing this app changes no behaviour on its own.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, getdate, nowdate

_CACHE_KEY = "pm_backdate_doctypes"
_CACHE_TTL = 300

# A rule (or the fallback) of -1 means "no limit", which is the fallback's default: a site that
# turns the switch on does not suddenly refuse every user it has no rule for.
NO_LIMIT = -1

# What the switch covers when nobody has named anything. The money and stock vouchers, because
# those are what a backdating control exists for.
#
# Deliberately absent: HR and payroll documents, which are dated in the past as a matter of
# course (attendance for last week, a salary slip for last month), and Period Closing Voucher,
# which is dated at the period end by definition. Naming them in PM Settings covers them; being
# silent about them here means turning the switch on does not quietly break payroll.
DEFAULT_COVERED_DOCTYPES = (
    "Journal Entry",
    "Payment Entry",
    "Sales Invoice",
    "Purchase Invoice",
    "Sales Order",
    "Purchase Order",
    "Delivery Note",
    "Purchase Receipt",
    "Stock Entry",
    "Payment Advice",
)


def _settings():
    try:
        return frappe.get_cached_doc("PM Settings")
    except Exception:
        return None


def get_restricted_doctypes() -> set:
    """Doctypes named by at least one enabled rule.

    This is consulted on every save of every document on the site, so the answer is cached and
    the miss path is one read of a Single.
    """
    if not frappe.db.table_exists("PM Backdate Rule"):
        return set()

    cached = frappe.cache().get_value(_CACHE_KEY)
    if cached is not None:
        return set(cached)

    doctypes = set()
    settings = _settings()
    if settings and cint(settings.get("enforce_backdate_control")):
        # The switch covers documents by itself — rules below it grant backdating to named
        # roles and users, they do not decide what is covered. Otherwise turning the control on
        # would do nothing at all until someone also wrote a rule, which is not what "restrict
        # backdated entries" says.
        doctypes = {
            row.document_type
            for row in (settings.get("backdate_doctypes") or [])
            if row.document_type
        }
        if not doctypes:
            doctypes = set(DEFAULT_COVERED_DOCTYPES)

        # A rule may reach a doctype outside the covered set; honour it rather than ignoring a
        # row somebody deliberately wrote.
        doctypes |= {
            rule.document_type
            for rule in (settings.get("backdate_rules") or [])
            if cint(rule.enabled) and rule.document_type
        }

        # Drop anything this site does not have installed, so a default set naming Payment
        # Advice costs nothing on a bench without sf_trading.
        doctypes = {dt for dt in doctypes if frappe.db.exists("DocType", dt)}

    frappe.cache().set_value(_CACHE_KEY, list(doctypes), expires_in_sec=_CACHE_TTL)
    return doctypes


def clear_backdate_cache(doc=None, method=None):
    frappe.cache().delete_value(_CACHE_KEY)


def _rules_for(doctype, settings=None):
    settings = settings or _settings()
    if not settings:
        return []
    return [
        rule
        for rule in (settings.get("backdate_rules") or [])
        if cint(rule.enabled) and rule.document_type == doctype
    ]


def resolve_date_field(doctype, rules=None):
    """Which field carries the date this doctype is judged on.

    A rule may name one outright; otherwise take the document's own dating field. Purchases,
    sales invoices, journals and stock entries all use `posting_date`; orders use
    `transaction_date`.
    """
    for rule in rules or []:
        if rule.get("date_field"):
            return rule.date_field.strip()

    meta = frappe.get_meta(doctype)
    for candidate in ("posting_date", "transaction_date"):
        if meta.has_field(candidate):
            return candidate

    return None


def allowed_backdate_days(doctype, user=None, settings=None):
    """Days of backdating this user gets on this doctype.

    Assumes the doctype is covered — callers check that against get_restricted_doctypes()
    first. A covered doctype that no rule mentions is not unrestricted: it falls to the
    fallback, because the switch is what covers documents and the rules only grant.

    Several rules may name the same user — one by role, one by name, or two roles they hold.
    The most generous wins: these grant permission, so holding another role must never take
    away what the first one gave.
    """
    settings = settings or _settings()
    rules = _rules_for(doctype, settings)

    user = user or frappe.session.user
    roles = set(frappe.get_roles(user))

    best = None
    for rule in rules:
        if rule.applies_to == "User":
            matched = rule.applies_to_value == user
        else:
            matched = rule.applies_to_value in roles
        if not matched:
            continue

        days = cint(rule.max_backdate_days)
        best = days if best is None else max(best, days)

    if best is None:
        fallback = settings.get("default_backdate_days") if settings else None
        best = NO_LIMIT if fallback in (None, "") else cint(fallback)

    return best


def validate_posting_date(doc, method=None):
    """Refuse a document dated further back than its author is allowed to reach."""
    if (
        frappe.flags.in_install
        or frappe.flags.in_migrate
        or frappe.flags.in_patch
        or frappe.flags.in_import
    ):
        return

    if doc.flags.get("ignore_backdate_control"):
        return

    doctype = doc.get("doctype")
    if not doctype or doctype not in get_restricted_doctypes():
        return

    user = frappe.session.user
    if user == "Administrator":
        return

    # A document ERPNext raises inside another one's transaction — an exchange gain journal, a
    # repost — carries the date of the document it belongs to and has no author to hold to it.
    if cint(doc.get("is_system_generated")):
        return

    settings = _settings()
    rules = _rules_for(doctype, settings)
    fieldname = resolve_date_field(doctype, rules)
    if not fieldname:
        return

    value = doc.get(fieldname)
    if not value:
        return

    # Only when the date is being set for the first time or actually moved. Re-saving an old
    # document, or any code that touches one, must not start failing because the date it has
    # always carried is now out of reach.
    if not doc.is_new():
        before = doc.get_doc_before_save()
        if before and before.get(fieldname) and getdate(before.get(fieldname)) == getdate(value):
            return

    # An amendment is a new document, so without this it is judged like any other entry and
    # correcting an old one needs an allowance that reaches back to it. Optionally let it keep
    # the date of the document it amends — the entry already stands on that date, so nothing new
    # is being backdated. Moving it further back than the original is refused either way, which
    # is what stops cancel-and-amend being used as a way in.
    if doc.get("amended_from") and cint(settings and settings.get("allow_amendment_on_original_date")):
        original = frappe.db.get_value(doc.doctype, doc.amended_from, fieldname)
        if original and getdate(original) == getdate(value):
            return

    days = allowed_backdate_days(doctype, user, settings)
    if days is None or days < 0:
        return

    earliest = add_days(getdate(nowdate()), -days)
    if getdate(value) >= earliest:
        return

    label = frappe.get_meta(doctype).get_label(fieldname) or fieldname
    if days:
        allowance = _("You may backdate {0} by {1} day(s), so the earliest is {2}.").format(
            _(doctype), frappe.bold(days), frappe.bold(frappe.format(earliest, {"fieldtype": "Date"}))
        )
    else:
        allowance = _("You may only date {0} today ({1}).").format(
            _(doctype), frappe.bold(frappe.format(earliest, {"fieldtype": "Date"}))
        )

    frappe.throw(
        _("{0} is set to {1}, which is further back than you are allowed to post. {2}").format(
            frappe.bold(_(label)),
            frappe.bold(frappe.format(getdate(value), {"fieldtype": "Date"})),
            allowance,
        ),
        title=_("Backdated Entry Not Allowed"),
    )
