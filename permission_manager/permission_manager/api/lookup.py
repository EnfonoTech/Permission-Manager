"""
Permission Manager — Lookup, Comparison, Health & Bulk APIs
Author: siva <siva@enfono.com>

Provides:
  - Reverse permission lookup  ("Who can delete Sales Invoice?")
  - Role comparison             (Role A vs Role B side-by-side)
  - Permission health dashboard (orphans, over-privileged users, stats)
  - Bulk role apply             (same permissions across many DocTypes)
  - CSV matrix export           (User / DocType / Role views)
"""

import csv
import io

import frappe
from frappe import _
from frappe.permissions import get_all_perms, get_doctypes_with_custom_docperms

from .matrix import (
    MATRIX_RIGHTS,
    SUBMITTABLE_ONLY,
    _get_all_doctypes,
    get_doctype_matrix,
    get_role_matrix,
    get_user_matrix,
    init_custom_perms,
)

_SENSITIVE_DOCTYPES = [
    "User", "User Permission", "Custom DocPerm", "Role",
    "Payment Entry", "Bank Account", "Salary Slip",
    "Stock Entry", "Journal Entry", "Sales Invoice",
]


def _check_access():
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Permission Studio is only accessible to System Managers."), frappe.PermissionError)


# ─── 1. Reverse Lookup ────────────────────────────────────────────────────────

@frappe.whitelist()
def get_users_with_permission(doctype: str, ptype: str = "read") -> dict:
    """
    Return every active user who has `ptype` on `doctype`, and the role(s)
    that grant it.  Handles both standard and custom DocPerms.
    """
    _check_access()

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))
    if ptype not in MATRIX_RIGHTS:
        frappe.throw(_("Invalid permission type: {0}").format(ptype))

    # Resolve active perms (custom overrides standard if present)
    custom_doctypes = get_doctypes_with_custom_docperms()
    has_custom = doctype in custom_doctypes

    source_table = "Custom DocPerm" if has_custom else "DocPerm"
    rows = frappe.get_all(
        source_table,
        filters={"parent": doctype},
        fields=["role", "permlevel", "if_owner", ptype],
    )

    granting_roles = []
    cond_roles = []  # if_owner only
    for p in rows:
        if p.permlevel != 0:
            continue
        if p.get(ptype):
            (cond_roles if p.get("if_owner") else granting_roles).append(p.role)

    all_relevant_roles = list(set(granting_roles + cond_roles))
    if not all_relevant_roles:
        return {
            "doctype": doctype, "ptype": ptype,
            "granting_roles": [], "conditional_roles": [],
            "users": [], "total_users": 0,
        }

    # Users who have at least one relevant role
    has_role_recs = frappe.get_all(
        "Has Role",
        filters={"role": ["in", all_relevant_roles], "parenttype": "User"},
        fields=["parent as user", "role"],
    )

    # Group by user
    user_role_map: dict = {}
    for r in has_role_recs:
        user_role_map.setdefault(r.user, {"direct": [], "cond": []})
        bucket = "direct" if r.role in granting_roles else "cond"
        if r.role not in user_role_map[r.user][bucket]:
            user_role_map[r.user][bucket].append(r.role)

    # Enrich with user details (only enabled users)
    users = []
    for user_id, roles in user_role_map.items():
        info = frappe.db.get_value(
            "User", user_id,
            ["full_name", "email", "enabled", "user_image"],
            as_dict=True,
        )
        if not info or not info.enabled:
            continue
        users.append({
            "user": user_id,
            "full_name": info.full_name or user_id,
            "email": info.email,
            "user_image": info.user_image,
            "direct_roles": roles["direct"],
            "cond_roles": roles["cond"],
            "access_type": "direct" if roles["direct"] else "if_owner",
        })

    users.sort(key=lambda x: (x["access_type"] != "direct", (x["full_name"] or x["user"]).lower()))

    return {
        "doctype": doctype,
        "ptype": ptype,
        "source": "custom" if has_custom else "standard",
        "granting_roles": sorted(set(granting_roles)),
        "conditional_roles": sorted(set(cond_roles)),
        "users": users,
        "total_users": len(users),
    }


# ─── 2. Role Comparison ───────────────────────────────────────────────────────

