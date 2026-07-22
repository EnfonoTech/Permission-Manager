"""
Permission Manager — Warehouse Dashboard API

Returns data scoped to the current user's warehouse(s):
  • Material Requests they need to fulfil (source warehouse = theirs)
  • Material Requests they created (to track status)
  • Pending PM Workflow Actions assigned to them
"""

import frappe
from frappe import _
from frappe.utils import today, flt


@frappe.whitelist()
def get_warehouse_dashboard_data() -> dict:
    user  = frappe.session.user
    roles = set(frappe.get_roles(user))

    warehouses = frappe.db.get_all(
        "User Permission",
        filters={"user": user, "allow": "Warehouse", "is_default": 1},
        pluck="for_value",
    )

    is_manager = "System Manager" in roles

    mr_to_fulfill     = _get_mr_to_fulfill(warehouses, is_manager)
    my_mrs            = _get_my_mrs(user, is_manager)
    pending_approvals = _get_pending_approvals(user, roles, warehouses, is_manager)

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

def _get_mr_to_fulfill(warehouses: list, is_manager: bool = False) -> list:
    """
    Submitted Material Requests of type Material Transfer where the SOURCE
    warehouse belongs to this user. Managers/admins see ALL source warehouses.
    """
    if not is_manager and not warehouses:
        return []

    filters = {
        "docstatus": 1,
        "material_request_type": "Material Transfer",
        "status": ["not in", ["Stopped", "Cancelled", "Ordered", "Transferred"]],
    }
    if not is_manager:
        filters["set_from_warehouse"] = ["in", warehouses]

    mrs = frappe.get_all(
        "Material Request",
        filters=filters,
        fields=[
            "name", "transaction_date", "status",
            "set_from_warehouse", "set_warehouse", "owner", "custom_priority",
        ],
        order_by="transaction_date desc",
        limit=100,
    )
    return _enrich_mrs(_drop_already_fulfilling(mrs))


def _drop_already_fulfilling(mrs: list) -> list:
    """
    Remove Material Requests that already have an in-progress or submitted
    Material Transfer Stock Entry linked to them, so the same MR is not shown
    for fulfilment twice (which led users to create duplicate Stock Entries).

    A Stock Entry Detail row carries `material_request` when the transfer was
    made against an MR, and its docstatus mirrors the parent Stock Entry:
        docstatus 0 = Draft / pending workflow approval  → block (in progress)
        docstatus 1 = Submitted                          → block (done)
        docstatus 2 = Cancelled                          → do NOT block (MR reappears)
    """
    if not mrs:
        return mrs

    names = [mr.name for mr in mrs]
    busy = frappe.get_all(
        "Stock Entry Detail",
        filters={"material_request": ["in", names], "docstatus": ["<", 2]},
        pluck="material_request",
    )
    busy_set = set(busy)
    return [mr for mr in mrs if mr.name not in busy_set]


