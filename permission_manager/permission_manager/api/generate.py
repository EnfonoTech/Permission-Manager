"""
Permission Manager — AI Workflow Generator
Reads provider + API key from PM Settings (Single doctype), then calls the
configured AI provider to convert a plain-English requirement into a structured
PM Workflow configuration (states + transitions).
"""

import json
import frappe
from frappe import _

# ── Provider defaults ─────────────────────────────────────────────────────────

_PROVIDER_DEFAULTS = {
    "claude (anthropic)": {
        "model": "claude-sonnet-4-6",
    },
    "deepclaude": {
        "model": "claude-sonnet-4-6",
    },
    "groq": {
        "model": "llama-3.3-70b-versatile",
    },
}

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """
You are a Frappe / ERPNext workflow configuration expert for the Permission Manager (PM) app.

Given a plain-English requirement, output a JSON object describing a PM Workflow.
Output ONLY valid JSON — no markdown fences, no explanation:

{
  "suggested_workflow_name": "...",
  "document_type": "...",
  "states": [ <STATE>, ... ],
  "transitions": [ <TRANSITION>, ... ]
}

━━━ STATE shape ━━━
{
  "state":                "<Workflow State name>",
  "doc_status":           "0" | "1" | "2",
  "edit_permission_type": "Role" | "User",
  "allow_edit":           "<exact ERPNext role or email>",
  "is_optional_state":    false | true,
  "send_email":           false | true
}

doc_status rules:
  "0" = Draft  (editable, not submitted)
  "1" = Submitted  (final accepted state — ledger entries post, stock moves)
  "2" = Cancelled  (only when requirement explicitly mentions cancellation)
  • First state → "0".  Final approved/accepted state → "1".
  • Rejected / returned states → "0" (document reverts to draft).
  • NEVER use "Creator" as allow_edit — use the actual role (e.g. "Stock User").

Common roles for allow_edit:
  "Stock User", "Stock Manager", "Accounts User", "Accounts Manager",
  "HR User", "HR Manager", "Purchase User", "Purchase Manager", "System Manager"

━━━ TRANSITION shape ━━━
{
  "state":                    "<from state>",
  "action":                   "<action label shown on button>",
  "next_state":               "<to state>",

  // ── Approver — choose ONE approach ──────────────────────────────────
  // Option A: Role or specific User (most common)
  "use_approver_matrix":      false,
  "approver_type":            "Role" | "User",
  "allowed":                  "<role or email>",
  "matrix_level":             null,
  "matrix_fallback_role":     "",

  // Option B: Employee Approver Matrix (for HR/expense multi-level chains)
  // Set use_approver_matrix=true; approver_type and allowed are ignored.
  "use_approver_matrix":      true,
  "matrix_level":             1,                  // 1 = direct manager, 2 = HOD, etc.
  "matrix_fallback_role":     "<role>",           // used if no chain entry found
  "approver_type":            "",
  "allowed":                  "",
  // ────────────────────────────────────────────────────────────────────

  "allow_self_approval":      true | false,
  "require_comment":          false | true,
  "is_return_for_correction": false | true,
  "condition":                "<python expression or empty string>"
}

Transition rules:
  • Initial submit (creator sends for approval): allow_self_approval=true, use_approver_matrix=false.
  • Approval steps: allow_self_approval=false.
  • Reject/return: is_return_for_correction=true, require_comment=true, next_state reverts to draft state.
  • Use use_approver_matrix=true ONLY when the requirement mentions "manager approval",
    "multi-level", "HOD", "reporting manager", or similar hierarchy terms.
  • Conditions: doc-level fields only, e.g. doc.purpose == "Material Transfer".
    Leave "" when no condition is needed.
  • NEVER use frappe.session.user inside conditions — that is evaluated at routing time separately.
"""

# ── Public API ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def generate_workflow_from_requirement(requirement: str) -> dict:
    """
    Convert a plain-English requirement into a PM Workflow configuration.
    Provider and API key are read from PM Settings.
    """
    frappe.has_permission("PM Workflow", ptype="create", throw=True)

    if not requirement or not requirement.strip():
        frappe.throw(_("Please provide a workflow requirement."))

    settings   = frappe.get_single("PM Settings")
    provider   = (settings.ai_provider or "Claude (Anthropic)").strip().lower()
    api_key    = settings.get_password("api_key") if settings.api_key else ""
    model      = (settings.ai_model or "").strip() or _PROVIDER_DEFAULTS.get(provider, {}).get("model", "")

    if not api_key:
        frappe.throw(_("API key not configured. Go to PM Settings and set the API Key."))

    raw = _call_provider(provider, api_key, model, requirement.strip())
    return _parse_config(raw)


