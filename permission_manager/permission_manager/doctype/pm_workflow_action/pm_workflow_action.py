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

    current_state = get_doc_workflow_state(doc)

    # If the document has never had a PM Workflow state written (newly created docs),
    # persist the initial state now so server scripts can read it via get_db_value().
    if not current_state:
        from ...workflow import get_workflow as _get_workflow
        _wf = _get_workflow(doc.get("doctype"), doc.get("name"))
        if _wf and _wf.states:
            initial_state = _wf.states[0].state
            frappe.db.set_value(
                doc.get("doctype"), doc.get("name"),
                _wf.workflow_state_field, initial_state,
                update_modified=False,
            )
            # Also on the in-memory document. db_set writes the row, not the object, and
            # everything below re-reads the state off `doc` — on an insert that left the
            # object blank, so no transition was found and no action was ever created. The
            # document only picked up an approver on some later save, which is why a
            # document created once and left alone never appeared in the approval inbox.
            doc.set(_wf.workflow_state_field, initial_state)
            current_state = initial_state

    # Close Open AND Forwarded actions from previous states, stamp who triggered the transition.
    _WA = DocType("PM Workflow Action")
    (
        frappe.qb.update(_WA)
        .set(_WA.status, "Completed")
        .set(_WA.completed_by, frappe.session.user)
        .where(
            (_WA.reference_doctype == doc.get("doctype"))
            & (_WA.reference_name == doc.get("name"))
            & (_WA.status.isin(["Open", "Forwarded"]))
            & (_WA.workflow_state != current_state)
        )
    ).run()

    if is_workflow_action_already_created(doc):
        return

    update_completed_workflow_actions(
        doc, workflow=workflow, workflow_state=current_state
    )
    clear_doctype_notifications("PM Workflow Action")

    next_transitions = get_next_possible_transitions(workflow, current_state, doc)
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
        filters={"parent": workflow, "state": current_state},
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
            # For role-based transitions, try to pin the action to the specific
            # user who holds that role AND has a User Permission for the document's
            # target warehouse (to_warehouse).  This routes the inbox item directly
            # to the right warehouse person without needing a session-user condition.
            assigned_to = None
            if t.approver_type == "Role" and doc.get("to_warehouse"):
                assigned_to = _resolve_warehouse_approver(t.allowed, doc.get("to_warehouse"))
            key = (t.approver_type, t.allowed, assigned_to, doc_owner if assigned_to else None)

        if key not in seen:
            seen.add(key)
            assignments.append(key)

    return assignments


