"""
Permission Manager — PM Workflow Engine
Author: siva <siva@enfono.com>

Enhanced Frappe workflow system with:
  - Company / dimension-level workflow scoping
  - Employee Approver Matrix: per-submitter, per-level, per-scope routing
  - Active Delegation: OOO / leave cover for approvers
  - Admin Reassignment: manually redirect a pending approval
  - Bulk approval, comment support, email alerts
"""

import json
from collections import defaultdict
from typing import Union

import frappe
from frappe import _
from frappe.model.docstatus import DocStatus
from frappe.model.document import Document
from frappe.utils import cint, today


# ─── Doctype allow-list cache ─────────────────────────────────────────────────
# Keeps a Redis-cached set of doctypes that have at least one active PM Workflow.
# process_workflow_actions checks this first — if the doctype isn't in the set
# the function returns immediately with zero additional DB queries.

_CACHE_KEY = "pm_workflow_active_doctypes"
_CACHE_TTL = 600  # 10 minutes; hard-invalidated on PM Workflow save/trash


def _get_active_workflow_doctypes() -> set:
    if not frappe.db.table_exists("PM Workflow"):
        return set()
    cached = frappe.cache().get_value(_CACHE_KEY)
    if cached is not None:
        return set(cached)
    doctypes = frappe.get_all("PM Workflow", filters={"is_active": 1}, pluck="document_type")
    frappe.cache().set_value(_CACHE_KEY, list(set(doctypes)), expires_in_sec=_CACHE_TTL)
    return set(doctypes)


def clear_workflow_doctype_cache():
    frappe.cache().delete_value(_CACHE_KEY)


# ─── State / field helpers ────────────────────────────────────────────────────

def get_doc_workflow_state(doc):
    workflow_name = get_workflow_name(doc.get("doctype"), doc.get("name"))
    workflow_state_field = get_workflow_state_field(workflow_name)
    return doc.get(workflow_state_field)


def get_workflow_state_field(workflow_name):
    return get_workflow_field_value(workflow_name, "workflow_state_field")


def send_email_alert(workflow_name):
    return get_workflow_field_value(workflow_name, "send_email_alert")


def get_workflow_field_value(workflow_name, field):
    return frappe.get_cached_value("PM Workflow", workflow_name, field)


# ─── Company hierarchy ────────────────────────────────────────────────────────

def get_closest_company_with_workflow(company: str, workflows: list[dict]) -> str | None:
    if any(wf.company == company for wf in workflows):
        return company
    current = company
    while True:
        parent = frappe.db.get_value("Company", current, "parent_company")
        if not parent:
            break
        if any(wf.company == parent and wf.allow_descendants for wf in workflows):
            return parent
        current = parent
    return None


# ─── Workflow resolution ──────────────────────────────────────────────────────

@frappe.whitelist()
def get_workflow_name(doctype: str, docname: str | int = None) -> str | None:
    """Resolve the most specific active PM Workflow for a document.

    Resolution order (most specific wins):
      1. Company-specific workflows, ranked by dimension specificity
      2. Global (no-company) workflows, ranked by dimension specificity
    """
    if not frappe.db.table_exists("PM Workflow"):
        return None

    doc = frappe.get_doc(doctype, docname) if docname else None
    company = getattr(doc, "company", None) or frappe.defaults.get_user_default("Company")
    project = getattr(doc, "project", None)
    cost_center = getattr(doc, "cost_center", None)
    user = getattr(doc, "owner", None) or frappe.session.user

    workflows = frappe.get_all(
        "PM Workflow",
        filters={"document_type": doctype, "is_active": 1},
        fields=["name", "company", "project", "cost_center", "allow_descendants", "user"],
    )
    if not workflows:
        return None

    accounting_dimensions = frappe.get_all(
        "Accounting Dimension", filters={"disabled": 0}, pluck="fieldname"
    )

    def _pick(candidates):
        for check in [
            lambda wf: wf.user and wf.user == user,
            lambda wf: any(
                getattr(wf, d, None) and getattr(doc, d, None) == getattr(wf, d, None)
                for d in accounting_dimensions
            ) if accounting_dimensions and doc else False,
            lambda wf: wf.cost_center and wf.cost_center == cost_center,
            lambda wf: wf.project and wf.project == project,
            lambda wf: True,
        ]:
            for wf in candidates:
                if check(wf):
                    return wf.name
        return None

    # 1. Company-specific match (respects parent-company inheritance)
    if company:
        closest_company = get_closest_company_with_workflow(company, workflows)
        if closest_company:
            company_workflows = [wf for wf in workflows if wf.company == closest_company]
            result = _pick(company_workflows)
            if result:
                return result

    # 2. Global fallback — workflows with no company set
    global_workflows = [wf for wf in workflows if not wf.company]
    return _pick(global_workflows)


