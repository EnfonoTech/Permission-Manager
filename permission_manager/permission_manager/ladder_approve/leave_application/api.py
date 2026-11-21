"""
Permission Manager — Multi-level Leave Application Approval
Author: siva <siva@enfono.com>

Provides:
  leave_application_permission_query  — permission_query_conditions hook
  before_save                         — auto-assign level-1 approver
  before_submit                       — gate submit on Approved status
  forward_leave                       — approve/forward action from form
  reject_leave                        — reject action from form
"""

import frappe
from frappe import _
from frappe.utils import cint


# ─── Helpers ──────────────────────────────────────────────────────────────────

_HR_ROLES = {"HR Manager", "HR User", "System Manager"}

# Who gives the FINAL approval from the form and from My Approvals: the same two roles
# leave_application.js tests, so a button never says "Approve" on one screen and
# "Approve & Forward" on the other. (System Manager is above, for seeing everything.)
_FINAL_ROLES = {"HR Manager", "HR User"}

APPROVE_ACTIONS = ("Approve", "Approve & Forward")
REJECT_ACTION = "Reject"


def _user_is_hr(user=None):
    roles = set(frappe.get_roles(user or frappe.session.user))
    return bool(roles & _HR_ROLES)


def _chain_for(employee: str, doctype: str = "Leave Application") -> dict:
    """
    {level: approver User} for the employee's PM Approval Chain.
    Respects scope (All DocTypes / Specific Module / Specific DocType): where several rows
    claim one level, the most specific scope wins, and the first row wins a tie.
    """
    if not employee or not frappe.db.table_exists("PM Employee Approval Chain"):
        return {}

    rows = frappe.get_all(
        "PM Employee Approval Chain",
        filters={"parent": employee, "parenttype": "Employee"},
        fields=["level", "approver", "applies_to", "module", "document_type_name"],
        order_by="idx asc",
    )
    if not rows:
        return {}

    dt_module = frappe.db.get_value("DocType", doctype, "module") or ""

    best = {}  # level -> (score, approver)
    for row in rows:
        scope = row.applies_to
        if scope == "Specific DocType":
            if row.document_type_name == doctype:
                score = 3
            else:
                continue
        elif scope == "Specific Module":
            if dt_module and row.module == dt_module:
                score = 2
            else:
                continue
        else:
            score = 1

        level = cint(row.level)
        held = best.get(level)
        if row.approver and (held is None or score > held[0]):
            best[level] = (score, row.approver)

    return {level: approver for level, (_score, approver) in best.items()}


def _get_chain_approver(employee: str, level: int, doctype: str = "Leave Application"):
    """
    Return the approver User at `level` from the employee's PM Approval Chain.
    Returns None if no chain entry found.
    """
    return _chain_for(employee, doctype).get(level)


def _chain_level_of(employee: str, user: str, doctype: str = "Leave Application"):
    """The chain level `user` holds for this employee (the highest, if they hold several), or None."""
    held = [level for level, approver in _chain_for(employee, doctype).items() if approver == user]
    return max(held) if held else None


def _next_chain_approver(employee: str, current: str, doctype: str = "Leave Application"):
    """
    The approver one step above `current` in the employee's chain, or None at the top.

    Worked out from where `current` stands rather than "always level 2": a chain of three levels
    used to hand the leave from level 1 to level 2 and then to level 2 again, for ever. A person
    who is not in the chain at all (the Department's default approver, say) hands it to level 1.
    """
    chain = _chain_for(employee, doctype)
    after = _chain_level_of(employee, current, doctype) or 0
    for level in sorted(chain):
        if level > after and chain[level] != current:
            return chain[level]
    return None


def _get_employee_for_user(user: str):
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name")


def _set_approver(doc, user: str):
    """Point the leave at `user`, keeping the name HRMS shows beside the field in step."""
    doc.leave_approver = user
    if doc.meta.has_field("leave_approver_name"):
        doc.leave_approver_name = frappe.db.get_value("User", user, "full_name") or user


def _multi_level_enabled(employee: str) -> bool:
    """Return False if the employee has disabled multi-level approval."""
    if not frappe.db.has_column("Employee", "custom_disable_multilevel_approval"):
        return True
    disabled = frappe.db.get_value("Employee", employee, "custom_disable_multilevel_approval")
    return not disabled


def _apply_leave_workflow(doc, next_state: str) -> bool:
    """
    Move the leave to `next_state` through the active Leave Application workflow.

    A workflow (hr_suite ships one) refuses a hand-set Approved/Rejected on a draft;
    its own transition sets the status and submits in one step. Returns False when
    no workflow is active, so the caller keeps the plain status update.
    """
    from frappe.model.workflow import apply_workflow, get_transitions, get_workflow_name

    if not get_workflow_name("Leave Application"):
        return False

    action = next(
        (t.action for t in get_transitions(doc) if t.next_state == next_state), None
    )
    if not action:
        frappe.throw(
            _("The approval workflow has no action that moves this leave to {0} for you.").format(
                _(next_state)
            )
        )
    apply_workflow(doc, action)
    return True


