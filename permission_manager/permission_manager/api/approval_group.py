# permission_manager/permission_manager/api/approval_group.py
"""Account-driven, config-driven approval routing (company-agnostic).

Two pieces:
  1. Stamping — the approval group of a transaction is derived from the ACCOUNT on
     its lines (tag accounts with `custom_approval_group`, no account numbers).
  2. Chains as data — each group's approver chain lives in the **PM Approval Group**
     doctype (ordered `stages` of roles). `rebuild_approval_workflows()` regenerates
     the Purchase Order, Purchase Invoice, Journal Entry and Payment Entry PM Workflows
     from those configs, so admins change who approves by editing data — never code.

Routing summary:
  * Purchase Invoice — by account group (service), currency (local/import), or Asset item.
  * Purchase Order   — Branch Head, or the Asset chain for fixed-asset POs.
  * Journal Entry    — by Journal Entry Template.
  * Payment Entry    — by supplier-payment category (advance vs PI payment).
"""

import frappe
from frappe.utils import cint, cstr

FIELD = "custom_approval_group"

# ── Fixed (non-group) routing constants ──────────────────────────────────────
PI_INITIATE_ROLE = "Purchase User"          # creates + sends the invoice
PI_LOCAL_ROLE = "Purchase Assistant"        # material, company currency (and returns)
PI_IMPORT_ROLE = "Purchase Manager"         # material, foreign currency
JE_INITIATE_ROLE = "Accounts User"          # creates + sends / submits normal JVs

# Journal templates that need no approval at all: the initiator (or an Accountant) submits
# them exactly like an untemplated JV. Without this list, ANY template routes to Pending Dept
# while the exits from Pending Dept are generated per Approval Group — so a template nobody is
# configured to approve strands there with no transition out. VAT PAYABLE is a computed
# statutory posting the accounts team raises and owns, so it goes straight through.
JE_DIRECT_TEMPLATES = ("VAT PAYABLE",)

# An Accountant may submit a direct template even without the Accounts User role.
JE_DIRECT_EXTRA_ROLE = "Accountant"

# Fixed-asset PI/PO route through this group (Dept Head → GM → Accountant); seeded
# as a normal PM Approval Group so the same generic multi-stage engine builds it.
ASSET_GROUP = "Asset"

# ── Payment Entry (supplier payments) — category-routed ───────────────────────
PE_INITIATE_ROLE = "Accounts User"          # drafts + sends the payment (accounts doc)
PE_CHAINS = {
	"Advance":     ["Purchase Manager", "Finance Manager", "Accountant"],   # PO ref OR unallocated prepay
	"PI Payment":  ["Finance Manager", "Accountant"],                       # allocated to a PI (material/service/due)
}
PE_COND = {
	"Advance":     'doc.custom_payment_category == "Advance"',
	# Materials (stock) and Service PI payments share one chain; label kept for reporting.
	"PI Payment":  '(doc.custom_payment_category == "Materials") or (doc.custom_payment_category == "Service")',
}


# ═══════════════════════════ stamping ════════════════════════════════════════
def account_group(account: str) -> str:
	"""Approval group for an account, inheriting from ancestor accounts."""
	seen = set()
	while account and account not in seen:
		seen.add(account)
		row = frappe.get_cached_value("Account", account, [FIELD, "parent_account"], as_dict=True)
		if not row:
			return ""
		if row.get(FIELD):
			return row.get(FIELD)
		account = row.get("parent_account")
	return ""


def _has_asset_group():
	return frappe.db.exists("PM Approval Group", ASSET_GROUP)


def stamp_purchase_invoice(doc, method=None):
	"""before_save(Purchase Invoice): set custom_approval_group. Fixed-asset lines route
	via the 'Asset' chain (takes priority); otherwise the first expense line whose account
	(or an ancestor) carries a group. Empty = normal material."""
	if not frappe.db.has_column("Account", FIELD):
		return
	group = ""
	# Asset items take priority — Dept Head → GM → Accountant.
	for item in (doc.get("items") or []):
		if item.get("is_fixed_asset") and _has_asset_group():
			group = ASSET_GROUP
			break
	if not group:
		for item in (doc.get("items") or []):
			acc = item.get("expense_account")
			if acc:
				g = account_group(acc)
				if g:
					group = g
					break
	doc.set(FIELD, group)


