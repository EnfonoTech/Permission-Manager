// Permission Manager — Matrix View Component
// Author: siva <siva@enfono.com>
//
// User View  : read-only matrix + per-row "Edit DocType Perms" shortcut
// DocType View: full inline edit mode (toggle cells, add/remove roles, reset)

import { MATRIX_RIGHTS, RIGHT_LABELS, RIGHT_FULL_LABELS, PERM_ICONS, esc } from "../utils/helpers";

export class MatrixView {
	constructor(opts) {
		this.wrapper          = opts.wrapper;
		this.data             = opts.data;
		this.mode             = opts.mode;                   // "user" | "doctype"
		this.on_why_click     = opts.on_why_click;
		this.on_restrictions_click = opts.on_restrictions_click;
		this.on_edit_doctype  = opts.on_edit_doctype;
		this.on_export        = opts.on_export;              // (type, id) → CSV download
		this.on_simulate      = opts.on_simulate;            // (user) → simulate dialog
		this.on_reload        = opts.on_reload;
		this.on_bulk_apply    = opts.on_bulk_apply;
		this._edit_mode       = false;
		this.render();
	}

	render() {
		this.wrapper.empty();
		if (this.mode === "user") {
			this._render_user_header();
			this._render_user_matrix();
		} else {
			this._render_doctype_header();
			this._render_doctype_matrix();
		}
	}

	// ══════════════════════════════════════════════════════════════════════════
	// USER VIEW
	// ══════════════════════════════════════════════════════════════════════════

