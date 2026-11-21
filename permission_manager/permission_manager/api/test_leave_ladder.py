# permission_manager/permission_manager/api/test_leave_ladder.py
"""A leave application travels its EMPLOYEE's approval chain, and My Approvals shows it.

What went wrong on a live site: HR keyed a leave in for an employee whose Employee record carried a
chain (level 1 the sales manager, level 2 the HR coordinator). The chain was read for the
document's OWNER (the HR clerk, who is nobody's employee here), so it found nothing and the leave
kept the Department's default approver; forwarding then ignored the chain too. And My Approvals
only lists PM Workflow Actions, which a ladder-approved leave never has, so the approver the chain
named saw nothing.

Mock-based on purpose: the rules are about who is picked and what is listed, not about the
database, so these run the same on a bench and on a laptop.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest import TestCase, mock

import frappe

from permission_manager.permission_manager.api import approvals
from permission_manager.permission_manager.ladder_approve.leave_application import api

DT = "Leave Application"
NAMES = {
    "jarees@x.com": "Jarees",
    "hr@x.com": "HR Coordinator",
    "head@x.com": "Head",
    "hr.clerk@x.com": "HR Clerk",
}


def row(level, approver, applies_to="Specific DocType", module=None, doctype=DT):
    return frappe._dict(level=level, approver=approver, applies_to=applies_to,
                        module=module, document_type_name=doctype)


def _get_value(doctype, name=None, fieldname=None, *args, **kwargs):
    if doctype == "DocType" and fieldname == "module":
        return "HR"
    if doctype == "User" and fieldname == "full_name":
        return NAMES.get(name)
    return None


@contextmanager
def chain(*rows):
    """The employee's approval chain, whatever the employee."""
    with mock.patch("frappe.db.table_exists", return_value=True), \
         mock.patch("frappe.get_all", return_value=list(rows)), \
         mock.patch("frappe.db.get_value", side_effect=_get_value), \
         mock.patch.object(api, "_pm_workflow_active", return_value=False):
        yield


def as_user(name):
    """Whoever is at the keyboard (the test runner is Administrator unless told otherwise)."""
    return mock.patch.object(frappe, "session", frappe._dict(user=name))


class FakeLeave(SimpleNamespace):
    """The bits of a Leave Application the ladder reads."""

    def get(self, key, default=None):
        return getattr(self, key, default)

    def is_new(self):
        return self.new

    def get_doc_before_save(self):
        return self.before

    def set_onload(self, key, value):
        self.onloaded[key] = value

    def save(self, **kwargs):
        # what the world looked like at the moment of the save
        self.saves.append({"ignore_validate": self.flags.get("ignore_validate"),
                           "ladder_flag": frappe.flags.get("pm_ladder_action"),
                           "status": self.status, "leave_approver": self.leave_approver})

    meta = SimpleNamespace(has_field=lambda fieldname: True)


def leave(**kw):
    base = dict(employee="1262", owner="hr.clerk@x.com", leave_approver=None,
                leave_approver_name=None, new=True, docstatus=0, status="Open",
                before=None, flags=frappe._dict(), saves=[], onloaded={}, description="",
                name="HR-LAP-1", doctype="Leave Application", leave_type="Annual Leave", from_date="2026-11-22",
                to_date="2026-12-27")
    base.update(kw)
    return FakeLeave(**base)


def saved(**kw):
    """A leave already in the database, as it was before this save."""
    return leave(new=False, **kw)


@contextmanager
def on_chain(applies=True):
    """Whether the leave travels its employee's chain, whatever the data says."""
    with mock.patch.object(api, "_ladder_applies", return_value=applies):
        yield


THREE = (row(1, "jarees@x.com"), row(2, "hr@x.com"), row(3, "head@x.com"))


