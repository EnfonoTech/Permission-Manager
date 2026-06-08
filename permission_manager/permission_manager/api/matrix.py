"""
Permission Manager — Permission Matrix APIs
Author: siva <siva@enfono.com>

READ and WRITE whitelisted endpoints for viewing and editing permission matrices
across users, DocTypes, and roles.  All write operations require System Manager.
"""

import frappe
from frappe import _
from frappe.permissions import (
    get_all_perms,
    get_doctypes_with_custom_docperms,
    get_roles,
    get_valid_perms,
)

MATRIX_RIGHTS = [
    "select", "read", "write", "create", "delete",
    "submit", "cancel", "amend",
    "print", "email", "report", "import", "export", "share",
]

SUBMITTABLE_ONLY = {"submit", "cancel", "amend"}

_BLANK_PERM = {r: 0 for r in MATRIX_RIGHTS}


def _check_access():
    if "System Manager" not in frappe.get_roles():
        frappe.throw(
            _("Permission Studio is only accessible to System Managers."),
            frappe.PermissionError,
        )


def _audit(doctype: str, role: str, ptype: str, old_value, new_value, source: str, note: str = ""):
    """Write a PM Permission Log entry. Silently swallows errors so audit never breaks the UI."""
    try:
        frappe.get_doc({
            "doctype": "PM Permission Log",
            "changed_by": frappe.session.user,
            "changed_on": frappe.utils.now_datetime(),
            "source": source,
            "doctype_name": doctype,
            "role": role or "",
            "permlevel": 0,
            "ptype": ptype or "",
            "old_value": str(old_value) if old_value is not None else "",
            "new_value": str(new_value) if new_value is not None else "",
            "ip_address": frappe.local.request_ip if hasattr(frappe.local, "request_ip") else "",
            "note": note,
        }).insert(ignore_permissions=True)
    except Exception:
        pass


# ─── Read APIs ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def has_studio_access() -> bool:
    return "System Manager" in frappe.get_roles()


