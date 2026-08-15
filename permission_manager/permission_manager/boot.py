"""Session boot additions for Permission Manager."""

import frappe


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

        bootinfo.pm_workflow_doctypes = sorted(_get_active_workflow_doctypes())
    except Exception:
        # a boot that fails takes the whole desk with it — never worth that
        bootinfo.pm_workflow_doctypes = []
        frappe.log_error(title="Permission Manager: could not boot workflow doctypes")