def stamp_purchase_order(doc, method=None):
	"""before_save(Purchase Order): tag fixed-asset POs with the 'Asset' group so they
	route Dept Head → GM → Accountant. All other POs stay on the Branch Head flow."""
	if not frappe.db.has_column("Purchase Order", FIELD):
		return
	group = ""
	for item in (doc.get("items") or []):
		if item.get("is_fixed_asset") and _has_asset_group():
			group = ASSET_GROUP
			break
	doc.set(FIELD, group)


def stamp_payment_entry(doc, method=None):
	"""before_save(Payment Entry): categorise supplier payments so the workflow routes.
	  Materials — pays against a Purchase Invoice with no approval group (stock)
	  Service   — pays against a Purchase Invoice that carries an approval group
	  Advance   — pays against a Purchase Order, OR has no reference at all (an
	              unallocated / on-account prepayment sits as a supplier advance)
	'Due payment of suppliers' is a Purchase-Invoice settlement, so it falls under the
	PI-Payment (Materials/Service) chain — there is no separate Due category.
	Non-supplier payments (customer receipts, internal transfer) get no category and
	submit directly — they are never forced through the supplier-approval workflow."""
	if not frappe.db.has_column("Payment Entry", "custom_payment_category"):
		return
	cat = ""
	if doc.get("payment_type") == "Pay" and doc.get("party_type") == "Supplier":
		refs = doc.get("references") or []
		if any(r.get("reference_doctype") == "Purchase Invoice" for r in refs):
			# paying booked invoice(s) — materials, or service if a referenced PI has a group
			cat = "Materials"
			pis = [r.get("reference_name") for r in refs
			       if r.get("reference_doctype") == "Purchase Invoice" and r.get("reference_name")]
			if pis and frappe.db.has_column("Purchase Invoice", FIELD) and frappe.get_all(
					"Purchase Invoice", filters={"name": ["in", pis], FIELD: ["is", "set"]}, limit=1):
				cat = "Service"
		else:
			# references a Purchase Order, or nothing (unallocated) → on-account advance
			cat = "Advance"
	doc.set("custom_payment_category", cat)


# ═══════════════════════════ workflow generator ══════════════════════════════
def _st(state, ds, role):
	return {"state": state, "doc_status": ds, "edit_permission_type": "Role", "allow_edit": role}


def _t(state, action, nxt, role, cond=None, self_appr=0, attach=0, comment=0, rfc=0):
	r = {"state": state, "action": action, "next_state": nxt, "approver_type": "Role",
	     "allowed": role, "allow_self_approval": self_appr, "require_attachment": attach,
	     "require_comment": comment, "is_return_for_correction": rfc,
	     # provenance: this row belongs to the config and is replaced on every rebuild
	     "is_generated": 1}
	if cond:
		r["condition"] = cond
	return r


def _load_groups():
	"""{group_name: {"stages": [ {role, attach, comment, self_approval} ], "templates": [names]}}"""
	out = {}
	for g in frappe.get_all("PM Approval Group", filters={"disabled": 0},
	                        fields=["name", "group_name", "journal_templates"]):
		stages = frappe.get_all("PM Approval Group Stage", filters={"parent": g.name},
		                        fields=["approver_role", "require_attachment", "require_comment",
		                                "allow_self_approval"],
		                        order_by="idx asc")
		if not stages:
			continue
		templates = [t.strip() for t in (g.journal_templates or "").splitlines() if t.strip()]
		out[g.group_name] = {"stages": stages, "templates": templates}
	return out


def _ensure_masters(max_level):
	states = ["Draft", "Pending", "Pending Dept", "Pending Accounts", "Approved", "Rejected"]
	states += ["Pending L%d" % k for k in range(3, max_level + 1)]
	for s in states:
		if not frappe.db.exists("Workflow State", s):
			frappe.get_doc({"doctype": "Workflow State", "workflow_state_name": s}).insert(ignore_permissions=True)
	for a in ["Send for Approval", "Approve", "Reject", "Submit"]:
		if not frappe.db.exists("Workflow Action Master", a):
			frappe.get_doc({"doctype": "Workflow Action Master", "workflow_action_name": a}).insert(ignore_permissions=True)