class TestChainResolution(TestCase):
    def test_most_specific_scope_wins_a_level(self):
        rows = (
            row(1, "everyone@x.com", applies_to="All DocTypes"),
            row(1, "module@x.com", applies_to="Specific Module", module="HR"),
            row(1, "jarees@x.com"),
        )
        with chain(*rows):
            self.assertEqual(api._get_chain_approver("1262", 1), "jarees@x.com")

    def test_a_row_for_another_doctype_or_module_is_not_ours(self):
        rows = (
            row(1, "other@x.com", doctype="Expense Claim"),
            row(1, "elsewhere@x.com", applies_to="Specific Module", module="Accounts"),
        )
        with chain(*rows):
            self.assertIsNone(api._get_chain_approver("1262", 1))

    def test_first_row_wins_a_tie(self):
        with chain(row(1, "jarees@x.com"), row(1, "hr@x.com")):
            self.assertEqual(api._get_chain_approver("1262", 1), "jarees@x.com")

    def test_no_chain_no_approver(self):
        with chain():
            self.assertEqual(api._chain_for("1262"), {})
            self.assertIsNone(api._next_chain_approver("1262", "jarees@x.com"))


class TestNextApprover(TestCase):
    def test_each_forward_moves_one_level_up(self):
        with chain(*THREE):
            self.assertEqual(api._next_chain_approver("1262", "jarees@x.com"), "hr@x.com")
            self.assertEqual(api._next_chain_approver("1262", "hr@x.com"), "head@x.com")

    def test_the_top_of_the_chain_has_nobody_above(self):
        with chain(*THREE):
            self.assertIsNone(api._next_chain_approver("1262", "head@x.com"))

    def test_somebody_outside_the_chain_hands_it_to_level_one(self):
        with chain(*THREE):
            self.assertEqual(api._next_chain_approver("1262", "default@x.com"), "jarees@x.com")

    def test_one_person_on_two_levels_is_not_asked_twice(self):
        with chain(row(1, "jarees@x.com"), row(2, "jarees@x.com"), row(3, "hr@x.com")):
            self.assertEqual(api._next_chain_approver("1262", "jarees@x.com"), "hr@x.com")

    def test_levels_are_ordered_by_number_not_by_row(self):
        with chain(row(2, "hr@x.com"), row(1, "jarees@x.com")):
            self.assertEqual(api._next_chain_approver("1262", "jarees@x.com"), "hr@x.com")


class TestBeforeSave(TestCase):
    def test_the_chain_is_the_employees_not_the_typists(self):
        """HR keys the leave in; the approver is the chain of the person who is away."""
        doc = leave(owner="hr.clerk@x.com", employee="1262")
        with chain(*THREE), mock.patch.object(api, "_multi_level_enabled", return_value=True) as enabled:
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "jarees@x.com")
        self.assertEqual(doc.leave_approver_name, "Jarees")
        # asked about the employee on leave every time, never about the typist
        self.assertTrue(enabled.call_args_list)
        self.assertTrue(all(call.args == ("1262",) for call in enabled.call_args_list))

    def test_a_new_leave_replaces_the_departments_default(self):
        """HRMS fills in the Department's approver first; the chain is the more specific word."""
        doc = leave(new=True, leave_approver="department@x.com")
        with chain(*THREE), mock.patch.object(api, "_multi_level_enabled", return_value=True):
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "jarees@x.com")

    def test_a_leave_already_moving_keeps_its_approver(self):
        doc = leave(new=False, leave_approver="hr@x.com")
        with chain(*THREE), mock.patch.object(api, "_multi_level_enabled", return_value=True):
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "hr@x.com")

    def test_a_saved_leave_with_no_approver_gets_level_one(self):
        doc = leave(new=False, leave_approver=None)
        with chain(*THREE), mock.patch.object(api, "_multi_level_enabled", return_value=True):
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "jarees@x.com")

    def test_an_employee_who_opted_out_keeps_the_default(self):
        doc = leave(new=True, leave_approver="department@x.com")
        with chain(*THREE), mock.patch.object(api, "_multi_level_enabled", return_value=False):
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "department@x.com")

    def test_an_employee_with_no_chain_keeps_the_default(self):
        doc = leave(new=True, leave_approver="department@x.com")
        with chain(), mock.patch.object(api, "_multi_level_enabled", return_value=True):
            api.before_save(doc)
        self.assertEqual(doc.leave_approver, "department@x.com")


