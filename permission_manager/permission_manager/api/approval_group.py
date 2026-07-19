# permission_manager/permission_manager/api/approval_group.py
"""Account-driven approval routing (company-agnostic).

The approval group of a transaction is derived from the ACCOUNT on its lines, not
from account numbers. Tag each expense Account (or a parent Account) with the
custom field ``custom_approval_group``; a document-event stamps the derived value
onto the transaction header (``custom_approval_group``) so that PM Workflow
transition conditions — which can only read header fields — can route on it.

Portable across companies/charts: no account-number assumptions, the mapping lives
as data on each site's own accounts.
"""

import frappe

FIELD = "custom_approval_group"


def account_group(account: str) -> str:
    """Approval group for an account, inheriting from ancestor accounts.

    Walks up ``parent_account`` until a tagged account is found, so tagging a few
    parent (group) accounts is enough — children inherit.
    """
    seen = set()
    while account and account not in seen:
        seen.add(account)
        row = frappe.get_cached_value("Account", account, [FIELD, "parent_account"], as_dict=True)
        if not row:
            return ""
        if row.get(FIELD):
            return row.get(FIELD)
        account = row.get("parent_account")
    return ""


def stamp_purchase_invoice(doc, method=None):
    """before_save(Purchase Invoice): set ``custom_approval_group`` from the first
    expense line whose account (or an ancestor) carries an approval group. Empty =
    a normal material invoice (routed by currency: local vs import)."""
    if not frappe.db.has_column("Account", FIELD):
        return
    group = ""
    for item in (doc.get("items") or []):
        acc = item.get("expense_account")
        if acc:
            g = account_group(acc)
            if g:
                group = g
                break
    doc.set(FIELD, group)
