# permission_manager/permission_manager/api/dues_inbox.py
"""One view of everything falling due, built from PM Dues Source configuration.

Adding a stream — lease invoices, employee advances, a second cheque register — means adding a
PM Dues Source row, not editing this file. Each source names the voucher DocType and the fields
that carry its due date, amount and party; this module turns that into a query.

Field names arriving from configuration are resolved through `frappe.get_meta()` before they are
used, and reading goes through `frappe.get_list`, never a hand-built query. That is deliberate:
get_list applies role permissions, User Permissions and any permission_query_conditions hook, so
an Accounts User restricted to one branch sees one branch. Building the same query with frappe.qb
would be shorter and would quietly return every company's invoices to everyone.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate, today

# keys only: the labels live in the page, and _() at module level would translate once at import
# into whichever language happened to load first
BUCKET_KEYS = ("not_due", "0-30", "31-60", "61-90", "90+")

WORKLISTS = ("untouched", "promised", "snoozed", "due_today", "overdue")
ACTIVE_STATES = ("Open", "Contacted", "Promised", "Snoozed", "Disputed", "Escalated")


# ── configuration ─────────────────────────────────────────────────────────────

def _sources_for_user():
    """Enabled sources this user's roles allow, newest configuration always respected."""
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


def _resolve_field(meta, fieldname):
    """A configured field name, only if the DocType really has it."""
    if not fieldname:
        return None
    fieldname = fieldname.strip()
    if meta.get_field(fieldname) or fieldname in frappe.model.default_fields:
        return fieldname
    return None


# ── the inbox ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dues_inbox(company=None, branch=None, as_on=None, source=None):
    """Every due row this user may see, with follow-up state attached.

    Filtering by bucket, worklist and source happens in the page so the chips are instant; this
    returns the whole scoped set once with the counts already tallied.
    """
    as_on = getdate(as_on or nowdate())
    # Every amount on this page is formatted in ONE currency, so the page is scoped to ONE
    # company. Left unset it would sum BHD and AED into a single meaningless total — a bug this
    # project has already paid for once.
    company = company or _default_company()
    sources = _sources_for_user()
    if source:
        sources = [s for s in sources if s.name == source]

    rows, skipped, no_access = [], [], []
    for src in sources:
        try:
            rows.extend(_rows_for_source(src, company, branch, as_on))
        except frappe.PermissionError:
            # expected, not a fault: this user cannot read that voucher type. Say nothing to the
            # Error Log and drop the stream rather than showing an empty chip.
            no_access.append(src.name)
        except Exception:
            # one misconfigured source must not blank the whole inbox
            frappe.log_error(
                title="Dues Inbox: source failed",
                message=frappe.get_traceback() + "\n\nSource: " + src.name,
            )
            skipped.append(src.name)

    sources = [s for s in sources if s.name not in no_access]

    _attach_follow_ups(rows)
    rows.sort(key=lambda r: (-cint(r["days_overdue"]), -flt(r["amount"])))

    return {
        "as_on": str(as_on),
        "company": company,
        "currency": _company_currency(company),
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
        "can_make_payment_entry": frappe.has_permission("Payment Entry", "create"),
        "can_make_payment_advice": (
            frappe.db.exists("DocType", "Payment Advice")
            and frappe.has_permission("Payment Advice", "create")
        ),
    }


def _rows_for_source(src, company, branch, as_on):
    meta = frappe.get_meta(src.voucher_doctype)
    date_field = _resolve_field(meta, src.date_field)
    amount_field = _resolve_field(meta, src.amount_field)
    if not date_field or not amount_field:
        raise ValueError("date or amount field missing on " + src.voucher_doctype)

    party_field = _resolve_field(meta, src.party_field)
    party_type_field = _resolve_field(meta, src.party_type_field)
    company_field = _resolve_field(meta, src.company_field)
    branch_field = _resolve_field(meta, src.branch_field)

    fields = ["name", date_field, amount_field, "docstatus"]
    for optional in (party_field, party_type_field, company_field, branch_field):
        if optional and optional not in fields:
            fields.append(optional)

    filters = {amount_field: [">", 0.005]}
    filters["docstatus"] = ["<", 2] if src.include_drafts else 1
    if company and company_field:
        filters[company_field] = company
    if branch and branch_field:
        filters[branch_field] = branch
    filters.update(_extra_filters(src, meta))

    # get_list, not frappe.qb: this is the line that keeps one branch's clerk out of another
    # branch's receivables, because it honours role permissions and User Permissions.
    records = frappe.get_list(
        src.voucher_doctype,
        filters=filters,
        fields=fields,
        order_by=date_field + " asc",
        limit_page_length=0,
        ignore_ifnull=True,
    )

    grace = cint(src.grace_days)
    out = []
    for rec in records:
        raw_due = rec.get(date_field)
        due = getdate(raw_due) if raw_due else None
        days = (as_on - due).days - grace if due else 0
        out.append({
            "source": src.name,
            "source_label": src.label or src.name,
            "direction": src.direction,
            "accent": src.accent or "Amber",
            "voucher_doctype": src.voucher_doctype,
            "voucher": rec.get("name"),
            "party": (rec.get(party_field) if party_field else "") or "",
            "party_type": (rec.get(party_type_field) if party_type_field else "") or src.party_type or "",
            "company": (rec.get(company_field) if company_field else "") or "",
            "branch": (rec.get(branch_field) if branch_field else "") or "",
            "due_date": str(due) if due else "",
            "days_overdue": days,
            "bucket": _bucket_of(days),
            "amount": flt(rec.get(amount_field)),
            "docstatus": rec.get("docstatus"),
        })
    return out