@frappe.whitelist()
def get_workflow(doctype: str, docname: str | int = None):
    workflow_name = get_workflow_name(doctype, docname)
    if not workflow_name:
        frappe.throw(
            _(f"No active PM Workflow found for {doctype}."),
            title=_("Workflow Missing"),
        )
    return frappe.get_cached_doc("PM Workflow", workflow_name)


# ═══════════════════════════════════════════════════════════════════════════════
# EMPLOYEE APPROVER MATRIX — Resolution Engine
# ═══════════════════════════════════════════════════════════════════════════════

def get_original_submitter(doc) -> str:
    """
    Return the user whose Employee Approval Chain should be used for matrix resolution.

    Priority:
      1. for_submitter on the most recent PM Workflow Action for this document
         (carries the original submitter across multi-level approvals even after
          the doc.owner gets overwritten by frappe.session.user during bench-execute setup)
      2. doc.owner as fallback
    """
    if not frappe.db.table_exists("PM Workflow Action"):
        return doc.get("owner") or ""
    submitter = frappe.db.get_value(
        "PM Workflow Action",
        {
            "reference_doctype": doc.get("doctype"),
            "reference_name": doc.get("name"),
        },
        "for_submitter",
        order_by="creation desc",
    )
    return submitter or doc.get("owner") or ""


def resolve_approver(submitter_user: str, level: int, doctype: str = None, workflow_name: str = None) -> str | None:
    """
    Resolve the effective approver for a submitter at a given level.

    Lookup priority (most specific wins):
      1. DocType-specific chain entry  (applies_to = 'Specific DocType', document_type_name = doctype)
      2. Module-specific chain entry   (applies_to = 'Specific Module', module matches doctype's module)
      3. Global chain entry            (applies_to = 'All DocTypes')
      4. None → caller uses role-based fallback

    After finding the mapped approver, checks for an active Delegation
    (PM Approver Delegation) and returns the substitute if one exists.
    """
    if not frappe.db.table_exists("PM Employee Approval Chain"):
        return None

    # Find the Employee record for the submitter
    employee = frappe.db.get_value("Employee", {"user_id": submitter_user, "status": "Active"}, "name")
    if not employee:
        return None

    # Get the approval chain child table
    chain = frappe.get_all(
        "PM Employee Approval Chain",
        filters={"parent": employee, "parenttype": "Employee", "level": level},
        fields=["approver", "applies_to", "module", "document_type_name"],
        order_by="idx asc",
    )

    if not chain:
        return None

    # Determine the doctype's module for module-scope matching
    dt_module = None
    if doctype:
        dt_module = frappe.db.get_value("DocType", doctype, "module")

    # Score each chain row by specificity: 3=DocType, 2=Module, 1=All
    best_approver = None
    best_score = 0

    for row in chain:
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
        else:  # "All DocTypes"
            score = 1

        if score > best_score:
            best_score = score
            best_approver = row.approver

    if not best_approver:
        return None

    # Check for active delegation
    return _apply_delegation(best_approver, doctype)


def _apply_delegation(approver: str, doctype: str = None) -> str:
    """
    Return the effective approver, substituting a delegate if one is active today.
    Checks scope: All DocTypes → Module → Specific DocType.
    """
    if not frappe.db.table_exists("PM Approver Delegation"):
        return approver

    today_str = today()
    candidates = frappe.get_all(
        "PM Approver Delegation",
        filters={
            "original_approver": approver,
            "is_active": 1,
            "from_date": ["<=", today_str],
            "to_date": [">=", today_str],
        },
        fields=["substitute_approver", "scope", "module", "document_type_name"],
        order_by="creation desc",
    )

    if not candidates:
        return approver

    dt_module = frappe.db.get_value("DocType", doctype, "module") if doctype else None

    # Pick most specific delegation
    for scope_level in ["Specific DocType", "Specific Module", "All DocTypes"]:
        for d in candidates:
            if d.scope != scope_level:
                continue
            if scope_level == "Specific DocType" and d.document_type_name == doctype:
                return d.substitute_approver
            elif scope_level == "Specific Module" and dt_module and d.module == dt_module:
                return d.substitute_approver
            elif scope_level == "All DocTypes":
                return d.substitute_approver

    return approver


