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
from frappe.utils import now_datetime


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
    actions = frappe.get_all(
        "PM Workflow Action",
        filters={"status": "Open"},
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "assigned_to", "for_submitter", "creation", "priority",
        ],
    )
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

    # ── Step 3: filter to actions I can act on ─────────────────────────────────
    my_actions = []
    for act in actions:
        role_id = ""
        is_mine = False

        if act.assigned_to == user:
            is_mine = True
            role_id = "Direct"
        else:
            for p in perms_map.get(act.name, []):
                if p.approver_type == "Role" and p.approver in user_roles:
                    is_mine = True
                    role_id = p.approver
                    break
                if p.approver_type == "User" and p.approver == user:
                    is_mine = True
                    role_id = "Direct"
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

        # Holder — who this action is currently assigned to
        holder = ""
        if act.assigned_to:
            holder = (
                frappe.db.get_value("User", act.assigned_to, "full_name")
                or act.assigned_to.split("@")[0]
            )

        # Days waiting since action was created
        days = int((today_dt - act.creation).total_seconds() / 86400) if act.creation else 0

        # Available transitions
        trans_info      = dt_state_map.get((doctype, state), {"actions": [], "roles": []})
        avail_actions   = trans_info["actions"]
        role_id         = act.get("role_id") or (trans_info["roles"][0] if trans_info["roles"] else "")
        category        = _categorize(state, avail_actions)

        results.append({
            "name":              act.name,
            "doctype":           doctype,
            "docname":           docname,
            "date":              frappe.utils.format_datetime(act.creation, "dd/MM/yy HH:mm"),
            "creation_iso":      str(act.creation)[:10],  # YYYY-MM-DD for client-side filtering/sorting
            "priority":          priority,
            "state":             state,
            "role_id":           role_id,
            "holder":            holder,
            "days":              days,
            "creator":           creator,
            "category":          category,
            "available_actions": avail_actions,
            "doc_url":           f"/app/{_safe_slug(doctype)}/{docname}",
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
def get_my_approval_history(limit: int = 100) -> list:
    """Return recent PM Workflow Actions completed by the current user."""
    user = frappe.session.user
    rows = frappe.get_all(
        "PM Workflow Action",
        filters={"completed_by": user, "status": "Completed"},
        fields=[
            "name", "reference_doctype", "reference_name",
            "workflow_state", "completed_by_role", "modified",
        ],
        order_by="modified desc",
        limit=int(limit),
    )
    result = []
    for r in rows:
        result.append({
            "name":         r.name,
            "doctype":      r.reference_doctype,
            "docname":      r.reference_name,
            "state":        r.workflow_state,
            "role":         r.completed_by_role or "Direct",
            "date":         frappe.utils.format_datetime(r.modified, "dd/MM/yy HH:mm"),
            "doc_url":      f"/app/{_safe_slug(r.reference_doctype)}/{r.reference_name}",
        })
    return result


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
