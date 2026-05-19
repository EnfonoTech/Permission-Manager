import frappe
import json
import os


def after_install():
    """Runs once after `bench install-app permission_manager`.

    bench install-app creates DocType tables from JSON but does NOT
    automatically run sync_fixtures, so Custom Field records would be
    missing without this hook.
    """
    _sync_fixtures()
    sync_pages()
    frappe.db.commit()
    print("Permission Manager: install complete — custom fields and pages synced.")


def after_migrate():
    """Runs after every `bench migrate`.

    bench migrate calls sync_fixtures globally, but we also need to
    sync pages (bench migrate skips Page JSON files after initial install).
    """
    sync_pages()
    frappe.db.commit()


def _sync_fixtures():
    """Import this app's fixtures (Custom Fields, etc.) into the DB."""
    try:
        from frappe.utils.fixtures import sync_fixtures
        sync_fixtures(app="permission_manager")
        print("Permission Manager: fixtures synced via frappe.utils.fixtures.")
    except Exception as e:
        # Fallback: direct JSON import in case sync_fixtures API differs
        frappe.log_error(f"sync_fixtures fallback triggered: {e}", "PM Install")
        import_fixtures()


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

def check_pi_env():
    company = frappe.db.get_value("Company", {}, ["name", "default_currency"], as_dict=True)
    print(f"Company: {company}")
    supplier = frappe.db.get_value("Supplier", {}, "name")
    print(f"First supplier: {supplier}")
    item = frappe.db.get_value("Item", {"is_purchase_item": 1, "disabled": 0}, ["name", "stock_uom"], as_dict=True)
    print(f"First purchase item: {item}")
    pi_perms = frappe.get_all("Custom DocPerm", filters={"parent": "Purchase Invoice", "role": "Accounts User"},
                              fields=["role", "read", "write", "create"])
    print(f"PI Custom DocPerms for Accounts User: {pi_perms}")


def check_note_perms():
    rows = frappe.get_all("Custom DocPerm", filters={"parent": "Note"},
                          fields=["name", "role", "permlevel", "read", "write", "create", "delete", "if_owner"])
    if rows:
        for r in rows:
            print(f"  Custom: role={r['role']} lvl={r['permlevel']} r={r['read']} w={r['write']} c={r['create']} d={r['delete']} if_owner={r['if_owner']}")
    else:
        print("  No Custom DocPerm for Note")


def patch_live_workflows():
    """Add missing re-submit transitions to live demo workflows."""
    patches = [
        {
            "workflow": "PM-PI-DEMO-Approval",
            "transition": {
                "state": "PI Rejected",
                "action": "PI Submit for Approval",
                "next_state": "PI Pending L1",
                "approver_type": "Role",
                "allowed": "Accounts User",
                "allow_self_approval": 1,
                "use_approver_matrix": 0,
            },
        },
        {
            "workflow": "PM-DEMO-Note-Approval",
            "transition": {
                "state": "PM Demo Rejected",
                "action": "PM Demo Submit",
                "next_state": "PM Demo Pending L1",
                "approver_type": "Role",
                "allowed": "Desk User",
                "allow_self_approval": 1,
                "use_approver_matrix": 0,
            },
        },
    ]
    for p in patches:
        wf_name = p["workflow"]
        if not frappe.db.exists("PM Workflow", wf_name):
            print(f"  SKIP (not found): {wf_name}")
            continue
        t = p["transition"]
        already = frappe.db.exists("PM Workflow Transition", {
            "parent": wf_name, "state": t["state"], "action": t["action"]
        })
        if already:
            print(f"  Already exists: {wf_name} [{t['state']} → {t['action']}]")
            continue
        wf_doc = frappe.get_doc("PM Workflow", wf_name)
        wf_doc.append("transitions", t)
        wf_doc.save(ignore_permissions=True)
        print(f"  Patched: {wf_name} — added [{t['state']} → {t['action']} → {t['next_state']}]")
    frappe.db.commit()
    frappe.clear_cache()


def repair_pi_demo_ownership():
    """Fix live PI demo: set owner to pi.submitter and reassign workflow actions correctly."""
    submitter  = "pi.submitter@pm-demo.test"
    approver2  = "pi.approver2@pm-demo.test"

    # 1. Fix PI owner
    pi = frappe.db.get_value("Purchase Invoice", {"supplier": "PM-PI-Demo-Supplier", "docstatus": 0}, "name")
    if not pi:
        print("  No open demo PI found.")
        return
    frappe.db.set_value("Purchase Invoice", pi, "owner", submitter)
    print(f"  Fixed PI owner: {pi} → {submitter}")

    # 2. Fix all open PM Workflow Actions for this PI
    actions = frappe.get_all(
        "PM Workflow Action",
        filters={"reference_doctype": "Purchase Invoice", "reference_name": pi},
        fields=["name", "workflow_state", "status"],
    )
    for a in actions:
        frappe.db.set_value("PM Workflow Action", a.name, "for_submitter", submitter)
        # For L2 (Pending L2) open action — assign directly to approver2
        if a.status == "Open" and a.workflow_state == "PI Pending L2":
            frappe.db.set_value("PM Workflow Action", a.name, "assigned_to", approver2)
            print(f"  Fixed L2 action {a.name}: for_submitter={submitter}, assigned_to={approver2}")
        else:
            print(f"  Fixed action {a.name}: for_submitter={submitter} (status={a.status})")

    frappe.db.commit()
    frappe.clear_cache()
    print("Done.")


def check_pi_wf_states():
    rows = frappe.get_all(
        "PM Workflow Document State",
        filters={"parent": "PM-PI-DEMO-Approval"},
        fields=["state", "doc_status"],
        order_by="idx asc"
    )
    for r in rows:
        label = {None: "Draft", "0": "Draft", "1": "Submitted", "2": "Cancelled"}.get(r.doc_status, r.doc_status)
        print(f"  {r.state:25s}  doc_status={r.doc_status}  ({label})")


def check_pi_owner():
    rows = frappe.get_all(
        "Purchase Invoice",
        filters={"supplier": "PM-PI-Demo-Supplier"},
        fields=["name", "owner", "pm_pi_workflow_state", "docstatus"],
    )
    for r in rows:
        print(f"  {r.name}: owner={r.owner} state={r.pm_pi_workflow_state} docstatus={r.docstatus}")
    # Also check PM Workflow Action
    actions = frappe.get_all(
        "PM Workflow Action",
        filters={"reference_doctype": "Purchase Invoice", "status": "Open"},
        fields=["name", "assigned_to", "for_submitter", "workflow_state"],
    )
    for a in actions:
        print(f"  Action {a.name}: assigned_to={a.assigned_to} for_submitter={a.for_submitter} state={a.workflow_state}")