# ─── Transition resolution ────────────────────────────────────────────────────

@frappe.whitelist()
def get_transitions(
    doc: Union[Document, str, dict],
    workflow: str = None,
    current_state: str = None,
    raise_exception: bool = False,
) -> list[dict]:
    """Return the transitions available to the current user for this document."""
    if not isinstance(doc, Document):
        doc = frappe.get_doc(frappe.parse_json(doc))
        if not doc.get("name"):
            return []
        doc.load_from_db()

    if doc.is_new():
        return []

    doc.check_permission("read")

    workflow_doc = (
        frappe.get_doc("PM Workflow", workflow)
        if workflow
        else get_workflow(doc.doctype, doc.name)
    )
    current_state = current_state or doc.get(workflow_doc.workflow_state_field)
    if not current_state:
        current_state = workflow_doc.transitions[0].state

    state = next((s for s in workflow_doc.states if s.state == current_state), None)
    if state and cint(state.doc_status) != cint(doc.get("docstatus")):
        frappe.throw(
            _("Workflow state '{0}' is incompatible with document status ({1}).").format(
                state.state, doc.get("docstatus")
            ),
            title=_("Invalid Workflow State"),
        )
        return []

    if not current_state:
        if raise_exception:
            frappe.throw(_("Workflow State not set"))
        return []

    # Pass full doc so matrix lookups can use doctype + owner
    transitions = get_allowed_transitions_for_user(
        workflow_doc.name, current_state, frappe.session.user, doc
    )
    # Administrator is unrestricted: don't gate on transition conditions
    # (e.g. the warehouse-User-Permission checks on Stock Entry accept/reject),
    # so admin can see and act on every pending document.
    if frappe.session.user == "Administrator":
        return transitions
    return [t for t in transitions if is_transition_condition_satisfied(t, doc)]


def get_allowed_transitions_for_user(
    workflow: str,
    current_state: str,
    user: str = None,
    doc=None,
) -> list[dict]:
    """
    Return transitions the given user may perform from current_state.

    When a transition has use_approver_matrix=1:
      - Resolve the approver from the submitter's Employee Approval Chain
      - Only allow if current user IS that resolved approver
    Otherwise use standard role / user check.
    """
    user = user or frappe.session.user
    transitions = frappe.get_all(
        "PM Workflow Transition",
        filters={"parent": workflow, "state": current_state},
        fields=["*"],
        order_by="idx asc",
    )
    user_roles = frappe.get_roles(user)

    # Administrator is unrestricted — may perform any transition from the state.
    if user == "Administrator":
        return transitions

    # Ad-hoc (forwarded) approver: authority comes from the direct assignment,
    # not from a role. If this user holds an Open ad-hoc action for this doc at
    # the current state, let them perform any transition from the state
    # (role/matrix bypassed); doc-based conditions are still enforced by the
    # caller via is_transition_condition_satisfied.
    if doc is not None and doc.get("name"):
        adhoc = frappe.db.get_value(
            "PM Workflow Action",
            {
                "reference_doctype": doc.get("doctype"),
                "reference_name": doc.get("name"),
                "workflow_state": current_state,
                "assigned_to": user,
                "is_adhoc": 1,
                "status": "Open",
            },
            ["name", "return_to_originator"],
            as_dict=True,
        )
        if adhoc:
            # Forwarded with "Return to me after their input": this user may give input but
            # may not move the document — apply_workflow sends it back to the forwarder
            # instead. Offering transitions here would only render buttons the engine
            # refuses to honour. Enforcement lives in apply_workflow, not here.
            if cint(adhoc.return_to_originator):
                return []
            return transitions

    allowed = []

    doc_owner = get_original_submitter(doc) if doc else None
    doc_type = doc.get("doctype") if doc else None

    for t in transitions:
        if t.get("use_approver_matrix"):
            if not doc_owner:
                continue

            resolved = resolve_approver(
                submitter_user=doc_owner,
                level=t.get("matrix_level") or 1,
                doctype=doc_type,
                workflow_name=workflow,
            )

            if resolved:
                # Only the resolved approver (or their active delegate) can act
                if resolved == user:
                    allowed.append(t)
            else:
                # No matrix entry → fall back to the configured role
                fallback = t.get("matrix_fallback_role")
                if fallback and fallback in user_roles:
                    allowed.append(t)

        elif t.approver_type == "Role" and t.allowed in user_roles:
            allowed.append(t)
        elif t.approver_type == "User" and t.allowed == user:
            allowed.append(t)

    return allowed