@frappe.whitelist()
def create_workflow_from_config(config: str) -> dict:
    """
    Given the config JSON returned by generate_workflow_from_requirement,
    auto-create missing Workflow State and Workflow Action Master records.
    """
    frappe.has_permission("PM Workflow", ptype="create", throw=True)

    config          = frappe.parse_json(config)
    created_states  = _ensure_workflow_states(config.get("states", []))
    created_actions = _ensure_workflow_actions(config.get("transitions", []))

    return {
        "config":          config,
        "created_states":  created_states,
        "created_actions": created_actions,
    }


# ── Provider dispatch ─────────────────────────────────────────────────────────

def _call_provider(provider: str, api_key: str, model: str, requirement: str) -> str:
    if provider == "groq":
        return _call_openai_compatible(
            url="https://api.groq.com/openai/v1/chat/completions",
            api_key=api_key,
            model=model or "llama-3.3-70b-versatile",
            requirement=requirement,
            provider_label="Groq",
        )
    if provider == "deepclaude":
        return _call_openai_compatible(
            url="https://api.deepclaude.com/v1/chat/completions",
            api_key=api_key,
            model=model or "claude-sonnet-4-6",
            requirement=requirement,
            provider_label="DeepClaude",
        )
    # Default: Anthropic direct
    return _call_claude(api_key, model or "claude-sonnet-4-6", requirement)


def _call_claude(api_key: str, model: str, requirement: str) -> str:
    """Anthropic native messages API."""
    import requests

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key":         api_key,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        json={
            "model":      model,
            "max_tokens": 2048,
            "system":     _SYSTEM_PROMPT,
            "messages":   [{"role": "user", "content": requirement}],
        },
        timeout=60,
    )
    if resp.status_code != 200:
        frappe.throw(_("Claude API error {0}: {1}").format(resp.status_code, resp.text[:400]))
    return resp.json()["content"][0]["text"]


def _call_openai_compatible(
    url: str, api_key: str, model: str, requirement: str, provider_label: str
) -> str:
    """OpenAI-compatible chat/completions endpoint (Groq, DeepClaude, etc.)."""
    import requests

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "content-type":  "application/json",
        },
        json={
            "model":      model,
            "max_tokens": 2048,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": requirement},
            ],
        },
        timeout=60,
    )
    if resp.status_code != 200:
        frappe.throw(
            _("{0} API error {1}: {2}").format(provider_label, resp.status_code, resp.text[:400])
        )
    return resp.json()["choices"][0]["message"]["content"]


# ── Config parsing & record creation ─────────────────────────────────────────

def _parse_config(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = "\n".join(l for l in raw.splitlines() if not l.startswith("```")).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        frappe.throw(_("Could not parse AI response as JSON: {0}").format(str(e)))


def _ensure_workflow_states(states: list) -> list:
    created = []
    for s in states:
        name = s.get("state")
        if not name:
            continue
        if not frappe.db.exists("Workflow State", name):
            frappe.get_doc({
                "doctype": "Workflow State",
                "workflow_state_name": name,
                "style": _guess_style(name),
            }).insert(ignore_permissions=True)
            created.append(name)
    return created


def _ensure_workflow_actions(transitions: list) -> list:
    created = []
    seen = set()
    for t in transitions:
        name = t.get("action")
        if not name or name in seen:
            continue
        seen.add(name)
        if not frappe.db.exists("Workflow Action Master", name):
            frappe.get_doc({
                "doctype": "Workflow Action Master",
                "workflow_action_name": name,
            }).insert(ignore_permissions=True)
            created.append(name)
    return created


def _guess_style(state_name: str) -> str:
    name = state_name.lower()
    if any(w in name for w in ("approved", "accepted", "complete", "done", "paid")):
        return "Success"
    if any(w in name for w in ("reject", "cancel", "denied", "failed")):
        return "Danger"
    if any(w in name for w in ("pending", "review", "waiting", "hold")):
        return "Warning"
    if any(w in name for w in ("draft", "new", "open")):
        return "Primary"
    return "Secondary"
