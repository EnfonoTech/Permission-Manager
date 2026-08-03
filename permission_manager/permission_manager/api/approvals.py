"""
Permission Manager — Approval Inbox API
Author: siva <siva@enfono.com>

Returns all open PM Workflow Actions where the current user is the designated
approver (direct assignment OR via role). Results are grouped into:
  • Approval Pending
  • Decision Pending
  • Acknowledgement Pending

Also exposes a quick-action endpoint for applying a workflow transition
directly from the inbox without visiting the form.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, getdate, now_datetime, nowdate


# ─── Helpers ──────────────────────────────────────────────────────────────────

_PRIORITY_WEIGHT = {"Critical": 0, "Urgent": 0, "High": 1, "Medium": 2, "Low": 3}
_VALID_PRIORITIES = set(_PRIORITY_WEIGHT.keys())


def _categorize(state: str, action_names: list) -> str:
    """
    Categorise a pending action by reading the state name and available
    transition labels.  Keyword matching keeps this fast (no extra DB hits).
    """
    s = state.lower()
    acts = [a.lower() for a in action_names]

    ack_kw = ("acknowledge", "accept", "receive", "noted", "confirm", "read")
    if any(k in acts for k in ack_kw) or any(k in s for k in ack_kw):
        return "Acknowledgement Pending"

    approve_kw = (
        "approve", "review", "verify", "validate",
        "authoris", "authoriz", "sanction", "forward",
    )
    if any(k in acts for k in approve_kw) or any(k in s for k in approve_kw):
        return "Approval Pending"

    return "Decision Pending"


def _safe_slug(doctype: str) -> str:
    return doctype.lower().replace(" ", "-")


def _only_pending_docs(actions: list) -> list:
    """Keep only actions whose reference document is still a draft (docstatus 0).

    Submitted (1) or cancelled (2) documents cannot accept a further pending-state
    workflow action, so listing them in the approval inbox only confuses approvers
    and any apply attempt fails with
    "Workflow state '...' is incompatible with document status". A reference
    document that no longer exists (hard-deleted) is dropped too. On an unexpected
    query error we fail OPEN (keep the action) so a transient hiccup never hides a
    genuinely-pending approval."""
    if not actions:
        return actions
    by_dt: dict = {}
    for a in actions:
        if a.reference_doctype and a.reference_name:
            by_dt.setdefault(a.reference_doctype, set()).add(a.reference_name)
    draft_docs: set = set()
    for dt, names in by_dt.items():
        try:
            rows = frappe.get_all(dt, filters={"name": ["in", list(names)]},
                                  fields=["name", "docstatus"])
            for r in rows:
                if r.docstatus == 0:
                    draft_docs.add((dt, r.name))
        except Exception:
            frappe.clear_last_message()
            for n in names:            # fail open — cannot verify, keep it
                draft_docs.add((dt, n))
    return [a for a in actions
            if (a.reference_doctype, a.reference_name) in draft_docs]


# ─── Main API ─────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_my_pending_approvals() -> dict:
    """
    Return all open PM Workflow Actions where the current user is the approver.

    Response shape:
    {
        "total": int,
        "groups": [
            {
                "label": "Approval Pending",
                "items": [ { ... }, ... ]
            },
            ...
        ]
    }
    """
    if not frappe.db.table_exists("PM Workflow Action"):
        return {"groups": [], "total": 0}

    user      = frappe.session.user
    user_roles = set(frappe.get_roles(user))

    # ── Step 1: all open actions ───────────────────────────────────────────────
    # "Forwarded" rows are included on purpose. Forwarding flips the original action to
    # Forwarded, and while it sits there it appears in no user-facing view at all — not this
    # inbox (which used to filter status == "Open"), not the list view (whose permission
    # condition hard-appends status = 'Open') and not History (which filters Completed). The
    # approver who forwarded it, and the role it belongs to, lost sight of the document until
    # somebody else finished it. They are shown here as waiting, with who is holding it, and
    # with no action buttons — see `waiting_with` below.
    # Document types whose workflow is flagged "Hide from Approvals Page". Configured on the
    # PM Workflow itself rather than listed here, so hiding or restoring one is a tick box and
    # not a deployment.
    hidden = _hidden_doctypes()

    actions = frappe.get_all(
        "PM Workflow Action",
        # Stock Entry approvals are shown ONLY in the Warehouse Dashboard,
        # not this general inbox (per ops request 2026-07-22).
        filters={"status": ["in", ["Open", "Forwarded"]],
                 "reference_doctype": ["not in", ["Stock Entry"] + hidden]},
        fields=[
            "name", "reference_doctype", "reference_name", "status",
            "workflow_state", "assigned_to", "for_submitter", "creation", "priority",
            "is_adhoc", "adhoc_for", "return_to_originator",
            # on a Forwarded row this holds the user who forwarded it
            "completed_by",
        ],
    )
    if not actions:
        return {"groups": [], "total": 0}

    # Drop actions whose reference document is already submitted (docstatus 1)
    # or cancelled (2): they cannot accept a pending-state workflow action and
    # only confuse approvers (apply errors "Workflow state incompatible with
    # document status"). Only draft (docstatus 0) documents remain.
    actions = _only_pending_docs(actions)
    if not actions:
        return {"groups": [], "total": 0}

    # ── Step 2: load permitted_roles for all actions in one query ──────────────
    perm_rows = frappe.get_all(
        "PM Workflow Action Permitted Role",
        filters={"parent": ["in", [a.name for a in actions]]},
        fields=["parent", "approver_type", "approver"],
    )
    perms_map: dict = {}
    for p in perm_rows:
        perms_map.setdefault(p.parent, []).append(p)

    # An ad-hoc (forwarded) action deliberately carries NO permitted_roles of its own — that
    # child table is an authorisation surface, not a label, and populating it would hand every
    # holder of the role read access plus the ability to close the ad-hoc action. The role slot
    # an ad-hoc approver stands in belongs to the action it was forwarded from, so borrow the
    # label from there. One query, no N+1.
    adhoc_parents = [a.adhoc_for for a in actions if a.get("is_adhoc") and a.get("adhoc_for")]
    parent_role_map: dict = {}
    if adhoc_parents:
        for p in frappe.get_all(
            "PM Workflow Action Permitted Role",
            filters={"parent": ["in", adhoc_parents], "approver_type": "Role"},
            fields=["parent", "approver"],
        ):
            parent_role_map.setdefault(p.parent, p.approver)

    # Who is holding each Forwarded action — its open ad-hoc child. One query.
    forwarded_names = [a.name for a in actions if a.status == "Forwarded"]
    holder_of_forwarded: dict = {}
    if forwarded_names:
        for child in frappe.get_all(
            "PM Workflow Action",
            filters={"adhoc_for": ["in", forwarded_names], "status": "Open"},
            fields=["adhoc_for", "assigned_to"],
        ):
            if child.assigned_to:
                holder_of_forwarded.setdefault(child.adhoc_for, child.assigned_to)

    # ── Step 3: filter to actions I can act on ─────────────────────────────────
    my_actions = []
    is_admin = user == "Administrator"
    for act in actions:
        role_id = ""
        is_mine = False

        # a forwarded action stands in for the role of the action it came from
        adhoc_role = parent_role_map.get(act.get("adhoc_for")) if act.get("is_adhoc") else None

        # whoever forwarded an action keeps sight of it while somebody else holds it, even if
        # they do not hold the role themselves (an Administrator forwarding, for instance)
        if act.status == "Forwarded" and act.completed_by == user:
            act["role_id"] = next(
                (p.approver for p in perms_map.get(act.name, []) if p.approver_type == "Role"),
                "Direct",
            )
            my_actions.append(act)
            continue

        if is_admin:
            # Administrator is an unrestricted super-viewer: every open action is theirs.
            is_mine = True
            # NOT "Administrator": that literal used to win on every ad-hoc row, because an
            # ad-hoc action has no permitted_roles to look through, and it made a forwarded
            # action read as if the Administrator were the one holding it. Falling through to
            # "" lets the state's own role fill the gap further down.
            role_id = (
                adhoc_role
                or next(
                    (p.approver for p in perms_map.get(act.name, []) if p.approver_type == "Role"),
                    None,
                )
                or ("Ad-hoc" if act.get("is_adhoc") else "")
            )
        elif act.assigned_to == user:
            is_mine = True
            # Prefer the role name over "Direct" for display — the action may have been
            # pinned to this user via warehouse-permission resolution but still belongs to
            # a named role (e.g. "Stock Manager").  Show that role so the inbox is useful.
            role_id = (
                adhoc_role
                or next(
                    (p.approver for p in perms_map.get(act.name, []) if p.approver_type == "Role"),
                    None,
                )
                or ("Ad-hoc" if act.get("is_adhoc") else "Direct")
            )
        else:
            for p in perms_map.get(act.name, []):
                if p.approver_type == "Role" and p.approver in user_roles:
                    is_mine = True
                    role_id = p.approver
                    break
                if p.approver_type == "User" and p.approver == user:
                    is_mine = True
                    role_id = next(
                        (p2.approver for p2 in perms_map.get(act.name, []) if p2.approver_type == "Role"),
                        "Direct",
                    )
                    break

        if is_mine:
            act["role_id"] = role_id
            my_actions.append(act)

    if not my_actions:
        return {"groups": [], "total": 0}

    # ── Step 4: bulk-load PM Workflow transitions for relevant doctypes ─────────
    unique_doctypes = list({a.reference_doctype for a in my_actions})

    workflows = frappe.get_all(
        "PM Workflow",
        filters={"document_type": ["in", unique_doctypes], "is_active": 1},
        fields=["name", "document_type"],
    )
    # doctype → first active workflow (simplified for inbox display)
    wf_by_doctype = {wf.document_type: wf.name for wf in workflows}
    wf_names = list(set(wf_by_doctype.values()))

    transitions_all = (
        frappe.get_all(
            "PM Workflow Transition",
            filters={"parent": ["in", wf_names]},
            fields=["parent", "state", "action", "allowed", "approver_type"],
        )
        if wf_names
        else []
    )

    # (doctype, state) → {"actions": [...], "roles": [...]}
    dt_state_map: dict = {}
    for t in transitions_all:
        dt = next((wf.document_type for wf in workflows if wf.name == t.parent), None)
        if not dt:
            continue
        key = (dt, t.state)
        entry = dt_state_map.setdefault(key, {"actions": [], "roles": []})
        if t.action and t.action not in entry["actions"]:
            entry["actions"].append(t.action)
        if t.approver_type == "Role" and t.allowed:
            entry["roles"].append(t.allowed)

    # ── Step 5: enrich every action ────────────────────────────────────────────
    today_dt = now_datetime()
    results  = []

    for act in my_actions:
        doctype = act.reference_doctype
        docname = act.reference_name
        state   = act.workflow_state or ""

        # Priority stamped on the action record at creation time
        priority = act.priority if act.priority in _VALID_PRIORITIES else "Medium"

        # Creator full name
        creator_user = (
            act.for_submitter
            or (frappe.db.get_value(doctype, docname, "owner") if docname else "")
            or ""
        )
        creator = ""
        if creator_user:
            creator = (
                frappe.db.get_value("User", creator_user, "full_name")
                or creator_user.split("@")[0]
            )

        # Holder — who this action is currently assigned to. A Forwarded action is not held by
        # its own assignee any more: it is held by the ad-hoc approver it was forwarded to, so
        # the row says who to chase.
        is_waiting = act.status == "Forwarded"
        holder_user = holder_of_forwarded.get(act.name) if is_waiting else act.assigned_to
        holder = ""
        if holder_user:
            holder = (
                frappe.db.get_value("User", holder_user, "full_name")
                or holder_user.split("@")[0]
            )

        # Days waiting since action was created
        days = int((today_dt - act.creation).total_seconds() / 86400) if act.creation else 0

        # Available transitions
        trans_info      = dt_state_map.get((doctype, state), {"actions": [], "roles": []})
        # A waiting row offers no buttons: the document is out with somebody else, and acting on
        # it from here would race the person holding it.
        avail_actions   = [] if is_waiting else trans_info["actions"]
        role_id         = act.get("role_id") or (trans_info["roles"][0] if trans_info["roles"] else "")
        # categorise on what the state can do, not on the emptied button list
        category        = _categorize(state, trans_info["actions"])

        results.append({
            "name":              act.name,
            "doctype":           doctype,
            "docname":           docname,
            "date":              frappe.utils.format_datetime(act.creation, "dd/MM/yy HH:mm"),
            "creation_iso":      str(act.creation)[:10],
            "priority":          priority,
            "state":             state,
            "role_id":           role_id,
            "holder":            holder,
            "days":              days,
            "creator":           creator,
            "category":          category,
            "available_actions": avail_actions,
            "doc_url":           f"/app/{_safe_slug(doctype)}/{docname}",
            "is_adhoc":          bool(act.get("is_adhoc")),
            "adhoc_for":         act.get("adhoc_for") or "",
            "return_to_originator": bool(act.get("return_to_originator")),
            # forwarded and waiting on somebody else — shown, but not actionable from here
            "is_waiting":        is_waiting,
            "waiting_with":      holder,
        })

    # ── Step 6: sort within each category then group ────────────────────────────
    category_order = ["Approval Pending", "Decision Pending", "Acknowledgement Pending"]
    grouped: dict  = {}
    for r in results:
        grouped.setdefault(r["category"], []).append(r)

    for items in grouped.values():
        items.sort(key=lambda x: (_PRIORITY_WEIGHT.get(x["priority"], 3), -x["days"]))

    return {
        "groups": [
            {"label": cat, "items": grouped[cat]}
            for cat in category_order
            if cat in grouped
        ],
        "total": len(results),
    }


# ─── Quick action from inbox ──────────────────────────────────────────────────

@frappe.whitelist()
def quick_apply_workflow_action(
    doctype: str, docname: str, action: str, comment: str = "", priority: str = "Medium"
) -> dict:
    """Apply a PM Workflow transition directly from the Approval Inbox."""
    from permission_manager.permission_manager.workflow import apply_workflow

    doc = frappe.get_doc(doctype, docname)
    apply_workflow(doc.as_dict(), action, comment or None, priority or "Medium")
    return {"success": True, "docname": docname, "action": action}


# ─── Approval history (what the current user has already acted on) ────────────

@frappe.whitelist()
def get_my_approval_history(limit: int = 200, all_users: int = 0,
                            from_date: str = None, to_date: str = None) -> list:
    """
    Return workflow action history visible to the current user:
    - Actions the current user personally completed (approver view)
    - Actions completed on documents the current user submitted (submitter view)

    A System Manager may pass all_users=1 to see everybody's, which is the only way to answer
    "who approved this last week" without opening each document. It is bounded rather than
    open-ended: the query is always limited to a date window - the caller's, or the last
    DEFAULT_HISTORY_DAYS if none is given - and to `limit` rows. A site with a hundred thousand
    completed actions must not be able to ask for all of them by unticking a box.
    """
    user = frappe.session.user
    limit = min(cint(limit) or 200, MAX_HISTORY_ROWS)

    all_users = cint(all_users) and "System Manager" in frappe.get_roles(user)
    window = _history_window(from_date, to_date)

    if all_users:
        # Everybody's, still inside the window and the row cap.
        rows = frappe.get_all(
            "PM Workflow Action",
            filters=dict({"status": "Completed"}, **window),
            fields=[
                "name", "reference_doctype", "reference_name",
                "workflow_state", "completed_by", "completed_by_role", "modified",
                "for_submitter",
            ],
            order_by="modified desc",
            limit=limit,
        )
        return _shape_history(_dedupe_actions(rows), all_users=True)

    # Completed actions where I was the approver
    as_approver = frappe.get_all(
        "PM Workflow Action",
        filters=dict({"completed_by": user, "status": "Completed"}, **window),
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "completed_by", "completed_by_role", "modified",
        ],
        order_by="modified desc",
        limit=int(limit),
    )

    # Completed actions on documents I submitted (so submitters see approval history of their docs)
    as_submitter = frappe.get_all(
        "PM Workflow Action",
        filters=dict({"for_submitter": user, "status": "Completed"}, **window),
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "completed_by", "completed_by_role", "modified",
        ],
        order_by="modified desc",
        limit=int(limit),
    )

    # Merge, deduplicate, sort newest first
    seen = set()
    merged = []
    for r in as_approver + as_submitter:
        if r.name not in seen:
            seen.add(r.name)
            merged.append(r)
    merged.sort(key=lambda x: x.modified, reverse=True)

    return _shape_history(_dedupe_actions(merged)[:limit], all_users=False)


# ── history: bounded, and shaped without a query per row ──────────────────────

MAX_HISTORY_ROWS = 500
DEFAULT_HISTORY_DAYS = 30


def _blank(value):
    """A date the caller did not really give.

    An empty filter travels from the browser as the literal string "null" or "undefined", not
    as nothing, and getdate() rejects those - which killed the whole request rather than simply
    meaning "no date".
    """
    return value in (None, "", "null", "None", "undefined", "NaN")


def _history_window(from_date, to_date):
    """A date window is always applied. Without one this query would happily scan every
    completed action the site has ever recorded, which is the difference between a page that
    opens and a page that times out."""
    from_date = None if _blank(from_date) else from_date
    to_date = None if _blank(to_date) else to_date
    try:
        if from_date:
            getdate(from_date)
        if to_date:
            getdate(to_date)
    except Exception:
        # an unparseable date means "no date", never a failed page
        from_date = to_date = None

    if from_date and to_date:
        return {"modified": ["between", [from_date, add_days(getdate(to_date), 1)]]}
    if from_date:
        return {"modified": [">=", from_date]}
    if to_date:
        return {"modified": ["<", add_days(getdate(to_date), 1)]}
    return {"modified": [">=", add_days(nowdate(), -DEFAULT_HISTORY_DAYS)]}


def _dedupe_actions(rows):
    """One row per voucher, carrying its most recent approval event.

    A document generates an action per stage, and forwarding adds another for the same stage,
    so the tab used to list the same voucher several times - PA-26-0012-1 twice, once for its
    rejection and once for its resend. The list is meant to answer "what happened to this
    document", which is one line per document; the full sequence of who did what and when is in
    the row's expansion, so nothing is lost by collapsing here.

    Rows arrive newest first, so the first occurrence of a voucher is its latest event. The
    count of events is carried on the surviving row, so the list can say there is more inside.
    """
    counts: dict = {}
    for r in rows:
        key = (r.reference_doctype, r.reference_name)
        counts[key] = counts.get(key, 0) + 1

    seen, kept = set(), []
    for r in rows:
        key = (r.reference_doctype, r.reference_name)
        if key in seen:
            continue
        seen.add(key)
        r.event_count = counts.get(key, 1)
        kept.append(r)
    return kept


def _shape_history(rows, all_users=False):
    """Turn action records into display rows.

    Names and current document states are fetched in bulk. Doing it per row cost two queries
    each - four hundred for a normal page, a thousand once a System Manager asks for everyone's
    - and that, not the row count, is what made the tab slow.
    """
    users = {r.completed_by for r in rows if r.completed_by}
    users |= {r.get("for_submitter") for r in rows if r.get("for_submitter")}
    names = {}
    if users:
        for u in frappe.get_all("User", filters={"name": ["in", list(users)]},
                                fields=["name", "full_name"]):
            names[u.name] = u.full_name or u.name.split("@")[0]

    # current state of each referenced document, one query per doctype rather than per row
    by_doctype: dict = {}
    for r in rows:
        by_doctype.setdefault(r.reference_doctype, set()).add(r.reference_name)
    current: dict = {}
    for dt, docnames in by_doctype.items():
        try:
            if not frappe.get_meta(dt).has_field("workflow_state"):
                continue
            for d in frappe.get_all(dt, filters={"name": ["in", list(docnames)]},
                                    fields=["name", "workflow_state"]):
                current[(dt, d.name)] = d.workflow_state or ""
        except Exception:
            # a doctype that has since been removed should not take the whole tab down
            continue

    out = []
    for r in rows:
        row = {
            "name": r.name,
            "doctype": r.reference_doctype,
            "docname": r.reference_name,
            "action_state": r.workflow_state,
            "current_state": current.get((r.reference_doctype, r.reference_name), ""),
            "role": r.completed_by_role or ("Direct" if r.completed_by else "—"),
            "completed_by": names.get(r.completed_by, "") if r.completed_by else "",
            "date": frappe.utils.format_datetime(r.modified, "dd/MM/yy HH:mm"),
            "doc_url": "/app/%s/%s" % (_safe_slug(r.reference_doctype), r.reference_name),
            "event_count": cint(r.get("event_count") or 1),
        }
        if all_users:
            row["submitted_by"] = names.get(r.get("for_submitter"), r.get("for_submitter") or "")
        out.append(row)
    return out


# ─── Approval analytics ───────────────────────────────────────────────────────

@frappe.whitelist()
def get_approval_analytics() -> dict:
    """
    Return analytics data for the approval inbox:
    - Average cycle time (days) per DocType
    - Volume by DocType (last 90 days)
    - Longest pending items
    - Approver activity (top 10 by completions in last 30 days)
    """
    if not frappe.db.table_exists("PM Workflow Action"):
        return {}

    today = now_datetime()
    days_90 = frappe.utils.add_to_date(today, days=-90)
    days_30 = frappe.utils.add_to_date(today, days=-30)

    # ── Volume and avg cycle time by DocType (completed actions, last 90 days) ─
    completed = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Completed", "creation": [">=", days_90]},
        fields=["reference_doctype", "creation", "modified"],
    )

    dt_stats: dict = {}
    for row in completed:
        dt = row.reference_doctype
        if dt not in dt_stats:
            dt_stats[dt] = {"count": 0, "total_days": 0}
        dt_stats[dt]["count"] += 1
        delta = (row.modified - row.creation).total_seconds() / 86400
        dt_stats[dt]["total_days"] += delta

    volume = [
        {
            "doctype": dt,
            "count": v["count"],
            "avg_days": round(v["total_days"] / v["count"], 1),
        }
        for dt, v in dt_stats.items()
    ]
    volume.sort(key=lambda x: -x["count"])

    # ── Longest pending (open actions, sorted by age) ─────────────────────────
    open_actions = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Open"},
        fields=["reference_doctype", "reference_name", "workflow_state", "creation", "assigned_to"],
        order_by="creation asc",
        limit=10,
    )
    longest_pending = []
    for a in open_actions:
        days = int((today - a.creation).total_seconds() / 86400)
        longest_pending.append({
            "doctype":  a.reference_doctype,
            "docname":  a.reference_name,
            "state":    a.workflow_state,
            "days":     days,
            "doc_url":  f"/app/{_safe_slug(a.reference_doctype)}/{a.reference_name}",
        })

    # ── Top approvers (completions in last 30 days) ───────────────────────────
    recent_completed = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Completed", "modified": [">=", days_30]},
        fields=["completed_by"],
    )
    approver_counts: dict = {}
    for row in recent_completed:
        if row.completed_by:
            approver_counts[row.completed_by] = approver_counts.get(row.completed_by, 0) + 1

    top_approvers = []
    for user, count in sorted(approver_counts.items(), key=lambda x: -x[1])[:10]:
        full_name = frappe.db.get_value("User", user, "full_name") or user.split("@")[0]
        top_approvers.append({"user": user, "name": full_name, "count": count})

    # ── Summary counts ────────────────────────────────────────────────────────
    total_open = frappe.db.count("PM Workflow Action", {"status": "Open"})
    total_completed_30 = len(recent_completed)
    overdue = sum(1 for a in open_actions if (today - a.creation).days > 30)

    return {
        "summary": {
            "total_open":          total_open,
            "completed_last_30d":  total_completed_30,
            "overdue":             overdue,
        },
        "volume_by_doctype": volume[:15],
        "longest_pending":   longest_pending,
        "top_approvers":     top_approvers,
    }


# ─── Permission audit log ─────────────────────────────────────────────────────

@frappe.whitelist()
def get_permission_audit_log(
    doctype_name: str = "", role: str = "", limit: int = 200
) -> list:
    """Fetch PM Permission Log entries. System Manager only."""
    if "System Manager" not in frappe.get_roles():
        frappe.throw("Permission Studio is only accessible to System Managers.", frappe.PermissionError)

    filters: dict = {}
    if doctype_name:
        filters["doctype_name"] = doctype_name
    if role:
        filters["role"] = role

    return frappe.get_all(
        "PM Permission Log",
        filters=filters,
        fields=[
            "name", "changed_on", "changed_by", "source",
            "doctype_name", "role", "ptype", "old_value", "new_value", "note",
        ],
        order_by="changed_on desc",
        limit=int(limit),
    )


# ─── SLA reminder scheduler ───────────────────────────────────────────────────

def send_approval_reminders():
    """
    Scheduled daily job.
    For every open PM Workflow Action, check against the parent workflow's
    reminder_after_days and escalate_after_days thresholds and send emails.
    """
    if not frappe.db.table_exists("PM Workflow Action"):
        return

    today = now_datetime()

    open_actions = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Open"},
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "assigned_to", "for_submitter", "creation",
        ],
    )
    if not open_actions:
        return

    # Load permitted roles in bulk
    perm_rows = frappe.get_all(
        "PM Workflow Action Permitted Role",
        filters={"parent": ["in", [a.name for a in open_actions]]},
        fields=["parent", "approver_type", "approver"],
    )
    perm_map: dict = {}
    for p in perm_rows:
        perm_map.setdefault(p.parent, []).append(p)

    # Load workflow SLA settings per doctype
    workflows = frappe.get_all(
        "PM Workflow",
        filters={"is_active": 1},
        fields=["name", "document_type", "reminder_after_days", "escalate_after_days", "escalation_email"],
    )
    wf_by_dt = {w.document_type: w for w in workflows}

    for action in open_actions:
        wf = wf_by_dt.get(action.reference_doctype)
        if not wf:
            continue

        remind_days = int(wf.reminder_after_days or 0)
        escalate_days = int(wf.escalate_after_days or 0)
        if not remind_days and not escalate_days:
            continue

        age_days = int((today - action.creation).total_seconds() / 86400)

        if escalate_days and age_days >= escalate_days:
            _send_sla_email(action, perm_map, wf, age_days, escalated=True)
        elif remind_days and age_days >= remind_days:
            _send_sla_email(action, perm_map, wf, age_days, escalated=False)


def _send_sla_email(action, perm_map: dict, wf, age_days: int, escalated: bool):
    """Send a reminder or escalation email for a single overdue action."""
    doctype = action.reference_doctype
    docname = action.reference_name
    doc_link = f"{frappe.utils.get_url()}/app/{_safe_slug(doctype)}/{docname}"

    recipients = []
    if action.assigned_to:
        email = frappe.db.get_value("User", action.assigned_to, "email")
        if email:
            recipients.append(email)
    else:
        for p in perm_map.get(action.name, []):
            if p.approver_type == "Role":
                for u in frappe.utils.user.get_users_with_role(p.approver)[:10]:
                    email = frappe.db.get_value("User", u, "email")
                    if email:
                        recipients.append(email)
            elif p.approver_type == "User":
                email = frappe.db.get_value("User", p.approver, "email")
                if email:
                    recipients.append(email)

    if escalated and wf.escalation_email:
        recipients.append(wf.escalation_email)

    if not recipients:
        return

    subject = (
        f"{'🔴 ESCALATED' if escalated else '⏰ Reminder'}: "
        f"Approval pending {age_days} days — {doctype} {docname}"
    )
    message = f"""