def get_all_transitions_from_state(workflow_name: str, current_state: str, doc=None) -> list[dict]:
    """
    Return ALL transitions from the current state regardless of user.
    Used by process_workflow_actions to determine who should receive action items.
    """
    transitions = frappe.get_all(
        "PM Workflow Transition",
        filters={"parent": workflow_name, "state": current_state},
        fields=["*"],
        order_by="idx asc",
    )
    return [t for t in transitions if _is_condition_satisfied_for_routing(t, doc)]


def _is_condition_satisfied_for_routing(transition, doc) -> bool:
    """
    Evaluate a transition condition for action-creation routing purposes.

    Session-dependent conditions (those referencing frappe.session) are skipped
    here — at action-creation time the session user is the submitter, not the
    approver, so evaluating them would incorrectly drop valid transitions and
    prevent actions from appearing in the approval inbox.

    These conditions are still fully enforced at execution time via
    get_transitions → is_transition_condition_satisfied, where session.user IS
    the approver attempting the action.
    """
    if not transition.condition:
        return True
    if "frappe.session" in transition.condition:
        return True
    try:
        return bool(frappe.safe_eval(
            transition.condition, get_workflow_safe_globals(), dict(doc=doc.as_dict())
        ))
    except Exception:
        return True


def has_approval_access(user, doc, transition) -> bool:
    return (
        user == "Administrator"
        or transition.get("allow_self_approval")
        or user != doc.get("owner")
    )


def get_open_return_adhoc_action(doc, current_state: str, user: str):
    """The Open ad-hoc action this user holds that was forwarded "return to me", if any.

    Such an approver is a reviewer, not a decision maker: whatever they choose, the document
    goes back to the person who forwarded it for the final call.
    """
    if doc is None or not doc.get("name") or not current_state:
        return None

    return frappe.db.get_value(
        "PM Workflow Action",
        {
            "reference_doctype": doc.get("doctype"),
            "reference_name": doc.get("name"),
            "workflow_state": current_state,
            "assigned_to": user,
            "is_adhoc": 1,
            "status": "Open",
            "return_to_originator": 1,
        },
        "name",
    )


# ─── Workflow application ─────────────────────────────────────────────────────

