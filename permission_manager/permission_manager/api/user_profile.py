"""
Permission Manager — Role Profile Matrix & User Override APIs
Author: siva <siva@enfono.com>

Provides:
  - Role Profile matrix view  (aggregate perms across all roles in a profile)
  - User-specific override    (ADD extra permissions  OR  RESTRICT permissions)
  - Account restrictions      (User Permission management for the Account doctype)

Override Modes
--------------
"add"      : Creates PM_Extra_{user} role with the EXTRA permissions the user needs
             beyond their current roles.  Override profile = original roles + extra role.

"restrict" : Takes a FULL SNAPSHOT of the user's effective permissions across every
             DocType, then applies your restriction on top.  Creates PM_Base_{user}
             with all those permissions as Custom DocPerms.  Override profile contains
             ONLY PM_Base_{user} — original roles are excluded so nothing can "win back"
             the restricted permission.

Why "restrict" can't just add a read-only role
-----------------------------------------------
Frappe permissions are purely additive.  If Accounts User grants create on Sales Invoice
and you add a read-only role, the union still gives create.  The ONLY way to restrict
a specific user is to remove the role that grants the permission, which is achieved here
by replacing all original roles with a single snapshot role that already has the correct
(restricted) permissions baked in.
"""

import frappe
from frappe import _
from frappe.permissions import get_all_perms, get_doctypes_with_custom_docperms

from .matrix import (
    MATRIX_RIGHTS,
    SUBMITTABLE_ONLY,
    init_custom_perms,
)

_PM_EXTRA_PREFIX  = "PM_Extra_"
_PM_BASE_PREFIX   = "PM_Base_"
_PM_PROFILE_PREFIX = "PM_Profile_"


def _check_access():
    if "System Manager" not in frappe.get_roles():
        frappe.throw(
            _("Permission Studio is only accessible to System Managers."),
            frappe.PermissionError,
        )


def _safe_user_name(user: str) -> str:
    cleaned = user.replace("@", "_").replace(".", "_").replace("-", "_")
    return frappe.scrub(cleaned)[:25]


# ─── 1. Role Profile Matrix ───────────────────────────────────────────────────

@frappe.whitelist()
def get_role_profile_matrix(profile: str) -> dict:
    """Aggregate permission matrix for all roles inside a Role Profile."""
    _check_access()

    if not frappe.db.exists("Role Profile", profile):
        frappe.throw(_("Role Profile '{0}' does not exist.").format(profile))

    profile_doc = frappe.get_doc("Role Profile", profile)
    roles = [r.role for r in profile_doc.roles]
    user_count = frappe.db.count("User", {"role_profile_name": profile, "enabled": 1})

    submittable_set = set(frappe.get_all("DocType", filters={"is_submittable": 1}, pluck="name"))
    custom_doctypes = get_doctypes_with_custom_docperms()

    dt_perms: dict = {}
    for role in roles:
        for p in get_all_perms(role):
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
        for p in dt_data["perms"]:
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
        "profile": profile,
        "roles": roles,
        "user_count": user_count,
        "total_doctypes": sum(len(m["doctypes"]) for m in modules),
        "modules": modules,
    }


# ─── 2. User Override ─────────────────────────────────────────────────────────

