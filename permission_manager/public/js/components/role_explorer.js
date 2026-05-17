// Permission Manager — Role Explorer Component
// Author: siva <siva@enfono.com>
// Supports read-only and inline-edit modes for the Role View.

import { MATRIX_RIGHTS, RIGHT_LABELS, RIGHT_FULL_LABELS, esc } from "../utils/helpers";

export class RoleExplorer {
	constructor(opts) {
		this.wrapper = opts.wrapper;
		this.data = opts.data;
		this._edit_mode = false;
		this.render();
	}

	render() {
		this.wrapper.empty();
		const d = this.data;

		// ── Header ────────────────────────────────────────────────────────────
		this.wrapper.append($(`
			<div class="ps-matrix-header">
				<div class="ps-role-info">
					<h3>${esc(d.role)}</h3>
					<div class="ps-stats">
						${__("{0} DocTypes across {1} modules", [d.total_doctypes, d.modules.length])}
						&nbsp;|&nbsp;
						${__("{0} users have this role", [d.user_count])}
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					<button class="btn btn-xs ${this._edit_mode ? "btn-primary" : "btn-default"} ps-role-edit-btn">
						${frappe.utils.icon(this._edit_mode ? "tick" : "edit", "xs")}
						${this._edit_mode ? __("Done Editing") : __("Edit Permissions")}
					</button>
				</div>
			</div>
		`));

		this.wrapper.find(".ps-role-edit-btn").on("click", () => this._toggle_edit_mode());

		if (!d.modules || !d.modules.length) {
			this.wrapper.append(
				$(`<div class="ps-empty-state">${__("This role has no permissions assigned to any DocType.")}</div>`)
			);
			return;
		}

		if (this._edit_mode) {
			this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info", "xs")}
					${__("Click any ✓ / ✗ cell to toggle. Changes save and reload instantly.")}
				</div>
			`));
		}

		// ── Module groups ─────────────────────────────────────────────────────
		d.modules.forEach((mod) => {
			const $group = $(`
				<div class="ps-module-group">
					<div class="ps-module-header">
						<strong>${esc(mod.module)}</strong>
						<span class="ps-module-count">(${mod.doctypes.length})</span>
					</div>
				</div>
			`);

			let html = `<table class="ps-matrix-table ps-matrix-compact">
				<thead><tr><th class="ps-col-doctype">${__("DocType")}</th>`;

			MATRIX_RIGHTS.forEach((r) => {
				html += `<th class="ps-col-perm" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
			});
			html += `</tr></thead><tbody>`;

			mod.doctypes.forEach((row) => {
				html += `<tr class="ps-matrix-row" data-doctype="${esc(row.doctype)}">`;
				html += `<td class="ps-col-doctype">
					<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
					${row.if_owner ? '<span class="ps-badge ps-badge-owner">if_owner</span>' : ""}
					${row.source === "custom" ? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>' : ""}
				</td>`;

				MATRIX_RIGHTS.forEach((r) => {
					const val = row.permissions[r];
					if (val === "na") {
						html += `<td class="ps-cell ps-cell-na">—</td>`;
					} else if (this._edit_mode) {
						const is_on = Boolean(val);
						html += `<td class="ps-cell ps-cell-editable ${is_on ? "ps-cell-allow" : "ps-cell-deny"}"
							title="${__("Click to toggle")} ${RIGHT_FULL_LABELS[r]} ${__("for")} ${row.doctype}"
							data-doctype="${esc(row.doctype)}" data-ptype="${r}" data-value="${is_on ? 1 : 0}">
							${is_on ? "✓" : "✗"}
						</td>`;
					} else {
						html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "✓" : "✗"}</td>`;
					}
				});

				html += `</tr>`;
			});

			html += `</tbody></table>`;
			$group.append($(html));

			// Bind edit-mode handlers
			if (this._edit_mode) {
				$group.find(".ps-cell-editable").on("click", (e) => {
					this._toggle_cell($(e.currentTarget));
				});
			}

			this.wrapper.append($group);
		});
	}

	// ── Edit mode toggle ──────────────────────────────────────────────────────

	_toggle_edit_mode() {
		this._edit_mode = !this._edit_mode;
		this.render();
	}

	// ── Toggle a single permission cell ──────────────────────────────────────

	_toggle_cell($cell) {
		const doctype = $cell.data("doctype");
		const ptype = $cell.data("ptype");
		const new_val = $cell.data("value") ? 0 : 1;
		const role = this.data.role;

		$cell.addClass("ps-cell-saving");

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.update_permission",
			args: { doctype, role, permlevel: 0, ptype, value: new_val },
			callback: (r) => {
				$cell.removeClass("ps-cell-saving");
				if (r.message?.success) {
					$cell.data("value", new_val)
						.removeClass("ps-cell-allow ps-cell-deny")
						.addClass(new_val ? "ps-cell-allow" : "ps-cell-deny")
						.text(new_val ? "✓" : "✗");

					frappe.show_alert({
						message: `${doctype} — ${ptype}: ${new_val ? __("Allowed") : __("Denied")}`,
						indicator: new_val ? "green" : "orange",
					});

					// Update local data so re-renders stay consistent
					this._update_local(doctype, ptype, new_val);
				}
			},
			error: () => {
				$cell.removeClass("ps-cell-saving");
				frappe.show_alert({ message: __("Failed to update permission."), indicator: "red" });
			},
		});
	}

	_update_local(doctype, ptype, value) {
		for (const mod of this.data.modules) {
			const row = mod.doctypes.find((r) => r.doctype === doctype);
			if (row) {
				row.permissions[ptype] = value;
				row.source = "custom";
				break;
			}
		}
	}
}