@frappe.whitelist()
def apply_workflow(doc, action: str, comment: str = None, priority: str = None):
    doc = frappe.get_doc(frappe.parse_json(doc))
    doc.load_from_db()
    if priority:
        frappe.local._pm_action_priority = priority

    workflow = get_workflow(doc.doctype, doc.name)
    user = frappe.session.user

    # ── "Return to me after their input" ───────────────────────────────────────────────
    # The forwarder ticked that box, so this reviewer's response must come back to them
    # instead of moving the document on. This is checked before get_transitions() because
    # that function deliberately returns no transitions for such a user, and it is checked
    # here — the single choke point every entry route funnels through (inbox, document form,
    # emailed link, bulk action, warehouse dashboard) — so no route can bypass it, not even
    # Administrator, whose role checks are otherwise short-circuited.
    current_state = doc.get(workflow.workflow_state_field)
    adhoc_return = get_open_return_adhoc_action(doc, current_state, user)
    if adhoc_return:
        # the label still has to be a real transition of this state, just not one this
        # reviewer is allowed to complete
        if not frappe.db.exists(
            "PM Workflow Transition",
            {"parent": workflow.name, "state": current_state, "action": action},
        ):
            frappe.throw(_("Invalid Workflow Action: %s") % action)

        from permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action import (
            return_adhoc_to_originator,
        )

        return_adhoc_to_originator(adhoc_return, comment, responded_action=action)
        frappe.msgprint(
            _("Your input on %s went back to the approver who forwarded it — the workflow did "
              "not advance.") % frappe.bold(action),
            alert=True,
            indicator="blue",
        )
        return doc

    transitions = get_transitions(doc, workflow.name)

    transition = next((t for t in transitions if t.action == action), None)
    if not transition:
        frappe.throw(_("Invalid Workflow Action: {0}").format(action))

    if not has_approval_access(user, doc, transition):
        frappe.throw(_("Self-approval is not allowed for this action."))

    is_return = bool(transition.get("is_return_for_correction"))

    # Return for Correction always requires a comment
    if is_return and not comment:
        frappe.throw(_("A comment is required when returning a document for correction."))

    # Attachment check — configured per transition in the PM Workflow form
    if transition.get("require_attachment"):
        has_file = frappe.db.exists("File", {
            "attached_to_doctype": doc.doctype,
            "attached_to_name": doc.name,
        })
        if not has_file:
            frappe.throw(
                _("An attachment is mandatory before performing '{0}'. Please attach a supporting document and try again.").format(action),
                title=_("Attachment Required"),
            )

    doc.set(workflow.workflow_state_field, transition.next_state)

    next_state = next((s for s in workflow.states if s.state == transition.next_state), None)
    if not next_state:
        frappe.throw(_("Next workflow state not defined: {0}").format(transition.next_state))

    if next_state.update_field:
        doc.set(next_state.update_field, next_state.update_value)

    new_docstatus = DocStatus(next_state.doc_status or 0)

    # Return for Correction: if document is submitted, revert to draft so submitter can edit
    if is_return and doc.docstatus.is_submitted():
        new_docstatus = DocStatus(0)

    _update_docstatus(doc, new_docstatus)

    if is_return:
        comment_html = (
            "<div style='padding:8px;background:#fff3e0;border-left:4px solid #ff9800;border-radius:4px;'>"
            "<strong style='color:#e65100;'>↩ Returned for Correction</strong> "
            f"<span style='color:#555;'>by {frappe.get_cached_value('User', user, 'full_name') or user}</span></div>"
        )
        if comment:
            comment_html += (
                "<div style='margin-top:8px;padding:8px;background:#fff8e1;"
                "border-left:4px solid #ffc107;border-radius:4px;'>"
                f"<strong style='color:#f57f17;'>✏ Reason:</strong> <em style='color:#555;'>{comment}</em></div>"
            )
        # Notify the original submitter
        submitter = get_original_submitter(doc) or doc.owner
        if submitter and submitter != user:
            _notify_return_for_correction(doc, submitter, user, comment)
    else:
        color_map = {
            0: {"bg": "#fff3cd", "border": "#ffc107", "text": "#856404", "icon": "⊙"},
            1: {"bg": "#e8f5e9", "border": "#4caf50", "text": "#2e7d32", "icon": "✓"},
            2: {"bg": "#ffebee", "border": "#f44336", "text": "#c62828", "icon": "✕"},
        }
        style = color_map.get(int(next_state.doc_status or 0), color_map[0])
        comment_html = (
            f"<div style='padding:8px;background:{style['bg']};border-left:4px solid {style['border']};border-radius:4px;'>"
            f"<strong style='color:{style['text']}'>{style['icon']} Moved to</strong> "
            f"<span style='color:#1565c0;font-weight:bold;'>{next_state.state}</span></div>"
        )
        if comment:
            comment_html += (
                "<div style='margin-top:8px;padding:8px;background:#e3f2fd;"
                "border-left:4px solid #2196f3;border-radius:4px;'>"
                f"<strong style='color:#1565c0;'>💬 Note:</strong> <em style='color:#666;'>{comment}</em></div>"
            )

    doc.add_comment("Workflow", comment_html)
    return doc