def _get_my_mrs(user: str, is_manager: bool = False) -> list:
    """Material Requests created by this user that are pending or in-progress.
    Managers/admins see ALL open Material Transfer requests."""
    filters = {
        "docstatus": ["in", [0, 1]],   # include drafts pending workflow approval
        "material_request_type": "Material Transfer",
        "status": ["not in", ["Cancelled", "Stopped", "Transferred"]],
    }
    if not is_manager:
        filters["owner"] = user

    mrs = frappe.get_all(
        "Material Request",
        filters=filters,
        fields=[
            "name", "transaction_date", "status",
            "set_from_warehouse", "set_warehouse", "owner",
        ],
        order_by="transaction_date desc",
        limit=100,
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


def _ses_with_cancelled_mr(se_names: list) -> set:
    """
    Stock Entry names whose linked Material Request(s) are ALL cancelled
    (docstatus 2). A Material Transfer raised against an MR that was later
    cancelled must not sit in an approver's queue — approving it would fulfil
    a dead request. Stock Entries with no MR link, or with at least one live
    linked MR, stay visible.
    """
    if not se_names:
        return set()
    rows = frappe.db.sql(
        """
        SELECT sed.parent AS se, mr.docstatus AS mr_docstatus
        FROM   `tabStock Entry Detail` sed
        JOIN   `tabMaterial Request` mr ON mr.name = sed.material_request
        WHERE  sed.parent IN %(names)s
          AND  sed.material_request IS NOT NULL
          AND  sed.material_request != ''
        """,
        {"names": se_names},
        as_dict=True,
    )
    by_se: dict = {}
    for r in rows:
        by_se.setdefault(r.se, []).append(r.mr_docstatus)
    return {se for se, st in by_se.items() if st and all(s == 2 for s in st)}


def _get_pending_approvals(user: str, roles: set, warehouses: list, is_manager: bool = False) -> list:
    """
    Open PM Workflow Actions for Stock Entry Material Transfer scoped to the
    user's default warehouse(s) as the destination.

    The destination warehouse is resolved from:
      1. Stock Entry header field `to_warehouse`
      2. First row of `tabStock Entry Detail`.`t_warehouse` when header is blank

    Stale actions (document already moved to a different state) are dropped.
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

    # Fetch current SE state + header warehouse in one round-trip
    se_names = list({a.reference_name for a in actions})
    cancelled_mr_ses = _ses_with_cancelled_mr(se_names)
    se_info: dict = {}
    for se in frappe.db.get_all(
        "Stock Entry",
        filters={"name": ["in", se_names]},
        fields=["name", "workflow_state", "docstatus", "from_warehouse", "to_warehouse"],
    ):
        se_info[se.name] = se

    # For SEs with no header-level to_warehouse, resolve from first item row
    ses_without_header_wh = [
        name for name, se in se_info.items() if not se.to_warehouse
    ]
    if ses_without_header_wh:
        item_rows = frappe.db.sql(
            """
            SELECT parent, t_warehouse
            FROM   `tabStock Entry Detail`
            WHERE  parent IN %(names)s
              AND  t_warehouse IS NOT NULL AND t_warehouse != ''
            ORDER  BY parent, idx ASC
            """,
            {"names": ses_without_header_wh},
            as_dict=True,
        )
        seen_parents: set = set()
        for row in item_rows:
            if row.parent not in seen_parents:
                se_info[row.parent].to_warehouse = row.t_warehouse
                seen_parents.add(row.parent)

    # Keep only SEs whose destination is in the user's default warehouses
    # (managers/admins see all destinations)
    if warehouses and not is_manager:
        wh_set = set(warehouses)
        in_scope = {
            name for name, se in se_info.items()
            if se.to_warehouse and se.to_warehouse in wh_set
        }
        actions = [a for a in actions if a.reference_name in in_scope]

    # Drop stale/cancelled actions — document moved on or was cancelled
    actions = [
        a for a in actions
        if se_info.get(a.reference_name)
        and se_info[a.reference_name].docstatus != 2
        and a.reference_name not in cancelled_mr_ses
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
                "available_actions": [],                # filled below
            })

    # Attach the exact workflow actions the current user may apply inline
    # (e.g. Accept / Reject). Uses the SAME resolver as apply_workflow
    # (get_transitions → matrix + self-approval + condition checks) so the
    # buttons rendered always match what the transition will actually accept —
    # never offer an action that would fail with "Invalid Workflow Action".
    try:
        from permission_manager.permission_manager.workflow import get_transitions
    except Exception:
        get_transitions = None

    for r in result:
        if not get_transitions:
            break
        try:
            trans = get_transitions(
                {"doctype": r["reference_doctype"], "name": r["reference_name"]}
            )
            r["available_actions"] = [
                {
                    "action":              t.get("action"),
                    "requires_comment":    bool(t.get("is_return_for_correction")),
                    "requires_attachment": bool(t.get("require_attachment")),
                }
                for t in trans
                if t.get("action")
            ]
        except Exception:
            frappe.clear_last_message()
            r["available_actions"] = []

    # Keep only rows the current user can actually DECIDE on — an approve or
    # reject action must be available. This drops submitter-only states such as
    # a Draft whose only action is "Send for Acceptance" (that belongs to the
    # creator, not the approver's Pending Approvals queue).
    result = [
        r for r in result
        if any(_action_kind(a.get("action")) in ("approve", "reject")
               for a in (r.get("available_actions") or []))
    ]

    # Over-fulfilment (duplicate) guard: hide an MR's pending approvals ONLY when
    # the TOTAL transferred qty across its non-cancelled Stock Entries EXCEEDS the
    # requested qty — i.e. a genuine duplicate transfer was raised. Splitting one
    # MR across several Stock Entries that together stay within the requested qty
    # is legitimate partial fulfilment and must remain visible for approval.
    if result:
        se_names = [r["reference_name"] for r in result]
        mr_rows = frappe.get_all(
            "Stock Entry Detail",
            filters={"parent": ["in", se_names], "material_request": ["is", "set"]},
            fields=["parent", "material_request"],
        )
        se_to_mr: dict = {}
        for row in mr_rows:
            se_to_mr.setdefault(row.parent, row.material_request)

        mrs = list({m for m in se_to_mr.values() if m})
        over_fulfilled: set = set()
        if mrs:
            # Per MR line: sum(transfer_qty) of all non-cancelled SE rows vs the
            # requested stock_qty. If any line is exceeded, the MR is a duplicate.
            rows = frappe.db.sql(
                """
                SELECT mri.parent AS mr
                FROM `tabMaterial Request Item` mri
                JOIN (
                    SELECT material_request_item, SUM(transfer_qty) AS moved
                    FROM `tabStock Entry Detail`
                    WHERE docstatus < 2
                      AND material_request_item IS NOT NULL
                      AND material_request_item != ''
                    GROUP BY material_request_item
                ) sed ON sed.material_request_item = mri.name
                WHERE mri.parent IN %(mrs)s
                  AND sed.moved > mri.stock_qty + 0.001
                """,
                {"mrs": mrs},
                as_dict=True,
            )
            over_fulfilled = {r.mr for r in rows}

        if over_fulfilled:
            result = [
                r for r in result
                if se_to_mr.get(r["reference_name"]) not in over_fulfilled
            ]

    return result


def _action_kind(label: str) -> str:
    """Classify a workflow action label → approve / reject / other.

    NB: check 'send' first — "Send for Acceptance" contains the substring
    'accept' and must NOT be treated as an approve action.
    """
    al = (label or "").lower()
    if "send" in al:                       # e.g. "Send for Acceptance" (submitter action)
        return "other"
    if any(k in al for k in ("reject", "decline", "cancel")):
        return "reject"
    if any(k in al for k in ("accept", "approve", "authoriz")):
        return "approve"
    return "other"


@frappe.whitelist()
def get_stock_entry_preview(stock_entry: str) -> dict:
    """
    Lightweight Stock Entry preview for the dashboard's inline approval view —
    header + item lines — so an approver can review without opening the form.
    """
    if not frappe.has_permission("Stock Entry", "read", doc=stock_entry):
        frappe.throw(_("Not permitted to read this Stock Entry"), frappe.PermissionError)

    se = frappe.get_doc("Stock Entry", stock_entry)
    items = [
        {
            "item_code":   i.item_code,
            "item_name":   i.item_name,
            "qty":         flt(i.qty),
            "uom":         i.uom,
            "s_warehouse": i.s_warehouse,
            "t_warehouse": i.t_warehouse,
        }
        for i in se.items
    ]
    return {
        "name":           se.name,
        "workflow_state": se.get("workflow_state") or "",
        "purpose":        se.purpose,
        "posting_date":   str(se.posting_date or ""),
        "from_warehouse": se.get("from_warehouse") or "",
        "to_warehouse":   se.get("to_warehouse") or "",
        "total_qty":      sum(flt(i.qty) for i in se.items),
        "item_count":     len(items),
        "remarks":        se.get("remarks") or "",
        "owner":          se.owner,
        "items":          items,
    }