# ─── Permission query condition ───────────────────────────────────────────────

def leave_application_permission_query(user: str, doctype: str = "Leave Application") -> str:
    """
    permission_query_conditions hook for Leave Application.

    HR roles and System Manager see everything (return empty string).
    Other users see only:
      - Applications they submitted (owner)
      - Applications where they are the current leave_approver
    """
    if not user:
        user = frappe.session.user

    if user == "Administrator" or _user_is_hr(user):
        return ""

    escaped = frappe.db.escape(user)
    return (
        f"(`tabLeave Application`.`owner` = {escaped} "
        f"OR `tabLeave Application`.`leave_approver` = {escaped})"
    )


# ─── Document event hooks ─────────────────────────────────────────────────────

def before_save(doc, method=None):
    """
    Put the leave on its employee's approval chain: level 1 is the approver when the leave is
    first saved, or whenever it has none.

    The chain is read for the employee the leave is FOR, not for whoever typed it in. It used
    to be read for the document's owner, so a leave raised by HR on someone's behalf found no
    chain (HR is not the person on leave) and silently kept the Department's default approver,
    and a new leave ignored the chain because HRMS had already filled that default in. A leave
    that is already on its way keeps the approver it has: forward_leave moves it up.
    """
    employee = doc.get("employee")
    if not employee or not _multi_level_enabled(employee):
        return

    if doc.get("leave_approver") and not doc.is_new():
        return

    approver = _get_chain_approver(employee, level=1)
    if approver:
        _set_approver(doc, approver)


def before_submit(doc, method=None):
    """
    Block submit unless the leave is Approved (or the submitter is HR).
    This prevents employees from self-submitting unapproved leaves.
    """
    if _user_is_hr():
        return

    if doc.get("status") != "Approved":
        frappe.throw(
            _("Leave Application must be Approved before it can be submitted."),
            title=_("Approval Required"),
        )


# ─── Whitelisted actions ──────────────────────────────────────────────────────

@frappe.whitelist()
def forward_leave(docname: str, designation: str = None) -> str:
    """
    Forward or final-approve a Leave Application.

    - designation == "hr"  → final approval: set status = Approved
    - designation is None  → line-manager forward: find level-2 approver and hand off
    """
    doc = frappe.get_doc("Leave Application", docname)

    if doc.leave_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this leave application."))
    if doc.docstatus != 0:
        frappe.throw(_("This leave application has already been submitted or cancelled."))

    if designation == "hr":
        if not _apply_leave_workflow(doc, "Approved"):
            doc.status = "Approved"
            doc.save(ignore_permissions=True)
        frappe.db.commit()
        return _("Leave application approved.")

    # Line-manager forward — find the next approver in the chain of the employee on leave
    employee = doc.employee
    next_approver = None

    if employee and _multi_level_enabled(employee):
        next_approver = _next_chain_approver(employee, doc.leave_approver)

    if not next_approver:
        # Fallback: hand to any HR Manager
        hr_users = frappe.get_all(
            "Has Role",
            filters={"role": "HR Manager", "parenttype": "User"},
            pluck="parent",
            limit=1,
        )
        next_approver = hr_users[0] if hr_users else None

    if not next_approver:
        frappe.throw(_("No level-2 approver or HR Manager found. Please set an approval chain on the Employee record."))

    _set_approver(doc, next_approver)
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    approver_name = frappe.db.get_value("User", next_approver, "full_name") or next_approver
    return _("Forwarded to {0}.").format(approver_name)