def _pytuple(names):
	return "(" + ", ".join(["%r" % n for n in names]) + ("," if len(names) == 1 else "") + ")"


def _company_currency():
	comp = frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")
	return frappe.get_cached_value("Company", comp, "default_currency") if comp else "BHD"


def _stage_states(entry_states, k):
	"""entry state for stage k (1-based). entry_states[0]=level1 ... then 'Pending Accounts', 'Pending L3'..."""
	if k <= len(entry_states):
		return entry_states[k - 1]
	return "Pending L%d" % k


# ── Rebuild safety: keep rows this config did not create ─────────────────────
# `_build` deletes the whole PM Workflow and re-inserts what the config generates. Sites hold
# routes the config cannot express — a role allowed to raise one specific journal template,
# currency-based routing — and those rows live only in the database. A rebuild used to take
# them with it, leaving the approval path quietly broken (Steel Force, 2026-07-25: Journal
# Entry lost its Counter Sale route, Purchase Order lost its currency routing).
#
# Which rows survive is decided by provenance, not by comparing shapes: every generated row
# carries is_generated=1, so anything without it was added by hand and is carried over. Rows
# predating this field have no stamp and so count as hand-added, which errs towards keeping
# them — but a legacy row identical to one the generator just produced is dropped, or the first
# rebuild after this field ships would duplicate every generated row it inherited.
# matrix_level is deliberately out: a generated row leaves it unset and the field defaults to 1
# in the database, so including it made every comparison fail
_ROW_KEY = ("state", "action", "next_state", "approver_type", "allowed", "condition")
_CHILD_META = {"name", "parent", "parentfield", "parenttype", "doctype", "idx",
               "owner", "creation", "modified", "modified_by", "docstatus"}


def _strip_meta(row):
	return {k: v for k, v in dict(row).items() if k not in _CHILD_META and v not in (None, "")}


def _signature(row):
	return tuple(cstr(row.get(f) or "").strip() for f in _ROW_KEY)


def _carry_over_manual_rows(existing, states, transitions):
	"""(extra_states, extra_transitions) to re-attach after regenerating `existing`."""
	old = frappe.get_all("PM Workflow Transition",
	                     filters={"parent": existing, "parenttype": "PM Workflow"},
	                     fields=["*"], order_by="idx asc")
	generated = {_signature(t) for t in transitions}

	kept, dropped, seen = [], [], set()
	for row in old:
		if cint(row.get("is_generated")):
			continue                       # config owns this row; the fresh generation replaces it
		if _signature(row) in generated:
			continue                       # identical to a row just generated: an unstamped legacy
			                               # copy, and re-adding it would duplicate the action
		if _signature(row) in seen:
			continue                       # the same hand-added route twice over; carry it once
		seen.add(_signature(row))
		# a row naming a role that no longer exists cannot be re-inserted
		if row.get("approver_type") == "Role" and row.get("allowed") \
				and not frappe.db.exists("Role", row.get("allowed")):
			dropped.append(row)
			continue
		kept.append(row)

	extra_states = []
	if kept:
		have = {cstr(s.get("state")) for s in states}
		old_states = {s["state"]: s for s in frappe.get_all(
			"PM Workflow Document State",
			filters={"parent": existing, "parenttype": "PM Workflow"}, fields=["*"])}
		for row in kept:
			# a carried transition is dead without the states it moves between:
			# PM Workflow.validate_docstatus throws on a transition whose state is missing
			for st in (row.get("state"), row.get("next_state")):
				if st and st not in have:
					extra_states.append(_strip_meta(old_states[st]) if st in old_states
					                    else {"state": st, "doc_status": "0"})
					have.add(st)

	if kept or dropped:
		describe = lambda r: " | ".join(cstr(r.get(f) or "") for f in
			("state", "action", "next_state", "allowed", "condition"))
		frappe.log_error(
			title="PM Workflow rebuild: %s" % existing,
			message=frappe.as_json({
				"carried_over_hand_added": [describe(r) for r in kept],
				"dropped_role_no_longer_exists": [describe(r) for r in dropped],
			}),
		)
	return extra_states, [_strip_meta(r) for r in kept]