class TestInboxAction(TestCase):
    def test_a_ladder_approve_runs_the_forward_step(self):
        with as_user("jarees@x.com"), \
             mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch.object(api, "_is_final_approver", return_value=False), \
             mock.patch.object(api, "forward_leave", return_value="done") as forward:
            self.assertEqual(api.apply_inbox_action("HR-LAP-1", "Approve & Forward"), "done")
        forward.assert_called_once_with("HR-LAP-1", None)

    def test_an_hr_approver_gives_the_final_approval(self):
        with as_user("hr@x.com"), \
             mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch.object(api, "_is_final_approver", return_value=True), \
             mock.patch.object(api, "forward_leave", return_value="done") as forward:
            api.apply_inbox_action("HR-LAP-1", "Approve")
        forward.assert_called_once_with("HR-LAP-1", "hr")

    def test_administrator_standing_in_for_level_one_forwards_not_approves(self):
        """Whether it is the last step depends on who holds the leave, not on who clicks."""
        with as_user("Administrator"), \
             mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch("frappe.db.get_value", return_value="jarees@x.com"), \
             mock.patch.object(api, "_is_final_approver",
                               side_effect=lambda user=None: user == "hr@x.com") as final, \
             mock.patch.object(api, "forward_leave", return_value="done") as forward:
            api.apply_inbox_action("HR-LAP-1", "Approve & Forward")
        forward.assert_called_once_with("HR-LAP-1", None)
        final.assert_called_once_with("jarees@x.com")

    def test_administrator_standing_in_for_hr_gives_the_final_approval(self):
        with as_user("Administrator"), \
             mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch("frappe.db.get_value", return_value="hr@x.com"), \
             mock.patch.object(api, "_is_final_approver",
                               side_effect=lambda user=None: user == "hr@x.com"), \
             mock.patch.object(api, "forward_leave", return_value="done") as forward:
            api.apply_inbox_action("HR-LAP-1", "Approve")
        forward.assert_called_once_with("HR-LAP-1", "hr")

    def test_a_rejection_needs_its_reason(self):
        with as_user("jarees@x.com"), \
             mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch.object(api, "reject_leave") as reject:
            with self.assertRaises(Exception):
                api.apply_inbox_action("HR-LAP-1", "Reject", "   ")
            reject.assert_not_called()
            api.apply_inbox_action("HR-LAP-1", "Reject", " clash with audit ")
        reject.assert_called_once_with("HR-LAP-1", "clash with audit")

    def test_any_other_action_is_not_the_ladders(self):
        with mock.patch.object(api, "_pm_workflow_active", return_value=False):
            self.assertIsNone(api.apply_inbox_action("HR-LAP-1", "Send for Approval"))

    def test_a_pm_workflow_takes_over_completely(self):
        with mock.patch.object(api, "_pm_workflow_active", return_value=True), \
             mock.patch.object(api, "forward_leave") as forward:
            self.assertIsNone(api.apply_inbox_action("HR-LAP-1", "Approve"))
            self.assertEqual(api.leaves_waiting_on("jarees@x.com"), [])
        forward.assert_not_called()


class TestWhoMayAct(TestCase):
    def test_the_named_approver_may(self):
        with as_user("jarees@x.com"):
            self.assertTrue(api._may_act(leave(leave_approver="jarees@x.com")))

    def test_somebody_else_may_not(self):
        with as_user("other@x.com"):
            self.assertFalse(api._may_act(leave(leave_approver="jarees@x.com")))

    def test_the_owner_who_keyed_it_in_may_not_approve_it(self):
        with as_user("hr.clerk@x.com"):
            self.assertFalse(api._may_act(leave(owner="hr.clerk@x.com", leave_approver="jarees@x.com")))

    def test_administrator_may_stand_in(self):
        with as_user("Administrator"):
            self.assertTrue(api._may_act(leave(leave_approver="jarees@x.com")))