<p>An approval action has been pending for <strong>{age_days} days</strong> and requires your attention.</p>
<table style="border-collapse:collapse;width:100%;max-width:500px">
  <tr><td style="padding:6px;font-weight:bold">Document</td><td style="padding:6px">{doctype}: <a href="{doc_link}">{docname}</a></td></tr>
  <tr><td style="padding:6px;font-weight:bold">State</td><td style="padding:6px">{action.workflow_state}</td></tr>
  <tr><td style="padding:6px;font-weight:bold">Pending Since</td><td style="padding:6px">{age_days} days</td></tr>
</table>
<p style="margin-top:16px">
  <a href="{frappe.utils.get_url()}/app/pm-approval-inbox"
     style="background:#1a73e8;color:white;padding:10px 20px;border-radius:4px;text-decoration:none">
     Open Approval Inbox
  </a>
</p>
"""
    try:
        frappe.sendmail(
            recipients=list(set(recipients)),
            subject=subject,
            message=message,
            reference_doctype="PM Workflow Action",
            reference_name=action.name,
        )
    except Exception:
        frappe.log_error(f"PM Approval SLA: failed to send reminder for {action.name}")


def _hidden_doctypes() -> list:
    """Document types whose workflow asks not to appear on the Approvals page."""
    if not frappe.db.has_column("PM Workflow", "hide_from_approval_inbox"):
        return []
    # Deliberately not restricted to active workflows. Switching a workflow off does not
    # remove the actions it already created - Payment Request has three still open - so an
    # inactive workflow is exactly when the flag has to keep working. Requiring is_active here
    # meant ticking the box did nothing at all for it.
    return frappe.get_all(
        "PM Workflow",
        filters={"hide_from_approval_inbox": 1},
        pluck="document_type",
    ) or []


def _condition_holds(condition: str, doc) -> bool:
    """Would this transition be offered for this document?

    Conditions that read frappe.session are answered "yes": they depend on who is looking,
    and the chain is drawn for the document, not for the viewer. Evaluated the same way the
    engine evaluates them, so a chain never claims a step the engine would refuse.
    """
    if not condition:
        return True
    if "frappe.session" in condition:
        return True
    try:
        from permission_manager.permission_manager.workflow import get_workflow_safe_globals

        return bool(frappe.safe_eval(condition, get_workflow_safe_globals(), dict(doc=doc.as_dict())))
    except Exception:
        return False


def _shortest_path(edges: dict, start: str, targets: set) -> list:
    """Fewest steps from start to any target, following only the edges given."""
    if start in targets:
        return [start]
    seen, queue = {start}, [[start]]
    while queue:
        path = queue.pop(0)
        for nxt in sorted(edges.get(path[-1], [])):
            if nxt in seen:
                continue
            if nxt in targets:
                return path + [nxt]
            seen.add(nxt)
            queue.append(path + [nxt])
    return []


def _role_holders(roles) -> list:
    """Enabled users holding each role, so a stalled approval has a name to chase."""
    out = []
    for role in sorted({r for r in roles if r}):
        users = frappe.get_all(
            "Has Role", filters={"role": role, "parenttype": "User"}, pluck="parent"
        )
        people = []
        for u in sorted(set(users)):
            if u in ("Administrator", "Guest"):
                continue
            row = frappe.db.get_value("User", u, ["enabled", "full_name"], as_dict=True)
            if not row or not row.enabled:
                continue
            people.append({"user": u, "full_name": row.full_name or u.split("@")[0]})
        out.append({"role": role, "users": people, "count": len(people)})
    return out


@frappe.whitelist()
def get_document_lifecycle(doctype: str, docname: str) -> dict:
    """The approval chain this document actually travels, and where it has got to.

    Worked out per document rather than per workflow: most of these chains fork on the
    document itself - the journal template, the purchase approval group, the payment route -
    so listing every state of the workflow would show phases this document will never see.
    Conditions are evaluated against the document, and only the reachable path is returned.

    Deliberately a separate call, made when a row is expanded. Building it for every row of
    the inbox would mean loading every document on every refresh.
    """
    if not (doctype and docname):
        return {"chain": [], "roles": []}
    if not frappe.has_permission(doctype, "read", doc=docname):
        frappe.throw(_("Not permitted to read {0} {1}").format(doctype, docname), frappe.PermissionError)

    wf = frappe.db.get_value(
        "PM Workflow", {"document_type": doctype, "is_active": 1}, "name"
    )
    if not wf:
        return {"chain": [], "roles": []}

    doc = frappe.get_doc(doctype, docname)
    current = doc.get("workflow_state") or ""

    states = frappe.get_all(
        "PM Workflow Document State", filters={"parent": wf},
        fields=["state", "doc_status"], order_by="idx asc",
    )
    finals = {s.state for s in states if cstr(s.doc_status) == "1"}

    transitions = frappe.get_all(
        "PM Workflow Transition", filters={"parent": wf},
        fields=["state", "action", "next_state", "allowed", "approver_type", "condition"],
        order_by="idx asc",
    )

    edges, roles_at = {}, {}
    for t in transitions:
        if (t.action or "").strip().lower().startswith("reject"):
            continue
        if not _condition_holds(t.condition, doc):
            continue
        edges.setdefault(t.state, set()).add(t.next_state)
        if t.approver_type in (None, "", "Role") and t.allowed:
            roles_at.setdefault(t.state, set()).add(t.allowed)

    start = states[0].state if states else "Draft"
    behind = _shortest_path(edges, start, {current}) if current and current != start else [start]
    ahead = _shortest_path(edges, current or start, finals)
    chain_states = (behind or [current or start]) + (ahead[1:] if len(ahead) > 1 else [])

    # Who already acted, read from the document's own version history rather than from the
    # action records. An action's workflow_state is the state it was CREATED in - the stage the
    # person acted FROM - so listing it as though it were the outcome credited the wrong person:
    # "Shihab / Rejected" meant Shihab resent a rejected advice, not that he rejected it.
    # A Version row carries the move itself, from one state to the next, with who and when.
    done_by, events = {}, []
    for v in frappe.get_all(
        "Version",
        filters={"ref_doctype": doctype, "docname": docname},
        fields=["owner", "creation", "data"],
        order_by="creation asc",
    ):
        try:
            changed = frappe.parse_json(v.data).get("changed") or []
        except Exception:
            continue
        move = next((c for c in changed if c and c[0] == "workflow_state"), None)
        if not move:
            continue
        was, now = move[1] or "", move[2] or ""
        who = (frappe.db.get_value("User", v.owner, "full_name")
               or (v.owner or "").split("@")[0])
        events.append({
            "by": who,
            "user": v.owner or "",
            "role": "",
            "state": was,
            "to_state": now,
            "action": _("{0} to {1}").format(was or _("Draft"), now),
            "on": frappe.utils.format_datetime(v.creation, "dd/MM/yy HH:mm"),
        })
        # the person who moved a document INTO a state is the one who cleared the one before it
        if was:
            done_by[was] = who

    cur_idx = chain_states.index(current) if current in chain_states else 0
    # A document that has reached a submitting state is finished: marking that last step
    # "current" would draw it as still waiting on somebody.
    finished = current in finals or cint(doc.get("docstatus")) == 1
    chain = []
    for i, st in enumerate(chain_states):
        chain.append({
            "state": st,
            "status": "done" if (i < cur_idx or finished) else "current" if i == cur_idx else "upcoming",
            "roles": sorted(roles_at.get(st, [])),
            "by": done_by.get(st, ""),
            "final": st in finals,
        })

    pending_roles = roles_at.get(current, set())
    return {"chain": chain, "roles": _role_holders(pending_roles),
            "events": events, "current": current, "finished": bool(finished)}
