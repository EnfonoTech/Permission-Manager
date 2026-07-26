# permission_manager/permission_manager/api/material_request_transfers.py
"""What has already been transferred against a Material Request.

ERPNext's own progress fields cannot answer this while a PM Workflow is in play.
`MaterialRequest.get_mr_items_ordered_qty()` sums Stock Entry Detail rows `WHERE docstatus = 1`,
so a transfer sitting in Draft or Pending Acceptance counts for nothing: `ordered_qty` stays 0,
`per_ordered` stays 0, and the status stays Pending. The form therefore looks untouched and the
next person raises the transfer again.

That is how Steel Force ended up with five identical transfers of 15,761 units against
MAT-MR-2026-00156-1 (2026-07-26) — 5× the requested quantity, all of them in Pending Acceptance,
none of them visible to ERPNext's counters.

This module counts what ERPNext will not: every non-cancelled Stock Entry row, split by whether
it is submitted or still awaiting approval, so the form can say plainly whether a further
transfer is warranted.
"""

import frappe
from frappe import _
from frappe.utils import flt

# Verdicts, in increasing order of "stop"
NONE = "none"           # nothing transferred yet — go ahead
PARTIAL = "partial"     # some quantity still outstanding — a further transfer is legitimate
COVERED = "covered"     # every line is accounted for — another transfer would duplicate
OVER = "over"           # more than requested is already in flight — something is wrong


HEADLINES = {
    NONE: "No transfer raised yet",
    PARTIAL: "Partially transferred — a further transfer covers the remainder",
    COVERED: "Already fully transferred — do not raise another",
    OVER: "More has been transferred than requested",
}


def _empty(material_request: str = None, status: str = None) -> dict:
    """Nothing to warn about, in the same shape as a real answer.

    Every caller gets the same keys whichever branch it took — an early return that dropped
    `totals` and `headline` broke a caller that read them unconditionally.
    """
    return {
        "verdict": NONE,
        "material_request": material_request,
        "status": status,
        "lines": [],
        "outstanding": [],
        "over_lines": [],
        "stock_entries": [],
        "totals": {"requested": 0.0, "submitted": 0.0, "pending": 0.0, "remaining": 0.0},
        "headline": _(HEADLINES[NONE]),
    }


@frappe.whitelist()
def get_transfer_summary(material_request: str) -> dict:
    """Per-line and overall transfer position for one Material Request.

    Read-only. Returns a verdict the form turns into a banner, the lines that are still
    outstanding, and every Stock Entry involved so the user can open them directly.
    """
    frappe.has_permission("Material Request", "read", doc=material_request, throw=True)

    mr = frappe.db.get_value(
        "Material Request",
        material_request,
        ["name", "docstatus", "material_request_type", "status"],
        as_dict=True,
    )
    if not mr or mr.docstatus != 1 or mr.material_request_type != "Material Transfer":
        return _empty(material_request, mr.status if mr else None)

    requested = frappe.get_all(
        "Material Request Item",
        filters={"parent": material_request},
        fields=["name", "item_code", "stock_qty", "uom", "stock_uom"],
        order_by="idx asc",
    )
    if not requested:
        return _empty(material_request, mr.status)

    # Sum the transfers per requested line, keeping submitted and not-yet-submitted apart:
    # a submitted transfer is done, one awaiting approval is a commitment nobody can see.
    moved = frappe.db.sql(
        """
        SELECT sed.material_request_item AS line,
               SUM(CASE WHEN sed.docstatus = 1 THEN sed.transfer_qty ELSE 0 END) AS submitted_qty,
               SUM(CASE WHEN sed.docstatus = 0 THEN sed.transfer_qty ELSE 0 END) AS pending_qty
        FROM   `tabStock Entry Detail` sed
        WHERE  sed.material_request = %(mr)s
          AND  sed.docstatus < 2
        GROUP BY sed.material_request_item
        """,
        {"mr": material_request},
        as_dict=True,
    )
    by_line = {r.line: r for r in moved}

    lines, outstanding, over_lines = [], [], []
    for row in requested:
        tally = by_line.get(row.name)
        submitted = flt(tally.submitted_qty) if tally else 0.0
        pending = flt(tally.pending_qty) if tally else 0.0
        remaining = flt(row.stock_qty) - submitted - pending
        line = {
            "item_code": row.item_code,
            "requested": flt(row.stock_qty),
            "submitted": submitted,
            "pending": pending,
            "remaining": remaining,
            "uom": row.stock_uom or row.uom,
        }
        lines.append(line)
        # a hair of tolerance: transfer_qty carries UOM conversion rounding
        if remaining > 0.001:
            outstanding.append(line)
        elif remaining < -0.001:
            over_lines.append(line)

    stock_entries = frappe.db.sql(
        """
        SELECT   se.name, se.docstatus, ifnull(se.workflow_state, '') AS workflow_state,
                 se.owner, se.creation, se.posting_date,
                 ifnull(se.from_warehouse, '') AS from_warehouse,
                 ifnull(se.to_warehouse, '') AS to_warehouse,
                 SUM(sed.transfer_qty) AS qty
        FROM     `tabStock Entry Detail` sed
        JOIN     `tabStock Entry` se ON se.name = sed.parent
        WHERE    sed.material_request = %(mr)s
          AND    sed.docstatus < 2
        GROUP BY se.name
        ORDER BY se.creation ASC
        """,
        {"mr": material_request},
        as_dict=True,
    )

    if not stock_entries:
        verdict = NONE
    elif over_lines:
        verdict = OVER
    elif outstanding:
        verdict = PARTIAL
    else:
        verdict = COVERED

    return {
        "verdict": verdict,
        "material_request": material_request,
        "status": mr.status,
        "lines": lines,
        "outstanding": outstanding,
        "over_lines": over_lines,
        "stock_entries": stock_entries,
        "totals": {
            "requested": sum(l["requested"] for l in lines),
            "submitted": sum(l["submitted"] for l in lines),
            "pending": sum(l["pending"] for l in lines),
            "remaining": sum(l["remaining"] for l in lines),
        },
        # Said once here so the form, a report or a bench console all phrase it the same way
        "headline": _(HEADLINES[verdict]),
    }
