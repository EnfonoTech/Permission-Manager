"""Session boot additions for Permission Manager."""

import frappe
from frappe.utils import nowdate


def boot_session(bootinfo):
    """Tell the desk which doctypes an approval workflow governs.

    The form used to learn this only from get_workflow_info, one round trip after the toolbar
    had already been painted — so core's Submit button appeared and was taken away again a
    moment later, which read as a lag. Sent at boot, the form knows before it paints.

    Doctype-level on purpose: whether a *particular* document is governed still depends on its
    company and dimensions, and get_workflow_info remains the authority on that. This only says
    "documents of this type are routed", which is enough to keep core's Submit off the screen
    until the real answer arrives.
    """
    try:
        from permission_manager.permission_manager.workflow import _get_active_workflow_doctypes

        bootinfo.pm_workflow_doctypes = sorted(_get_active_workflow_doctypes() - _conditional_doctypes())
    except Exception:
        # a boot that fails takes the whole desk with it — never worth that
        bootinfo.pm_workflow_doctypes = []
        frappe.log_error(title="Permission Manager: could not boot workflow doctypes")

    try:
        bootinfo.pm_backdate = _backdate_allowances()
    except Exception:
        bootinfo.pm_backdate = {}
        frappe.log_error(title="Permission Manager: could not boot backdate allowances")


def _conditional_doctypes() -> set:
    """Doctypes a workflow governs only *some* documents of, so they stay off the boot list.

    The boot list exists to take core's Submit button away before the toolbar is painted, on
    the strength of the doctype alone. That is right for a doctype routed as a whole and wrong
    for one routed in part -- a workflow meant for returns above a threshold, say: naming its
    doctype here would blank the Submit button on every ordinary document of that type until
    get_workflow_info answered a round trip later. A resolver says so by returning
    `conditional` (see workflow.APPLICABILITY_HOOK).

    get_workflow_info remains the authority; these doctypes simply wait for it.
    """
    try:
        from permission_manager.permission_manager.workflow import (
            _get_active_workflow_doctypes,
            applicability_verdicts,
        )

        conditional = set()
        for doctype in _get_active_workflow_doctypes():
            for verdict in applicability_verdicts(doctype):
                if verdict.get("conditional"):
                    conditional.add(doctype)
        return conditional
    except Exception:
        return set()


def _backdate_allowances() -> dict:
    """This user's backdating allowance per restricted doctype, for the form to act on.

    Sent at boot so the date field can be settled before it is drawn rather than after a
    round trip, and so a user with no allowance is never offered a date they cannot keep. The
    server-side check in api/backdate_control.py remains the actual gate — this only stops the
    form inviting an entry that would be refused.
    """
    from permission_manager.permission_manager.api.backdate_control import (
        allowed_backdate_days,
        get_restricted_doctypes,
        resolve_date_field,
        _rules_for,
        _settings,
    )

    if frappe.session.user == "Administrator":
        return {}

    doctypes = get_restricted_doctypes()
    if not doctypes:
        return {}

    settings = _settings()
    # The server's today, not the browser's. The validator compares against frappe.utils
    # nowdate() in the site's timezone; a form that works out its own date from the machine it
    # is running on can land a day out and lock the field to a value the server then refuses,
    # leaving the user unable to save and unable to correct it.
    out = {"today": nowdate(), "doctypes": {}}
    for doctype in doctypes:
        days = allowed_backdate_days(doctype, frappe.session.user, settings)
        if days is None or days < 0:
            continue  # unrestricted for this user
        date_field = resolve_date_field(doctype, _rules_for(doctype, settings))
        if not date_field:
            continue
        out["doctypes"][doctype] = {"days": days, "date_field": date_field}

    return out if out["doctypes"] else {}