class TestWhoIsListed(TestCase):
    def _waiting(self, user, rows):
        levels = {"jarees@x.com": 1, "hr@x.com": 2}
        with mock.patch.object(api, "_pm_workflow_active", return_value=False), \
             mock.patch("frappe.get_all", return_value=rows) as get_all, \
             mock.patch.object(api, "_chain_level_of", side_effect=lambda emp, u: levels.get(u)), \
             mock.patch.object(api, "_is_final_approver", side_effect=lambda u=None: u == "hr@x.com"):
            return api.leaves_waiting_on(user), get_all.call_args.kwargs["filters"]

    def _leave(self, name, approver):
        return frappe._dict(name=name, employee="1262", employee_name="S", leave_approver=approver)

    def test_an_approver_is_asked_only_for_their_own(self):
        _rows, filters = self._waiting("jarees@x.com", [])
        self.assertEqual(filters["leave_approver"], "jarees@x.com")
        self.assertEqual((filters["docstatus"], filters["status"]), (0, "Open"))

    def test_administrator_is_asked_for_every_held_leave(self):
        _rows, filters = self._waiting("Administrator", [])
        self.assertEqual(filters["leave_approver"], ["is", "set"])

    def test_each_row_carries_the_step_of_whoever_holds_it(self):
        rows, _filters = self._waiting("Administrator", [self._leave("A", "jarees@x.com"),
                                                          self._leave("B", "hr@x.com")])
        self.assertEqual([(r.name, r.level, r.final) for r in rows],
                         [("A", 1, False), ("B", 2, True)])

    def test_nobody_listed_for_no_user(self):
        self.assertEqual(api.leaves_waiting_on(""), [])


class TestInboxRows(TestCase):
    def _rows(self, **kw):
        creation = frappe.utils.add_days(frappe.utils.now_datetime(), -3)
        base = frappe._dict(name="HR-LAP-2026-00002", employee="1262",
                            employee_name="Shihabudheen", leave_type="Annual Leave",
                            owner="hr.clerk@x.com", creation=creation,
                            leave_approver="jarees@x.com", level=1, final=False)
        base.update(kw)
        return [base]

    def _items(self, rows, user="jarees@x.com"):
        with mock.patch.object(api, "leaves_waiting_on", return_value=rows), \
             mock.patch("frappe.db.get_value", side_effect=_get_value):
            return approvals._ladder_leave_items(user)

    def test_the_creator_is_who_raised_it_and_the_row_carries_the_chain_steps(self):
        (item,) = self._items(self._rows())
        self.assertEqual(item["doctype"], DT)
        self.assertEqual(item["docname"], "HR-LAP-2026-00002")
        self.assertEqual(item["creator"], "HR Clerk")
        self.assertEqual(item["available_actions"], ["Approve & Forward", "Reject"])
        self.assertEqual(item["category"], "Approval Pending")
        self.assertTrue(item["ladder"])
        self.assertEqual(item["doc_url"], "/app/leave-application/HR-LAP-2026-00002")
        self.assertGreaterEqual(item["days"], 3)

    def test_your_own_leave_needs_no_name_in_the_with_column(self):
        (item,) = self._items(self._rows())
        self.assertEqual(item["holder"], "")

    def test_administrator_is_told_whose_leave_it_is(self):
        (item,) = self._items(self._rows(), user="Administrator")
        self.assertEqual(item["holder"], "Jarees")

    def test_the_last_approver_sees_approve_not_approve_and_forward(self):
        (item,) = self._items(self._rows(final=True))
        self.assertEqual(item["available_actions"], ["Approve", "Reject"])

    def test_the_row_has_every_key_the_page_reads(self):
        (item,) = self._items(self._rows())
        pm_keys = {"name", "doctype", "transaction", "transaction_filter", "docname", "date",
                   "creation_iso", "priority", "state", "role_id", "holder", "days", "creator",
                   "category", "available_actions", "doc_url", "is_adhoc", "adhoc_for",
                   "return_to_originator", "is_waiting", "waiting_with"}
        self.assertTrue(pm_keys <= set(item), pm_keys - set(item))

    def test_nobody_waiting_adds_nothing(self):
        self.assertEqual(self._items([]), [])

    def test_the_inbox_merges_ladder_rows_with_the_workflow_ones(self):
        pm = {"groups": [{"label": "Approval Pending",
                          "items": [{"priority": "Medium", "days": 1, "docname": "PUR-1"}]},
                         {"label": "Decision Pending",
                          "items": [{"priority": "Medium", "days": 1, "docname": "PA-1"}]}],
              "total": 2}
        with mock.patch.object(approvals, "_pm_pending_approvals", return_value=pm), \
             mock.patch.object(approvals, "_ladder_leave_items",
                               return_value=[{"priority": "Medium", "days": 5, "docname": "HR-LAP-1"}]):
            out = approvals.get_my_pending_approvals()
        self.assertEqual(out["total"], 3)
        self.assertEqual([g["label"] for g in out["groups"]], ["Approval Pending", "Decision Pending"])
        # the longer-waiting leave comes first within its group
        self.assertEqual([i["docname"] for i in out["groups"][0]["items"]], ["HR-LAP-1", "PUR-1"])

    def test_a_leave_alone_still_makes_a_group(self):
        empty = {"groups": [], "total": 0}
        with mock.patch.object(approvals, "_pm_pending_approvals", return_value=empty), \
             mock.patch.object(approvals, "_ladder_leave_items",
                               return_value=[{"priority": "Medium", "days": 0, "docname": "HR-LAP-1"}]):
            out = approvals.get_my_pending_approvals()
        self.assertEqual(out["total"], 1)
        self.assertEqual(out["groups"][0]["label"], "Approval Pending")

    def test_no_leaves_returns_the_workflow_answer_untouched(self):
        pm = {"groups": [{"label": "Approval Pending", "items": []}], "total": 0}
        with mock.patch.object(approvals, "_pm_pending_approvals", return_value=pm), \
             mock.patch.object(approvals, "_ladder_leave_items", return_value=[]):
            self.assertIs(approvals.get_my_pending_approvals(), pm)


