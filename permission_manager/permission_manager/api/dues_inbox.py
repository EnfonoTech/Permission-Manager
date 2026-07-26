# permission_manager/permission_manager/api/dues_inbox.py
"""One view of everything falling due, built from PM Dues Source configuration.

Adding a stream — lease invoices, employee advances, a second cheque register — means adding a
PM Dues Source row, not editing this file. Each source names the voucher DocType and the fields
that carry its due date, amount and party; this module turns that into a query.

Two things here are deliberate and easy to get wrong:

* Reading goes through `frappe.get_list`, never a hand-built query, because get_list applies role
  permissions, User Permissions and any permission_query_conditions hook. The same query written
  with frappe.qb would quietly return every company's invoices to everyone.

* Amounts carry their own currency. `Sales Invoice.outstanding_amount` and
  `Purchase Invoice.outstanding_amount` are bound to `party_account_currency`, NOT to the company
  currency — a customer with a USD receivable account has a USD outstanding on a BHD company. So
  each row reports the currency of its own amount field and totals are kept per currency. Never
  add two rows' amounts together without checking they agree, and never convert with
  `conversion_rate`: that rate is transaction-to-company currency and is wrong for an amount
  already denominated in the party's account currency.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate, today

BUCKET_KEYS = ("not_due", "0-30", "31-60", "61-90", "90+")
WORKLISTS = ("untouched", "promised", "snoozed", "due_today", "touched")
ACTIVE_STATES = ("Open", "Contacted", "Promised", "Snoozed", "Disputed", "Escalated", "Settled")
OWNER_OVERRIDE_ROLES = ("Accounts Manager", "System Manager")

# Per source. A site with years of open vouchers must not ship every one of them to a browser;
# the page says how many it is showing out of how many exist.
ROW_CAP = 2000


# ── field resolution ──────────────────────────────────────────────────────────

def field_is_usable(meta, fieldname):
    """Is this a name that can actually appear in a SELECT or WHERE for this DocType?

    `meta.get_field()` answers "is there a field", which is not the same question: Table, Section
    Break and virtual fields have no column, and `doctype` sits in default_fields but is stripped
    before the query. Accepting those saves cleanly and then throws 1054 at read time.
    """
    if not fieldname:
        return None, False
    fieldname = fieldname.strip()
    df = meta.get_field(fieldname)
    if df:
        usable = df.fieldtype in frappe.model.data_fieldtypes and not df.get("is_virtual")
        return df, usable
    return None, fieldname in (set(frappe.model.default_fields) - {"doctype"})


def _resolve_field(meta, fieldname, slot=""):
    """A configured field name, or None when unset. Raises when set but unusable.

    The distinction matters: an unset branch field means "this voucher has no branch" and the
    stream is still fine, whereas a misconfigured one silently dropped the company filter and
    mixed companies together. That now fails the stream loudly instead.
    """
    if not fieldname or not fieldname.strip():
        return None
    fieldname = fieldname.strip()
    _df, usable = field_is_usable(meta, fieldname)
    if not usable:
        raise ValueError(
            "%s is not a queryable field on %s (configured as %s)"
            % (fieldname, meta.name, slot or "a field")
        )
    return fieldname


# ── configuration ─────────────────────────────────────────────────────────────

def _sources_for_user():
    """Enabled sources this user's roles allow."""
    rows = frappe.get_all(
        "PM Dues Source",
        filters={"enabled": 1},
        fields=["name", "label", "direction", "voucher_doctype", "date_field", "amount_field",
                "party_field", "party_type", "party_type_field", "company_field", "branch_field",
                "include_drafts", "grace_days", "extra_filters", "accent", "sort_order"],
        order_by="sort_order asc, name asc",
    )
    if not rows:
        return []

    user_roles = set(frappe.get_roles())
    is_manager = "System Manager" in user_roles or frappe.session.user == "Administrator"
    allowed = []
    for src in rows:
        roles = frappe.get_all("PM Dues Source Role", filters={"parent": src.name}, pluck="role")
        # no roles configured = visible to anyone who can open the page
        if roles and not is_manager and not (set(roles) & user_roles):
            continue
        allowed.append(src)
    return allowed