def _build(document_type, workflow_name, states, transitions):
	ex = frappe.db.get_value("PM Workflow", {"document_type": document_type}, "name")
	# whether approval emails fire is an operational switch a site flips — Steel Force has it off
	# while no outgoing account is configured — not something this config derives, so a rebuild
	# must leave it as it found it
	send_email_alert = cint(frappe.db.get_value("PM Workflow", ex, "send_email_alert")) if ex else 1
	extra_states, extra_transitions = (
		_carry_over_manual_rows(ex, states, transitions) if ex else ([], []))
	if ex:
		frappe.delete_doc("PM Workflow", ex, force=1)
	frappe.get_doc({
		"doctype": "PM Workflow", "workflow_name": workflow_name, "document_type": document_type,
		"is_active": 1, "workflow_state_field": "workflow_state",
		"send_email_alert": send_email_alert,
		"states": states + extra_states, "transitions": transitions + extra_transitions,
	}).insert(ignore_permissions=True)


def _group_stage_transitions(groups, cond_for, level1_state, level2_plus):
	"""Generate per-group multi-stage approve/reject transitions.
	level1_state = state where stage 1 acts; level2_plus = list starting at stage-2 state."""
	entry = [level1_state] + level2_plus
	tx = []
	for gname, cfg in groups.items():
		stages = cfg["stages"]
		cond = cond_for(gname, cfg)
		if not cond:
			continue
		n = len(stages)
		for i, sd in enumerate(stages, start=1):
			state = _stage_states(entry, i)
			nxt = "Approved" if i == n else _stage_states(entry, i + 1)
			role = sd["approver_role"]
			# self-approval is off unless the stage asks for it: an approver clearing their own
			# document collapses the chain to one person, so it stays opt-in per stage
			tx.append(_t(state, "Approve", nxt, role, cond=cond,
			             attach=int(sd.get("require_attachment") or 0),
			             self_appr=int(sd.get("allow_self_approval") or 0)))
			tx.append(_t(state, "Reject", "Rejected", role, cond=cond, rfc=1, comment=1))
	return tx


def _max_level(groups):
	return max([len(c["stages"]) for c in groups.values()] + [2])


def _build_pi(groups):
	cur = _company_currency()
	LOCAL = "doc.is_return or ((not doc.custom_approval_group) and doc.currency == %r)" % cur
	IMPORT = "(not doc.custom_approval_group) and (not doc.is_return) and doc.currency != %r" % cur
	tx = [
		_t("Draft", "Send for Approval", "Pending", PI_INITIATE_ROLE, self_appr=1),
		_t("Pending", "Approve", "Approved", PI_LOCAL_ROLE, cond=LOCAL),
		_t("Pending", "Reject", "Rejected", PI_LOCAL_ROLE, cond=LOCAL, rfc=1, comment=1),
		_t("Pending", "Approve", "Approved", PI_IMPORT_ROLE, cond=IMPORT),
		_t("Pending", "Reject", "Rejected", PI_IMPORT_ROLE, cond=IMPORT, rfc=1, comment=1),
	]
	tx += _group_stage_transitions(
		groups, lambda g, c: "doc.custom_approval_group == %r" % g,
		"Pending", ["Pending Accounts"] + ["Pending L%d" % k for k in range(3, _max_level(groups) + 1)])
	tx.append(_t("Rejected", "Send for Approval", "Pending", PI_INITIATE_ROLE, self_appr=1))
	states = [_st("Draft", "0", PI_INITIATE_ROLE), _st("Pending", "0", "Purchase Manager"),
	          _st("Pending Accounts", "0", "Accountant"),
	          _st("Approved", "1", "Purchase Manager"), _st("Rejected", "0", PI_INITIATE_ROLE)]
	for k in range(3, _max_level(groups) + 1):
		states.append(_st("Pending L%d" % k, "0", "Accountant"))
	_build("Purchase Invoice", "Purchase Invoice Approval", states, tx)


