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
import time

import frappe
from frappe import _

# A role change for a user who holds a Role Profile cannot be a plain Has Role edit: User.validate
# re-applies the profile on EVERY save (populate_role_profile_roles clears the roles table and
# refills it from the profile), so a row added straight to the user is silently dropped, and a row
# removed that the profile still carries comes straight back. The change has to go through the
# profile, and a profile that other users hold must not be edited for one person.
_PERSONAL_PROFILE_PREFIX = "PM_UserRoles_"
# Profiles that exist for ONE user (made here, or by the Permission Studio override): edited in
# place when that user is their only holder.
_OWN_PROFILE_PREFIXES = (_PERSONAL_PROFILE_PREFIX, "PM_Profile_")
# Role Profile.on_update queues update_all_users and locks the profile until a worker has run it;
# a second save inside that window raises DocumentLockedError, so wait for it instead.
_LOCK_WAIT_SECONDS = 6


# ─── Role Management ──────────────────────────────────────────────────────────

def _wait_until_unlocked(profile_doc):
    if profile_doc.is_new():
        return
    for _i in range(_LOCK_WAIT_SECONDS):
        if not profile_doc.is_locked:
            return
        time.sleep(1)
    frappe.throw(
        _("Role Profile {0} is still refreshing from your previous change. "
          "Wait a few seconds and try again.").format(profile_doc.name)
    )


def _change_user_roles(user: str, add_roles: list, remove_roles: list) -> dict:
    """Add / remove roles on a user so the change is still there after the save.

    No Role Profile  -> edit the user's roles table.
    Role Profile     -> the roles go onto a profile. A profile only this user holds (a personal
                        PM_UserRoles_<user> / PM_Profile_<user>) is edited in place; any other
                        profile is left alone and the user is moved to a personal copy that carries
                        the profile's roles plus the change, so the users who share it are untouched.

    The result is read back from the database; if the change did not stick the whole thing is rolled
    back and the caller is told, instead of reporting success for a role that is not there.
    """
    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    remove = set(remove_roles)
    add_roles = [r for r in dict.fromkeys(add_roles) if r not in remove]
    for role in add_roles:
        if not frappe.db.exists("Role", role):
            frappe.throw(_("Role {0} does not exist.").format(role))

    doc = frappe.get_doc("User", user)
    before = [r.role for r in doc.roles]
    profile = doc.role_profile_name
    touched = []
    note = ""
    profile_used = profile

    try:
        if not profile:
            doc.roles = [r for r in doc.roles if r.role not in remove]
            for role in add_roles:
                if role not in before:
                    doc.append("roles", {"role": role})
            doc.save(ignore_permissions=True)
        else:
            profile_doc = frappe.get_doc("Role Profile", profile)
            profile_roles = [r.role for r in profile_doc.roles]
            carried = list(dict.fromkeys(profile_roles + before))
            wanted = [r for r in carried if r not in remove]
            wanted += [r for r in add_roles if r not in wanted]

            if set(wanted) == set(profile_roles):
                return _role_result(user, profile, added=[], removed=[], note="")

            holders = frappe.db.count("User", {"role_profile_name": profile})
            if holders == 1 and profile.startswith(_OWN_PROFILE_PREFIXES):
                target = profile_doc
                note = _("Saved on Role Profile {0}, which only {1} uses.").format(profile, user)
            else:
                personal = (_PERSONAL_PROFILE_PREFIX + user)[:140]
                if frappe.db.exists("Role Profile", personal):
                    if frappe.db.count("User", {"role_profile_name": personal, "name": ["!=", user]}):
                        frappe.throw(
                            _("Role Profile {0} is held by another user; cannot use it as a "
                              "personal profile for {1}.").format(personal, user)
                        )
                    target = frappe.get_doc("Role Profile", personal)
                else:
                    target = frappe.new_doc("Role Profile")
                    target.role_profile = personal
                if holders > 1:
                    note = _(
                        "{0} shares Role Profile {1} with {2} other user(s), so the roles were saved on "
                        "a personal profile, {3}. The other users are not affected."
                    ).format(user, profile, holders - 1, personal)
                else:
                    note = _(
                        "Role Profile {0} was left as it is; the roles were saved on a personal "
                        "profile, {1}."
                    ).format(profile, personal)

            _wait_until_unlocked(target)
            target.set("roles", [])
            for role in wanted:
                target.append("roles", {"role": role})
            touched.append(target)
            target.save(ignore_permissions=True)

            # Saving the profile queues update_all_users, which re-saves the profile's holders (inline
            # in tests / install), so the User loaded above may already be stale: read it again.
            doc = frappe.get_doc("User", user)
            doc.role_profile_name = target.name
            doc.save(ignore_permissions=True)  # validate re-applies the profile onto the user
            profile_used = target.name

        now = set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"))
        missing = [r for r in add_roles if r not in now]
        lingering = [r for r in remove if r in now]
        if missing or lingering:
            frappe.throw(
                _("The role change did not stick for {0} (missing: {1}; still present: {2}). "
                  "Nothing was changed.").format(user, ", ".join(missing) or "-", ", ".join(lingering) or "-")
            )
    except Exception:
        frappe.db.rollback()
        # a rolled-back save leaves the profile's file lock behind; free it so the retry is not refused
        for locked in touched:
            try:
                locked.unlock()
            except Exception:
                pass
        raise

    frappe.db.commit()
    return _role_result(
        user, profile_used,
        added=[r for r in add_roles if r not in before],
        removed=[r for r in remove if r in before],
        note=note,
    )


def _role_result(user: str, profile, added: list, removed: list, note: str) -> dict:
    roles = sorted(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"))
    return {
        "success": True,
        "roles": roles,
        "profile": profile,
        "added": added,
        "removed": removed,
        "note": note,
    }


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
    """Add or remove roles for a user. Goes through the user's Role Profile when they hold one
    (see _change_user_roles); returns the roles the user really has afterwards."""
    frappe.only_for("System Manager")
    return _change_user_roles(
        user,
        frappe.parse_json(add_roles) or [],
        frappe.parse_json(remove_roles) or [],
    )


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

    result = _change_user_roles(target_user, sorted(source_roles), [])
    added = result["added"]
    msg = _("Copied {0} role(s): {1}").format(len(added), ", ".join(added))
    if added and result["note"]:
        msg = f"{msg}. {result['note']}"
    return {"msg": msg, "roles": result["roles"]}


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
        result = _change_user_roles(user, [role], [])
        msg = _("Role '{0}' added.").format(role)
        return {"msg": f"{msg} {result['note']}" if result["note"] else msg}

    if fix_type == "remove_role":
        role = fix_data["role"]
        result = _change_user_roles(user, [], [role])
        msg = _("Role '{0}' removed.").format(role)
        return {"msg": f"{msg} {result['note']}" if result["note"] else msg}

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