class TestLifecycle(TestCase):
    def _chain_of(self, **kw):
        doc = leave(**kw)
        doc.docstatus = kw.get("docstatus", 0)
        with chain(*THREE), \
             mock.patch("frappe.get_doc", return_value=doc), \
             mock.patch.object(api, "_multi_level_enabled", return_value=True), \
             mock.patch.object(api, "_is_final_approver",
                               side_effect=lambda user=None: user == "hr@x.com"):
            return api.lifecycle("HR-LAP-1")

    def _states(self, out):
        return [(p["state"], p["status"]) for p in out["chain"]]

    def test_waiting_at_level_one(self):
        out = self._chain_of(leave_approver="jarees@x.com")
        self.assertEqual(self._states(out), [("Level 1", "current"), ("Level 2", "upcoming"),
                                             ("Level 3", "upcoming"), ("Final approval", "upcoming")])

    def test_waiting_at_level_two_has_cleared_level_one(self):
        out = self._chain_of(leave_approver="hr@x.com")
        self.assertEqual(self._states(out)[:2], [("Level 1", "done"), ("Level 2", "current")])
        self.assertEqual(out["chain"][0]["by"], "Jarees")
        self.assertEqual(out["chain"][1]["roles"], ["HR Coordinator"])

    def test_approved_means_every_step_is_done(self):
        out = self._chain_of(leave_approver="hr@x.com", status="Approved")
        self.assertTrue(all(p["status"] == "done" for p in out["chain"]))
        self.assertTrue(out["finished"])

    def test_who_can_act_now_is_the_person_the_leave_is_with(self):
        out = self._chain_of(leave_approver="hr@x.com")
        self.assertEqual(out["roles"], [{"role": "Level 2", "count": 1,
                                         "users": [{"user": "hr@x.com", "full_name": "HR Coordinator"}]}])

    def test_who_can_act_now_is_nobody_once_it_is_decided(self):
        out = self._chain_of(leave_approver="hr@x.com", status="Approved")
        self.assertEqual(out["roles"], [])

    def test_the_label_follows_the_holders_level(self):
        out = self._chain_of(leave_approver="head@x.com")
        self.assertEqual(out["roles"][0]["role"], "Level 3")
        out = self._chain_of(leave_approver="jarees@x.com")
        self.assertEqual(out["roles"][0]["users"][0]["full_name"], "Jarees")

    def test_the_last_step_is_always_hr_and_marked_final(self):
        out = self._chain_of(leave_approver="jarees@x.com")
        self.assertTrue(out["chain"][-1]["final"])
        self.assertEqual(out["chain"][-1]["roles"], ["HR"])


