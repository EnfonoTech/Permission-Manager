"""
Permission Manager — Quick Tools API
Author: siva <siva@enfono.com>

Backend for Permission Studio's Quick Tools panel:
  - Role management (add / remove without opening User form)
  - Issue scanner (common permission problems with auto-fix suggestions)
  - Copy roles from another user
  - Clear all custom perms for a user/doctype
"""

import json

import frappe
from frappe import _


# ─── Role Management ──────────────────────────────────────────────────────────

@frappe.whitelist()
def get_user_roles(user: str) -> list:
    """Return current roles for a user with metadata."""
    frappe.only_for("System Manager")
    base_roles = {"All", "Desk User", "Guest"}
    roles = frappe.get_all(
        "Has Role",
        filters={"parent": user, "parenttype": "User"},
        fields=["role"],
        order_by="role asc",
    )
    return [
        {
            "role": r.role,
            "is_custom": r.role not in base_roles,
        }
        for r in roles
    ]


@frappe.whitelist()
def update_user_roles(user: str, add_roles: str, remove_roles: str) -> dict:
    """Add or remove roles for a user."""
    frappe.only_for("System Manager")
    add_roles   = json.loads(add_roles)
    remove_roles = json.loads(remove_roles)

    doc = frappe.get_doc("User", user)

    existing = {r.role for r in doc.roles}

    for role in add_roles:
        if role not in existing:
            doc.append("roles", {"role": role})

    doc.roles = [r for r in doc.roles if r.role not in remove_roles]
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def copy_roles_from_user(target_user: str, source_user: str) -> dict:
    """Copy all non-base roles from source_user to target_user."""
    frappe.only_for("System Manager")
    base_roles = {"All", "Desk User", "Guest"}

    source_roles = {
        r.role for r in frappe.get_all(
            "Has Role",
            filters={"parent": source_user, "parenttype": "User"},
            fields=["role"],
        )
        if r.role not in base_roles
    }
    if not source_roles:
        return {"msg": _("Source user has no custom roles to copy.")}

    doc = frappe.get_doc("User", target_user)
    existing = {r.role for r in doc.roles}
    added = []
    for role in source_roles:
        if role not in existing:
            doc.append("roles", {"role": role})
            added.append(role)
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"msg": _("Copied {0} role(s): {1}").format(len(added), ", ".join(added))}


# ─── Issue Scanner ────────────────────────────────────────────────────────────

@frappe.whitelist()
def find_user_issues(user: str) -> list:
    """
    Scan for common permission problems for this user.
    Returns a list of issues with severity, description, and optional auto-fix.

    severity: "error" | "warning" | "info"
    fix_type: key passed to apply_quick_fix
    fix_label: button label shown next to the issue
    fix_data: JSON-serialisable dict passed to apply_quick_fix
    """
    frappe.only_for("System Manager")
    issues = []

    roles = {r.role for r in frappe.get_all(
        "Has Role", filters={"parent": user, "parenttype": "User"}, fields=["role"]
    )}

    # ── No roles at all ───────────────────────────────────────────────────────
    if not roles or roles == {"All"} or roles == {"All", "Guest"}:
        issues.append({
            "severity": "error",
            "title": _("User has no functional roles"),
            "description": _("This user can log in but has no role-based permissions. "
                             "They will see a blank desk."),
            "fix_label": _("Assign Desk User"),
            "fix_type":  "add_role",
            "fix_data":  {"role": "Desk User"},
        })

    # ── Guest role assigned ────────────────────────────────────────────────────
    if "Guest" in roles:
        issues.append({
            "severity": "warning",
            "title": _("Guest role is assigned"),
            "description": _("The Guest role grants public (unauthenticated) access. "
                             "Assigning it to a named user is almost never intentional."),
            "fix_label": _("Remove Guest Role"),
            "fix_type":  "remove_role",
            "fix_data":  {"role": "Guest"},
        })

    # ── System Manager + other roles — redundant ──────────────────────────────
    if "System Manager" in roles and len(roles) > 3:
        others = [r for r in roles if r not in {"System Manager", "All", "Desk User", "Guest"}]
        if others:
            issues.append({
                "severity": "info",
                "title": _("Redundant roles alongside System Manager"),
                "description": _(
                    "System Manager already has full access. The additional roles {0} are redundant "
                    "and add noise to the permission matrix."
                ).format(", ".join(others[:5])),
                "fix_label": None,
                "fix_type":  None,
                "fix_data":  {},
            })

    # ── User Permissions that might be too restrictive ────────────────────────
    user_perms = frappe.get_all(
        "User Permission",
        filters={"user": user},
        fields=["allow", "for_value", "apply_to_all_doctypes"],
    )
    if len(user_perms) > 20:
        issues.append({
            "severity": "warning",
            "title": _("Too many User Permission restrictions ({0})").format(len(user_perms)),
            "description": _(
                "Large numbers of User Permissions slow down every list query. "
                "Consider consolidating via roles or removing stale entries."
            ),
            "fix_label": None,
            "fix_type":  None,
            "fix_data":  {},
        })

    # ── Duplicate User Permissions ─────────────────────────────────────────────
    seen = {}
    duplicates = []
    for up in user_perms:
        key = (up.allow, up.for_value)
        if key in seen:
            duplicates.append(up)
        else:
            seen[key] = True
    if duplicates:
        issues.append({
            "severity": "warning",
            "title": _("Duplicate User Permissions ({0})").format(len(duplicates)),
            "description": _(
                "Multiple restrictions exist for the same DocType + value combination. "
                "Only one is needed; duplicates waste query cycles."
            ),
            "fix_label": _("Remove Duplicates"),
            "fix_type":  "remove_duplicate_user_perms",
            "fix_data":  {"user": user},
        })

    # ── Custom DocPerms that deny more than standard role grants ──────────────
    custom_perms = frappe.get_all(
        "Custom DocPerm",
        filters={"role": ["in", list(roles)]},
        fields=["parent as doctype", "role", "read", "write", "create"],
    )
    over_restricted = [
        p for p in custom_perms
        if not p.read and not p.write and not p.create
    ]
    if over_restricted:
        issues.append({
            "severity": "warning",
            "title": _("Custom DocPerms with no permissions ({0} rows)").format(len(over_restricted)),
            "description": _(
                "Some Custom DocPerm rows grant zero permissions (read=0, write=0, create=0). "
                "These effectively block access for the role on those DocTypes."
            ),
            "fix_label": None,
            "fix_type":  None,
            "fix_data":  {},
        })

    # ── User is disabled ──────────────────────────────────────────────────────
    enabled = frappe.db.get_value("User", user, "enabled")
    if not enabled:
        issues.append({
            "severity": "error",
            "title": _("User account is disabled"),
            "description": _("This user cannot log in. Enable the account to restore access."),
            "fix_label": _("Enable User"),
            "fix_type":  "enable_user",
            "fix_data":  {},
        })

    return issues


