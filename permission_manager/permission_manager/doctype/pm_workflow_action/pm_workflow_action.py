# Copyright (c) 2026, siva <siva@enfono.com>
# License: MIT

import frappe
from frappe import _
from frappe.desk.form.utils import get_pdf_link
from frappe.desk.notifications import clear_doctype_notifications
from frappe.email.doctype.email_template.email_template import get_email_template
from frappe.model.document import Document
from frappe.query_builder import DocType
from frappe.utils import get_datetime, get_url
from frappe.utils.background_jobs import enqueue
from frappe.utils.data import get_link_to_form
from frappe.utils.user import get_users_with_role
from frappe.utils.verified_command import get_signed_params, verify_request

from ...workflow import (
    apply_workflow,
    clear_workflow_doctype_cache,
    get_allowed_transitions_for_user,
    get_doc_workflow_state,
    get_original_submitter,
    get_workflow_name,
    has_approval_access,
    is_transition_condition_satisfied,
    send_email_alert,
    _get_active_workflow_doctypes,
)


class PMWorkflowAction(Document):
    pass


def on_doctype_update():
    frappe.db.add_index(
        "PM Workflow Action", ["reference_name", "reference_doctype", "status"]
    )


# ─── Permission helpers ───────────────────────────────────────────────────────

def get_permission_query_conditions(user):
    """
    Restrict PM Workflow Action list to actions the user can act on.

    A user sees an action if:
      (a) They are the specific assigned_to user (Employee Approver Matrix routing), OR
      (b) They have a role listed in the action's permitted_roles (classic role routing)
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""

    roles = frappe.get_roles(user)

    WorkflowAction = DocType("PM Workflow Action")
    WorkflowActionPermitted = DocType("PM Workflow Action Permitted Role")

    # Role-based subquery (existing behaviour)
    role_subquery = (
        frappe.qb.from_(WorkflowAction)
        .join(WorkflowActionPermitted)
        .on(WorkflowAction.name == WorkflowActionPermitted.parent)
        .select(WorkflowAction.name)
        .where(
            (
                (WorkflowActionPermitted.approver_type == "Role")
                & (WorkflowActionPermitted.approver.isin(roles))
            )
            | (
                (WorkflowActionPermitted.approver_type == "User")
                & (WorkflowActionPermitted.approver == user)
            )
        )
        # Only show role-based actions when no specific user is assigned
        .where(WorkflowAction.assigned_to.isnull() | (WorkflowAction.assigned_to == ""))
    ).get_sql()

    # User-specific assignment — always shown to the assigned user
    return (
        f"(`tabPM Workflow Action`.`assigned_to` = '{user}'"
        f"  OR `tabPM Workflow Action`.`name` IN ({role_subquery}))"
        "  AND `tabPM Workflow Action`.`status` = 'Open'"
    )


def has_permission(doc, user):
    if user == "Administrator":
        return True
    # Directly assigned
    if doc.get("assigned_to") == user:
        return True
    # Role-based
    permitted_roles = {r.approver for r in doc.permitted_roles}
    return not permitted_roles.isdisjoint(frappe.get_roles(user))


# ─── Core engine ──────────────────────────────────────────────────────────────

def process_workflow_actions(doc, state):
    """
    Called on every document event (on_update, on_cancel, on_trash,
    on_update_after_submit).  Creates or closes PM Workflow Action records
    and optionally sends email alerts.
    """
    # ── Guard 1: tables may not exist before first bench migrate ─────────────
    if not frappe.db.table_exists("PM Workflow"):
        return

    # ── Guard 2: zero-overhead exit for non-workflow doctypes ────────────────
    # Checks a Redis-cached allow-list — no extra DB query for irrelevant saves.
    doctype = doc.get("doctype")
    if doctype not in _get_active_workflow_doctypes():
        return

    # ── Guard 3: skip if standard Frappe workflow owns this doctype ──────────
    # Prevents double-processing; conflict is already blocked at PM Workflow save.
    if frappe.db.exists("Workflow", {"document_type": doctype, "is_active": 1}):
        return

    workflow = get_workflow_name(doc.get("doctype"), doc.get("name"))
    if not workflow:
        return

    if state == "on_trash":
        clear_workflow_actions(doc.get("doctype"), doc.get("name"))
        return

    if is_workflow_action_already_created(doc):
        return

    update_completed_workflow_actions(
        doc, workflow=workflow, workflow_state=get_doc_workflow_state(doc)
    )
    clear_doctype_notifications("PM Workflow Action")

    next_transitions = get_next_possible_transitions(workflow, get_doc_workflow_state(doc), doc)
    if not next_transitions:
        return

    # Priority: use the one the approver explicitly chose, else fall back to transition definition
    _PWEIGHT = {"Critical": 0, "Urgent": 0, "High": 1, "Medium": 2, "Low": 3}
    override_priority = getattr(frappe.local, "_pm_action_priority", None)
    if override_priority:
        frappe.local._pm_action_priority = None  # consume so it doesn't bleed into next save
        action_priority = override_priority
    else:
        best = min(
            next_transitions,
            key=lambda t: _PWEIGHT.get(getattr(t, "priority", "Medium") or "Medium", 2),
        )
        action_priority = getattr(best, "priority", None) or "Medium"

    # Build resolved assignments: list of (approver_type, approver, assigned_to, for_submitter)
    assignments = _resolve_transition_assignments(next_transitions, doc, workflow)
    create_workflow_actions_for_assignments(assignments, doc, priority=action_priority)

    if send_email_alert(workflow) and frappe.db.get_value(
        "PM Workflow Document State",
        filters={"parent": workflow, "state": get_doc_workflow_state(doc)},
        fieldname="send_email",
    ):
        enqueue(
            send_workflow_action_email,
            queue="short",
            doc=doc,
            transitions=next_transitions,
            enqueue_after_commit=True,
            now=frappe.flags.in_test,
        )


def update_completed_workflow_actions(doc, user=None, workflow=None, workflow_state=None):
    allowed_roles = get_allowed_roles(user, workflow, workflow_state)
    if not allowed_roles:
        return
    if action := get_workflow_action_by_role(doc, allowed_roles):
        update_completed_workflow_actions_using_role(user, action)
    else:
        clear_old_workflow_actions_using_user(doc, user)
        update_completed_workflow_actions_using_user(doc, user)


def get_workflow_action_by_role(doc, allowed_roles):
    WorkflowAction = DocType("PM Workflow Action")
    WorkflowActionPermitted = DocType("PM Workflow Action Permitted Role")
    return (
        frappe.qb.from_(WorkflowAction)
        .join(WorkflowActionPermitted)
        .on(WorkflowAction.name == WorkflowActionPermitted.parent)
        .select(
            WorkflowAction.name,
            WorkflowActionPermitted.approver_type,
            WorkflowActionPermitted.approver,
        )
        .where(
            (WorkflowAction.reference_name == doc.get("name"))
            & (WorkflowAction.reference_doctype == doc.get("doctype"))
            & (WorkflowAction.status == "Open")
            & (
                (
                    (WorkflowActionPermitted.approver_type == "Role")
                    & WorkflowActionPermitted.approver.isin(list(allowed_roles))
                )
                | (
                    (WorkflowActionPermitted.approver_type == "User")
                    & (WorkflowActionPermitted.approver == frappe.session.user)
                )
            )
        )
        .orderby(WorkflowActionPermitted.approver)
        .limit(1)
    ).run(as_dict=True)


def update_completed_workflow_actions_using_role(user=None, workflow_action=None):
    user = user or frappe.session.user
    WorkflowAction = DocType("PM Workflow Action")
    if not workflow_action:
        return

    approver_type = workflow_action[0].approver_type
    approver = workflow_action[0].approver

    (
        frappe.qb.update(WorkflowAction)
        .set(WorkflowAction.status, "Completed")
        .set(WorkflowAction.completed_by, user)
        .set(
            WorkflowAction.completed_by_role,
            approver if approver_type == "Role" else None,
        )
        .where(WorkflowAction.name == workflow_action[0].name)
    ).run()


def clear_old_workflow_actions_using_user(doc, user=None):
    user = user or frappe.session.user
    if frappe.db.has_column("PM Workflow Action", "user"):
        frappe.db.delete(
            "PM Workflow Action",
            {
                "reference_name": doc.get("name"),
                "reference_doctype": doc.get("doctype"),
                "status": "Open",
                "user": ("!=", user),
            },
        )


def update_completed_workflow_actions_using_user(doc, user=None):
    user = user or frappe.session.user
    if frappe.db.has_column("PM Workflow Action", "user"):
        WorkflowAction = DocType("PM Workflow Action")
        (
            frappe.qb.update(WorkflowAction)
            .set(WorkflowAction.status, "Completed")
            .set(WorkflowAction.completed_by, user)
            .where(
                (WorkflowAction.reference_name == doc.get("name"))
                & (WorkflowAction.reference_doctype == doc.get("doctype"))
                & (WorkflowAction.status == "Open")
                & (WorkflowAction.user == user)
            )
        ).run()


@frappe.whitelist(allow_guest=True)
def apply_action(action, doctype, docname, current_state, user=None, last_modified=None):
    if not verify_request():
        return
    doc = frappe.get_doc(doctype, docname)
    doc_state = get_doc_workflow_state(doc)
    if doc_state == current_state:
        action_link = get_confirm_workflow_action_url(doc, action, user)
        if not last_modified or get_datetime(doc.modified) == get_datetime(last_modified):
            return_action_confirmation_page(doc, action, action_link)
        else:
            return_action_confirmation_page(doc, action, action_link, alert_doc_change=True)
    else:
        return_link_expired_page(doc, doc_state)


@frappe.whitelist(allow_guest=True)
def confirm_action(doctype, docname, user, action):
    if not verify_request():
        return
    logged_in_user = frappe.session.user
    if logged_in_user == "Guest" and user:
        frappe.set_user(user)
    doc = frappe.get_doc(doctype, docname)
    newdoc = apply_workflow(doc, action)
    frappe.db.commit()
    return_success_page(newdoc)
    if logged_in_user == "Guest":
        frappe.set_user(logged_in_user)


def return_success_page(doc):
    frappe.respond_as_web_page(
        _("Success"),
        _("{0}: {1} is now in state {2}").format(
            doc.get("doctype"),
            frappe.bold(doc.get("name")),
            frappe.bold(get_doc_workflow_state(doc)),
        ),
        indicator_color="green",
    )


def return_action_confirmation_page(doc, action, action_link, alert_doc_change=False):
    frappe.respond_as_web_page(
        title=None,
        html=None,
        indicator_color="blue",
        template="confirm_workflow_action",
        context={
            "title": doc.get("name"),
            "doctype": doc.get("doctype"),
            "docname": doc.get("name"),
            "action": action,
            "action_link": action_link,
            "alert_doc_change": alert_doc_change,
            "pdf_link": get_pdf_link(doc.get("doctype"), doc.get("name")),
        },
    )


def return_link_expired_page(doc, doc_workflow_state):
    frappe.respond_as_web_page(
        _("Link Expired"),
        _("Document {0} has been set to state {1} by {2}").format(
            frappe.bold(doc.get("name")),
            frappe.bold(doc_workflow_state),
            frappe.bold(frappe.get_value("User", doc.get("modified_by"), "full_name")),
        ),
        indicator_color="blue",
    )


def get_allowed_roles(user, workflow, workflow_state):
    user = user or frappe.session.user
    transitions = frappe.get_all(
        "PM Workflow Transition",
        fields=["approver_type", "allowed"],
        filters=[["parent", "=", workflow], ["next_state", "=", workflow_state]],
    )
    user_roles = set(frappe.get_roles(user))
    allowed = set()
    for t in transitions:
        if t.approver_type == "Role" and t.allowed in user_roles:
            allowed.add(t.allowed)
        elif t.approver_type == "User" and t.allowed == user:
            allowed.add(user)
    return allowed


def get_next_possible_transitions(workflow_name, state, doc=None):
    """
    Return all non-optional transitions from the current state.
    Uses get_all_transitions_from_state (no user filter) so that
    matrix-based transitions are included even when the saver
    is the submitter (not the approver).
    """
    from ...workflow import get_all_transitions_from_state
    transitions = get_all_transitions_from_state(workflow_name, state, doc)
    return [
        t for t in transitions
        if not get_state_optional_field_value(workflow_name, t.next_state)
    ]


def _resolve_transition_assignments(transitions, doc, workflow_name):
    """
    For each transition, return (approver_type, approver, assigned_to, for_submitter).

    - Matrix transitions: assigned_to = resolved specific user
    - Role/User transitions: assigned_to = None (role-based routing)
    """
    from ...workflow import resolve_approver, get_original_submitter

    # get_original_submitter reads for_submitter from existing PM Workflow Actions.
    # On the FIRST transition no prior action exists, so it returns doc.owner.
    # If doc.owner is Administrator (set by frappe when running via bench execute),
    # fall back to frappe.session.user — the person who actually triggered the action.
    doc_owner = get_original_submitter(doc)
    if (not doc_owner or doc_owner == "Administrator") and \
       frappe.session.user not in ("Administrator", "Guest"):
        doc_owner = frappe.session.user

    doc_type = doc.get("doctype")
    assignments = []
    seen = set()

    for t in transitions:
        if t.get("use_approver_matrix"):
            level = t.get("matrix_level") or 1
            resolved = resolve_approver(
                submitter_user=doc_owner,
                level=level,
                doctype=doc_type,
                workflow_name=workflow_name,
            )
            if resolved:
                key = ("User", resolved, resolved, doc_owner)
            else:
                fallback = t.get("matrix_fallback_role")
                if fallback:
                    key = ("Role", fallback, None, doc_owner)
                else:
                    continue
        else:
            key = (t.approver_type, t.allowed, None, None)

        if key not in seen:
            seen.add(key)
            assignments.append(key)

    return assignments


def get_users_next_action_data(transitions, doc):
    user_data_map = {}

    @frappe.request_cache
    def user_has_permission(user: str) -> bool:
        from frappe.permissions import has_permission
        return has_permission(doctype=doc, user=user)

    for transition in transitions:
        users = (
            get_users_with_role(transition.allowed)
            if transition.approver_type == "Role"
            else [transition.allowed]
        )
        filtered = [
            u for u in users
            if has_approval_access(u, doc, transition) and user_has_permission(u)
        ]
        if doc.get("owner") in filtered and not transition.get("send_email_to_creator"):
            filtered.remove(doc.get("owner"))

        for user in filtered:
            if user not in user_data_map:
                user_data_map[user] = frappe._dict(
                    {
                        "possible_actions": [],
                        "email": frappe.db.get_value("User", user, "email"),
                    }
                )
            user_data_map[user].get("possible_actions").append(
                frappe._dict(
                    {
                        "action_name": transition.action,
                        "action_link": get_workflow_action_url(transition.action, doc, user),
                    }
                )
            )
    return user_data_map


def create_workflow_actions_for_roles(roles, doc, priority="Medium"):
    """Legacy: kept for backward compatibility. Wraps the new assignment-aware function."""
    assignments = [(at, ap, None, None) for at, ap in roles]
    create_workflow_actions_for_assignments(assignments, doc, priority=priority)


def create_workflow_actions_for_assignments(assignments, doc, priority="Medium"):
    """
    Create PM Workflow Action records from resolved assignments.

    assignments: list of (approver_type, approver, assigned_to, for_submitter)
      - assigned_to:   specific user if resolved via Employee Approver Matrix, else None
      - for_submitter: doc owner the matrix lookup was based on, else None
    """
    if not assignments:
        return

    action = frappe.get_doc(
        {
            "doctype": "PM Workflow Action",
            "reference_doctype": doc.get("doctype"),
            "reference_name": doc.get("name"),
            "workflow_state": get_doc_workflow_state(doc),
            "status": "Open",
            "priority": priority or "Medium",
            # Store the matrix-resolved user if any (first assignment wins for the header)
            "assigned_to": next((a[2] for a in assignments if a[2]), None),
            "for_submitter": next((a[3] for a in assignments if a[3]), None),
        }
    )

    for approver_type, approver, _assigned_to, _for_submitter in assignments:
        action.append(
            "permitted_roles",
            {"approver_type": approver_type, "approver": approver},
        )

    action.insert(ignore_permissions=True)
    _push_inbox_notifications(assignments, doc)


def _push_inbox_notifications(assignments, doc):
    """
    Push a Frappe Notification Log so approvers see the count badge in the bell.
    Role-based: notify all users in the role (capped at 50 to avoid spam).
    User-based: notify directly.
    """
    doctype = doc.get("doctype")
    docname = doc.get("name")
    subject = _("Approval pending: {0} {1}").format(doctype, docname)
    from_user = frappe.session.user

    notified = set()
    for approver_type, approver, assigned_to, _fs in assignments:
        if approver_type == "User" or assigned_to:
            target = assigned_to or approver
            if target and target not in notified and frappe.db.exists("User", target):
                notified.add(target)
        elif approver_type == "Role":
            users = frappe.db.get_all(
                "Has Role",
                filters={"role": approver, "parenttype": "User"},
                pluck="parent",
                limit=50,
            )
            for u in users:
                notified.add(u)

    for user in notified:
        if user in ("Administrator", "Guest", from_user):
            continue
        try:
            frappe.get_doc({
                "doctype": "Notification Log",
                "subject": subject,
                "for_user": user,
                "document_type": doctype,
                "document_name": docname,
                "type": "Alert",
                "from_user": from_user,
                "email_content": _(
                    "A new approval is waiting for you in your "
                    "<a href='/app/pm-approval-inbox'>Approval Inbox</a>."
                ),
            }).insert(ignore_permissions=True)
        except Exception:
            pass


def send_workflow_action_email(doc, transitions):
    users_data = get_users_next_action_data(transitions, doc)
    common_args = get_common_email_args(doc)
    message = common_args.pop("message", None)
    for data in users_data.values():
        email_args = {
            "recipients": [data.get("email")],
            "args": {
                "actions": list(_deduplicate_actions(data.get("possible_actions"))),
                "message": message,
            },
            "reference_name": doc.name,
            "reference_doctype": doc.doctype,
        }
        email_args.update(common_args)
        try:
            frappe.sendmail(**email_args)
        except frappe.OutgoingEmailError:
            frappe.log_error("Permission Manager: Failed to send workflow action email")


def _deduplicate_actions(action_list):
    seen = {}
    for a in action_list:
        if a.action_name not in seen:
            seen[a.action_name] = a
    return seen.values()


def get_workflow_action_url(action, doc, user):
    params = {
        "doctype": doc.get("doctype"),
        "docname": doc.get("name"),
        "action": action,
        "current_state": get_doc_workflow_state(doc),
        "user": user,
        "last_modified": doc.get("modified"),
    }
    method = "/api/method/permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.apply_action"
    return get_url(method + "?" + get_signed_params(params))


def get_confirm_workflow_action_url(doc, action, user):
    params = {
        "action": action,
        "doctype": doc.get("doctype"),
        "docname": doc.get("name"),
        "user": user,
    }
    method = "/api/method/permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.confirm_action"
    return get_url(method + "?" + get_signed_params(params))


def is_workflow_action_already_created(doc):
    return frappe.db.exists(
        {
            "doctype": "PM Workflow Action",
            "reference_name": doc.get("name"),
            "reference_doctype": doc.get("doctype"),
            "workflow_state": get_doc_workflow_state(doc),
        }
    )


def clear_workflow_actions(doctype, name):
    if not (doctype and name):
        return
    frappe.db.delete(
        "PM Workflow Action",
        {"reference_name": name, "reference_doctype": doctype},
    )


def get_common_email_args(doc):
    doctype = doc.get("doctype")
    docname = doc.get("name")

    email_template = get_email_template_from_workflow(doc)
    if email_template:
        subject = email_template.get("subject")
        response = email_template.get("message")
    else:
        subject = _("PM Workflow Action on {0}: {1}").format(doctype, docname)
        response = get_link_to_form(doctype, docname, f"{doctype}: {docname}")

    print_format = doc.meta.default_print_format
    lang = doc.get("language") or (
        frappe.get_cached_value("Print Format", print_format, "default_print_language")
        if print_format
        else None
    )

    return {
        "template": "workflow_action",
        "header": "PM Workflow Action",
        "attachments": [
            frappe.attach_print(doctype, docname, file_name=docname, doc=doc, lang=lang, print_format=print_format)
        ],
        "subject": subject,
        "message": response,
    }


def get_email_template_from_workflow(doc):
    workflow_name = get_workflow_name(doc.get("doctype"), doc.get("name"))
    doc_state = get_doc_workflow_state(doc)
    template_name = frappe.db.get_value(
        "PM Workflow Document State",
        {"parent": workflow_name, "state": doc_state},
        "next_action_email_template",
    )
    if not template_name:
        return None
    if isinstance(doc, Document):
        doc = doc.as_dict()
    return get_email_template(template_name, doc)


def get_state_optional_field_value(workflow_name, state):
    return frappe.get_cached_value(
        "PM Workflow Document State",
        {"parent": workflow_name, "state": state},
        "is_optional_state",
    )