class TestLadderApplies(TestCase):
    def _applies(self, *, workflow=False, enabled=True, chain_rows=THREE):
        with chain(*chain_rows), \
             mock.patch.object(api, "_pm_workflow_active", return_value=workflow), \
             mock.patch.object(api, "_multi_level_enabled", return_value=enabled):
            return api._ladder_applies(leave())

    def test_an_employee_with_a_chain_is_on_it(self):
        self.assertTrue(self._applies())

    def test_no_chain_no_ladder(self):
        self.assertFalse(self._applies(chain_rows=()))

    def test_an_opt_out_leaves_the_plain_hrms_way(self):
        self.assertFalse(self._applies(enabled=False))

    def test_a_pm_workflow_takes_the_doctype_over(self):
        self.assertFalse(self._applies(workflow=True))


class TestStatusIsTheChainsToMove(TestCase):
    def _refused(self, doc, **flags):
        with on_chain(), mock.patch.dict(frappe.flags, flags):
            try:
                api._refuse_hand_set_status(doc)
            except Exception:
                return True
        return False

    def test_status_edited_by_hand_on_a_saved_leave_is_refused(self):
        doc = leave(new=False, status="Approved", before=saved(status="Open"))
        self.assertTrue(self._refused(doc))

    def test_so_is_a_move_to_pending_next_approval(self):
        doc = leave(new=False, status="Pending Next Approval", before=saved(status="Open"))
        self.assertTrue(self._refused(doc))

    def test_an_edit_that_leaves_status_alone_passes(self):
        doc = leave(new=False, status="Open", before=saved(status="Open"))
        self.assertFalse(self._refused(doc))

    def test_a_leave_cannot_be_created_already_approved(self):
        self.assertTrue(self._refused(leave(new=True, status="Approved", before=None)))
        self.assertFalse(self._refused(leave(new=True, status="Open", before=None)))

    def test_the_chains_own_step_raises_the_flag_and_passes(self):
        doc = leave(new=False, status="Approved", before=saved(status="Open"))
        self.assertFalse(self._refused(doc, pm_ladder_action=True))

    def test_patches_migrations_and_imports_pass(self):
        doc = leave(new=False, status="Approved", before=saved(status="Open"))
        for flag in ("in_patch", "in_migrate", "in_install", "in_import"):
            with self.subTest(flag=flag):
                self.assertFalse(self._refused(doc, **{flag: True}))

    def test_a_leave_off_the_chain_is_left_alone(self):
        doc = leave(new=False, status="Approved", before=saved(status="Open"))
        with on_chain(False):
            api._refuse_hand_set_status(doc)