@frappe.whitelist()
def get_user_override_status(user: str) -> dict:
    """Return override metadata for a user — used to show the active-override badge."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    safe   = _safe_user_name(user)
    base_r = f"{_PM_BASE_PREFIX}{safe}"
    ext_r  = f"{_PM_EXTRA_PREFIX}{safe}"
    p_name = f"{_PM_PROFILE_PREFIX}{safe}"

    current_profile = frappe.db.get_value("User", user, "role_profile_name")
    has_base    = bool(frappe.db.exists("Role", base_r))
    has_extra   = bool(frappe.db.exists("Role", ext_r))
    has_profile = bool(frappe.db.exists("Role Profile", p_name))
    is_active   = current_profile == p_name

    # Determine mode from which role was created
    mode = "restrict" if has_base else ("add" if has_extra else None)

    # Load only the EXPLICITLY overridden items (stored as a site default key)
    override_perms = []
    if has_base or has_extra:
        stored = frappe.db.get_default(f"pm_override_{safe}") or ""
        if stored:
            try:
                override_perms = frappe.parse_json(stored)
            except Exception:
                override_perms = []

    return {
        "has_override":         has_base or has_extra or has_profile,
        "is_active":            is_active,
        "mode":                 mode,
        "base_role":            base_r  if has_base    else None,
        "extra_role":           ext_r   if has_extra   else None,
        "profile_name":         p_name  if has_profile else None,
        "current_profile":      current_profile,
        "override_permissions": override_perms,
    }


@frappe.whitelist()
def create_user_override(user: str, override_items: str, mode: str = "add") -> dict:
    """
    Apply a user-specific permission override.

    mode = "add"
        Creates PM_Extra_{user} role with the specified EXTRA permissions,
        adds it to the user's new profile alongside their existing roles.

    mode = "restrict"
        Takes a complete snapshot of the user's effective permissions across
        every DocType, applies your restriction on top of that snapshot, then
        stores everything in PM_Base_{user} (Custom DocPerms for every DocType).
        The override profile contains ONLY this single role so no original role
        can resurrect the restricted permission via additive union.

    Args:
        user:           User e-mail / name
        override_items: JSON list of {"doctype": "…", "permissions": {ptype: 0|1}}
        mode:           "add" | "restrict"
    """
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))
    if mode not in ("add", "restrict"):
        frappe.throw(_("Invalid mode '{0}'. Use 'add' or 'restrict'.").format(mode))

    items = frappe.parse_json(override_items)
    if not items:
        frappe.throw(_("No override items provided."))

    for item in items:
        if not frappe.db.exists("DocType", item.get("doctype")):
            frappe.throw(_("DocType '{0}' does not exist.").format(item.get("doctype")))

    safe   = _safe_user_name(user)
    p_name = f"{_PM_PROFILE_PREFIX}{safe}"

    # ── Snapshot original roles BEFORE first override (restore target on removal) ─
    import json as _json
    pm_orig_key = f"pm_original_{safe}"
    if not frappe.db.get_default(pm_orig_key):
        orig_doc = frappe.get_doc("User", user)
        base_set = {"All", "Guest"}
        frappe.db.set_default(pm_orig_key, _json.dumps({
            "role_profile_name": orig_doc.role_profile_name or "",
            "roles": [r.role for r in orig_doc.roles if r.role not in base_set],
        }))

    # ── Clean up whichever role from the opposite mode might already exist ─────
    _cleanup_role(f"{_PM_BASE_PREFIX}{safe}")
    _cleanup_role(f"{_PM_EXTRA_PREFIX}{safe}")

    user_doc = frappe.get_doc("User", user)

    if mode == "add":
        role_name, profile_roles = _apply_add_override(user_doc, safe, items)
    else:
        role_name, profile_roles = _apply_restrict_override(user_doc, safe, items)

    # ── Create / update the override Role Profile ──────────────────────────────
    if frappe.db.exists("Role Profile", p_name):
        prof = frappe.get_doc("Role Profile", p_name)
        prof.roles = []
    else:
        prof = frappe.new_doc("Role Profile")
        prof.role_profile = p_name

    for r in profile_roles:
        if frappe.db.exists("Role", r):
            prof.append("roles", {"role": r})

    prof.save(ignore_permissions=True)

    # ── Persist explicit override items as a site default key (for re-opening dialog) ──
    import json as _json
    frappe.db.set_default(
        f"pm_override_{safe}",
        _json.dumps([
            {"doctype": i["doctype"], "permissions": i.get("permissions", {})}
            for i in items
        ]),
    )

    # ── Assign profile to user and sync roles table ────────────────────────────
    base_roles = {"All", "Guest"}
    user_doc.role_profile_name = p_name
    user_doc.roles = [r for r in user_doc.roles if r.role in base_roles]
    for r in profile_roles:
        user_doc.append("roles", {"role": r})
    user_doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "success":       True,
        "mode":          mode,
        "role_name":     role_name,
        "profile_name":  p_name,
        "roles_included": profile_roles,
        "msg": _("{0} override profile '{1}' created and assigned to {2}.").format(
            mode.capitalize(), p_name, user
        ),
    }


def _apply_add_override(user_doc, safe: str, items: list) -> tuple:
    """
    ADD mode: create PM_Extra_{user} with the extra permissions.
    Profile = existing roles + extra role.
    """
    ext_r = f"{_PM_EXTRA_PREFIX}{safe}"
    base_roles = {"All", "Guest"}
    p_name = f"{_PM_PROFILE_PREFIX}{safe}"

    # Create the extra role
    if not frappe.db.exists("Role", ext_r):
        frappe.get_doc({"doctype": "Role", "role_name": ext_r, "desk_access": 1}).insert(
            ignore_permissions=True
        )

    # Write Custom DocPerms for the extra items
    for item in items:
        dt    = item["doctype"]
        perms = item.get("permissions", {})
        if not frappe.db.exists("Custom DocPerm", {"parent": dt}):
            init_custom_perms(dt)

        # Remove any existing row for this role on this dt first
        old = frappe.db.get_value(
            "Custom DocPerm", {"parent": dt, "role": ext_r, "permlevel": 0}, "name"
        )
        if old:
            frappe.delete_doc("Custom DocPerm", old, ignore_permissions=True)

        frappe.get_doc({
            "doctype":     "Custom DocPerm",
            "parent":      dt,
            "parenttype":  "DocType",
            "parentfield": "permissions",
            "role":        ext_r,
            "permlevel":   0,
            "if_owner":    0,
            **{r: int(bool(perms.get(r, 0))) for r in MATRIX_RIGHTS},
        }).insert(ignore_permissions=True)
        frappe.clear_cache(doctype=dt)

    # Collect existing roles (individual + from current profile if not our override)
    individual = {r.role for r in user_doc.roles if r.role not in base_roles}
    profile_roles_set: set = set()
    cur = user_doc.role_profile_name
    if cur and cur != p_name and frappe.db.exists("Role Profile", cur):
        profile_roles_set = {r.role for r in frappe.get_doc("Role Profile", cur).roles}

    all_roles = sorted((individual | profile_roles_set) - base_roles)
    if ext_r not in all_roles:
        all_roles.append(ext_r)

    return ext_r, all_roles


def _apply_restrict_override(user_doc, safe: str, items: list) -> tuple:
    """
    RESTRICT mode: snapshot the user's full effective permissions,
    apply restrictions on top, write everything into PM_Base_{user}.
    Profile = [PM_Base_{user}] only.
    """
    base_r = f"{_PM_BASE_PREFIX}{safe}"
    base_roles = {"All", "Guest"}

    # ── Build effective permission snapshot for this user ──────────────────────
    individual = {r.role for r in user_doc.roles if r.role not in base_roles}
    profile_roles_set: set = set()
    p_name = f"{_PM_PROFILE_PREFIX}{safe}"
    cur = user_doc.role_profile_name
    if cur and cur != p_name and frappe.db.exists("Role Profile", cur):
        profile_roles_set = {r.role for r in frappe.get_doc("Role Profile", cur).roles}

    all_current_roles = list((individual | profile_roles_set) - base_roles)

    # {doctype: {ptype: 0|1}}
    effective: dict = {}
    submittable_set    = set(frappe.get_all("DocType", filters={"is_submittable": 1}, pluck="name"))
    existing_doctypes  = set(frappe.get_all("DocType", pluck="name"))

    if all_current_roles:
        # DocTypes that have ANY Custom DocPerm — for those, standard DocPerm is ignored
        custom_dt_set = set(
            frappe.get_all("Custom DocPerm", pluck="parent", distinct=True)
        )

        # 1. Custom DocPerm rows for all roles at once
        perm_rows = frappe.get_all(
            "Custom DocPerm",
            filters={"role": ["in", all_current_roles], "permlevel": 0},
            fields=["parent as dt"] + MATRIX_RIGHTS,
        )

        # 2. Standard DocPerm rows for doctypes that have NO Custom DocPerm
        non_custom = list(existing_doctypes - custom_dt_set)
        if non_custom:
            perm_rows += frappe.get_all(
                "DocPerm",
                filters={
                    "role": ["in", all_current_roles],
                    "parent": ["in", non_custom],
                    "permlevel": 0,
                },
                fields=["parent as dt"] + MATRIX_RIGHTS,
            )

        # Union all rows into effective dict
        for p in perm_rows:
            dt = p.get("dt")
            if not dt or dt not in existing_doctypes:
                continue
            effective.setdefault(dt, {})
            is_sub = dt in submittable_set
            for ptype in MATRIX_RIGHTS:
                if ptype in SUBMITTABLE_ONLY and not is_sub:
                    effective[dt][ptype] = effective[dt].get(ptype, "na")
                else:
                    current = effective[dt].get(ptype, 0)
                    if current != "na":
                        effective[dt][ptype] = max(current, int(bool(p.get(ptype, 0))))

    # ── Apply restrictions on top of snapshot ─────────────────────────────────
    for item in items:
        dt    = item["doctype"]
        perms = item.get("permissions", {})
        is_sub = dt in submittable_set
        row: dict = {"if_owner": int(bool(perms.get("if_owner", 0)))}
        for ptype in MATRIX_RIGHTS:
            if ptype in SUBMITTABLE_ONLY and not is_sub:
                row[ptype] = "na"
            else:
                row[ptype] = int(bool(perms.get(ptype, 0)))
        effective[dt] = row

    # ── Create PM_Base_{user} role ─────────────────────────────────────────────
    if not frappe.db.exists("Role", base_r):
        frappe.get_doc({"doctype": "Role", "role_name": base_r, "desk_access": 1}).insert(
            ignore_permissions=True
        )

    # Clear any old Custom DocPerm rows for this base role
    old_names = frappe.get_all("Custom DocPerm", filters={"role": base_r}, pluck="name")
    stale_dts  = frappe.get_all("Custom DocPerm", filters={"role": base_r}, pluck="parent", distinct=True)
    for nm in old_names:
        frappe.delete_doc("Custom DocPerm", nm, ignore_permissions=True)

    # Write one Custom DocPerm row per DocType (only where at least one right is set)
    for dt, perms in effective.items():
        # Skip if no rights at all, or if the DocType no longer exists (stale perms)
        if dt not in existing_doctypes:
            continue
        real_perms = {k: v for k, v in perms.items() if v not in (0, "na")}
        if not real_perms:
            continue

        if not frappe.db.exists("Custom DocPerm", {"parent": dt}):
            init_custom_perms(dt)

        frappe.get_doc({
            "doctype":     "Custom DocPerm",
            "parent":      dt,
            "parenttype":  "DocType",
            "parentfield": "permissions",
            "role":        base_r,
            "permlevel":   0,
            "if_owner":    int(bool(perms.get("if_owner", 0))),
            **{r: (int(bool(v)) if v != "na" else 0) for r, v in perms.items() if r != "if_owner"},
        }).insert(ignore_permissions=True)

    for dt in stale_dts:
        frappe.clear_cache(doctype=dt)
    for dt in effective.keys():
        frappe.clear_cache(doctype=dt)

    return base_r, [base_r]


def _cleanup_role(role_name: str):
    """Delete a PM_* role, its Custom DocPerm rows, and all Has Role references."""
    if not frappe.db.exists("Role", role_name):
        return

    # Collect affected doctypes before deleting
    dts = frappe.get_all("Custom DocPerm", filters={"role": role_name}, pluck="parent", distinct=True)

    # Delete Custom DocPerm rows
    for nm in frappe.get_all("Custom DocPerm", filters={"role": role_name}, pluck="name"):
        frappe.delete_doc("Custom DocPerm", nm, ignore_permissions=True)

    # Remove Has Role references first — without this, Frappe raises LinkExistsError
    # because the Role is still referenced in User.roles child table
    frappe.db.delete("Has Role", {"role": role_name})

    # Delete the Role
    frappe.delete_doc("Role", role_name, ignore_permissions=True)

    for dt in dts:
        frappe.clear_cache(doctype=dt)


@frappe.whitelist()
def remove_user_override(user: str) -> dict:
    """Remove all override roles, profile, and restore a clean state for the user."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    safe   = _safe_user_name(user)
    base_r = f"{_PM_BASE_PREFIX}{safe}"
    ext_r  = f"{_PM_EXTRA_PREFIX}{safe}"
    p_name = f"{_PM_PROFILE_PREFIX}{safe}"

    # ── Fetch original state BEFORE cleanup ───────────────────────────────────
    import json as _json
    pm_orig_key = f"pm_original_{safe}"
    original_json = frappe.db.get_default(pm_orig_key) or ""

    # Clear the override profile assignment first
    cur_profile = frappe.db.get_value("User", user, "role_profile_name")
    if cur_profile == p_name:
        frappe.db.set_value("User", user, "role_profile_name", "")

    # ── Delete PM roles and profile ────────────────────────────────────────────
    user_doc = frappe.get_doc("User", user)
    user_doc.roles = [r for r in user_doc.roles if r.role not in (base_r, ext_r)]
    user_doc.save(ignore_permissions=True)

    _cleanup_role(base_r)
    _cleanup_role(ext_r)

    if frappe.db.exists("Role Profile", p_name):
        frappe.delete_doc("Role Profile", p_name, ignore_permissions=True)

    # ── Restore original roles ─────────────────────────────────────────────────
    base_set = {"All", "Guest"}
    if original_json:
        try:
            original = frappe.parse_json(original_json)
            user_doc = frappe.get_doc("User", user)
            orig_profile = original.get("role_profile_name") or ""
            orig_roles   = original.get("roles") or []

            user_doc.role_profile_name = orig_profile
            user_doc.roles = [r for r in user_doc.roles if r.role in base_set]
            for role in orig_roles:
                if frappe.db.exists("Role", role) and not any(r.role == role for r in user_doc.roles):
                    user_doc.append("roles", {"role": role})
            user_doc.save(ignore_permissions=True)
        except Exception:
            pass  # fallback: user is already in neutral state

    # ── Clean up stored keys ───────────────────────────────────────────────────
    frappe.db.delete("DefaultValue", {"defkey": f"pm_override_{safe}"})
    frappe.db.delete("DefaultValue", {"defkey": pm_orig_key})

    frappe.db.commit()
    return {
        "success": True,
        "msg": _("Override removed for {0}. Original roles and profile have been restored.").format(user),
    }