def _extra_filters(src, meta):
    """Admin-supplied filters, dropped rather than trusted when they name a missing field.

    Values are handed to get_list, which binds them — the shape is Frappe's own filter dict, so
    {"clearance_date": ["is", "not set"]} and {"status": ["not in", [...]]} both work.
    """
    raw = (src.extra_filters or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {f: c for f, c in parsed.items() if _resolve_field(meta, f)}


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
    for fu in frappe.get_all(
        "PM Dues Follow Up",
        filters={"voucher": ["in", vouchers]},
        fields=["name", "voucher_doctype", "voucher", "state", "promised_date", "snooze_until",
                "owner_user", "last_contacted", "note"],
    ):
        follow_ups[(fu.voucher_doctype, fu.voucher)] = fu

    for row in rows:
        fu = follow_ups.get((row["voucher_doctype"], row["voucher"]))
        row["follow_up"] = fu or None
        row["state"] = fu.state if fu else "Open"
        row["promised_date"] = str(fu.promised_date) if fu and fu.promised_date else ""
        row["snooze_until"] = str(fu.snooze_until) if fu and fu.snooze_until else ""
        row["owner_user"] = fu.owner_user if fu else ""
        row["note"] = fu.note if fu else ""
        row["last_contacted"] = str(fu.last_contacted) if fu and fu.last_contacted else ""
        row["snoozed"] = bool(
            fu and fu.state == "Snoozed" and fu.snooze_until and getdate(fu.snooze_until) > getdate(today())
        )
        row["worklist"] = _worklist_of(row)


def _worklist_of(row):
    if row["snoozed"]:
        return "snoozed"
    if row["state"] == "Promised":
        return "promised"
    if row["state"] == "Open":
        return "untouched"
    return "overdue"


# ── tallies ───────────────────────────────────────────────────────────────────

def _kpis(rows):
    live = [r for r in rows if not r["snoozed"]]
    by_direction = {}
    for row in live:
        entry = by_direction.setdefault(row["direction"], {"count": 0, "amount": 0.0, "overdue": 0.0})
        entry["count"] += 1
        entry["amount"] += flt(row["amount"])
        if row["days_overdue"] >= 0:
            entry["overdue"] += flt(row["amount"])
    return {
        "by_direction": by_direction,
        "total_overdue_amount": sum(flt(r["amount"]) for r in live if r["days_overdue"] >= 0),
        "total_rows": len(rows),
        "live_rows": len(live),
        "oldest_days": max([r["days_overdue"] for r in live], default=0),
        "due_today": len([r for r in live if r["days_overdue"] == 0]),
    }


def _bucket_counts(rows):
    counts = {key: {"count": 0, "amount": 0.0} for key in BUCKET_KEYS}
    for row in rows:
        if row["snoozed"]:
            continue
        entry = counts.setdefault(row["bucket"], {"count": 0, "amount": 0.0})
        entry["count"] += 1
        entry["amount"] += flt(row["amount"])
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
    # exactly one company on the site: no ambiguity to resolve
    return companies[0] if len(companies) == 1 else None


def _company_currency(company=None):
    company = company or _default_company()
    return frappe.get_cached_value("Company", company, "default_currency") if company else None


# ── actions ───────────────────────────────────────────────────────────────────

@frappe.whitelist()
def save_follow_up(voucher_doctype, voucher, state, promised_date=None, snooze_until=None,
                   note=None, owner_user=None, source=None, party=None, party_type=None,
                   company=None):
    """Record what was agreed on one voucher. Requires read access on the voucher itself."""
    frappe.has_permission(voucher_doctype, "read", doc=voucher, throw=True)
    if state not in ACTIVE_STATES + ("Settled",):
        frappe.throw(_("%s is not a follow-up state.") % frappe.bold(state))

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
        "note": note,
        "owner_user": owner_user or doc.get("owner_user") or frappe.session.user,
    })
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "state": doc.state, "snooze_until": str(doc.snooze_until or "")}


@frappe.whitelist()
def make_payment_entry(voucher_doctype, voucher):
    """Hand back a Payment Entry for this voucher, using ERPNext's own builder."""
    frappe.has_permission("Payment Entry", "create", throw=True)
    frappe.has_permission(voucher_doctype, "read", doc=voucher, throw=True)
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    return get_payment_entry(voucher_doctype, voucher).as_dict()