class TestSubmit(TestCase):
    def _submit(self, doc, *, hr, applies=True):
        with on_chain(applies), mock.patch.object(api, "_user_is_hr", return_value=hr):
            try:
                api.before_submit(doc)
            except Exception:
                return "refused"
        return "allowed"

    def test_a_leave_still_on_the_chain_cannot_be_submitted_even_by_hr(self):
        doc = leave(new=False, docstatus=1, status="Open", before=saved(status="Open"))
        self.assertEqual(self._submit(doc, hr=True), "refused")

    def test_status_set_by_hand_in_the_same_request_as_the_submit_is_refused(self):
        doc = leave(new=False, docstatus=1, status="Approved", before=saved(status="Open"))
        self.assertEqual(self._submit(doc, hr=True), "refused")

    def test_pending_next_approval_cannot_be_submitted(self):
        doc = leave(new=False, docstatus=1, status="Pending Next Approval",
                    before=saved(status="Pending Next Approval"))
        self.assertEqual(self._submit(doc, hr=True), "refused")

    def test_a_leave_the_chain_approved_can_be_submitted(self):
        doc = leave(new=False, docstatus=1, status="Approved", before=saved(status="Approved"))
        self.assertEqual(self._submit(doc, hr=True), "allowed")

    def test_a_leave_the_chain_rejected_can_be_submitted_to_close_it(self):
        doc = leave(new=False, docstatus=1, status="Rejected", before=saved(status="Rejected"))
        self.assertEqual(self._submit(doc, hr=True), "allowed")

    def test_off_the_chain_hr_may_submit_as_before(self):
        doc = leave(new=False, docstatus=1, status="Open", before=saved(status="Open"))
        self.assertEqual(self._submit(doc, hr=True, applies=False), "allowed")

    def test_off_the_chain_somebody_else_still_needs_an_approved_leave(self):
        open_ = leave(new=False, docstatus=1, status="Open", before=saved(status="Open"))
        done = leave(new=False, docstatus=1, status="Approved", before=saved(status="Approved"))
        self.assertEqual(self._submit(open_, hr=False, applies=False), "refused")
        self.assertEqual(self._submit(done, hr=False, applies=False), "allowed")


class TestStepSave(TestCase):
    def test_the_step_skips_validation_and_raises_the_flag_only_while_saving(self):
        doc = leave(new=False, status="Approved")
        api._save_step(doc)
        (at_save,) = doc.saves
        self.assertTrue(at_save["ignore_validate"])
        self.assertTrue(at_save["ladder_flag"])
        self.assertFalse(frappe.flags.get("pm_ladder_action"))

    def test_the_flag_comes_down_even_when_the_save_fails(self):
        doc = leave(new=False)
        doc.save = mock.Mock(side_effect=ValueError("boom"))
        with self.assertRaises(ValueError):
            api._save_step(doc)
        self.assertFalse(frappe.flags.get("pm_ladder_action"))


class TestForwardAndReject(TestCase):
    """The buttons: each is one _save_step, taken by whoever may act."""

    def _run(self, fn, doc, *args, user="jarees@x.com"):
        with as_user(user), \
             mock.patch("frappe.get_doc", return_value=doc), \
             mock.patch("frappe.db.get_value", side_effect=_get_value), \
             mock.patch("frappe.db.commit"), \
             mock.patch.object(api, "_apply_leave_workflow", return_value=False), \
             mock.patch.object(api, "_multi_level_enabled", return_value=True), \
             chain(*THREE):
            return fn("HR-LAP-1", *args)

    def test_forward_moves_the_leave_one_level_up_in_one_step(self):
        doc = saved(leave_approver="jarees@x.com", status="Open")
        self._run(api.forward_leave, doc)
        self.assertEqual(doc.leave_approver, "hr@x.com")
        self.assertEqual(doc.leave_approver_name, "HR Coordinator")
        self.assertEqual(doc.status, "Open")
        self.assertEqual(len(doc.saves), 1)
        self.assertTrue(doc.saves[0]["ignore_validate"])

    def test_the_final_approval_sets_approved_inside_the_chains_own_step(self):
        doc = saved(leave_approver="hr@x.com", status="Open")
        self._run(api.forward_leave, doc, "hr", user="hr@x.com")
        self.assertEqual([(x["status"], x["ladder_flag"]) for x in doc.saves], [("Approved", True)])

    def test_reject_saves_the_note_then_the_status_both_as_steps(self):
        doc = saved(leave_approver="jarees@x.com", status="Open")
        self._run(api.reject_leave, doc, "clash with audit")
        self.assertEqual([x["status"] for x in doc.saves], ["Open", "Rejected"])
        self.assertTrue(all(x["ladder_flag"] for x in doc.saves))
        self.assertIn("clash with audit", doc.description)

    def test_somebody_who_is_not_the_approver_is_turned_away(self):
        doc = saved(leave_approver="jarees@x.com", status="Open")
        with self.assertRaises(Exception):
            self._run(api.forward_leave, doc, user="other@x.com")
        with self.assertRaises(Exception):
            self._run(api.reject_leave, doc, "no", user="other@x.com")
        self.assertEqual(doc.saves, [])

    def test_a_submitted_leave_cannot_be_moved(self):
        doc = saved(leave_approver="jarees@x.com", status="Approved", docstatus=1)
        with self.assertRaises(Exception):
            self._run(api.forward_leave, doc)