# ─── 3. DocType dependency analysis ─────────────────────────────────────────

_SKIP_DEP_DTS = {
    "User", "Role", "Module Def", "Print Format", "Letter Head",
    "Currency", "UOM", "Country", "Language", "DocType", "File",
    "Workflow", "Workflow State", "Workflow Action", "Custom Field",
    "Client Script", "Server Script", "Report", "Page",
}


@frappe.whitelist()
def get_doctype_create_deps(doctype: str) -> list:
    """
    Return DocTypes that a user needs READ access to in order to meaningfully
    CREATE a document of the given DocType (based on Link fields in the form
    and its child tables, one level deep).
    Excludes child-table DocTypes, Singles, and system-internal DocTypes.
    """
    _check_access()

    if not frappe.db.exists("DocType", doctype):
        frappe.throw(_("DocType {0} does not exist.").format(doctype))

    linked: set = set()

    def _collect(meta):
        for fld in meta.fields:
            if fld.fieldtype != "Link" or not fld.options:
                continue
            target = fld.options
            if target == doctype or target in _SKIP_DEP_DTS:
                continue
            if not frappe.db.exists("DocType", target):
                continue
            if frappe.db.get_value("DocType", target, "issingle"):
                continue
            linked.add(target)

    meta = frappe.get_meta(doctype)
    _collect(meta)

    for tf in meta.get_table_fields():
        if tf.options:
            try:
                _collect(frappe.get_meta(tf.options))
            except Exception:
                pass

    return sorted(linked)