def _notify_return_for_correction(doc, submitter: str, returned_by: str, reason: str):
    """Send a Notification Log + email to the submitter when a document is returned."""
    try:
        frappe.get_doc({
            "doctype": "Notification Log",
            "subject": _("Document returned for correction: {0} {1}").format(doc.doctype, doc.name),
            "for_user": submitter,
            "document_type": doc.doctype,
            "document_name": doc.name,
            "type": "Alert",
            "from_user": returned_by,
            "email_content": _(
                "{0} has returned {1} {2} for correction.<br><br>"
                "<strong>Reason:</strong> {3}"
            ).format(
                frappe.get_cached_value("User", returned_by, "full_name") or returned_by,
                doc.doctype,
                doc.name,
                reason or _("No reason provided"),
            ),
        }).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error("PM Workflow: failed to send return-for-correction notification")


def _update_docstatus(doc, new_docstatus: DocStatus) -> None:
    if doc.docstatus.is_draft() and new_docstatus.is_draft():
        doc.save()
    elif doc.docstatus.is_draft() and new_docstatus.is_submitted():
        doc.submit()
    elif doc.docstatus.is_submitted() and new_docstatus.is_submitted():
        doc.save()
    elif doc.docstatus.is_submitted() and new_docstatus.is_cancelled():
        doc.cancel()
    else:
        frappe.throw(_("Illegal Document Status transition"))


# ─── Admin Reassignment ───────────────────────────────────────────────────────

@frappe.whitelist()
def reassign_workflow_approver(
    doctype: str, docname: str, new_approver: str, reason: str = ""
) -> dict:
    """
    Admin reassigns the pending PM Workflow Action for a document to a new approver.
    Creates an audit comment and notifies the new approver.

    Only System Managers and HR Managers may reassign.
    """
    if not frappe.db.exists("User", new_approver):
        frappe.throw(_("User '{0}' does not exist.").format(new_approver))

    allowed_roles = {"System Manager", "HR Manager"}
    if not allowed_roles.intersection(set(frappe.get_roles())):
        frappe.throw(_("Only System Managers or HR Managers can reassign approvers."))

    # Find the open workflow action for this document
    action_name = frappe.db.get_value(
        "PM Workflow Action",
        {"reference_doctype": doctype, "reference_name": docname, "status": "Open"},
        "name",
    )
    if not action_name:
        frappe.throw(_("No open workflow action found for {0} {1}.").format(doctype, docname))

    old_approver = frappe.db.get_value("PM Workflow Action", action_name, "assigned_to") or _("(role-based)")

    # Update the action — replace permitted_roles so the permission query
    # only exposes the new approver (not the previous role holders).
    action_doc = frappe.get_doc("PM Workflow Action", action_name)
    action_doc.assigned_to = new_approver
    action_doc.status = "Open"
    action_doc.set("permitted_roles", [
        {"approver_type": "User", "approver": new_approver}
    ])
    action_doc.save(ignore_permissions=True)

    # Add an audit comment on the document
    doc = frappe.get_doc(doctype, docname)
    doc.add_comment(
        "Workflow",
        (
            f"<div style='padding:8px;background:#e3f2fd;border-left:4px solid #2196f3;border-radius:4px;'>"
            f"<strong>🔄 Approver Reassigned</strong><br>"
            f"From: <em>{old_approver}</em> → To: <em>{new_approver}</em><br>"
            f"By: {frappe.session.user}"
            + (f"<br>Reason: {reason}" if reason else "")
            + "</div>"
        ),
    )

    # Email notification to new approver
    try:
        frappe.sendmail(
            recipients=[new_approver],
            subject=f"Approval Reassigned to You — {doctype}: {docname}",
            message=(
                f"<p>Dear {new_approver},</p>"
                f"<p>An approval for <strong>{doctype}: {docname}</strong> has been reassigned to you by {frappe.session.user}.</p>"
                + (f"<p>Reason: {reason}</p>" if reason else "")
                + f"<p><a href='{frappe.utils.get_url()}/app/{frappe.utils.slug(doctype)}/{docname}'>Open Document</a></p>"
            ),
        )
    except Exception:
        # Email is best-effort; log but don't block the reassignment
        frappe.log_error(
            title=f"PM Workflow: reassignment email failed for {doctype} {docname}",
            message=frappe.get_traceback(),
        )

    frappe.db.commit()
    return {
        "success": True,
        "action": action_name,
        "old_approver": old_approver,
        "new_approver": new_approver,
    }