@frappe.whitelist()
def compare_roles(role1: str, role2: str) -> dict:
    """
    Side-by-side permission comparison between two roles.
    Each DocType row has:  role1_perms, role2_perms, diff (only_1 | only_2 | both | neither | na)
    """
    _check_access()

    for role in (role1, role2):
        if not frappe.db.exists("Role", role):
            frappe.throw(_("Role '{0}' does not exist.").format(role))

    flat1 = _role_perms_flat(role1)
    flat2 = _role_perms_flat(role2)

    submittable_set = set(frappe.get_all("DocType", filters={"is_submittable": 1}, pluck="name"))
    all_dt = sorted(set(list(flat1.keys()) + list(flat2.keys())))

    dt_modules: dict = {
        r["name"]: r["module"]
        for r in frappe.get_all("DocType", filters={"name": ["in", all_dt]}, fields=["name", "module"])
    }

    rows = []
    for dt in all_dt:
        is_sub = dt in submittable_set
        p1 = flat1.get(dt, {})
        p2 = flat2.get(dt, {})
        diff: dict = {}

        for r in MATRIX_RIGHTS:
            if r in SUBMITTABLE_ONLY and not is_sub:
                diff[r] = "na"
                continue
            v1 = bool(p1.get(r, 0))
            v2 = bool(p2.get(r, 0))
            if v1 and v2:
                diff[r] = "both"
            elif v1:
                diff[r] = "only_1"
            elif v2:
                diff[r] = "only_2"
            else:
                diff[r] = "neither"

        has_diff = any(v in ("only_1", "only_2") for v in diff.values())

        rows.append({
            "doctype": dt,
            "module": dt_modules.get(dt, "Other"),
            "role1_perms": {r: int(bool(p1.get(r, 0))) if r not in SUBMITTABLE_ONLY or is_sub else "na" for r in MATRIX_RIGHTS},
            "role2_perms": {r: int(bool(p2.get(r, 0))) if r not in SUBMITTABLE_ONLY or is_sub else "na" for r in MATRIX_RIGHTS},
            "diff": diff,
            "has_diff": has_diff,
        })

    return {
        "role1": role1,
        "role2": role2,
        "rows": rows,
        "total": len(rows),
        "diff_count": sum(1 for r in rows if r["has_diff"]),
        "only_in_role1": sum(1 for r in rows if any(v == "only_1" for v in r["diff"].values())),
        "only_in_role2": sum(1 for r in rows if any(v == "only_2" for v in r["diff"].values())),
    }


def _role_perms_flat(role: str) -> dict:
    """Flatten role permissions into {doctype: {ptype: 0/1}}."""
    all_perms = get_all_perms(role)
    result: dict = {}
    for p in all_perms:
        dt = p.parent
        if not dt:
            continue
        result.setdefault(dt, {})
        for r in MATRIX_RIGHTS:
            if p.get(r):
                result[dt][r] = 1
            elif r not in result[dt]:
                result[dt][r] = 0
    return result


# ─── 3. Permission Health Dashboard ──────────────────────────────────────────

@frappe.whitelist()
def get_permission_health() -> dict:
    """
    System-wide permission health statistics:
    custom overrides, orphan records, over-privileged users, empty roles.
    """
    _check_access()

    # Custom DocPerm stats
    custom_count = frappe.db.count("Custom DocPerm")
    custom_dt_count = len(frappe.get_all("Custom DocPerm", pluck="parent", distinct=True))

    # System Manager count
    sm_users = frappe.get_all(
        "Has Role",
        filters={"role": "System Manager", "parenttype": "User"},
        pluck="parent",
    )
    sm_count = len(sm_users)

    # Users with no desk roles (besides 'All')
    system_users = frappe.get_all(
        "User",
        filters={"enabled": 1, "user_type": "System User", "name": ["!=", "Administrator"]},
        pluck="name",
    )
    users_no_roles = []
    for user in system_users:
        roles = set(frappe.get_roles(user)) - {"All", "Guest"}
        if not roles:
            users_no_roles.append(user)

    # Roles with no assigned users
    desk_roles = frappe.get_all(
        "Role",
        filters={"disabled": 0, "desk_access": 1, "name": ["not in", ["System Manager", "Administrator", "All", "Guest"]]},
        pluck="name",
    )
    roles_no_users = [
        role for role in desk_roles
        if not frappe.db.count("Has Role", {"role": role, "parenttype": "User"})
    ]

    # Sensitive DocTypes with custom perms
    sensitive_with_custom = [
        dt for dt in _SENSITIVE_DOCTYPES
        if frappe.db.exists("Custom DocPerm", {"parent": dt})
    ]

    # Orphan Custom DocPerm (role no longer exists)
    all_custom_roles = frappe.get_all("Custom DocPerm", pluck="role", distinct=True)
    orphan_role_perms = [r for r in all_custom_roles if not frappe.db.exists("Role", r)]

    # Users with more than N roles (potential over-privilege)
    role_counts = frappe.db.sql("""
        SELECT parent as user, COUNT(*) as role_count
        FROM `tabHas Role`
        WHERE parenttype='User' AND role != 'All'
        GROUP BY parent
        HAVING COUNT(*) > 10
        ORDER BY role_count DESC
        LIMIT 10
    """, as_dict=True)

    return {
        "custom_perm_count": custom_count,
        "custom_perm_doctypes": custom_dt_count,
        "system_manager_count": sm_count,
        "system_manager_users": sm_users[:20],
        "users_no_roles": users_no_roles[:20],
        "users_no_roles_count": len(users_no_roles),
        "roles_no_users": roles_no_users[:30],
        "roles_no_users_count": len(roles_no_users),
        "sensitive_with_custom": sensitive_with_custom,
        "orphan_role_perms": orphan_role_perms,
        "over_privileged_users": role_counts,
    }


