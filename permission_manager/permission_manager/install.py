import frappe
import json
import os


def import_fixtures():
    fixture_path = os.path.join(
        frappe.get_app_path("permission_manager"),
        "fixtures",
        "custom_field.json",
    )
    with open(fixture_path) as f:
        records = json.load(f)

    created, updated, errors = [], [], []
    for rec in records:
        try:
            name = rec.get("name") or f"{rec['dt']}-{rec['fieldname']}"
            if frappe.db.exists("Custom Field", name):
                doc = frappe.get_doc("Custom Field", name)
                doc.update(rec)
                doc.save(ignore_permissions=True)
                updated.append(name)
            else:
                doc = frappe.get_doc({"doctype": "Custom Field", **rec})
                doc.insert(ignore_permissions=True)
                created.append(name)
        except Exception as e:
            errors.append(f"{rec.get('fieldname')}: {e}")

    frappe.db.commit()
    print(f"Created : {len(created)}")
    for n in created:
        print(f"  + {n}")
    print(f"Updated : {len(updated)}")
    for n in updated:
        print(f"  ~ {n}")
    if errors:
        print(f"Errors  : {len(errors)}")
        for e in errors:
            print(f"  ! {e}")


def list_pages():
    rows = frappe.db.sql(
        "SELECT name, module, title FROM `tabPage` WHERE module='Permission Manager' OR name LIKE '%pm%' OR name LIKE '%permission%'",
        as_dict=True
    )
    for r in rows:
        print(f"  [{r['name']}] {r['title']} (module: {r['module']})")
    print(f"Total: {len(rows)}")


def sync_pages():
    from frappe.modules.import_file import import_file_by_path
    import os
    page_dir = frappe.get_app_path("permission_manager", "permission_manager", "page")
    for page_name in os.listdir(page_dir):
        json_path = os.path.join(page_dir, page_name, f"{page_name}.json")
        if os.path.exists(json_path):
            import_file_by_path(json_path, force=True)
            print(f"Synced page: {page_name}")
    frappe.db.commit()


def rename_nl_to_pm_doctypes():
    """Update DocType records and all references in tabDocType from NL → PM."""
    renames = [
        ("NL Workflow Action Permitted Role", "PM Workflow Action Permitted Role"),
        ("NL Workflow Document State",        "PM Workflow Document State"),
        ("NL Workflow Transition",            "PM Workflow Transition"),
        ("NL Workflow Action",                "PM Workflow Action"),
        ("NL Workflow",                       "PM Workflow"),
    ]
    for old, new in renames:
        if frappe.db.exists("DocType", old):
            frappe.db.sql("UPDATE `tabDocType` SET name=%s WHERE name=%s", (new, old))
            frappe.db.sql(
                "UPDATE `tabCustom DocPerm` SET parent=%s WHERE parent=%s", (new, old)
            )
            print(f"  DocType: {old} → {new}")
        elif frappe.db.exists("DocType", new):
            print(f"  Already PM: {new}")
        else:
            print(f"  MISSING DocType: {old}")
    frappe.db.commit()
    frappe.clear_cache()
    print("Done — run bench migrate next.")


def rename_nl_to_pm_tables():
    """Rename all tabNL Workflow* tables to tabPM Workflow* in the database."""
    renames = [
        ("tabNL Workflow Action Permitted Role", "tabPM Workflow Action Permitted Role"),
        ("tabNL Workflow Document State",        "tabPM Workflow Document State"),
        ("tabNL Workflow Transition",            "tabPM Workflow Transition"),
        ("tabNL Workflow Action",                "tabPM Workflow Action"),
        ("tabNL Workflow",                       "tabPM Workflow"),
    ]
    for old, new in renames:
        if frappe.db.table_exists(old.replace("tab", "")):
            frappe.db.sql(f"RENAME TABLE `{old}` TO `{new}`")
            print(f"  Renamed: {old} → {new}")
        elif frappe.db.table_exists(new.replace("tab", "")):
            print(f"  Already PM: {new}")
        else:
            print(f"  MISSING: {old}")
    frappe.db.commit()
    print("Done.")


def check_approval_chain_cols():
    cols = frappe.db.sql("DESCRIBE `tabPM Employee Approval Chain`", as_dict=True)
    for c in cols:
        print(f"  {c['Field']} ({c['Type']})")


def check_nl_action_columns():
    cols = frappe.db.sql("DESCRIBE `tabPM Workflow Action`", as_dict=True)
    for c in cols:
        print(f"  {c['Field']} ({c['Type']})")


def check_tables():
    pm_doctypes = [
        "PM Workflow", "PM Workflow Action", "PM Workflow Transition",
        "PM Employee Approval Chain", "PM Approver Delegation",
    ]
    for dt in pm_doctypes:
        table = f"tab{dt}"
        exists = frappe.db.table_exists(dt)
        print(f"  {'OK' if exists else 'MISSING'} {table}")


def fix_approval_tab_position():
    """Move pm_approval_section to after 'ctc' so it's a new tab, not inside Attendance & Leaves."""
    frappe.db.set_value(
        "Custom Field",
        "Employee-pm_approval_section",
        "insert_after",
        "holiday_list",
    )
    frappe.db.commit()
    frappe.clear_cache(doctype="Employee")
    frappe.reload_doctype("Employee")
    print("Done — Approval Chain tab now inserts after 'holiday_list' (end of Attendance & Leaves tab).")


def reload_employee():
    frappe.clear_cache(doctype="Employee")
    frappe.reload_doctype("Employee")
    print("Employee doctype cache cleared and reloaded.")


def verify_fields():
    rows = frappe.db.sql(
        "SELECT name, dt, fieldname, fieldtype, label FROM `tabCustom Field` WHERE fieldname LIKE 'pm_%' OR fieldname LIKE 'custom_%' ORDER BY dt, fieldname",
        as_dict=True
    )
    for r in rows:
        print(f"  [{r['dt']}] {r['fieldname']} ({r['fieldtype']}) — {r['label']}")
    print(f"Total: {len(rows)}")