@frappe.whitelist()
def get_user_matrix(user: str, module: str = None) -> dict:
    """Full permission matrix for a user across all DocTypes."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    roles = get_roles(user, with_standard=True)
    role_profile = frappe.db.get_value("User", user, "role_profile_name")
    doctype_list = _get_all_doctypes(module)
    all_perms = get_valid_perms(user=user)

    perm_by_doctype: dict = {}
    for p in all_perms:
        perm_by_doctype.setdefault(p.parent, []).append(p)

    matrix = []
    for dt_info in doctype_list:
        dt_name = dt_info["name"]
        is_submittable = bool(dt_info.get("is_submittable"))
        perm_dict = _compute_effective_perms(
            perm_by_doctype.get(dt_name, []), roles, is_submittable
        )
        matrix.append({
            "doctype": dt_name,
            "module": dt_info["module"],
            "is_submittable": is_submittable,
            "permissions": perm_dict,
        })

    matrix.sort(key=lambda x: (
        0 if any(v in ("allow", "cond") for v in x["permissions"].values()) else 1,
        x["module"],
        x["doctype"],
    ))

    return {
        "user": user,
        "roles": sorted(roles),
        "role_profile": role_profile,
        "total_doctypes": len(doctype_list),
        "matrix": matrix,
    }


@frappe.whitelist()
def get_doctype_matrix(doctype: str) -> dict:
    """All roles with permission levels for a specific DocType."""
    _check_access()

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    meta = frappe.get_meta(doctype)
    is_submittable = bool(meta.is_submittable)
    custom_doctypes = get_doctypes_with_custom_docperms()
    has_custom = doctype in custom_doctypes

    standard_perms = frappe.get_all(
        "DocPerm",
        filters={"parent": doctype},
        fields=["role", "permlevel", "if_owner"] + MATRIX_RIGHTS,
        order_by="idx asc",
    )

    custom_perms = []
    if has_custom:
        custom_perms = frappe.get_all(
            "Custom DocPerm",
            filters={"parent": doctype},
            fields=["name", "role", "permlevel", "if_owner"] + MATRIX_RIGHTS,
            order_by="idx asc",
        )

    active_perms = custom_perms if has_custom else standard_perms
    source_label = "custom" if has_custom else "standard"

    roles = []
    for p in active_perms:
        perm_dict = {}
        for right in MATRIX_RIGHTS:
            if right in SUBMITTABLE_ONLY and not is_submittable:
                perm_dict[right] = "na"
            else:
                perm_dict[right] = int(bool(p.get(right, 0)))

        roles.append({
            "name": p.get("name", ""),
            "role": p.role,
            "source": source_label,
            "if_owner": bool(p.get("if_owner", 0)),
            "permlevel": p.get("permlevel", 0),
            "permissions": perm_dict,
        })

    return {
        "doctype": doctype,
        "module": meta.module or "",
        "is_submittable": is_submittable,
        "is_custom": has_custom,
        "roles": roles,
    }


@frappe.whitelist()
def get_role_matrix(role: str) -> dict:
    """All DocTypes a role has permissions for, grouped by module."""
    _check_access()

    if not frappe.db.exists("Role", role):
        frappe.throw(_("Role {0} does not exist.").format(role))

    all_perms = get_all_perms(role)
    user_count = frappe.db.count("Has Role", {"role": role, "parenttype": "User"})
    submittable_set = set(frappe.get_all("DocType", filters={"is_submittable": 1}, pluck="name"))
    custom_doctypes = get_doctypes_with_custom_docperms()

    dt_perms: dict = {}
    for p in all_perms:
        dt_name = p.parent
        if not dt_name:
            continue
        dt_perms.setdefault(dt_name, {
            "perms": [],
            "is_submittable": dt_name in submittable_set,
            "source": "custom" if dt_name in custom_doctypes else "standard",
        })["perms"].append(p)

    dt_modules: dict = {}
    if dt_perms:
        for dt_info in frappe.get_all(
            "DocType",
            filters={"name": ["in", list(dt_perms.keys())]},
            fields=["name", "module"],
        ):
            dt_modules[dt_info["name"]] = dt_info["module"] or "Other"

    module_map: dict = {}
    for dt_name, dt_data in dt_perms.items():
        mod = dt_modules.get(dt_name, "Other")
        is_sub = dt_data["is_submittable"]
        agg_perms: dict = {}
        has_if_owner = False

        for p in dt_data["perms"]:
            if p.get("if_owner"):
                has_if_owner = True
            for right in MATRIX_RIGHTS:
                if right in SUBMITTABLE_ONLY and not is_sub:
                    agg_perms[right] = "na"
                elif p.get(right):
                    agg_perms[right] = 1
                elif right not in agg_perms:
                    agg_perms[right] = 0

        module_map.setdefault(mod, []).append({
            "doctype": dt_name,
            "is_submittable": is_sub,
            "source": dt_data["source"],
            "if_owner": has_if_owner,
            "permissions": agg_perms,
        })

    modules = [
        {
            "module": mod_name,
            "doctypes": sorted(module_map[mod_name], key=lambda x: x["doctype"]),
        }
        for mod_name in sorted(module_map.keys())
    ]

    return {
        "role": role,
        "user_count": user_count,
        "total_doctypes": sum(len(m["doctypes"]) for m in modules),
        "modules": modules,
    }


# ─── Write APIs ───────────────────────────────────────────────────────────────

@frappe.whitelist()
def init_custom_perms(doctype: str) -> dict:
    """
    Copy standard DocPerm → Custom DocPerm so the DocType can be edited.
    No-op if custom perms already exist.
    """
    _check_access()

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    if frappe.db.exists("Custom DocPerm", {"parent": doctype}):
        return get_doctype_matrix(doctype)

    standard_perms = frappe.get_all(
        "DocPerm",
        filters={"parent": doctype},
        fields=["role", "permlevel", "if_owner"] + MATRIX_RIGHTS,
        order_by="idx asc",
    ) or [{
        "role": "System Manager", "permlevel": 0, "if_owner": 0,
        "read": 1, "write": 1, "create": 1, "delete": 1, "select": 1,
        "submit": 0, "cancel": 0, "amend": 0,
        "print": 1, "email": 1, "report": 1, "import": 0, "export": 1, "share": 1,
    }]

    for perm in standard_perms:
        row = {
            "doctype": "Custom DocPerm",
            "parent": doctype,
            "parenttype": "DocType",
            "parentfield": "permissions",
        }
        row.update({k: perm.get(k, 0) for k in ["role", "permlevel", "if_owner"] + MATRIX_RIGHTS})
        frappe.get_doc(row).insert(ignore_permissions=True)

    frappe.clear_cache(doctype=doctype)
    return get_doctype_matrix(doctype)


@frappe.whitelist()
def update_permission(doctype: str, role: str, permlevel: int, ptype: str, value: int) -> dict:
    """
    Toggle a single permission bit for a role on a DocType.
    Auto-initialises custom perms and auto-creates the role row if needed.
    """
    _check_access()

    permlevel = int(permlevel)
    value = int(value)

    if ptype not in MATRIX_RIGHTS:
        frappe.throw(_("Invalid permission type: {0}").format(ptype))

    # Ensure custom perms exist
    if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
        init_custom_perms(doctype)

    row_name = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role, "permlevel": permlevel},
        "name",
    )

    # Auto-create the role row if it doesn't exist at this permlevel
    if not row_name:
        row = frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": doctype,
            "parenttype": "DocType",
            "parentfield": "permissions",
            "role": role,
            "permlevel": permlevel,
            "if_owner": 0,
            **_BLANK_PERM,
        })
        row.insert(ignore_permissions=True)
        row_name = row.name

    old_val = frappe.db.get_value("Custom DocPerm", row_name, ptype)
    frappe.db.set_value("Custom DocPerm", row_name, ptype, value)
    frappe.clear_cache(doctype=doctype)
    _audit(doctype, role, ptype, old_val, value, "DocType View")

    return {"success": True, "doctype": doctype, "role": role, "ptype": ptype, "value": value}


@frappe.whitelist()
def update_if_owner(doctype: str, role: str, permlevel: int, value: int) -> dict:
    """Toggle the if_owner flag for a role permission row."""
    _check_access()

    permlevel = int(permlevel)
    value = int(value)

    if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
        init_custom_perms(doctype)

    row_name = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role, "permlevel": permlevel},
        "name",
    )

    if not row_name:
        frappe.throw(_("Permission row not found for role '{0}' on '{1}'.").format(role, doctype))

    old_val = frappe.db.get_value("Custom DocPerm", row_name, "if_owner")
    frappe.db.set_value("Custom DocPerm", row_name, "if_owner", value)
    frappe.clear_cache(doctype=doctype)
    _audit(doctype, role, "if_owner", old_val, value, "if_owner")
    return {"success": True}


@frappe.whitelist()
def add_role_permission(doctype: str, role: str, permlevel: int = 0) -> dict:
    """Add a new Custom DocPerm row (read-only by default) for a role."""
    _check_access()

    permlevel = int(permlevel)

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))
    if not frappe.db.exists("Role", role):
        frappe.throw(_("Role {0} does not exist.").format(role))

    if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
        init_custom_perms(doctype)

    if frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": permlevel}):
        frappe.throw(
            _("Role '{0}' already has a permission row at level {1} for '{2}'.").format(
                role, permlevel, doctype
            )
        )

    frappe.get_doc({
        "doctype": "Custom DocPerm",
        "parent": doctype,
        "parenttype": "DocType",
        "parentfield": "permissions",
        "role": role,
        "permlevel": permlevel,
        "if_owner": 0,
        "read": 1,
        **{r: 0 for r in MATRIX_RIGHTS if r != "read"},
    }).insert(ignore_permissions=True)

    frappe.clear_cache(doctype=doctype)
    _audit(doctype, role, "read", None, 1, "Add Role", f"Added role at permlevel {permlevel}")
    return get_doctype_matrix(doctype)


@frappe.whitelist()
def remove_role_permission(doctype: str, role: str, permlevel: int = 0) -> dict:
    """Remove a Custom DocPerm row for a role."""
    _check_access()

    permlevel = int(permlevel)
    row_name = frappe.db.get_value(
        "Custom DocPerm",
        {"parent": doctype, "role": role, "permlevel": permlevel},
        "name",
    )

    if not row_name:
        frappe.throw(
            _("No custom permission row found for role '{0}' on '{1}'.").format(role, doctype)
        )

    frappe.delete_doc("Custom DocPerm", row_name, ignore_permissions=True)
    frappe.clear_cache(doctype=doctype)
    _audit(doctype, role, "", "exists", None, "Remove Role", f"Removed role at permlevel {permlevel}")
    return get_doctype_matrix(doctype)


@frappe.whitelist()
def reset_to_standard(doctype: str) -> dict:
    """Delete all Custom DocPerm rows, reverting to standard permissions."""
    _check_access()

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    for row_name in frappe.get_all("Custom DocPerm", filters={"parent": doctype}, pluck="name"):
        frappe.delete_doc("Custom DocPerm", row_name, ignore_permissions=True)

    frappe.clear_cache(doctype=doctype)
    _audit(doctype, "", "", "custom", "standard", "Reset to Standard")
    return get_doctype_matrix(doctype)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_all_doctypes(module: str = None) -> list[dict]:
    filters: dict = {"istable": 0}
    if module:
        filters["module"] = module
    return frappe.get_all(
        "DocType",
        filters=filters,
        fields=["name", "module", "is_submittable"],
        order_by="name asc",
    )


def _compute_effective_perms(perm_rules: list, user_roles: list, is_submittable: bool) -> dict:
    result: dict = {}
    for right in MATRIX_RIGHTS:
        if right in SUBMITTABLE_ONLY and not is_submittable:
            result[right] = "na"
            continue
        has_direct = False
        has_if_owner = False
        for p in perm_rules:
            if p.role not in user_roles or p.permlevel != 0:
                continue
            if p.get(right):
                if p.get("if_owner"):
                    has_if_owner = True
                else:
                    has_direct = True
        result[right] = "allow" if has_direct else ("cond" if has_if_owner else "deny")
    return result