# ─── 4. Bulk Role Apply ───────────────────────────────────────────────────────

@frappe.whitelist()
def bulk_apply_role_permissions(doctypes: str, role: str, permissions: str) -> dict:
    """
    Apply a fixed set of permission bits for a role across multiple DocTypes.

    Args:
        doctypes:    JSON list of DocType names
        role:        Role name
        permissions: JSON dict {ptype: 0|1}  e.g. {"read":1,"write":0,"print":1}

    Returns:
        {"success": [...], "failed": [...]}
    """
    _check_access()

    doctypes_list = frappe.parse_json(doctypes)
    perms_dict = frappe.parse_json(permissions)

    if not frappe.db.exists("Role", role):
        frappe.throw(_("Role '{0}' does not exist.").format(role))

    allowed_keys = set(MATRIX_RIGHTS) | {"if_owner"}
    invalid_ptypes = [p for p in perms_dict if p not in allowed_keys]
    if invalid_ptypes:
        frappe.throw(_("Invalid permission types: {0}").format(", ".join(invalid_ptypes)))

    success, failed = [], []

    for doctype in doctypes_list:
        try:
            if not frappe.db.exists("DocType", doctype):
                raise ValueError(f"DocType '{doctype}' does not exist.")

            # Ensure custom perms exist
            if not frappe.db.exists("Custom DocPerm", {"parent": doctype}):
                init_custom_perms(doctype)

            row_name = frappe.db.get_value(
                "Custom DocPerm",
                {"parent": doctype, "role": role, "permlevel": 0},
                "name",
            )

            if not row_name:
                # Auto-create the row for this role
                new_row = frappe.get_doc({
                    "doctype": "Custom DocPerm",
                    "parent": doctype,
                    "parenttype": "DocType",
                    "parentfield": "permissions",
                    "role": role,
                    "permlevel": 0,
                    "if_owner": 0,
                    **{r: 0 for r in MATRIX_RIGHTS},
                })
                new_row.insert(ignore_permissions=True)
                row_name = new_row.name

            for ptype, value in perms_dict.items():
                frappe.db.set_value("Custom DocPerm", row_name, ptype, int(value))

            frappe.clear_cache(doctype=doctype)
            success.append(doctype)

        except Exception as exc:
            failed.append({"doctype": doctype, "error": str(exc)})
            frappe.log_error(title=f"Bulk apply failed for {doctype}", message=str(exc))

    return {"success": success, "failed": failed, "total": len(doctypes_list)}


# ─── 5. CSV Export ───────────────────────────────────────────────────────────