def _resolve_warehouse_approver(role: str, warehouse: str):
    """
    Return the user who has both the given role and a User Permission for the
    warehouse, or None if no unique match is found.
    """
    if not warehouse:
        return None
    role_users = frappe.get_all(
        "Has Role",
        filters={"role": role, "parenttype": "User"},
        pluck="parent",
    )
    if not role_users:
        return None
    return frappe.db.get_value(
        "User Permission",
        filters={
            "user": ["in", role_users],
            "allow": "Warehouse",
            "for_value": warehouse,
        },
        fieldname="user",
    )


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

        try:
            frappe.publish_realtime(
                event="pm_new_approval_action",
                message={
                    "doctype": doctype,
                    "docname": docname,
                    "subject": subject,
                },
                user=user,
                after_commit=True,
            )
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
    # Only block if an OPEN action already exists for this state —
    # completed old actions (from a previous cycle) must not block re-creation.
    return frappe.db.exists(
        {
            "doctype": "PM Workflow Action",
            "reference_name": doc.get("name"),
            "reference_doctype": doc.get("doctype"),
            "workflow_state": get_doc_workflow_state(doc),
            "status": "Open",
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


def _can_act_on(action, user):
    """True if `user` may act on this workflow action: the specifically-assigned
    user, a System Manager, or — for role-based (unassigned) actions — a user who
    holds one of the action's permitted roles / is a permitted user."""
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True
    assigned = action.get("assigned_to")
    if assigned:
        return assigned == user
    roles = set(frappe.get_roles(user))
    for r in (action.get("permitted_roles") or []):
        if r.approver_type == "Role" and r.approver in roles:
            return True
        if r.approver_type == "User" and r.approver == user:
            return True
    return False


@frappe.whitelist()
def forward_workflow_action(action_name, to_user, comment="", return_to_originator=0):
    """Forward an open PM Workflow Action to another user as an ad-hoc approver.

    The original action is marked Forwarded; a new ad-hoc action is created for
    to_user with the same state/doc. When the ad-hoc approver acts, the normal
    workflow engine closes all Forwarded/Open actions from the old state.
    """
    action = frappe.get_doc("PM Workflow Action", action_name)

    # The assigned user, a permitted-role approver, or a system manager can forward
    if not _can_act_on(action, frappe.session.user):
        frappe.throw(_("You can only forward actions assigned to you."), frappe.PermissionError)

    if action.status != "Open":
        frappe.throw(_("This action is no longer open and cannot be forwarded."))

    to_user_exists = frappe.db.exists("User", to_user)
    if not to_user_exists:
        frappe.throw(_("User {0} not found.").format(to_user))

    # Mark the original action as Forwarded
    frappe.db.set_value("PM Workflow Action", action_name, {
        "status": "Forwarded",
        "completed_by": frappe.session.user,
    }, update_modified=False)

    # Create the ad-hoc action for the target user
    adhoc = frappe.get_doc({
        "doctype":           "PM Workflow Action",
        "reference_doctype": action.reference_doctype,
        "reference_name":    action.reference_name,
        "workflow_state":    action.workflow_state,
        "status":            "Open",
        "is_adhoc":          1,
        "adhoc_for":         action_name,
        "return_to_originator": int(return_to_originator or 0),
        "assigned_to":       to_user,
        "for_submitter":     action.for_submitter,
        "priority":          action.priority or "Medium",
    })
    adhoc.insert(ignore_permissions=True)

    # Add a comment on the referenced document
    try:
        ref_doc = frappe.get_doc(action.reference_doctype, action.reference_name)
        forwarder_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
        target_name    = frappe.db.get_value("User", to_user, "full_name") or to_user
        msg = _("Forwarded to {0} for ad-hoc approval.").format(f"<b>{target_name}</b>")
        if comment:
            msg += f"<br><em>{frappe.utils.escape_html(comment)}</em>"
        ref_doc.add_comment("Workflow", msg)
    except Exception:
        pass

    # Notify the target user
    try:
        target_email = frappe.db.get_value("User", to_user, "email")
        forwarder_name = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
        if target_email:
            frappe.sendmail(
                recipients=[target_email],
                subject=_("Action Required: {0} {1}").format(action.reference_doctype, action.reference_name),
                message=_(
                    "<p>{forwarder} has forwarded a <b>{doctype}</b> approval to you.</p>"
                    "<p><b>Document:</b> {docname}<br><b>State:</b> {state}</p>"
                    "{comment_block}"
                    '<p><a href="{url}/app/pm-approval-inbox">Open My Approvals</a></p>'
                ).format(
                    forwarder=forwarder_name,
                    doctype=action.reference_doctype,
                    docname=action.reference_name,
                    state=action.workflow_state or "",
                    comment_block=f"<p><em>{frappe.utils.escape_html(comment)}</em></p>" if comment else "",
                    url=frappe.utils.get_url(),
                ),
            )
    except Exception:
        pass

    return {"adhoc_action": adhoc.name, "return_to_originator": int(return_to_originator or 0)}


@frappe.whitelist()
def return_adhoc_to_originator(action_name, comment="", responded_action=None):
    """Ad-hoc (forwarded) approver returns control to the originator instead of
    advancing the workflow: closes this ad-hoc action and re-opens the original.
    Used when the Forward was made with 'Return to Originator' ticked.

    `responded_action` is the label the reviewer chose (Approve, Reject, …) when they reached
    here through the normal action buttons rather than the explicit return button. It never
    moves the document — it is recorded on the document so the approver who forwarded it can
    see what was recommended.
    """
    action = frappe.get_doc("PM Workflow Action", action_name)
    if not action.is_adhoc or not action.adhoc_for:
        frappe.throw(_("This is not an ad-hoc action."))
    if not _can_act_on(action, frappe.session.user):
        frappe.throw(_("You can only act on actions assigned to you."), frappe.PermissionError)
    if action.status != "Open":
        frappe.throw(_("This action is no longer open."))

    frappe.db.set_value("PM Workflow Action", action_name,
                        {"status": "Completed", "completed_by": frappe.session.user}, update_modified=False)
    orig = action.adhoc_for
    reopened = False
    if orig and frappe.db.exists("PM Workflow Action", orig):
        frappe.db.set_value("PM Workflow Action", orig,
                            {"status": "Open", "completed_by": None}, update_modified=False)
        reopened = True

    if not reopened:
        # The original row is gone (an amend or trash cycle clears actions). Regenerate the
        # state's actions from the workflow rather than leaving the document with nobody to
        # approve it.
        try:
            ref_doc = frappe.get_doc(action.reference_doctype, action.reference_name)
            process_workflow_actions(ref_doc, "on_update")
        except Exception:
            frappe.log_error(
                message=frappe.get_traceback(),
                title="permission_manager: could not regenerate an action on ad-hoc return",
            )

    # Never leave the document with no open action: a throw rolls the whole request back, so
    # the ad-hoc action stays Open and the reviewer can try again, which is far better than a
    # document nobody can approve.
    if not frappe.db.exists("PM Workflow Action", {
        "reference_doctype": action.reference_doctype,
        "reference_name": action.reference_name,
        "workflow_state": action.workflow_state,
        "status": "Open",
    }):
        frappe.throw(
            _("Could not re-open the original approver's action, so nothing was changed. "
              "Ask a System Manager to reassign this approval.")
        )

    try:
        ref = frappe.get_doc(action.reference_doctype, action.reference_name)
        who = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
        msg = _("Ad-hoc review by") + " <b>" + who + "</b> — " + _("returned to the original approver.")
        if responded_action:
            msg = msg + "<br>" + _("Recommended:") + " <b>" + frappe.utils.escape_html(str(responded_action)) + "</b>"
        if comment:
            msg = msg + "<br><em>" + frappe.utils.escape_html(comment) + "</em>"
        ref.add_comment("Workflow", msg)
    except Exception:
        pass

    try:
        # The original may have been routed to a role rather than a named user, in which case
        # assigned_to is empty and nobody used to be told the document was back.
        recipients = []
        orig_user = frappe.db.get_value("PM Workflow Action", orig, "assigned_to") if orig else None
        if orig_user:
            recipients.append(orig_user)
        elif orig:
            for row in frappe.get_all(
                "PM Workflow Action Permitted Role",
                filters={"parent": orig, "approver_type": "Role"},
                fields=["approver"],
            ):
                recipients.extend(get_users_with_role(row.approver))
        emails = [
            email
            for email in {frappe.db.get_value("User", u, "email") for u in recipients if u}
            if email
        ]
        if emails:
            subject = _("Returned for your approval:") + " " + action.reference_doctype + " " + str(action.reference_name)
            body = ("<p>" + _("An ad-hoc reviewer has returned this document for your approval.") + "</p>"
                    + (("<p><b>" + _("Recommended:") + "</b> " + frappe.utils.escape_html(str(responded_action)) + "</p>")
                       if responded_action else "")
                    + '<p><a href="' + frappe.utils.get_url() + '/app/pm-approval-inbox">' + _("Open My Approvals") + "</a></p>")
            frappe.sendmail(recipients=emails[:50], subject=subject, message=body)
    except Exception:
        pass

    return {"returned_to": orig, "responded_action": responded_action}