	_render_user_header() {
		const d = this.data;
		const roles_html = d.roles.map((r) => `<span class="ps-badge">${esc(r)}</span>`).join(" ");

		const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-user-info">
					<div class="ps-user-details">
						<h3>${esc(d.user)}</h3>
						<div class="ps-roles-list">${roles_html}</div>
						${d.role_profile
							? `<div class="ps-role-profile">${__("Role Profile")}: <strong>${esc(d.role_profile)}</strong></div>`
							: ""}
						<div class="ps-stats">${__("Showing {0} DocTypes", [d.total_doctypes])}</div>
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					<button class="btn btn-xs btn-default ps-simulate-btn">
						${frappe.utils.icon("eye", "xs")} ${__("Test as User")}
					</button>
					<button class="btn btn-xs btn-default ps-export-user-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
					<button class="btn btn-xs btn-default ps-restrictions-btn">
						${frappe.utils.icon("lock", "xs")} ${__("Manage Restrictions")}
					</button>
				</div>
			</div>
		`);

		$header.find(".ps-restrictions-btn").on("click", () => {
			if (this.on_restrictions_click) this.on_restrictions_click();
		});
		$header.find(".ps-export-user-btn").on("click", () => {
			if (this.on_export) this.on_export("user", this.data.user);
		});
		$header.find(".ps-simulate-btn").on("click", () => {
			if (this.on_simulate) this.on_simulate(this.data.user);
		});

		this.wrapper.append($header);
	}

	_render_user_matrix() {
		const d = this.data;

		if (!d.matrix || !d.matrix.length) {
			this.wrapper.append(
				$(`<div class="ps-empty-state">${__("No permissions found for this user.")}</div>`)
			);
			return;
		}

		const has_edit = !!this.on_edit_doctype;

		this.wrapper.append($(`
			<div class="ps-table-hint">
				${frappe.utils.icon("info", "xs")}
				${__("Click any cell to explain why it is allowed or denied.")}
				${has_edit ? __(" Click the pencil icon to edit that DocType's permissions.") : ""}
			</div>
		`));

		let html = `<div class="ps-matrix-scroll"><table class="ps-matrix-table">
			<thead><tr>
				<th class="ps-col-module">${__("MODULE")}</th>
				<th class="ps-col-doctype">${__("DOCTYPE")}</th>`;

		MATRIX_RIGHTS.forEach((r) => {
			html += `<th class="ps-col-perm" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
		});

		if (has_edit) html += `<th class="ps-col-action" title="${__("Edit")}"></th>`;
		html += `</tr></thead><tbody>`;

		let last_module = "";
		d.matrix.forEach((row) => {
			const show_module = row.module !== last_module;
			last_module = row.module;

			html += `<tr class="ps-matrix-row" data-doctype="${esc(row.doctype)}">`;
			html += `<td class="ps-col-module">${show_module ? esc(row.module) : ""}</td>`;
			html += `<td class="ps-col-doctype">
				<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
			</td>`;

			MATRIX_RIGHTS.forEach((r) => {
				const val = row.permissions[r];
				const clickable = this.on_why_click ? "ps-cell-clickable" : "";
				const label = { allow: "Allowed", deny: "Denied", cond: "Conditional", na: "N/A" }[val] || val;
				html += `<td class="ps-cell ps-cell-${val} ${clickable}"
					title="${RIGHT_FULL_LABELS[r]}: ${label} — ${__("Click to explain")}"
					data-doctype="${esc(row.doctype)}" data-ptype="${r}">${PERM_ICONS[val]}</td>`;
			});

			if (has_edit) {
				html += `<td class="ps-col-action">
					<button class="btn btn-xs btn-default ps-edit-dt-btn"
						data-doctype="${esc(row.doctype)}"
						title="${__("Edit permissions for {0}", [row.doctype])}">
						${frappe.utils.icon("edit", "xs")}
					</button>
				</td>`;
			}

			html += `</tr>`;
		});

		html += `</tbody></table></div>`;
		const $table = $(html);

		$table.find(".ps-cell-clickable").on("click", (e) => {
			const $c = $(e.currentTarget);
			if (this.on_why_click) this.on_why_click($c.data("doctype"), $c.data("ptype"));
		});

		$table.find(".ps-edit-dt-btn").on("click", (e) => {
			const dt = $(e.currentTarget).data("doctype");
			if (this.on_edit_doctype) this.on_edit_doctype(dt);
		});

		this.wrapper.append($table);
	}

	// ══════════════════════════════════════════════════════════════════════════
	// DOCTYPE VIEW
	// ══════════════════════════════════════════════════════════════════════════

	_render_doctype_header() {
		const d = this.data;

		const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-doctype-info">
					<h3>${esc(d.doctype)}</h3>
					<div class="ps-stats">
						${__("Module")}: ${esc(d.module)} &nbsp;|&nbsp;
						${d.is_submittable ? __("Submittable") : __("Not Submittable")} &nbsp;|&nbsp;
						${d.is_custom
							? `<span class="ps-badge ps-badge-custom">${__("Custom Perms Active")}</span>`
							: `<span class="ps-badge">${__("Standard Perms")}</span>`}
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					${d.is_custom
						? `<button class="btn btn-xs btn-danger ps-reset-btn">
							${frappe.utils.icon("undo", "xs")} ${__("Reset to Standard")}
						   </button>`
						: ""}
					<button class="btn btn-xs btn-default ps-bulk-apply-btn">
						${frappe.utils.icon("settings", "xs")} ${__("Bulk Apply")}
					</button>
					<button class="btn btn-xs btn-default ps-export-dt-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
					<button class="btn btn-xs ${this._edit_mode ? "btn-primary" : "btn-default"} ps-edit-toggle-btn">
						${frappe.utils.icon(this._edit_mode ? "tick" : "edit", "xs")}
						${this._edit_mode ? __("Done Editing") : __("Edit Permissions")}
					</button>
				</div>
			</div>
		`);

		$header.find(".ps-edit-toggle-btn").on("click", () => this._toggle_edit_mode());
		$header.find(".ps-reset-btn").on("click", () => this._confirm_reset());
		$header.find(".ps-export-dt-btn").on("click", () => {
			if (this.on_export) this.on_export("doctype", this.data.doctype);
		});
		$header.find(".ps-bulk-apply-btn").on("click", () => {
			if (this.on_bulk_apply) this.on_bulk_apply();
		});
		this.wrapper.append($header);
	}

	_render_doctype_matrix() {
		const d = this.data;
		const edit = this._edit_mode;

		if (!d.roles || !d.roles.length) {
			this.wrapper.append(
				$(`<div class="ps-empty-state">${__("No role permissions defined for this DocType.")}</div>`)
			);
			if (edit) this._render_add_role_row();
			return;
		}

		// ── Search bar ───────────────────────────────────────────────────────────
		const $search_wrap = $(`
			<div class="ps-re-search-wrap">
				<span class="ps-re-search-icon">${frappe.utils.icon("search", "xs")}</span>
				<input class="form-control ps-re-search"
					placeholder="${__("Search roles…")}"
					type="text" autocomplete="off"
					value="${esc(this._search_query || "")}" />
				${this._search_query ? `<button class="ps-re-search-clear btn-naked" title="${__("Clear")}">✕</button>` : ""}
			</div>
		`);
		this.wrapper.append($search_wrap);

		if (edit) {
			this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info", "xs")}
					${__("Click any ✓ / ✗ cell to toggle. Changes save instantly.")}
				</div>
			`));
		}

		let html = `<div class="ps-matrix-scroll"><table class="ps-matrix-table">
			<thead><tr>
				<th class="ps-col-role">${__("Role")}</th>
				<th class="ps-col-level">${__("Level")}</th>
				<th class="ps-col-owner">${__("Owner")}</th>`;

		MATRIX_RIGHTS.forEach((r) => {
			html += `<th class="ps-col-perm" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
		});

		if (edit) html += `<th class="ps-col-action"></th>`;
		html += `</tr></thead><tbody>`;

		d.roles.forEach((row) => {
			html += `<tr class="ps-matrix-row" data-role="${esc(row.role)}" data-level="${row.permlevel}">`;
			html += `<td class="ps-col-role">
				<span class="ps-role-name">${esc(row.role)}</span>
				${row.source === "custom"
					? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>'
					: ""}
			</td>`;
			html += `<td class="ps-col-level">${row.permlevel}</td>`;

			// Owner cell
			if (edit) {
				html += `<td class="ps-col-owner ps-cell-owner-edit"
					data-role="${esc(row.role)}" data-level="${row.permlevel}"
					data-value="${row.if_owner ? 1 : 0}" title="${__("If Owner Only")}">
					<span class="ps-owner-toggle ${row.if_owner ? "ps-owner-on" : "ps-owner-off"}">
						${row.if_owner ? "✓" : "○"}
					</span>
				</td>`;
			} else {
				html += `<td class="ps-col-owner">
					${row.if_owner ? '<span class="ps-owner-badge">✓</span>' : ""}
				</td>`;
			}

			MATRIX_RIGHTS.forEach((r) => {
				const val = row.permissions[r];
				if (val === "na") {
					html += `<td class="ps-cell ps-cell-na" title="${__("Not applicable")}">—</td>`;
				} else if (edit) {
					const is_on = Boolean(val);
					html += `<td class="ps-cell ps-cell-editable ${is_on ? "ps-cell-allow" : "ps-cell-deny"}"
						title="${__("Click to toggle")} ${RIGHT_FULL_LABELS[r]}"
						data-role="${esc(row.role)}" data-level="${row.permlevel}"
						data-ptype="${r}" data-value="${is_on ? 1 : 0}">
						${is_on ? "✓" : "✗"}
					</td>`;
				} else {
					html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "✓" : "✗"}</td>`;
				}
			});

			if (edit) {
				html += `<td class="ps-col-action">
					<button class="btn btn-xs btn-danger ps-remove-role-btn"
						data-role="${esc(row.role)}" data-level="${row.permlevel}"
						title="${__("Remove")}">
						${frappe.utils.icon("delete", "xs")}
					</button>
				</td>`;
			}

			html += `</tr>`;
		});

		html += `</tbody></table></div>`;
		const $table = $(html);

		if (edit) {
			$table.find(".ps-cell-editable").on("click", (e) => this._toggle_cell($(e.currentTarget)));
			$table.find(".ps-cell-owner-edit").on("click", (e) => this._toggle_if_owner($(e.currentTarget)));
			$table.find(".ps-remove-role-btn").on("click", (e) => {
				const $b = $(e.currentTarget);
				this._remove_role($b.data("role"), $b.data("level"));
			});
		}

		this.wrapper.append($table);
		if (edit) this._render_add_role_row();

		// Bind search after table is in DOM
		const $search = this.wrapper.find(".ps-re-search");
		const _apply = () => {
			const q = (this._search_query || "").toLowerCase();
			$table.find(".ps-matrix-row").each((_, row) => {
				const role = ($(row).attr("data-role") || "").toLowerCase();
				$(row).toggle(!q || role.includes(q));
			});
			this.wrapper.find(".ps-re-search-clear").toggle(!!q);
		};
		$search.on("input", () => {
			this._search_query = $search.val().trim();
			_apply();
		});
		this.wrapper.find(".ps-re-search-clear").on("click", () => {
			this._search_query = "";
			$search.val("").trigger("input");
		});
		if (this._search_query) _apply();
	}

	_render_add_role_row() {
		const $add = $(`
			<div class="ps-add-role-row">
				<button class="btn btn-xs btn-default ps-add-role-btn">
					${frappe.utils.icon("add", "xs")} ${__("Add Role")}
				</button>
			</div>
		`);
		$add.find(".ps-add-role-btn").on("click", () => this._show_add_role_dialog());
		this.wrapper.append($add);
	}

	// ── Edit mode actions ─────────────────────────────────────────────────────

	_toggle_edit_mode() {
		if (!this._edit_mode) {
			frappe.dom.freeze(__("Initialising custom permissions…"));
			frappe.call({
				method: "permission_manager.permission_manager.api.matrix.init_custom_perms",
				args: { doctype: this.data.doctype },
				callback: (r) => {
					frappe.dom.unfreeze();
					if (r.message) {
						this.data = r.message;
						this._edit_mode = true;
						this.render();
					}
				},
				error: () => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("Failed to initialise custom permissions."), indicator: "red" });
				},
			});
		} else {
			this._edit_mode = false;
			this.render();
		}
	}

	_toggle_cell($cell) {
		const role = $cell.data("role");
		const permlevel = $cell.data("level");
		const ptype = $cell.data("ptype");
		const new_val = $cell.data("value") ? 0 : 1;

		$cell.addClass("ps-cell-saving");

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.update_permission",
			args: { doctype: this.data.doctype, role, permlevel, ptype, value: new_val },
			callback: (r) => {
				$cell.removeClass("ps-cell-saving");
				if (r.message?.success) {
					$cell.data("value", new_val)
						.removeClass("ps-cell-allow ps-cell-deny")
						.addClass(new_val ? "ps-cell-allow" : "ps-cell-deny")
						.text(new_val ? "✓" : "✗");

					frappe.show_alert({
						message: `${role} — ${ptype}: ${new_val ? __("Allowed") : __("Denied")}`,
						indicator: new_val ? "green" : "orange",
					});
				}
			},
			error: () => {
				$cell.removeClass("ps-cell-saving");
				frappe.show_alert({ message: __("Failed to update permission."), indicator: "red" });
			},
		});
	}

	_toggle_if_owner($cell) {
		const role = $cell.data("role");
		const permlevel = $cell.data("level");
		const new_val = $cell.data("value") ? 0 : 1;

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.update_if_owner",
			args: { doctype: this.data.doctype, role, permlevel, value: new_val },
			callback: (r) => {
				if (r.message?.success) {
					$cell.data("value", new_val)
						.find(".ps-owner-toggle")
						.removeClass("ps-owner-on ps-owner-off")
						.addClass(new_val ? "ps-owner-on" : "ps-owner-off")
						.text(new_val ? "✓" : "○");
				}
			},
		});
	}

	_remove_role(role, permlevel) {
		frappe.confirm(
			__("Remove permission for role '{0}' from '{1}'?", [role, this.data.doctype]),
			() => {
				frappe.dom.freeze();
				frappe.call({
					method: "permission_manager.permission_manager.api.matrix.remove_role_permission",
					args: { doctype: this.data.doctype, role, permlevel },
					callback: (r) => {
						frappe.dom.unfreeze();
						if (r.message) {
							this.data = r.message;
							this.render();
							frappe.show_alert({ message: __("Role removed."), indicator: "green" });
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			}
		);
	}

	_show_add_role_dialog() {
		const dlg = new frappe.ui.Dialog({
			title: __("Add Role Permission — {0}", [this.data.doctype]),
			fields: [
				{ fieldtype: "Link", fieldname: "role", label: __("Role"), options: "Role", reqd: 1 },
				{
					fieldtype: "Int",
					fieldname: "permlevel",
					label: __("Permission Level"),
					default: 0,
					description: __("0 = document level. Higher = field-level security."),
				},
			],
			primary_action_label: __("Add"),
			primary_action: (vals) => {
				dlg.hide();
				frappe.dom.freeze();
				frappe.call({
					method: "permission_manager.permission_manager.api.matrix.add_role_permission",
					args: { doctype: this.data.doctype, role: vals.role, permlevel: vals.permlevel || 0 },
					callback: (r) => {
						frappe.dom.unfreeze();
						if (r.message) {
							this.data = r.message;
							this.render();
							frappe.show_alert({ message: __("Role '{0}' added.", [vals.role]), indicator: "green" });
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			},
		});
		dlg.show();
	}

	_confirm_reset() {
		frappe.confirm(
			__("Reset '{0}' to standard permissions? All custom changes will be lost.", [this.data.doctype]),
			() => {
				frappe.dom.freeze();
				frappe.call({
					method: "permission_manager.permission_manager.api.matrix.reset_to_standard",
					args: { doctype: this.data.doctype },
					callback: (r) => {
						frappe.dom.unfreeze();
						if (r.message) {
							this.data = r.message;
							this._edit_mode = false;
							this.render();
							frappe.show_alert({ message: __("Permissions reset to standard."), indicator: "green" });
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			}
		);
	}
}
