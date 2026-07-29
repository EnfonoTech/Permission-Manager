# permission_manager/permission_manager/patches/drop_dues_follow_up_table.py
"""Drop the orphaned tabPM Dues Follow Up table.

remove_dues_follow_up deleted the DocType, but Frappe v15 does not drop the table when a DocType is
deleted - there is no DROP TABLE anywhere in delete_doc or DocType.on_trash, which is why the site
was left with a table nothing reads and `bench trim-tables` as the only cleanup route. Doing it here
means the app cleans up after itself on every site instead of relying on someone remembering.

Separate patch rather than an edit to remove_dues_follow_up, because that one has already run and
logged on the sites that had the feature.

Idempotent: nothing to do once the table is gone, and nothing to do on a site that never had it.
"""

import frappe


def execute():
    if frappe.db.exists("DocType", "PM Dues Follow Up"):
        # the DocType is back for some reason: leave its table alone
        return
    if not frappe.db.table_exists("PM Dues Follow Up"):
        return

    rows = frappe.db.sql("select count(*) from `tabPM Dues Follow Up`")[0][0]
    frappe.db.sql_ddl("drop table if exists `tabPM Dues Follow Up`")
    frappe.db.commit()
    frappe.logger().info(
        "permission_manager: dropped orphaned tabPM Dues Follow Up (%d row(s))" % rows
    )