# ── the inbox ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dues_inbox(company=None, branch=None, as_on=None, source=None, due_from=None, due_to=None):
    """Every due row this user may see, with follow-up state attached.

    Chips filter in the page so they feel instant; this returns the scoped set once, with counts
    tallied per currency.
    """
    as_on = getdate(as_on or nowdate())
    company = company or _default_company()
    sources = _sources_for_user()
    if source:
        sources = [s for s in sources if s.name == source]

    rows, skipped, no_access, truncated = [], [], [], []
    for src in sources:
        try:
            src_rows, was_capped, total = _rows_for_source(
                src, company, branch, as_on, due_from, due_to
            )
            rows.extend(src_rows)
            if was_capped:
                truncated.append({"source": src.name, "shown": len(src_rows), "total": total})
        except frappe.PermissionError:
            # expected, not a fault: this user cannot read that voucher type. Say nothing to the
            # Error Log and drop the stream rather than showing an empty chip.
            no_access.append(src.name)
        except Exception as e:
            # one misconfigured source must not blank the whole inbox, but it must be visible
            frappe.log_error(
                title="Dues Inbox: source failed",
                message=frappe.get_traceback() + "\n\nSource: " + src.name,
            )
            skipped.append({"source": src.name, "reason": str(e)[:200]})

    sources = [s for s in sources if s.name not in no_access]
    _attach_follow_ups(rows)
    rows.sort(key=lambda r: (-cint(r["days_overdue"]), -flt(r["amount"])))

    return {
        "as_on": str(as_on),
        "company": company,
        "company_currency": _company_currency(company),
        "sources": [
            {"name": s.name, "label": s.label or s.name, "direction": s.direction,
             "accent": s.accent or "Amber", "voucher_doctype": s.voucher_doctype}
            for s in sources
        ],
        "rows": rows,
        "kpis": _kpis(rows),
        "buckets": _bucket_counts(rows),
        "worklists": _worklist_counts(rows),
        "skipped_sources": skipped,
        "no_access_sources": no_access,
        "truncated": truncated,
        "can_make_payment_entry": frappe.has_permission("Payment Entry", "create"),
    }


def _rows_for_source(src, company, branch, as_on, due_from=None, due_to=None):
    meta = frappe.get_meta(src.voucher_doctype)
    date_field = _resolve_field(meta, src.date_field, "Due Date Field")
    amount_field = _resolve_field(meta, src.amount_field, "Amount Field")
    if not date_field or not amount_field:
        raise ValueError("date and amount fields are both required on " + src.voucher_doctype)

    party_field = _resolve_field(meta, src.party_field, "Party Field")
    party_type_field = _resolve_field(meta, src.party_type_field, "Party Type Field")
    company_field = _resolve_field(meta, src.company_field, "Company Field")
    branch_field = _resolve_field(meta, src.branch_field, "Branch Field")
    currency_field, fixed_currency = _currency_source(meta, amount_field, company)

    fields = ["name", date_field, amount_field, "docstatus"]
    for optional in (party_field, party_type_field, company_field, branch_field, currency_field):
        if optional and optional not in fields:
            fields.append(optional)

    filters = {amount_field: [">", 0.005]}
    filters["docstatus"] = ["<", 2] if src.include_drafts else 1
    if company and company_field:
        filters[company_field] = company
    if branch and branch_field:
        filters[branch_field] = branch
    if due_from and due_to:
        filters[date_field] = ["between", [due_from, due_to]]
    elif due_from:
        filters[date_field] = [">=", due_from]
    elif due_to:
        filters[date_field] = ["<=", due_to]
    filters.update(_extra_filters(src, meta))

    # get_list, not frappe.qb: this is the line that keeps one branch's clerk out of another
    # branch's receivables, because it honours role permissions and User Permissions.
    records = frappe.get_list(
        src.voucher_doctype,
        filters=filters,
        fields=fields,
        order_by=date_field + " asc",
        limit_page_length=ROW_CAP + 1,
        ignore_ifnull=True,
    )
    was_capped = len(records) > ROW_CAP
    total = None
    if was_capped:
        records = records[:ROW_CAP]
        counted = frappe.get_list(src.voucher_doctype, filters=filters,
                                  fields=["count(name) as total"])
        total = counted[0].get("total") if counted else None

    grace = cint(src.grace_days)
    out = []
    for rec in records:
        raw_due = rec.get(date_field)
        due = getdate(raw_due) if raw_due else None
        days = (as_on - due).days - grace if due else 0
        row_company = (rec.get(company_field) if company_field else "") or company or ""
        out.append({
            "source": src.name,
            "source_label": src.label or src.name,
            "direction": src.direction,
            "accent": src.accent or "Amber",
            "voucher_doctype": src.voucher_doctype,
            "voucher": rec.get("name"),
            "party": (rec.get(party_field) if party_field else "") or "",
            "party_type": (rec.get(party_type_field) if party_type_field else "") or src.party_type or "",
            "company": row_company,
            "branch": (rec.get(branch_field) if branch_field else "") or "",
            "due_date": str(due) if due else "",
            "days_overdue": days,
            "bucket": _bucket_of(days),
            "amount": flt(rec.get(amount_field)),
            # the currency of THIS amount, which for an invoice outstanding is the party account's
            "currency": (
                (rec.get(currency_field) if currency_field else None)
                or fixed_currency
                or _company_currency(row_company)
            ),
            "docstatus": rec.get("docstatus"),
        })
    return out, was_capped, total


