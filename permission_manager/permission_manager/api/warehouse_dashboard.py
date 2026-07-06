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
    pending_approvals = _enrich_approvals(_get_pending_approvals(user, roles))

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
            "status": ["in", ["Submitted", "Partially Ordered"]],
            "material_request_type": "Material Transfer",
            "set_from_warehouse": ["in", warehouses],
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
    """Material Requests created by this user that are still open."""
    mrs = frappe.get_all(
        "Material Request",
        filters={
            "docstatus": 1,
            "owner": user,
            "material_request_type": "Material Transfer",
            "status": ["in", ["Submitted", "Partially Ordered", "Ordered"]],
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


def _enrich_approvals(approvals: list) -> list:
    """Attach a warehouse field to each approval for client-side filtering."""
    if not approvals:
        return approvals

    se_names = [a["reference_name"] for a in approvals if a["reference_doctype"] == "Stock Entry"]
    mr_names = [a["reference_name"] for a in approvals if a["reference_doctype"] == "Material Request"]

    wh_map: dict = {}
    if se_names:
        for se in frappe.db.get_all(
            "Stock Entry",
            filters={"name": ["in", se_names]},
            fields=["name", "from_warehouse", "to_warehouse"],
        ):
            wh_map[se.name] = se.to_warehouse or se.from_warehouse or ""

    if mr_names:
        for mr in frappe.db.get_all(
            "Material Request",
            filters={"name": ["in", mr_names]},
            fields=["name", "set_from_warehouse", "set_warehouse"],
        ):
            wh_map[mr.name] = mr.set_from_warehouse or mr.set_warehouse or ""

    for ap in approvals:
        ap["warehouse"] = wh_map.get(ap["reference_name"], "")

    return approvals


def _get_pending_approvals(user: str, roles: set) -> list:
    """Open PM Workflow Actions where this user is the designated approver."""
    if not frappe.db.table_exists("PM Workflow Action"):
        return []

    actions = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Open"},
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "assigned_to", "creation",
        ],
    )
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
            result.append({
                "name":              act.name,
                "reference_doctype": act.reference_doctype,
                "reference_name":    act.reference_name,
                "workflow_state":    act.workflow_state,
                "role_label":        role_label,
                "creation":          str(act.creation),
            })

    return result