@frappe.whitelist()
def export_matrix_csv(data_type: str, identifier: str, module: str = None) -> dict:
    """
    Export a permission matrix as a CSV string.

    Args:
        data_type:  "user" | "doctype" | "role"
        identifier: user email / doctype name / role name
        module:     (optional) module filter for user export

    Returns:
        { "csv": "...", "filename": "permissions_user_john_20260517.csv" }
    """
    _check_access()

    ts = frappe.utils.now_datetime().strftime("%Y%m%d_%H%M%S")
    safe_id = identifier.replace(" ", "_").replace("@", "_").replace(".", "_")

    output = io.StringIO()
    writer = csv.writer(output)

    if data_type == "user":
        data = get_user_matrix(identifier, module)
        writer.writerow(["User", identifier])
        writer.writerow(["Role Profile", data.get("role_profile") or ""])
        writer.writerow(["Roles", ", ".join(data.get("roles", []))])
        writer.writerow([])
        writer.writerow(["DocType", "Module"] + MATRIX_RIGHTS)
        for row in data["matrix"]:
            writer.writerow(
                [row["doctype"], row["module"]]
                + [row["permissions"].get(r, "na") for r in MATRIX_RIGHTS]
            )

    elif data_type == "doctype":
        data = get_doctype_matrix(identifier)
        writer.writerow(["DocType", identifier])
        writer.writerow(["Module", data.get("module", "")])
        writer.writerow(["Permission Source", "Custom" if data["is_custom"] else "Standard"])
        writer.writerow([])
        writer.writerow(["Role", "Level", "If Owner"] + MATRIX_RIGHTS)
        for row in data["roles"]:
            writer.writerow(
                [row["role"], row["permlevel"], "Yes" if row["if_owner"] else "No"]
                + [row["permissions"].get(r, "na") for r in MATRIX_RIGHTS]
            )

    elif data_type == "role":
        data = get_role_matrix(identifier)
        writer.writerow(["Role", identifier])
        writer.writerow(["User Count", data.get("user_count", 0)])
        writer.writerow([])
        writer.writerow(["Module", "DocType", "Source"] + MATRIX_RIGHTS)
        for mod in data["modules"]:
            for dt in mod["doctypes"]:
                writer.writerow(
                    [mod["module"], dt["doctype"], dt["source"]]
                    + [dt["permissions"].get(r, "na") for r in MATRIX_RIGHTS]
                )

    elif data_type == "comparison":
        # identifier is "role1||role2"
        role1, role2 = identifier.split("||", 1)
        data = compare_roles(role1, role2)
        writer.writerow(["Role 1", role1, "Role 2", role2])
        writer.writerow(["DocType", "Module", "Diff?"]
                        + [f"{r} ({role1})" for r in MATRIX_RIGHTS]
                        + [f"{r} ({role2})" for r in MATRIX_RIGHTS])
        for row in data["rows"]:
            writer.writerow(
                [row["doctype"], row["module"], "Yes" if row["has_diff"] else "No"]
                + [row["role1_perms"].get(r, "na") for r in MATRIX_RIGHTS]
                + [row["role2_perms"].get(r, "na") for r in MATRIX_RIGHTS]
            )

    else:
        frappe.throw(_("Invalid data_type: {0}").format(data_type))

    return {
        "csv": output.getvalue(),
        "filename": f"permissions_{data_type}_{safe_id}_{ts}.csv",
    }


# ─── 6. Test-as-User Access Simulation ───────────────────────────────────────

@frappe.whitelist()
def simulate_user_access(user: str) -> dict:
    """
    Simulate what a user can access.
    Returns: accessible modules, per-module DocType counts (read/write/create),
    and key access flags for sensitive DocTypes.
    """
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    from frappe.permissions import get_roles, get_valid_perms

    roles = get_roles(user, with_standard=True)
    all_perms = get_valid_perms(user=user)
    submittable_set = set(frappe.get_all("DocType", filters={"is_submittable": 1}, pluck="name"))

    # Build perm lookup
    perm_by_dt: dict = {}
    for p in all_perms:
        perm_by_dt.setdefault(p.parent, []).append(p)

    doctype_list = _get_all_doctypes()

    module_summary: dict = {}
    sensitive_access: list = []

    for dt_info in doctype_list:
        dt = dt_info["name"]
        mod = dt_info["module"] or "Other"
        is_sub = dt in submittable_set
        perms = perm_by_dt.get(dt, [])

        can_read = can_write = can_create = can_delete = can_submit = False
        for p in perms:
            if p.role not in roles or p.permlevel != 0 or p.get("if_owner"):
                continue
            if p.get("read"):
                can_read = True
            if p.get("write"):
                can_write = True
            if p.get("create"):
                can_create = True
            if p.get("delete"):
                can_delete = True
            if p.get("submit"):
                can_submit = True

        if not can_read:
            continue

        module_summary.setdefault(mod, {"read": 0, "write": 0, "create": 0, "delete": 0, "doctypes": []})
        module_summary[mod]["read"] += 1
        if can_write:
            module_summary[mod]["write"] += 1
        if can_create:
            module_summary[mod]["create"] += 1
        if can_delete:
            module_summary[mod]["delete"] += 1
        module_summary[mod]["doctypes"].append(dt)

        if dt in _SENSITIVE_DOCTYPES:
            sensitive_access.append({
                "doctype": dt,
                "read": can_read,
                "write": can_write,
                "create": can_create,
                "delete": can_delete,
                "submit": can_submit,
            })

    # Sort modules by readable count desc
    modules = [
        {"module": mod, **counts}
        for mod, counts in sorted(module_summary.items(), key=lambda x: -x[1]["read"])
    ]

    # User details
    user_info = frappe.db.get_value(
        "User", user, ["full_name", "email", "user_image", "last_login"], as_dict=True
    )

    return {
        "user": user,
        "full_name": user_info.full_name,
        "email": user_info.email,
        "user_image": user_info.user_image,
        "last_login": str(user_info.last_login) if user_info.last_login else None,
        "roles": sorted(roles),
        "total_accessible_doctypes": sum(m["read"] for m in modules),
        "total_modules": len(modules),
        "modules": modules,
        "sensitive_access": sensitive_access,
    }
