"""
Permission Manager — AI Workflow Generator
Calls the Claude API to convert a plain-English requirement into a structured
PM Workflow configuration (states + transitions), then auto-creates any missing
Workflow State and Workflow Action Master records before returning the config
to the caller.
"""

import json
import frappe
from frappe import _

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """
You are a Frappe / ERPNext workflow configuration expert for the Permission Manager app.

Given a plain-English business requirement, output a JSON object that describes a
PM Workflow.  Follow these rules exactly:

STATES array — each item:
  {
    "state":               "<Workflow State name>",
    "doc_status":          "0" | "1" | "2",   // 0=Draft, 1=Submitted, 2=Cancelled
    "edit_permission_type": "Role" | "User",
    "allow_edit":          "<role or user>",
    "is_optional_state":   false,
    "send_email":          true | false
  }

  Rules:
  - First state is always doc_status "0" (draft).
  - The final approved/accepted state is doc_status "1" (submitted) — it means the
    document is physically submitted in Frappe, i.e. stock moves, journal entries post.
  - Rejection/return states revert to doc_status "0".
  - Never use doc_status "2" unless the requirement explicitly mentions cancellation.

TRANSITIONS array — each item:
  {
    "state":                  "<from state>",
    "action":                 "<Workflow Action Master name>",
    "next_state":             "<to state>",
    "approver_type":          "Role" | "User",
    "allowed":                "<role or user name>",
    "condition":              "<python expression or empty string>",
    "is_return_for_correction": false | true,
    "allow_self_approval":    true | false,
    "require_comment":        false | true
  }

  Rules:
  - Return/reject transitions must have is_return_for_correction: true and require_comment: true.
  - Self-approval should be false for approval steps, true for initial submission steps.
  - Conditions should use doc fields (e.g. doc.purpose == "Material Transfer") or
    frappe.session.user comparisons.  Leave empty string when not needed.
  - Common ERPNext roles: "Stock User", "Stock Manager", "Accounts User", "Accounts Manager",
    "HR User", "HR Manager", "Purchase User", "Purchase Manager", "System Manager".

SUGGESTED_WORKFLOW_NAME: a short, descriptive name string.
DOCUMENT_TYPE: the Frappe DocType this workflow applies to (e.g. "Stock Entry",
  "Purchase Order", "Leave Application", "Expense Claim", "Journal Entry").

Output ONLY valid JSON in this exact shape — no markdown fences, no explanation:
{
  "suggested_workflow_name": "...",
  "document_type": "...",
  "states": [ ... ],
  "transitions": [ ... ]
}
"""

# ── Public API ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def generate_workflow_from_requirement(
    requirement: str,
    provider: str = "claude",
    api_key: str = None,
) -> dict:
    """
    Convert a plain-English requirement into a PM Workflow configuration.

    provider: "claude"      — Anthropic direct API
              "deepclaude"  — DeepClaude proxy (OpenAI-compatible)

    Returns the parsed config dict.  Does NOT create any records yet —
    call create_workflow_from_config to persist.
    """
    frappe.has_permission("PM Workflow", ptype="create", throw=True)

    if not requirement or not requirement.strip():
        frappe.throw(_("Please provide a workflow requirement."))

    provider = (provider or "claude").lower().strip()

    if provider == "deepclaude":
        settings_key_field = "deepclaude_api_key"
        key_label = "DeepClaude API Key"
    else:
        settings_key_field = "claude_api_key"
        key_label = "Claude API Key"

    key = api_key or frappe.db.get_single_value("PM Settings", settings_key_field) or ""
    if not key:
        frappe.throw(
            _("{0} not configured. Add it in PM Settings → {0} or pass it directly.").format(key_label)
        )

    if provider == "deepclaude":
        raw = _call_deepclaude(key, requirement.strip())
    else:
        raw = _call_claude(key, requirement.strip())

    config = _parse_config(raw)
    return config


@frappe.whitelist()
def create_workflow_from_config(config: str) -> dict:
    """
    Given a config JSON string (as returned by generate_workflow_from_requirement),
    create missing Workflow State and Workflow Action Master records, then return
    the config ready for the PM Workflow form to pre-fill.
    """
    frappe.has_permission("PM Workflow", ptype="create", throw=True)

    config = frappe.parse_json(config)
    created_states  = _ensure_workflow_states(config.get("states", []))
    created_actions = _ensure_workflow_actions(config.get("transitions", []))

    return {
        "config":          config,
        "created_states":  created_states,
        "created_actions": created_actions,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _call_claude(api_key: str, requirement: str) -> str:
    """Call the Anthropic API directly (native messages format)."""
    import requests

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key":         api_key,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        json={
            "model":      "claude-sonnet-4-6",
            "max_tokens": 2048,
            "system":     _SYSTEM_PROMPT,
            "messages":   [{"role": "user", "content": requirement}],
        },
        timeout=60,
    )

    if resp.status_code != 200:
        frappe.throw(
            _("Claude API error {0}: {1}").format(resp.status_code, resp.text[:300])
        )

    data = resp.json()
    return data["content"][0]["text"]


def _call_deepclaude(api_key: str, requirement: str) -> str:
    """Call the DeepClaude proxy (OpenAI-compatible chat/completions format)."""
    import requests

    resp = requests.post(
        "https://api.deepclaude.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "content-type":  "application/json",
        },
        json={
            "model":      "claude-sonnet-4-6",
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
            _("DeepClaude API error {0}: {1}").format(resp.status_code, resp.text[:300])
        )

    data = resp.json()
    return data["choices"][0]["message"]["content"]


def _parse_config(raw: str) -> dict:
    raw = raw.strip()
    # Strip markdown code fences if the model wrapped the JSON
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(
            l for l in lines if not l.startswith("```")
        ).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        frappe.throw(_("Could not parse Claude response as JSON: {0}").format(str(e)))


def _ensure_workflow_states(states: list) -> list:
    """Create Workflow State records that don't exist yet."""
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
    """Create Workflow Action Master records that don't exist yet."""
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
