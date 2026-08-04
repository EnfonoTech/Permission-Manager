# permission_manager/permission_manager/test_workflow_submit_guard.py
"""The submit guard must not assume the document has already been saved.

ERPNext raises and submits journals inside another document's transaction — the credit note
behind a Payment Reconciliation, an exchange gain or loss — by building the document in memory
and calling submit() on it directly. frappe runs before_submit *before* that row is inserted,
while the document already carries the name autoname handed it. A guard that resolves the
workflow by reading that name back finds nothing and throws DoesNotExistError, which on a
production site surfaced as "Journal Entry ACC-JV-2026-03548 not found" and left the user unable
to reconcile a single credit note.

Nothing here writes: the guard is called with documents built in memory, so no approval chain on
a client site is disturbed.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from permission_manager.permission_manager.workflow import (
    SUBMIT_GUARD_DOCTYPES,
    get_workflow,
    get_workflow_name,
    validate_submit_state,
)

GUARDED = SUBMIT_GUARD_DOCTYPES[0]

# A name that is formatted like a real one and belongs to nothing — what a document carries
# between autoname and insert.
UNSAVED_NAME = "ACC-JV-1999-99999"


def _unsaved(**overrides):
    doc = frappe.new_doc(GUARDED)
    doc.name = UNSAVED_NAME
    for key, value in overrides.items():
        doc.set(key, value)
    return doc


def _workflow_for_guarded_doctype():
    if not frappe.db.table_exists("PM Workflow"):
        return None
    return get_workflow_name(GUARDED)


class TestSubmitGuardOnUnsavedDocument(FrappeTestCase):
    def test_the_guard_does_not_read_back_a_row_that_is_not_there_yet(self):
        """The regression. Before the fix this raised DoesNotExistError."""
        self.assertFalse(frappe.db.exists(GUARDED, UNSAVED_NAME))
        validate_submit_state(_unsaved())

    def test_resolving_a_workflow_by_a_name_that_does_not_exist_is_not_an_error(self):
        self.assertFalse(frappe.db.exists(GUARDED, UNSAVED_NAME))
        # Whatever it resolves to, it must answer rather than throw.
        get_workflow_name(GUARDED, UNSAVED_NAME)

    def test_the_document_in_hand_is_preferred_over_a_lookup(self):
        """Passing the document is what makes the pre-insert case work at all, so the parameter
        has to be honoured even when the name would resolve to something."""
        doc = _unsaved()
        self.assertEqual(get_workflow_name(GUARDED, doc.name, doc=doc),
                         get_workflow_name(GUARDED, None, doc=doc))

    def test_a_string_passed_over_http_is_ignored_rather_than_trusted(self):
        """get_workflow_name is whitelisted, so `doc` can arrive as a string from a client."""
        get_workflow_name(GUARDED, None, doc="not-a-document")

    def test_a_system_generated_journal_is_never_held_for_approval(self):
        """It has no draft stage and no approver, and refusing it would abort the document the
        user is actually working on."""
        workflow_name = _workflow_for_guarded_doctype()
        if not workflow_name:
            self.skipTest("no PM Workflow routes %s on this site" % GUARDED)

        workflow = frappe.get_cached_doc("PM Workflow", workflow_name)
        held = next((s.state for s in workflow.states if not int(s.doc_status or 0)), None)
        if not held:
            self.skipTest("this workflow has no non-submitting state")

        doc = _unsaved(is_system_generated=1)
        doc.set(workflow.workflow_state_field, held)
        validate_submit_state(doc)

    def test_a_document_parked_in_a_non_submitting_state_is_still_refused(self):
        """The guard's whole purpose. Tolerating an unsaved document must not become a way past
        an approval chain."""
        workflow_name = _workflow_for_guarded_doctype()
        if not workflow_name:
            self.skipTest("no PM Workflow routes %s on this site" % GUARDED)

        workflow = frappe.get_cached_doc("PM Workflow", workflow_name)
        held = next((s.state for s in workflow.states if not int(s.doc_status or 0)), None)
        if not held:
            self.skipTest("this workflow has no non-submitting state")

        doc = _unsaved()
        doc.set(workflow.workflow_state_field, held)
        with self.assertRaises(frappe.ValidationError):
            validate_submit_state(doc)

    def test_a_submitting_state_is_allowed_through(self):
        workflow_name = _workflow_for_guarded_doctype()
        if not workflow_name:
            self.skipTest("no PM Workflow routes %s on this site" % GUARDED)

        workflow = frappe.get_cached_doc("PM Workflow", workflow_name)
        approved = next((s.state for s in workflow.states if int(s.doc_status or 0) == 1), None)
        if not approved:
            self.skipTest("this workflow has no submitting state")

        doc = _unsaved()
        doc.set(workflow.workflow_state_field, approved)
        validate_submit_state(doc)


class TestWorkflowLookupWithoutAWorkflow(FrappeTestCase):
    def test_asking_whether_a_workflow_applies_does_not_raise(self):
        """A guard that runs on every submit cannot raise merely because this site does not
        route that doctype."""
        self.assertIsNone(get_workflow("_Nonexistent Doctype For Test", throw=False))

    def test_asking_for_one_that_must_exist_still_raises(self):
        with self.assertRaises(frappe.ValidationError):
            get_workflow("_Nonexistent Doctype For Test")

    def test_an_unrouted_doctype_passes_the_guard(self):
        """Only doctypes in the guard list are examined, so this is cheap to prove."""
        doc = frappe.new_doc("ToDo")
        validate_submit_state(doc)
