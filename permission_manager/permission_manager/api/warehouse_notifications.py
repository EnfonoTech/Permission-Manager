"""
Warehouse real-time notifications.

Fires pm_new_approval_action realtime events (reuses the existing chime +
toast + dashboard-refresh pipeline in pm_realtime.js) at two extra points:

  1. Material Request submitted (type = Material Transfer)
     → notify every user whose DEFAULT warehouse = set_from_warehouse
       (they need to fulfil the request)

  2. PM Workflow Action created for a Stock Entry
     → notify every user whose DEFAULT warehouse = to_warehouse
       (they need to accept the incoming transfer)
     (approvers are already notified by _push_inbox_notifications; this
      covers dashboard-only users who are not in the approver role)
"""

import frappe
from frappe import _


# ── Helpers ────────────────────────────────────────────────────────────────────

def _default_warehouse_users(warehouse: str) -> list[str]:
    """Return users who have `warehouse` as their is_default User Permission."""
    if not warehouse:
        return []
    return frappe.db.get_all(
        "User Permission",
        filters={"allow": "Warehouse", "for_value": warehouse, "is_default": 1},
        pluck="user",
    )


def _push(users: list[str], doctype: str, docname: str, subject: str, skip_user: str | None = None) -> None:
    """Fire pm_new_approval_action to each user (after DB commit)."""
    for user in users:
        if user in ("Administrator", "Guest") or user == skip_user:
            continue
        try:
            frappe.publish_realtime(
                event="pm_new_approval_action",
                message={"doctype": doctype, "docname": docname, "subject": subject},
                user=user,
                after_commit=True,
            )
        except Exception:
            pass


# ── Hook: Material Request submitted ──────────────────────────────────────────

def on_material_request_submit(doc, method=None):
    """
    Fires when a Material Transfer MR is submitted.
    Notifies all users whose default warehouse = the FROM warehouse (the
    people responsible for picking and sending the stock).
    """
    if doc.material_request_type != "Material Transfer":
        return
    if not doc.set_from_warehouse:
        return

    users = _default_warehouse_users(doc.set_from_warehouse)
    _push(
        users,
        doctype="Material Request",
        docname=doc.name,
        subject=_("New material request to fulfil: {0}").format(doc.name),
        skip_user=doc.owner,
    )


# ── Hook: PM Workflow Action created (Stock Entry) ────────────────────────────

def on_pm_workflow_action_insert(doc, method=None):
    """
    Fires when a new PM Workflow Action is created.
    For Stock Entry references: notifies all users whose default warehouse =
    the to_warehouse on the SE (they need to accept the incoming transfer).
    The approvers themselves are already notified by _push_inbox_notifications;
    this is a supplementary refresh ping for non-approver warehouse staff.
    """
    if doc.reference_doctype != "Stock Entry":
        return

    se = frappe.db.get_value(
        "Stock Entry",
        doc.reference_name,
        ["to_warehouse", "purpose"],
        as_dict=True,
    )
    if not se or se.purpose != "Material Transfer":
        return

    to_wh = se.to_warehouse
    # Fall back to first item row when header to_warehouse is blank
    if not to_wh:
        to_wh = frappe.db.get_value(
            "Stock Entry Detail",
            {"parent": doc.reference_name, "t_warehouse": ["!=", ""]},
            "t_warehouse",
            order_by="idx asc",
        )
    if not to_wh:
        return

    users = _default_warehouse_users(to_wh)
    _push(
        users,
        doctype="Stock Entry",
        docname=doc.reference_name,
        subject=_("Stock Entry pending acceptance: {0}").format(doc.reference_name),
        skip_user=frappe.session.user,
    )