# ─── Quick Fixes ──────────────────────────────────────────────────────────────

@frappe.whitelist()
def apply_quick_fix(user: str, fix_type: str, fix_data: str) -> dict:
    """Apply a suggested fix returned by find_user_issues."""
    frappe.only_for("System Manager")
    fix_data = json.loads(fix_data) if isinstance(fix_data, str) else fix_data

    if fix_type == "add_role":
        role = fix_data["role"]
        doc = frappe.get_doc("User", user)
        if not any(r.role == role for r in doc.roles):
            doc.append("roles", {"role": role})
            doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"msg": _("Role '{0}' added.").format(role)}

    if fix_type == "remove_role":
        role = fix_data["role"]
        doc = frappe.get_doc("User", user)
        doc.roles = [r for r in doc.roles if r.role != role]
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"msg": _("Role '{0}' removed.").format(role)}

    if fix_type == "enable_user":
        frappe.db.set_value("User", user, "enabled", 1)
        frappe.db.commit()
        return {"msg": _("User '{0}' enabled.").format(user)}

    if fix_type == "remove_duplicate_user_perms":
        user_perms = frappe.get_all(
            "User Permission",
            filters={"user": user},
            fields=["name", "allow", "for_value"],
        )
        seen = {}
        removed = 0
        for up in user_perms:
            key = (up.allow, up.for_value)
            if key in seen:
                frappe.delete_doc("User Permission", up.name, ignore_permissions=True)
                removed += 1
            else:
                seen[key] = True
        frappe.db.commit()
        return {"msg": _("{0} duplicate User Permission(s) removed.").format(removed)}

    frappe.throw(_("Unknown fix type: {0}").format(fix_type))


# ─── Clear Custom Perms ───────────────────────────────────────────────────────

@frappe.whitelist()
def clear_custom_perms_for_user(user: str) -> dict:
    """
    Remove all Custom DocPerm rows for roles belonging to this user.
    Resets those roles to standard (stock) permissions.
    """
    frappe.only_for("System Manager")

    roles = [
        r.role for r in frappe.get_all(
            "Has Role", filters={"parent": user, "parenttype": "User"}, fields=["role"]
        )
        if r.role not in {"All", "Guest", "Desk User"}
    ]

    if not roles:
        return {"msg": _("No custom roles found for this user.")}

    custom_perms = frappe.get_all(
        "Custom DocPerm",
        filters={"role": ["in", roles]},
        pluck="name",
    )

    for name in custom_perms:
        frappe.delete_doc("Custom DocPerm", name, ignore_permissions=True)

    frappe.db.commit()
    frappe.clear_cache()
    return {"msg": _("Cleared {0} Custom DocPerm row(s) for {1} role(s).").format(
        len(custom_perms), len(roles)
    )}
