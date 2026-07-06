"""
Permission Manager — Warehouse Dashboard API

Returns data scoped to the current user's warehouse(s):
  • Material Requests they need to fulfil (source warehouse = theirs)
  • Material Requests they created (to track status)
  • Pending PM Workflow Actions assigned to them
"""

import frappe
from frappe.utils import today


@frappe.whitelist()
def get_warehouse_dashboard_data() -> dict:
    user  = frappe.session.user
    roles = set(frappe.get_roles(user))

    warehouses = frappe.db.get_all(
        "User Permission",
        filters={"user": user, "allow": "Warehouse", "is_default": 1},
        pluck="for_value",
    )

    is_manager = bool(roles & {"Stock Manager", "System Manager"})

    mr_to_fulfill     = _get_mr_to_fulfill(warehouses)
    my_mrs            = _get_my_mrs(user)
    pending_approvals = _get_pending_approvals(user, roles)

    transferred_today = frappe.db.count(
        "Stock Entry",
        filters={
            "docstatus": 1,
            "purpose": "Material Transfer",
            "owner": user,
            "posting_date": today(),
        },
    )

    return {
        "warehouses": warehouses,
        "is_manager": is_manager,
        "mr_to_fulfill": mr_to_fulfill,
        "my_mrs": my_mrs,
        "pending_approvals": pending_approvals,
        "kpis": {
            "mr_to_fulfill_count": len(mr_to_fulfill),
            "my_mr_count": len(my_mrs),
            "pending_approval_count": len(pending_approvals),
            "transferred_today": transferred_today,
        },
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_mr_to_fulfill(warehouses: list) -> list:
    """
    Submitted Material Requests of type Material Transfer where the SOURCE
    warehouse belongs to this user.
    """
    if not warehouses:
        return []

    mrs = frappe.get_all(
        "Material Request",
        filters={
            "docstatus": 1,
            "material_request_type": "Material Transfer",
            "set_from_warehouse": ["in", warehouses],
            "status": ["not in", ["Stopped", "Cancelled", "Ordered"]],
        },
        fields=[
            "name", "transaction_date", "status",
            "set_from_warehouse", "set_warehouse", "owner",
        ],
        order_by="transaction_date asc",
        limit=50,
    )
    return _enrich_mrs(mrs)


def _get_my_mrs(user: str) -> list:
    """Material Requests created by this user that are pending or in-progress."""
    mrs = frappe.get_all(
        "Material Request",
        filters={
            "docstatus": ["in", [0, 1]],   # include drafts pending workflow approval
            "owner": user,
            "material_request_type": "Material Transfer",
            "status": ["not in", ["Cancelled", "Stopped", "Transferred"]],
        },
        fields=[
            "name", "transaction_date", "status",
            "set_from_warehouse", "set_warehouse", "owner",
        ],
        order_by="transaction_date desc",
        limit=30,
    )
    return _enrich_mrs(mrs)


def _enrich_mrs(mr_list: list) -> list:
    """Attach item_count, total_qty, requester_name to each MR in one pass."""
    if not mr_list:
        return mr_list

    names = [mr.name for mr in mr_list]

    # Item counts — single SQL round-trip for all MRs
    count_rows = frappe.db.sql(
        """
        SELECT parent,
               COUNT(*)                AS item_count,
               COALESCE(SUM(qty), 0)   AS total_qty
        FROM   `tabMaterial Request Item`
        WHERE  parent IN %(names)s
        GROUP  BY parent
        """,
        {"names": names},
        as_dict=True,
    )
    count_map = {r.parent: r for r in count_rows}

    # Owner full names — one lookup for all unique owners
    owners = list({mr.owner for mr in mr_list if mr.owner})
    name_map: dict = {}
    if owners:
        users = frappe.db.get_all(
            "User",
            filters={"name": ["in", owners]},
            fields=["name", "full_name"],
        )
        name_map = {u.name: u.full_name or u.name.split("@")[0] for u in users}

    for mr in mr_list:
        c = count_map.get(mr.name, {})
        mr["item_count"]     = int(c.get("item_count") or 0)
        mr["total_qty"]      = float(c.get("total_qty") or 0)
        mr["requester_name"] = name_map.get(mr.owner, (mr.owner or "").split("@")[0])

    return mr_list


def _get_pending_approvals(user: str, roles: set) -> list:
    """
    Open PM Workflow Actions for Stock Entry Material Transfer where this user
    is the designated approver.  Stale actions (document has already moved to a
    different workflow state) are filtered out so only truly-pending items show.
    """
    if not frappe.db.table_exists("PM Workflow Action"):
        return []

    actions = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Open", "reference_doctype": "Stock Entry"},
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "assigned_to", "creation",
        ],
    )
    if not actions:
        return []

    # Fetch current SE state + warehouse info in one round-trip
    se_names = list({a.reference_name for a in actions})
    se_info: dict = {}
    for se in frappe.db.get_all(
        "Stock Entry",
        filters={"name": ["in", se_names]},
        fields=["name", "workflow_state", "docstatus", "from_warehouse", "to_warehouse"],
    ):
        se_info[se.name] = se

    # Drop stale/cancelled actions — document moved on or was cancelled
    actions = [
        a for a in actions
        if se_info.get(a.reference_name)
        and se_info[a.reference_name].docstatus != 2
        and (
            not se_info[a.reference_name].workflow_state
            or se_info[a.reference_name].workflow_state == a.workflow_state
        )
    ]
    if not actions:
        return []

    perm_rows = frappe.get_all(
        "PM Workflow Action Permitted Role",
        filters={"parent": ["in", [a.name for a in actions]]},
        fields=["parent", "approver_type", "approver"],
    )
    perms_map: dict = {}
    for p in perm_rows:
        perms_map.setdefault(p.parent, []).append(p)

    result = []
    seen: set = set()

    for act in actions:
        is_mine    = False
        role_label = ""

        if act.assigned_to == user:
            is_mine    = True
            role_label = next(
                (p.approver for p in perms_map.get(act.name, []) if p.approver_type == "Role"),
                "Direct",
            )
        else:
            for p in perms_map.get(act.name, []):
                if p.approver_type == "Role" and p.approver in roles:
                    is_mine    = True
                    role_label = p.approver
                    break
                if p.approver_type == "User" and p.approver == user:
                    is_mine    = True
                    role_label = "Direct"
                    break

        if is_mine and act.name not in seen:
            seen.add(act.name)
            se      = se_info.get(act.reference_name)
            from_wh = (se.from_warehouse if se else "") or ""
            to_wh   = (se.to_warehouse   if se else "") or ""
            result.append({
                "name":              act.name,
                "reference_doctype": act.reference_doctype,
                "reference_name":    act.reference_name,
                "workflow_state":    act.workflow_state,
                "role_label":        role_label,
                "creation":          str(act.creation),
                "from_warehouse":    from_wh,
                "to_warehouse":      to_wh,
                "warehouse":         to_wh or from_wh,  # for chip-level filtering
            })

    return result