class TestOnload(TestCase):
    def _payload(self, doc, *, applies=True, may_act=True, final=False):
        with on_chain(applies), \
             mock.patch.object(api, "_may_act", return_value=may_act), \
             mock.patch.object(api, "_is_final_approver", return_value=final), \
             mock.patch("frappe.db.get_value", side_effect=_get_value), \
             chain(*THREE):
            api.onload(doc)
        return doc.onloaded.get("pm_ladder")

    def test_a_leave_on_the_chain_says_where_it_stands(self):
        doc = saved(leave_approver="hr@x.com", status="Open")
        payload = self._payload(doc, final=True)
        self.assertEqual(payload, {"active": True, "can_act": True, "final": True,
                                   "holder": "hr@x.com", "holder_name": "HR Coordinator", "level": 2})

    def test_somebody_who_may_not_act_is_told_so(self):
        doc = saved(leave_approver="jarees@x.com", status="Open")
        self.assertFalse(self._payload(doc, may_act=False)["can_act"])

    def test_a_decided_leave_is_no_longer_active(self):
        for status in ("Approved", "Rejected"):
            with self.subTest(status=status):
                doc = saved(leave_approver="hr@x.com", status=status)
                payload = self._payload(doc)
                self.assertFalse(payload["active"])
                self.assertFalse(payload["can_act"])

    def test_nothing_is_sent_for_a_new_a_submitted_or_an_off_chain_leave(self):
        self.assertIsNone(self._payload(leave(new=True)))
        self.assertIsNone(self._payload(saved(docstatus=1, status="Approved")))
        self.assertIsNone(self._payload(saved(leave_approver="jarees@x.com"), applies=False))


class TestHandingOverTheShare(TestCase):
    """HRMS takes the leave off the old approver through the SAVER's permissions, and a manager who
    is not HR may not delete a DocShare: forwarding failed on a live site with "User not allowed to
    delete DocShare" and then 'You need to have "Share" permission'."""

    def test_the_old_approvers_share_goes_with_every_permission_check_stepped_over(self):
        with mock.patch("frappe.db.get_value", return_value="share-1"),              mock.patch("frappe.delete_doc") as delete:
            api._drop_share(leave(name="HR-LAP-1"), "jarees@x.com")
        delete.assert_called_once_with("DocShare", "share-1", ignore_permissions=True,
                                       flags={"ignore_share_permission": True})

    def test_no_share_or_no_approver_means_nothing_to_delete(self):
        with mock.patch("frappe.delete_doc") as delete:
            with mock.patch("frappe.db.get_value", return_value=None):
                api._drop_share(leave(name="HR-LAP-1"), "jarees@x.com")
            api._drop_share(leave(name="HR-LAP-1"), None)
        delete.assert_not_called()

    def test_forward_hands_the_share_over_before_the_save(self):
        calls = []
        doc = saved(leave_approver="jarees@x.com", status="Open")
        with as_user("jarees@x.com"),              mock.patch("frappe.get_doc", return_value=doc),              mock.patch("frappe.db.get_value", side_effect=_get_value),              mock.patch("frappe.db.commit"),              mock.patch.object(api, "_multi_level_enabled", return_value=True),              mock.patch.object(api, "_drop_share", side_effect=lambda d, u: calls.append(("drop", u))),              mock.patch.object(api, "_save_step", side_effect=lambda d: calls.append(("save", d.leave_approver))),              chain(*THREE):
            api.forward_leave("HR-LAP-1")
        # the share of the one handing on, then the save that names the next approver
        self.assertEqual(calls, [("drop", "jarees@x.com"), ("save", "hr@x.com")])