@frappe.whitelist()
def get_pending_workflow_action(doctype: str, docname: str) -> dict | None:
    """
    Return the pending PM Workflow Action for a document, including the
    resolved approver name (useful for showing in the form UI).
    """
    action = frappe.db.get_value(
        "PM Workflow Action",
        {"reference_doctype": doctype, "reference_name": docname, "status": "Open"},
        ["name", "assigned_to", "for_submitter", "workflow_state"],
        as_dict=True,
    )
    if not action:
        return None

    if action.assigned_to:
        action["assigned_to_name"] = frappe.db.get_value("User", action.assigned_to, "full_name")

    # Always return the role(s) from permitted_roles so the form banner can show
    # "Pending with: Stock Manager" even when no specific user is assigned.
    action["pending_roles"] = frappe.get_all(
        "PM Workflow Action Permitted Role",
        filters={"parent": action.name, "approver_type": "Role"},
        pluck="approver",
    )

    return action


# ─── Bulk approval ────────────────────────────────────────────────────────────

@frappe.whitelist()
def bulk_workflow_approval(docnames, doctype: str, action: str):
    docnames = json.loads(docnames)
    if len(docnames) < 20:
        _bulk_workflow_action(docnames, doctype, action)
    elif len(docnames) <= 500:
        frappe.msgprint(_(f"Bulk {action} enqueued for background processing."), alert=True)
        frappe.enqueue(
            _bulk_workflow_action,
            docnames=docnames,
            doctype=doctype,
            action=action,
            queue="short",
            timeout=1000,
        )
    else:
        frappe.throw(_("Bulk approval is limited to 500 documents at a time."))


def _bulk_workflow_action(docnames, doctype, action):
    failed, success = defaultdict(list), defaultdict(list)
    frappe.clear_messages()
    for idx, name in enumerate(docnames, 1):
        try:
            _show_progress(docnames, _(f"Applying: {action}"), idx, name)
            apply_workflow(frappe.get_doc(doctype, name), action)
            frappe.db.commit()
            success[name].append({"message": "Success"})
        except Exception as exc:
            frappe.db.rollback()
            failed[name].append({"message": str(exc)})
            frappe.log_error(title=f"PM Workflow {action} failed for {doctype} {name}")
    _print_workflow_results(success, failed, doctype)


def _show_progress(docnames, message, i, description):
    n = len(docnames)
    if n >= 5:
        frappe.publish_progress(float(i) * 100 / n, title=message, description=description)


def _print_workflow_results(success, failed, doctype):
    if success:
        _print_workflow_log(success, _("Successful Transactions"), doctype, "green")
    if failed:
        _print_workflow_log(failed, _("Failed Transactions"), doctype, "red")


def _print_workflow_log(records, title, doctype, indicator):
    if not records:
        return
    msg = f"<h4>{title}</h4>"
    for doc, logs in records.items():
        html = f"<details><summary>{frappe.utils.get_link_to_form(doctype, doc)}</summary>"
        for log in logs:
            html += f"<div class='small text-muted' style='padding:2.5px'>{log.get('message')}</div>"
        html += "</details>"
        msg += html
    frappe.msgprint(msg, title=_("Workflow Status"), indicator=indicator, is_minimizable=True, realtime=True)


# ─── Workflow info (for JS) ───────────────────────────────────────────────────

@frappe.whitelist()
def get_workflow_info(doc: dict | str):
    if isinstance(doc, str):
        doc = json.loads(doc)

    workflow_name = get_workflow_name(doc.get("doctype"), doc.get("name"))
    if not workflow_name:
        return None

    workflow = frappe.get_cached_doc("PM Workflow", workflow_name)
    user = frappe.session.user
    user_roles = frappe.get_roles(user)

    workflow_state = get_doc_workflow_state(doc)
    if not workflow_state:
        workflow_state = workflow.transitions[0].state

    state = next((s for s in workflow.states if s.state == workflow_state), None)
    if state and cint(state.doc_status) != cint(doc.get("docstatus")):
        return None

    allow_edit = False
    if state:
        if state.edit_permission_type == "User" and state.allow_edit == user:
            allow_edit = True
        elif state.edit_permission_type == "Role" and (state.allow_edit or "").strip() in user_roles:
            allow_edit = True

    result = {"workflow": workflow.as_dict(), "current_state": workflow_state}
    if allow_edit:
        result["allow_edit"] = allow_edit
    return result


