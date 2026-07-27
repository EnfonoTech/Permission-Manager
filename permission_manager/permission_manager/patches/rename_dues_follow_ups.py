# permission_manager/permission_manager/patches/rename_dues_follow_ups.py
"""Give existing follow-ups the readable name the doctype now autonames with.

Early rows were named by hash, so the list read like a2f9c1d3 rather than DUES-SI-2001000060.
Renaming is safe: nothing links to a follow-up by name, the inbox joins on
(voucher_doctype, voucher). A row whose target name is already taken keeps its hash.
"""

import frappe


def execute():
    if not frappe.db.exists("DocType", "PM Dues Follow Up"):
        return

    # the model-level function, not frappe.rename_doc: only this one takes ignore_permissions
    from frappe.model.rename_doc import rename_doc

    from permission_manager.permission_manager.doctype.pm_dues_follow_up.pm_dues_follow_up import (
        doctype_code,
    )

    for row in frappe.get_all("PM Dues Follow Up", fields=["name", "voucher_doctype", "voucher"]):
        if row.name.startswith("DUES-"):
            continue
        target = "DUES-%s-%s" % (doctype_code(row.voucher_doctype), row.voucher)
        if frappe.db.exists("PM Dues Follow Up", target):
            continue
        rename_doc("PM Dues Follow Up", row.name, target, force=True, show_alert=False,
                   ignore_permissions=True)
        print("Dues Inbox: renamed %s to %s" % (row.name, target))

    frappe.db.commit()