def _build_je(groups):
	# Templates in JE_DIRECT_TEMPLATES submit like an untemplated JV; everything else routes.
	# With no direct templates configured these are the original two conditions, unchanged.
	direct = _pytuple(JE_DIRECT_TEMPLATES) if JE_DIRECT_TEMPLATES else None
	NORMAL = ("not doc.from_template or doc.from_template in %s" % direct) if direct else "not doc.from_template"
	ROUTED = ("doc.from_template and doc.from_template not in %s" % direct) if direct else "doc.from_template"
	tx = [
		_t("Draft", "Submit", "Approved", JE_INITIATE_ROLE, cond=NORMAL, self_appr=1),
		_t("Draft", "Send for Approval", "Pending Dept", JE_INITIATE_ROLE, cond=ROUTED, self_appr=1, attach=1),
	]
	if direct:
		# the accounts team owns these postings, so an Accountant can submit one even without
		# the Accounts User role
		DIRECT_ONLY = "doc.from_template in %s" % direct
		tx.append(_t("Draft", "Submit", "Approved", JE_DIRECT_EXTRA_ROLE, cond=DIRECT_ONLY, self_appr=1))
		tx.append(_t("Rejected", "Submit", "Approved", JE_DIRECT_EXTRA_ROLE, cond=DIRECT_ONLY, self_appr=1))
	def cond_for(g, c):
		return ("doc.from_template in %s" % _pytuple(c["templates"])) if c["templates"] else None
	tx += _group_stage_transitions(
		groups, cond_for,
		"Pending Dept", ["Pending Accounts"] + ["Pending L%d" % k for k in range(3, _max_level(groups) + 1)])
	tx.append(_t("Rejected", "Send for Approval", "Pending Dept", JE_INITIATE_ROLE, cond=ROUTED, self_appr=1, attach=1))
	tx.append(_t("Rejected", "Submit", "Approved", JE_INITIATE_ROLE, cond=NORMAL, self_appr=1))
	states = [_st("Draft", "0", JE_INITIATE_ROLE), _st("Pending Dept", "0", JE_INITIATE_ROLE),
	          _st("Pending Accounts", "0", "Accountant"),
	          _st("Approved", "1", JE_INITIATE_ROLE), _st("Rejected", "0", JE_INITIATE_ROLE)]
	for k in range(3, _max_level(groups) + 1):
		states.append(_st("Pending L%d" % k, "0", "Accountant"))
	_build("Journal Entry", "Journal Entry Approval", states, tx)


def _build_po(groups):
	"""Purchase Order: normal POs → Branch Head. Send requires a Quotation attachment
	UNLESS 'Verbal' is ticked (mandatory Verbal Comment stands in). Fixed-asset POs
	(custom_approval_group == 'Asset') route through the Asset chain instead."""
	VERBAL = "doc.custom_verbal"
	NOTVERBAL = "not doc.custom_verbal"
	NOASSET = "not doc.custom_approval_group"
	tx = [
		_t("Draft", "Send for Approval", "Pending", "Purchase User", cond=VERBAL, self_appr=1),
		_t("Draft", "Send for Approval", "Pending", "Purchase User", cond=NOTVERBAL, self_appr=1, attach=1),
		_t("Pending", "Approve", "Approved", "Branch Head", cond=NOASSET),
		_t("Pending", "Reject", "Rejected", "Branch Head", cond=NOASSET, rfc=1, comment=1),
		_t("Rejected", "Send for Approval", "Pending", "Purchase User", cond=VERBAL, self_appr=1),
		_t("Rejected", "Send for Approval", "Pending", "Purchase User", cond=NOTVERBAL, self_appr=1, attach=1),
	]
	asset = {k: v for k, v in (groups or {}).items() if k == ASSET_GROUP}
	states = [_st("Draft", "0", "Purchase User"), _st("Pending", "0", "Branch Head"),
	          _st("Approved", "1", "Purchase Manager"), _st("Rejected", "0", "Purchase User")]
	if asset:
		maxl = _max_level(asset)
		tx += _group_stage_transitions(
			asset, lambda g, c: "doc.custom_approval_group == %r" % g,
			"Pending", ["Pending Accounts"] + ["Pending L%d" % k for k in range(3, maxl + 1)])
		states.append(_st("Pending Accounts", "0", "Accountant"))
		for k in range(3, maxl + 1):
			states.append(_st("Pending L%d" % k, "0", "Accountant"))
	_build("Purchase Order", "Purchase Order Approval", states, tx)


