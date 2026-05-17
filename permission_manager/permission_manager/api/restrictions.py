"""
Permission Manager — User Restrictions & Shares Summary
Author: siva <siva@enfono.com>

Returns and manages User Permission restrictions and DocShare records.
"""

import frappe
from frappe import _


def _check_access():
    if "System Manager" not in frappe.get_roles():
        frappe.throw(_("Access denied."), frappe.PermissionError)


@frappe.whitelist()
def get_user_restrictions(user: str) -> dict:
    """Return all User Permission restrictions and the DocTypes they affect."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    user_perms = frappe.get_all(
        "User Permission",
        filters={"user": user},
        fields=[
            "name", "allow", "for_value", "applicable_for",
            "apply_to_all_doctypes", "is_default", "hide_descendants",
        ],
        order_by="allow asc, for_value asc",
    )

    link_map = _build_link_field_map()
    restrictions = []
    summary: dict = {}

    for up in user_perms:
        allow_dt = up.allow
        for_value = up.for_value

        if up.apply_to_all_doctypes:
            affected = link_map.get(allow_dt, [])
        elif up.applicable_for:
            affected = [up.applicable_for]
        else:
            affected = link_map.get(allow_dt, [])

        restrictions.append({
            "name": up.name,
            "allow": allow_dt,
            "for_value": for_value,
            "apply_to_all": bool(up.apply_to_all_doctypes),
            "applicable_for": up.applicable_for,
            "is_default": bool(up.is_default),
            "affected_doctypes": sorted(affected),
        })

        summary.setdefault(allow_dt, [])
        if for_value not in summary[allow_dt]:
            summary[allow_dt].append(for_value)

    return {
        "user": user,
        "restrictions": restrictions,
        "restriction_summary": summary,
    }


@frappe.whitelist()
def get_user_shares(user: str) -> dict:
    """Return the latest 100 DocShare records for a user."""
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    shares = frappe.get_all(
        "DocShare",
        filters={"user": user},
        fields=["share_doctype", "share_name", "read", "write", "share", "submit", "everyone", "owner", "creation"],
        order_by="creation desc",
        limit=100,
    )

    return {
        "user": user,
        "shares": [
            {
                "doctype": s.share_doctype,
                "docname": s.share_name,
                "read": bool(s.read),
                "write": bool(s.write),
                "share": bool(s.share),
                "submit": bool(s.submit),
                "everyone": bool(s.everyone),
                "owner": s.owner,
                "creation": str(s.creation),
            }
            for s in shares
        ],
        "total": len(shares),
    }


@frappe.whitelist()
def preview_restriction_impact(allow: str, for_value: str) -> dict:
    """
    Preview which DocTypes would be narrowed by a User Permission restriction,
    and how many records match vs. total — shown before the restriction is saved.
    Capped at 25 DocTypes to stay fast.
    """
    _check_access()

    link_map = _build_link_field_map()
    affected_doctypes = link_map.get(allow, [])[:25]

    impact = []
    for dt in affected_doctypes:
        try:
            if not frappe.db.table_exists(dt):
                continue

            # Find the link field pointing to `allow`
            link_field = frappe.db.get_value(
                "DocField",
                {"parent": dt, "fieldtype": "Link", "options": allow},
                "fieldname",
            )
            if not link_field:
                link_field = frappe.db.get_value(
                    "Custom Field",
                    {"dt": dt, "fieldtype": "Link", "options": allow},
                    "fieldname",
                )
            if not link_field:
                continue

            total = frappe.db.count(dt)
            matching = frappe.db.count(dt, {link_field: for_value})

            impact.append({
                "doctype": dt,
                "link_field": link_field,
                "total_records": total,
                "accessible_after": matching,
                "restricted_out": total - matching,
            })
        except Exception:
            continue

    return {
        "allow": allow,
        "for_value": for_value,
        "affected_doctypes_count": len(affected_doctypes),
        "impact": sorted(impact, key=lambda x: -x["total_records"]),
    }


@frappe.whitelist()
def add_user_permission(
    user: str,
    allow: str,
    for_value: str,
    applicable_for: str = None,
    apply_to_all_doctypes: int = 1,
) -> dict:
    """
    Add a User Permission restriction for a user.
    Returns the refreshed restriction list.
    """
    _check_access()

    if not frappe.db.exists("User", user):
        frappe.throw(_("User {0} does not exist.").format(user))

    if not frappe.db.exists("DocType", allow):
        frappe.throw(_("DocType {0} does not exist.").format(allow))

    frappe.get_doc({
        "doctype": "User Permission",
        "user": user,
        "allow": allow,
        "for_value": for_value,
        "applicable_for": applicable_for or "",
        "apply_to_all_doctypes": int(apply_to_all_doctypes),
        "is_default": 0,
    }).insert(ignore_permissions=True)

    return get_user_restrictions(user)


@frappe.whitelist()
def remove_user_permission(name: str) -> dict:
    """
    Remove a User Permission restriction by its document name.
    Returns the user's refreshed restriction list.
    """
    _check_access()

    perm = frappe.db.get_value("User Permission", name, ["user", "allow", "for_value"], as_dict=True)
    if not perm:
        frappe.throw(_("User Permission '{0}' not found.").format(name))

    frappe.delete_doc("User Permission", name, ignore_permissions=True)
    return get_user_restrictions(perm.user)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_link_field_map() -> dict:
    """Map: { target_doctype: [doctypes_that_link_to_it] }"""
    link_map: dict = {}

    for lf in frappe.get_all(
        "DocField",
        filters={"fieldtype": "Link", "options": ["is", "set"]},
        fields=["parent", "options"],
        distinct=True,
    ):
        link_map.setdefault(lf.options, [])
        if lf.parent not in link_map[lf.options]:
            link_map[lf.options].append(lf.parent)

    for clf in frappe.get_all(
        "Custom Field",
        filters={"fieldtype": "Link", "options": ["is", "set"]},
        fields=["dt", "options"],
        distinct=True,
    ):
        link_map.setdefault(clf.options, [])
        if clf.dt not in link_map[clf.options]:
            link_map[clf.options].append(clf.dt)

    return link_map
