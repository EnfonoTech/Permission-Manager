# permission_manager/permission_manager/api/test_user_role_changes.py
"""Manage Roles in Permission Studio must leave the role on the user.

User.validate re-applies a user's Role Profile on every save, so the old Manage Roles (append a Has
Role row, save) was undone the moment the user held a profile: the dialog said "Role added." and the
role was gone. Ops Coordinator shares one profile with two colleagues, so the answer cannot be "put
it on the profile" either. Properties protected here:
  * a user with no profile: a plain edit, as before
  * a user on a profile other people hold: the role sticks, on a personal copy of the profile; the
    shared profile and the other holders are untouched, for adds AND for removals of a carried role
  * a user who is the only holder of a Permission Studio profile: that profile is edited in place
  * a change that did not stick is refused and rolled back, never reported as done

Everything is rolled back by FrappeTestCase; commit and rollback inside the code under test are
patched out so the suite cannot persist or discard anything beyond its own transaction.
"""

import json
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.api import quickfix

TAG = "_test_pmrc"
SHARED_ROLES = ["Accounts User", "Sales User"]
EXTRA = "Stock User"
EXTRA_2 = "HR User"


def _roles(user):
    return set(frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"))


def _profile_roles(profile):
    return set(frappe.get_all("Has Role", filters={"parent": profile, "parenttype": "Role Profile"}, pluck="role"))


def _make_profile(name, roles):
    frappe.get_doc(
        {"doctype": "Role Profile", "role_profile": name, "roles": [{"role": r} for r in roles]}
    ).insert(ignore_permissions=True)
    return name


def _make_user(tag, profile=None):
    doc = frappe.get_doc(
        {
            "doctype": "User",
            "email": f"{TAG}_{tag}@example.com",
            "first_name": "PMRC",
            "send_welcome_email": 0,
            "role_profile_name": profile or "",
        }
    )
    if not profile:
        doc.append("roles", {"role": "Accounts User"})
    doc.insert(ignore_permissions=True)
    return doc.name


class TestUserRoleChanges(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self.commit = patch.object(frappe.db, "commit").start()
        self.rollback = patch.object(frappe.db, "rollback").start()
        self.addCleanup(patch.stopall)

        # FrappeTestCase rolls back per CLASS, so every test gets names of its own
        self.t = frappe.generate_hash(length=6)
        self.shared = _make_profile(f"_Test PMRC Shared {self.t}", SHARED_ROLES)
        self.a = _make_user(f"{self.t}_a", self.shared)
        self.b = _make_user(f"{self.t}_b", self.shared)

    def test_user_without_a_profile_gets_and_loses_a_role(self):
        user = _make_user(f"{self.t}_plain")
        self.assertFalse(frappe.db.get_value("User", user, "role_profile_name"))

        res = quickfix._change_user_roles(user, [EXTRA], [])
        self.assertIn(EXTRA, _roles(user))
        self.assertEqual(res["added"], [EXTRA])
        self.assertIn(EXTRA, res["roles"])

        res = quickfix._change_user_roles(user, [], [EXTRA])
        self.assertNotIn(EXTRA, _roles(user))
        self.assertEqual(res["removed"], [EXTRA])

    def test_a_role_added_to_one_holder_of_a_shared_profile_stays_off_the_others(self):
        res = quickfix._change_user_roles(self.a, [EXTRA], [])

        personal = quickfix._PERSONAL_PROFILE_PREFIX + self.a
        self.assertIn(EXTRA, _roles(self.a))
        self.assertEqual(frappe.db.get_value("User", self.a, "role_profile_name"), personal)
        self.assertEqual(_profile_roles(personal), set(SHARED_ROLES) | {EXTRA})
        self.assertEqual(res["profile"], personal)
        self.assertTrue(res["note"])

        # the shared profile and the other holder are exactly as they were
        self.assertEqual(_profile_roles(self.shared), set(SHARED_ROLES))
        self.assertEqual(frappe.db.get_value("User", self.b, "role_profile_name"), self.shared)
        self.assertEqual(_roles(self.b), set(SHARED_ROLES))

    def test_a_second_change_edits_the_personal_profile_in_place(self):
        quickfix._change_user_roles(self.a, [EXTRA], [])
        quickfix._change_user_roles(self.a, [EXTRA_2], [])

        personal = quickfix._PERSONAL_PROFILE_PREFIX + self.a
        self.assertEqual(frappe.db.get_value("User", self.a, "role_profile_name"), personal)
        self.assertTrue(
            {EXTRA, EXTRA_2, *SHARED_ROLES} <= _roles(self.a), "both changes must be on the user"
        )
        self.assertEqual(
            frappe.db.count("Role Profile", {"name": ["like", quickfix._PERSONAL_PROFILE_PREFIX + f"{TAG}_{self.t}_%"]}),
            1,
        )
        self.assertEqual(_roles(self.b), set(SHARED_ROLES))

    def test_a_role_the_shared_profile_carries_can_be_taken_off_one_holder(self):
        quickfix._change_user_roles(self.a, [], ["Sales User"])

        self.assertNotIn("Sales User", _roles(self.a))
        self.assertIn("Accounts User", _roles(self.a))
        self.assertIn("Sales User", _roles(self.b))
        self.assertEqual(_profile_roles(self.shared), set(SHARED_ROLES))

    def test_the_only_holder_of_a_permission_studio_profile_edits_it_in_place(self):
        own = _make_profile(f"PM_Profile_{TAG}_{self.t}_solo", SHARED_ROLES)
        user = _make_user(f"{self.t}_solo", own)

        res = quickfix._change_user_roles(user, [EXTRA], [])

        self.assertEqual(frappe.db.get_value("User", user, "role_profile_name"), own)
        self.assertEqual(_profile_roles(own), set(SHARED_ROLES) | {EXTRA})
        self.assertIn(EXTRA, _roles(user))
        self.assertEqual(res["profile"], own)
        self.assertFalse(frappe.db.exists("Role Profile", quickfix._PERSONAL_PROFILE_PREFIX + user))

    def test_a_named_profile_with_one_holder_is_left_alone(self):
        named = _make_profile(f"_Test PMRC Named {self.t}", SHARED_ROLES)
        user = _make_user(f"{self.t}_named", named)

        quickfix._change_user_roles(user, [EXTRA], [])

        self.assertEqual(_profile_roles(named), set(SHARED_ROLES))
        self.assertEqual(
            frappe.db.get_value("User", user, "role_profile_name"), quickfix._PERSONAL_PROFILE_PREFIX + user
        )
        self.assertIn(EXTRA, _roles(user))

    def test_nothing_to_change_touches_nothing(self):
        before = frappe.db.get_value("User", self.a, "modified")

        res = quickfix._change_user_roles(self.a, ["Accounts User"], ["Purchase User"])

        self.assertEqual(frappe.db.get_value("User", self.a, "role_profile_name"), self.shared)
        self.assertEqual(frappe.db.get_value("User", self.a, "modified"), before)
        self.assertEqual(res["added"], [])
        self.assertEqual(res["removed"], [])

    def test_a_change_that_did_not_stick_is_refused_and_rolled_back(self):
        if not frappe.db.exists("Role", "_Test PMRC Disabled"):
            frappe.get_doc(
                {"doctype": "Role", "role_name": "_Test PMRC Disabled", "disabled": 1, "desk_access": 1}
            ).insert(ignore_permissions=True)

        with self.assertRaises(frappe.ValidationError):
            quickfix._change_user_roles(self.a, ["_Test PMRC Disabled"], [])

        self.assertTrue(self.rollback.called, "a refused change must be rolled back")
        self.assertFalse(self.commit.called, "a refused change must never be committed")

    def test_an_unknown_role_is_refused_before_anything_is_written(self):
        with self.assertRaises(frappe.ValidationError):
            quickfix._change_user_roles(self.a, ["_Test PMRC No Such Role"], [])
        self.assertEqual(frappe.db.get_value("User", self.a, "role_profile_name"), self.shared)

    def test_copy_roles_from_user_goes_through_the_profile(self):
        source = _make_user(f"{self.t}_source")
        quickfix._change_user_roles(source, [EXTRA], [])

        res = quickfix.copy_roles_from_user(self.a, source)

        self.assertIn(EXTRA, _roles(self.a))
        self.assertNotIn(EXTRA, _roles(self.b))
        self.assertIn(EXTRA, res["msg"])

    def test_the_endpoint_returns_the_roles_the_user_really_has(self):
        res = quickfix.update_user_roles(self.a, json.dumps([EXTRA]), "[]")

        self.assertTrue(res["success"])
        self.assertIn(EXTRA, res["roles"])
        self.assertEqual(set(res["roles"]), _roles(self.a))

    def test_the_quick_fix_buttons_use_the_same_path(self):
        quickfix.apply_quick_fix(self.a, "add_role", json.dumps({"role": EXTRA}))
        self.assertIn(EXTRA, _roles(self.a))
        self.assertNotIn(EXTRA, _roles(self.b))

        quickfix.apply_quick_fix(self.a, "remove_role", json.dumps({"role": EXTRA}))
        self.assertNotIn(EXTRA, _roles(self.a))