def _build_payment_entry():
	"""Payment Entry: supplier payments route by category (stamped on custom_payment_category).
	Non-supplier payments (no category) submit directly, so customer receipts / internal
	transfers are never dragged through the supplier-approval flow."""
	pe_groups = {
		k: {"stages": [{"approver_role": r, "require_attachment": 0, "require_comment": 0} for r in chain],
		    "templates": []}
		for k, chain in PE_CHAINS.items()
	}
	maxl = _max_level(pe_groups)
	CAT = "doc.custom_payment_category"          # truthy → a supplier category was stamped
	NOCAT = "not doc.custom_payment_category"     # receipts / internal / uncategorised
	tx = [
		_t("Draft", "Submit", "Approved", PE_INITIATE_ROLE, cond=NOCAT, self_appr=1),
		_t("Draft", "Send for Approval", "Pending", PE_INITIATE_ROLE, cond=CAT, self_appr=1, attach=1),
	]
	tx += _group_stage_transitions(
		pe_groups, lambda g, c: PE_COND[g],
		"Pending", ["Pending Accounts"] + ["Pending L%d" % k for k in range(3, maxl + 1)])
	tx.append(_t("Rejected", "Submit", "Approved", PE_INITIATE_ROLE, cond=NOCAT, self_appr=1))
	tx.append(_t("Rejected", "Send for Approval", "Pending", PE_INITIATE_ROLE, cond=CAT, self_appr=1, attach=1))
	states = [_st("Draft", "0", PE_INITIATE_ROLE), _st("Pending", "0", "Finance Manager"),
	          _st("Pending Accounts", "0", "Accountant"),
	          _st("Approved", "1", "Accountant"), _st("Rejected", "0", PE_INITIATE_ROLE)]
	for k in range(3, maxl + 1):
		states.append(_st("Pending L%d" % k, "0", "Accountant"))
	_build("Payment Entry", "Payment Entry Approval", states, tx)


def _grant_perms():
	"""Give every role used in the two workflows the DocType perms it needs, so
	apply_workflow (which saves/submits AS the acting user) doesn't hit PermissionError."""
	from frappe.permissions import add_permission, update_permission_property

	def has(dt, role, ptype):
		for src in ("Custom DocPerm", "DocPerm"):
			for r in frappe.get_all(src, {"parent": dt, "role": role, "permlevel": 0}, [ptype]):
				if r.get(ptype):
					return True
		return False

	for dt in ("Purchase Order", "Purchase Invoice", "Journal Entry", "Payment Entry"):
		wf = frappe.db.get_value("PM Workflow", {"document_type": dt}, "name")
		if not wf:
			continue
		d = frappe.get_doc("PM Workflow", wf)
		ds = {s.state: str(s.doc_status) for s in d.states}
		roles, creators, submitters = set(s.allow_edit for s in d.states if s.allow_edit), set(), set()
		for t in d.transitions:
			roles.add(t.allowed)
			if t.state == "Draft":
				creators.add(t.allowed)
			if ds.get(t.next_state) == "1":
				submitters.add(t.allowed)
		for role in roles:
			if not frappe.db.exists("Role", role):
				continue
			if not has(dt, role, "write"):
				add_permission(dt, role, 0)
				update_permission_property(dt, role, 0, "read", 1, validate=False)
				update_permission_property(dt, role, 0, "write", 1, validate=False)
			if role in creators and not has(dt, role, "create"):
				add_permission(dt, role, 0)
				update_permission_property(dt, role, 0, "create", 1, validate=False)
			if role in submitters and not has(dt, role, "submit"):
				add_permission(dt, role, 0)
				update_permission_property(dt, role, 0, "submit", 1, validate=False)


def rebuild_approval_workflows():
	"""Regenerate the Purchase Invoice + Journal Entry PM Workflows from PM Approval
	Group configs. Safe to call repeatedly (idempotent rebuild)."""
	groups = _load_groups()
	# Payment Entry chains are up to 3 deep, so ensure Pending L3 masters exist even
	# when no account group reaches level 3.
	_ensure_masters(max(_max_level(groups) if groups else 2, 3))
	_build_po(groups)
	_build_pi(groups)
	_build_je(groups)
	_build_payment_entry()
	_grant_perms()
	frappe.db.commit()
	frappe.clear_cache()


@frappe.whitelist()
def sync_approval_workflows():
	"""Manual trigger (button / bench execute)."""
	frappe.only_for(("System Manager", "Administrator"))
	rebuild_approval_workflows()
	return "Approval workflows rebuilt from PM Approval Group configs."