@frappe.whitelist()
def reject_leave(docname: str, reason: str = "") -> str:
    """
    Reject a Leave Application and record the rejection reason.
    """
    doc = frappe.get_doc("Leave Application", docname)

    if doc.leave_approver != frappe.session.user:
        frappe.throw(_("You are not the designated approver for this leave application."))
    if doc.docstatus != 0:
        frappe.throw(_("This leave application has already been submitted or cancelled."))

    description = doc.get("description") or ""
    if reason:
        rejection_note = _("Rejected by {0}: {1}").format(frappe.session.user, reason)
        doc.description = f"{description}\n\n{rejection_note}".strip() if description else rejection_note

    # the workflow reloads the document, so the note is saved (still Open) first
    doc.save(ignore_permissions=True)
    if not _apply_leave_workflow(doc, "Rejected"):
        doc.status = "Rejected"
        doc.save(ignore_permissions=True)
    frappe.db.commit()

    # Notify the applicant
    try:
        applicant_email = frappe.db.get_value("User", doc.owner, "email")
        if applicant_email:
            frappe.sendmail(
                recipients=[applicant_email],
                subject=f"Leave Application Rejected — {doc.leave_type}",
                message=f"""
<p>Your leave application <strong>{docname}</strong> ({doc.leave_type}, {doc.from_date} – {doc.to_date}) has been <strong>rejected</strong>.</p>
{"<p><strong>Reason:</strong> " + frappe.utils.escape_html(reason) + "</p>" if reason else ""}
<p><a href="{frappe.utils.get_url()}/app/leave-application/{docname}">View Application</a></p>
""",
                reference_doctype="Leave Application",
                reference_name=docname,
            )
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"PM Ladder Approve: rejection email failed for {docname}")

    return _("Leave application rejected.")


# ─── My Approvals ─────────────────────────────────────────────────────────────
# My Approvals lists PM Workflow Actions, and a ladder-approved leave has none: it travels on
# `leave_approver`, not through a PM Workflow. So the person the chain had picked was never told
# anything on that page. These feed it. They stand aside the moment a PM Workflow is switched on
# for Leave Application, because that workflow's own actions are listed there and the same leave
# must not appear twice.

def _pm_workflow_active() -> bool:
    return bool(frappe.db.exists("PM Workflow", {"document_type": "Leave Application", "is_active": 1}))


def _is_final_approver(user: str = None) -> bool:
    return bool(set(frappe.get_roles(user or frappe.session.user)) & _FINAL_ROLES)


def leaves_waiting_on(user: str) -> list:
    """Open leave applications whose current approver is `user`, oldest first."""
    if not user or _pm_workflow_active():
        return []

    rows = frappe.get_all(
        "Leave Application",
        filters={"leave_approver": user, "docstatus": 0, "status": "Open"},
        fields=["name", "employee", "employee_name", "leave_type", "from_date", "to_date",
                "total_leave_days", "owner", "creation"],
        order_by="creation asc",
    )
    final = _is_final_approver(user)
    for row in rows:
        row["level"] = _chain_level_of(row.employee, user)
        row["final"] = final
    return rows


def apply_inbox_action(docname: str, action: str, comment: str = ""):
    """
    Carry out the step an approver picked on My Approvals. Returns the message to show, or None
    when `action` is not one of the ladder's (so the caller falls through to the PM Workflow).
    """
    if _pm_workflow_active():
        return None

    if action in APPROVE_ACTIONS:
        return forward_leave(docname, "hr" if _is_final_approver() else None)

    if action == REJECT_ACTION:
        reason = (comment or "").strip()
        if not reason:
            # the form insists on one (leave_application.js); this screen must not be a way round it
            frappe.throw(_("Give a reason for rejecting this leave application."))
        return reject_leave(docname, reason)

    return None


def lifecycle(docname: str) -> dict:
    """
    The chain a leave travels, in the shape My Approvals draws for a PM Workflow
    ({"chain": [...], "roles": [], "events": [], ...}): each level of the employee's chain, then
    the final approval by HR.
    """
    doc = frappe.get_doc("Leave Application", docname)
    chain = _chain_for(doc.employee) if _multi_level_enabled(doc.employee) else {}
    levels = sorted(chain)
    top = levels[-1] if levels else 0
    decided = cint(doc.docstatus) == 1 or doc.status in ("Approved", "Rejected")

    # where the leave stands, as a position on the chain: a level it is waiting at, past the top
    # (with HR), or before the start (held by someone the chain does not name)
    if decided:
        pos = float("inf")
    elif _chain_level_of(doc.employee, doc.leave_approver) is not None:
        pos = _chain_level_of(doc.employee, doc.leave_approver)
    elif _is_final_approver(doc.leave_approver):
        pos = top + 1
    else:
        pos = 0

    def name_of(user):
        return frappe.db.get_value("User", user, "full_name") or user

    phases = []
    for level in levels:
        status = "done" if level < pos else "current" if level == pos else "upcoming"
        who = name_of(chain[level])
        phases.append({
            "state": _("Level {0}").format(level), "status": status, "final": False,
            "by": who if status == "done" else "",
            "roles": [] if status == "done" else [who],
        })

    status = "done" if decided else "current" if pos > top else "upcoming"
    holder = [name_of(doc.leave_approver)] if status == "current" and doc.leave_approver else [_("HR")]
    phases.append({
        "state": _("Final approval"), "status": status, "final": True,
        "by": "", "roles": [] if status == "done" else holder,
    })
    return {"chain": phases, "roles": [], "events": [], "current": doc.status,
            "finished": bool(decided)}