def _currency_source(meta, amount_field, company):
    """How to label this amount: (sibling fieldname to read, fixed currency).

    A Currency field declares its currency in `options`, either as a
    `Doctype:link_field:currency_field` triple (base_paid_amount -> the company's own currency) or
    as the name of another field on the same DocType (outstanding_amount -> party_account_currency).
    """
    df = meta.get_field(amount_field)
    options = (df.options or "").strip() if df else ""
    if not options:
        return None, _company_currency(company)
    if ":" in options:
        # e.g. Company:company:default_currency — a company-currency amount
        return None, _company_currency(company)
    _sibling_df, usable = field_is_usable(meta, options)
    if usable:
        return options, None
    return None, _company_currency(company)


def _extra_filters(src, meta):
    """Admin-supplied filters, refused when they name something unqueryable.

    Values go to get_list, which binds them, so Frappe's own filter shapes work:
    {"clearance_date": ["is", "not set"]} and {"status": ["not in", [...]]}.
    """
    raw = (src.extra_filters or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise ValueError("Extra Filters is not valid JSON")
    if not isinstance(parsed, dict):
        raise ValueError("Extra Filters must be a JSON object")
    for fieldname in parsed:
        _df, usable = field_is_usable(meta, fieldname)
        if not usable:
            raise ValueError("Extra Filters names %s, which is not queryable" % fieldname)
    return parsed


def _bucket_of(days):
    if days < 0:
        return "not_due"
    if days <= 30:
        return "0-30"
    if days <= 60:
        return "31-60"
    if days <= 90:
        return "61-90"
    return "90+"


# ── follow-up state ───────────────────────────────────────────────────────────

def _attach_follow_ups(rows):
    if not rows:
        return
    vouchers = list({r["voucher"] for r in rows})
    follow_ups = {}
    # get_list, so a user who cannot read follow-ups simply sees none
    try:
        existing = frappe.get_list(
            "PM Dues Follow Up",
            filters={"voucher": ["in", vouchers]},
            fields=["name", "voucher_doctype", "voucher", "state", "promised_date", "snooze_until",
                    "owner_user", "last_contacted", "note"],
            limit_page_length=0,
        )
    except frappe.PermissionError:
        existing = []
    for fu in existing:
        follow_ups[(fu.voucher_doctype, fu.voucher)] = fu

    for row in rows:
        fu = follow_ups.get((row["voucher_doctype"], row["voucher"]))
        row["follow_up"] = fu.name if fu else None
        row["state"] = fu.state if fu else "Open"
        row["promised_date"] = str(fu.promised_date) if fu and fu.promised_date else ""
        row["snooze_until"] = str(fu.snooze_until) if fu and fu.snooze_until else ""
        row["owner_user"] = fu.owner_user if fu else ""
        row["note"] = fu.note if fu else ""
        row["last_contacted"] = str(fu.last_contacted) if fu and fu.last_contacted else ""
        row["snoozed"] = bool(
            fu and fu.state == "Snoozed" and fu.snooze_until
            and getdate(fu.snooze_until) > getdate(today())
        )
        row["worklist"] = _worklist_of(row)


def _worklist_of(row):
    if row["snoozed"]:
        return "snoozed"
    if row["state"] == "Promised":
        return "promised"
    if row["state"] == "Open":
        return "untouched"
    return "touched"


# ── tallies, always per currency ──────────────────────────────────────────────

def _kpis(rows):
    live = [r for r in rows if not r["snoozed"]]
    by_direction = {}
    for row in live:
        entry = by_direction.setdefault(row["direction"], {"count": 0, "amounts": {}})
        entry["count"] += 1
        if row["days_overdue"] >= 0:
            cur = row["currency"] or ""
            entry["amounts"][cur] = flt(entry["amounts"].get(cur)) + flt(row["amount"])
    return {
        "by_direction": by_direction,
        "total_rows": len(rows),
        "live_rows": len(live),
        "oldest_days": max([r["days_overdue"] for r in live], default=0),
        "due_today": len([r for r in live if r["days_overdue"] == 0]),
        "currencies": sorted({r["currency"] for r in live if r["currency"]}),
    }


def _bucket_counts(rows):
    counts = {key: {"count": 0, "amounts": {}} for key in BUCKET_KEYS}
    for row in rows:
        if row["snoozed"]:
            continue
        entry = counts.setdefault(row["bucket"], {"count": 0, "amounts": {}})
        entry["count"] += 1
        cur = row["currency"] or ""
        entry["amounts"][cur] = flt(entry["amounts"].get(cur)) + flt(row["amount"])
    return counts


def _worklist_counts(rows):
    counts = {key: 0 for key in WORKLISTS}
    for row in rows:
        counts[row["worklist"]] = counts.get(row["worklist"], 0) + 1
        if row["days_overdue"] == 0 and not row["snoozed"]:
            counts["due_today"] += 1
    return counts


def _default_company():
    """The company to scope to when the caller did not name one."""
    company = frappe.defaults.get_user_default("Company")
    if company:
        return company
    companies = frappe.get_all("Company", pluck="name", limit=2)
    return companies[0] if len(companies) == 1 else None


def _company_currency(company=None):
    company = company or _default_company()
    return frappe.get_cached_value("Company", company, "default_currency") if company else None


# ── actions ───────────────────────────────────────────────────────────────────

@frappe.whitelist()
def save_follow_up(voucher_doctype, voucher, state, promised_date=None, snooze_until=None,
                   note=None, owner_user=None, source=None, party=None, party_type=None,
                   company=None):
    """Record what was agreed on one voucher.

    Authorisation, in order: the state must be one we know, the voucher type must be one this
    user's own sources cover (so read access on some unrelated doctype is not a way in), the user
    must be able to read the voucher, and then the save runs through normal permissions — no
    ignore_permissions, so the DocPerms and User Permissions on PM Dues Follow Up apply.
    """
    if state not in ACTIVE_STATES:
        frappe.throw(_("%s is not a follow-up state.") % frappe.bold(state))

    permitted = {s.voucher_doctype for s in _sources_for_user()}
    if voucher_doctype not in permitted:
        frappe.throw(
            _("%s is not one of your dues sources.") % frappe.bold(voucher_doctype),
            frappe.PermissionError,
        )
    frappe.has_permission(voucher_doctype, "read", doc=voucher, throw=True)

    if owner_user and owner_user != frappe.session.user:
        # reassigning someone else's chase is a supervisor's job
        if not set(OWNER_OVERRIDE_ROLES) & set(frappe.get_roles()):
            frappe.throw(_("Only Accounts Manager can hand a follow-up to someone else."),
                         frappe.PermissionError)

    name = frappe.db.get_value(
        "PM Dues Follow Up", {"voucher_doctype": voucher_doctype, "voucher": voucher}, "name"
    )
    doc = frappe.get_doc("PM Dues Follow Up", name) if name else frappe.new_doc("PM Dues Follow Up")
    doc.update({
        "voucher_doctype": voucher_doctype,
        "voucher": voucher,
        "source": source or doc.get("source"),
        "party": party or doc.get("party"),
        "party_type": party_type or doc.get("party_type"),
        "company": company or doc.get("company"),
        "state": state,
        "promised_date": promised_date or None,
        "snooze_until": snooze_until or None,
        "owner_user": owner_user or doc.get("owner_user") or frappe.session.user,
    })
    # an omitted note must not wipe what a colleague wrote
    if note is not None:
        doc.note = note
    doc.save()
    frappe.db.commit()
    return {"name": doc.name, "state": doc.state, "snooze_until": str(doc.snooze_until or "")}


@frappe.whitelist()
def make_payment_entry(voucher_doctype, voucher):
    """Hand back a Payment Entry for this voucher, using ERPNext's own builder."""
    permitted = {s.voucher_doctype for s in _sources_for_user()}
    if voucher_doctype not in permitted:
        frappe.throw(
            _("%s is not one of your dues sources.") % frappe.bold(voucher_doctype),
            frappe.PermissionError,
        )
    frappe.has_permission("Payment Entry", "create", throw=True)
    frappe.has_permission(voucher_doctype, "read", doc=voucher, throw=True)
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    return get_payment_entry(voucher_doctype, voucher).as_dict()