# ─── 4. Account Restrictions (User Permissions for Account doctype) ───────────

@frappe.whitelist()
def get_user_account_restrictions(user: str) -> dict:
    """
    Return all User Permissions of type 'Account' for a user plus the full
    COA tree (filtered to the user's allowed companies if Company-level User
    Permissions exist).
    """
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    restrictions = frappe.get_all(
        "User Permission",
        filters={"user": user, "allow": "Account"},
        fields=["name", "for_value", "apply_to_all_doctypes"],
        order_by="for_value asc",
    )

    # Check whether the user is restricted to specific companies
    company_restrictions = frappe.get_all(
        "User Permission",
        filters={"user": user, "allow": "Company"},
        pluck="for_value",
    )

    account_filters: dict = {"disabled": 0}
    if company_restrictions:
        account_filters["company"] = ["in", company_restrictions]

    # Fetch full COA tree — lft ordering preserves tree structure
    all_accounts = frappe.get_all(
        "Account",
        filters=account_filters,
        fields=[
            "name", "account_name", "parent_account",
            "is_group", "account_type", "root_type", "company", "lft",
        ],
        order_by="lft asc",
        limit=5000,
    )

    return {
        "user":                user,
        "restrictions":        restrictions,
        "all_accounts":        all_accounts,
        "is_restricted":       bool(restrictions),
        "company_restrictions": company_restrictions,
    }


