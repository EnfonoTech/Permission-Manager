# permission_manager/permission_manager/api/approval_group.py
"""Account-driven, config-driven approval routing (company-agnostic).

Two pieces:
  1. Stamping — the approval group of a transaction is derived from the ACCOUNT on
     its lines (tag accounts with `custom_approval_group`, no account numbers).
  2. Chains as data — each group's approver chain lives in the **PM Approval Group**
     doctype (ordered `stages` of roles). `rebuild_approval_workflows()` regenerates
     the Purchase Invoice + Journal Entry PM Workflows from those configs, so admins
     change who approves by editing data — never code or transitions.
"""

import frappe

FIELD = "custom_approval_group"

# ── Fixed (non-group) routing constants ──────────────────────────────────────
PI_INITIATE_ROLE = "Purchase User"          # creates + sends the invoice
PI_LOCAL_ROLE = "Purchase Assistant"        # material, company currency (and returns)
PI_IMPORT_ROLE = "Purchase Manager"         # material, foreign currency
JE_INITIATE_ROLE = "Accounts User"          # creates + sends / submits normal JVs


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


def stamp_purchase_invoice(doc, method=None):
	"""before_save(Purchase Invoice): set custom_approval_group from the first expense
	line whose account (or an ancestor) carries a group. Empty = normal material."""
	if not frappe.db.has_column("Account", FIELD):
		return
	group = ""
	for item in (doc.get("items") or []):
		acc = item.get("expense_account")
		if acc:
			g = account_group(acc)
			if g:
				group = g
				break
	doc.set(FIELD, group)


# ═══════════════════════════ workflow generator ══════════════════════════════
def _st(state, ds, role):
	return {"state": state, "doc_status": ds, "edit_permission_type": "Role", "allow_edit": role}


def _t(state, action, nxt, role, cond=None, self_appr=0, attach=0, comment=0, rfc=0):
	r = {"state": state, "action": action, "next_state": nxt, "approver_type": "Role",
	     "allowed": role, "allow_self_approval": self_appr, "require_attachment": attach,
	     "require_comment": comment, "is_return_for_correction": rfc}
	if cond:
		r["condition"] = cond
	return r


def _load_groups():
	"""{group_name: {"stages": [ {role, attach, comment} ], "templates": [names]}}"""
	out = {}
	for g in frappe.get_all("PM Approval Group", filters={"disabled": 0},
	                        fields=["name", "group_name", "journal_templates"]):
		stages = frappe.get_all("PM Approval Group Stage", filters={"parent": g.name},
		                        fields=["approver_role", "require_attachment", "require_comment"],
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


def _build(document_type, workflow_name, states, transitions):
	ex = frappe.db.get_value("PM Workflow", {"document_type": document_type}, "name")
	if ex:
		frappe.delete_doc("PM Workflow", ex, force=1)
	frappe.get_doc({
		"doctype": "PM Workflow", "workflow_name": workflow_name, "document_type": document_type,
		"is_active": 1, "workflow_state_field": "workflow_state", "send_email_alert": 1,
		"states": states, "transitions": transitions,
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
			tx.append(_t(state, "Approve", nxt, role, cond=cond, attach=int(sd.get("require_attachment") or 0)))
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
	NORMAL = "not doc.from_template"
	ROUTED = "doc.from_template"
	tx = [
		_t("Draft", "Submit", "Approved", JE_INITIATE_ROLE, cond=NORMAL, self_appr=1),
		_t("Draft", "Send for Approval", "Pending Dept", JE_INITIATE_ROLE, cond=ROUTED, self_appr=1, attach=1),
	]
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


def _build_po():
	"""Purchase Order: Branch Head approves. Send requires a Quotation attachment,
	UNLESS 'Verbal' is ticked — then the mandatory Verbal Comment stands in and no
	attachment is required."""
	VERBAL = "doc.custom_verbal"
	NOTVERBAL = "not doc.custom_verbal"
	tx = [
		_t("Draft", "Send for Approval", "Pending", "Purchase User", cond=VERBAL, self_appr=1),
		_t("Draft", "Send for Approval", "Pending", "Purchase User", cond=NOTVERBAL, self_appr=1, attach=1),
		_t("Pending", "Approve", "Approved", "Branch Head"),
		_t("Pending", "Reject", "Rejected", "Branch Head", rfc=1, comment=1),
		_t("Rejected", "Send for Approval", "Pending", "Purchase User", cond=VERBAL, self_appr=1),
		_t("Rejected", "Send for Approval", "Pending", "Purchase User", cond=NOTVERBAL, self_appr=1, attach=1),
	]
	states = [_st("Draft", "0", "Purchase User"), _st("Pending", "0", "Branch Head"),
	          _st("Approved", "1", "Purchase Manager"), _st("Rejected", "0", "Purchase User")]
	_build("Purchase Order", "Purchase Order Approval", states, tx)


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

	for dt in ("Purchase Order", "Purchase Invoice", "Journal Entry"):
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
	_ensure_masters(_max_level(groups) if groups else 2)
	_build_po()
	_build_pi(groups)
	_build_je(groups)
	_grant_perms()
	frappe.db.commit()
	frappe.clear_cache()


@frappe.whitelist()
def sync_approval_workflows():
	"""Manual trigger (button / bench execute)."""
	frappe.only_for(("System Manager", "Administrator"))
	rebuild_approval_workflows()
	return "Approval workflows rebuilt from PM Approval Group configs."