@frappe.whitelist()
def get_common_transition_actions(docs, doctype: str):
    if isinstance(docs, str):
        docs = json.loads(docs)
    user = frappe.session.user
    common_actions = None
    for doc in docs:
        if not doc.get("doctype"):
            doc["doctype"] = doctype
        transitions = get_transitions(doc)
        actions = {t.get("action") for t in transitions if has_approval_access(user, doc, t)}
        common_actions = actions if common_actions is None else common_actions & actions
        if not common_actions:
            break
    return list(common_actions or [])


# ─── Condition evaluation ─────────────────────────────────────────────────────

def get_workflow_safe_globals():
    return dict(
        frappe=frappe._dict(
            db=frappe._dict(get_value=frappe.db.get_value, get_list=frappe.db.get_list),
            session=frappe.session,
            utils=frappe._dict(
                now_datetime=frappe.utils.now_datetime,
                add_to_date=frappe.utils.add_to_date,
                get_datetime=frappe.utils.get_datetime,
                now=frappe.utils.now,
            ),
        )
    )


def is_transition_condition_satisfied(transition, doc) -> bool:
    if not transition.condition:
        return True
    return frappe.safe_eval(
        transition.condition, get_workflow_safe_globals(), dict(doc=doc.as_dict())
    )


# ─── Validation ───────────────────────────────────────────────────────────────

def validate_workflow(doc):
    workflow = get_workflow(doc.doctype, doc.name)
    current_state = None
    if getattr(doc, "_doc_before_save", None):
        current_state = doc._doc_before_save.get(workflow.workflow_state_field)
    next_state = doc.get(workflow.workflow_state_field)

    if not next_state:
        next_state = workflow.states[0].state
        doc.set(workflow.workflow_state_field, next_state)
    if not current_state:
        current_state = workflow.states[0].state

    state_row = [s for s in workflow.states if s.state == current_state]
    if not state_row:
        frappe.throw(_("{0} is not a valid Workflow State.").format(frappe.bold(current_state)))

    if current_state != next_state:
        bold_current = frappe.bold(current_state)
        bold_next = frappe.bold(next_state)
        if not doc._doc_before_save:
            frappe.throw(_("Workflow State transition not allowed from {0} to {1}").format(bold_current, bold_next))
        transitions = get_transitions(doc._doc_before_save)
        if not [t for t in transitions if t.next_state == next_state]:
            frappe.throw(_("Workflow State transition not allowed from {0} to {1}").format(bold_current, bold_next))


@frappe.whitelist()
def can_cancel_document(doctype: str, docname: str = None) -> bool:
    workflow = get_workflow(doctype, docname)
    cancel_states = {s.state for s in workflow.states if s.doc_status == "2"}
    if not cancel_states:
        return True
    return not any(t.next_state in cancel_states for t in workflow.transitions)


def set_workflow_state_on_action(doc, workflow_name: str, action: str):
    workflow = frappe.get_doc("PM Workflow", workflow_name)
    field = workflow.workflow_state_field
    for state in workflow.states:
        if state.state == doc.get(field) and doc.docstatus == cint(state.doc_status):
            return
    action_map = {"update_after_submit": "1", "submit": "1", "cancel": "2"}
    docstatus = action_map.get(action)
    for state in workflow.states:
        if state.doc_status == docstatus:
            doc.set(field, state.state)
            return


@frappe.whitelist()
def get_diagram_data(workflow_name: str) -> dict:
    """Return states + transitions for SVG diagram rendering."""
    wf = frappe.get_doc("PM Workflow", workflow_name)
    states = [
        {
            "name": s.state,
            "doc_status": s.doc_status,
            "is_optional_state": getattr(s, "is_optional_state", 0),
        }
        for s in (wf.states or [])
    ]
    transitions = [
        {
            "from_state": t.state,
            "to_state": t.next_state,
            "action": t.action,
            "is_return": cint(getattr(t, "is_return_for_correction", 0)),
            "allowed": t.allowed,
        }
        for t in (wf.transitions or [])
    ]
    return {"states": states, "transitions": transitions, "workflow_name": workflow_name}