@frappe.whitelist()
def add_user_account_restriction(user: str, account: str, apply_to_all: int = 0) -> dict:
    """Add a User Permission restricting the user to a specific Account."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User '{0}' does not exist.").format(user))
    if not frappe.db.exists("Account", account):
        frappe.throw(_("Account '{0}' does not exist.").format(account))
    if frappe.db.exists("User Permission", {"user": user, "allow": "Account", "for_value": account}):
        frappe.throw(_("Account '{0}' is already restricted for this user.").format(account))

    doc = frappe.get_doc({
        "doctype":            "User Permission",
        "user":               user,
        "allow":              "Account",
        "for_value":          account,
        "apply_to_all_doctypes": int(apply_to_all),
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"success": True, "name": doc.name}


@frappe.whitelist()
def remove_user_account_restriction(perm_name: str) -> dict:
    """Remove a specific User Permission record."""
    _check_access()

    if not frappe.db.exists("User Permission", perm_name):
        frappe.throw(_("User Permission '{0}' not found.").format(perm_name))

    frappe.delete_doc("User Permission", perm_name, ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def clear_user_account_restrictions(user: str) -> dict:
    """Remove ALL Account User Permissions for a user (grant access to all accounts)."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User '{0}' does not exist.").format(user))

    names = frappe.get_all(
        "User Permission",
        filters={"user": user, "allow": "Account"},
        pluck="name",
    )
    for nm in names:
        frappe.delete_doc("User Permission", nm, ignore_permissions=True)
    frappe.db.commit()
    return {"success": True, "removed": len(names)}
