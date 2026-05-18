// Permission Manager — Studio Bundle Entry
// Author: siva <siva@enfono.com>

import { MatrixView } from "./components/matrix_view";
import { WhyExplainer } from "./components/why_explainer";
import { UserExplorer } from "./components/user_explorer";
import { RoleExplorer } from "./components/role_explorer";
import { ReverseLookup, _download_csv } from "./components/reverse_lookup";
import { RoleComparison } from "./components/role_comparison";
import { HealthDashboard, showUserSimulation } from "./components/health_dashboard";
import { MATRIX_RIGHTS, RIGHT_LABELS, RIGHT_FULL_LABELS, PERM_ICONS, esc } from "./utils/helpers";

window.permission_manager_studio = window.permission_manager_studio || {};

class PermissionStudio {
	constructor(page) {
		this.page = page;
		this.current_tab = "user";
		this.components = {};
		this._current_user = null;
		this._current_doctype = null;
		this._current_role = null;

		this.setup_page();
		this.setup_tabs();
		this.render_tab("user");
	}

	setup_page() {
		this.page.set_title(__("Permission Studio"));

		this.$wrapper = $(`
			<div class="ps-app">
				<div class="ps-tabs"></div>
				<div class="ps-search-bar"></div>
				<div class="ps-content"></div>
			</div>
		`).appendTo(this.page.body);

		this.$tabs    = this.$wrapper.find(".ps-tabs");
		this.$search  = this.$wrapper.find(".ps-search-bar");
		this.$content = this.$wrapper.find(".ps-content");
	}

	setup_tabs() {
		const tabs = [
			{ key: "user",      label: __("User View"),    icon: "users"    },
			{ key: "doctype",   label: __("DocType View"), icon: "list"     },
			{ key: "role",      label: __("Role View"),    icon: "tool"     },
			{ key: "lookup",    label: __("Who Can?"),     icon: "search"   },
			{ key: "compare",   label: __("Compare"),      icon: "compare"  },
			{ key: "dashboard", label: __("Health"),       icon: "dashboard"},
		];

		tabs.forEach((tab) => {
			const $tab = $(`
				<button class="ps-tab ${tab.key === this.current_tab ? "active" : ""}"
						data-tab="${tab.key}">
					${frappe.utils.icon(tab.icon, "sm")}
					<span>${tab.label}</span>
				</button>
			`);
			$tab.on("click", () => this.switch_tab(tab.key));
			this.$tabs.append($tab);
		});
	}

	switch_tab(tab_key) {
		if (tab_key === this.current_tab) return;
		this.current_tab = tab_key;
		this.$tabs.find(".ps-tab").removeClass("active");
		this.$tabs.find(`[data-tab="${tab_key}"]`).addClass("active");
		this.render_tab(tab_key);
	}

	render_tab(tab_key) {
		this.$search.empty();
		this.$content.empty();
		switch (tab_key) {
			case "user":      this._render_user_tab();      break;
			case "doctype":   this._render_doctype_tab();   break;
			case "role":      this._render_role_tab();      break;
			case "lookup":    this._render_lookup_tab();    break;
			case "compare":   this._render_compare_tab();   break;
			case "dashboard": this._render_dashboard_tab(); break;
		}
	}

	// ── User tab ──────────────────────────────────────────────────────────────

	_render_user_tab() {
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-user-select"></div>
				<div class="ps-search-field" id="ps-module-filter"></div>
				<div class="ps-search-field" id="ps-dt-search"></div>
				<div class="ps-quick-tools-wrap" style="display:none;flex:0 0 auto;align-self:flex-end;">
					<button class="btn btn-sm btn-default ps-quick-tools-btn">
						⚡ ${__("Quick Tools")}
					</button>
				</div>
			</div>
		`);

		this.user_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "User", fieldname: "user",
				placeholder: __("Select User…"), label: __("User"),
				change: () => {
					const user = this.user_field.get_value();
					if (user) { this._current_user = user; this.load_user_matrix(user); }
				},
			},
			parent: this.$search.find("#ps-user-select"),
			render_input: true,
		});

		this.module_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Module Def", fieldname: "module",
				placeholder: __("All Modules"), label: __("Module"),
				change: () => { if (this._current_user) this.load_user_matrix(this._current_user); },
			},
			parent: this.$search.find("#ps-module-filter"),
			render_input: true,
		});

		this.search_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				options: "DocType",
				fieldname: "dt_search",
				placeholder: __("Filter by DocType…"),
				label: __("Search"),
				change: () => this._apply_dt_filter(),
			},
			parent: this.$search.find("#ps-dt-search"),
			render_input: true,
		});
		// Also filter on raw keystroke for partial matches before a value is picked
		this.search_field.$input?.on("input", () => this._apply_dt_filter());

		this.$content.html(this._welcome_html(
			frappe.utils.icon("users", "lg"),
			__("Select a User"),
			__("View permissions, test access, export, and manage restrictions for any user.")
		));
	}

	// ── DocType tab ───────────────────────────────────────────────────────────

	_render_doctype_tab() {
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-doctype-select"></div>
			</div>
		`);

		this.doctype_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "DocType", fieldname: "doctype",
				placeholder: __("Select DocType…"), label: __("DocType"),
				change: () => {
					const dt = this.doctype_field.get_value();
					if (dt) { this._current_doctype = dt; this.load_doctype_matrix(dt); }
				},
			},
			parent: this.$search.find("#ps-doctype-select"),
			render_input: true,
		});

		if (this._pending_doctype_edit) {
			const dt = this._pending_doctype_edit;
			this._pending_doctype_edit = null;
			setTimeout(() => {
				this.doctype_field.set_value(dt);
				this._current_doctype = dt;
				this.load_doctype_matrix(dt, true);
			}, 100);
		} else {
			this.$content.html(this._welcome_html(
				frappe.utils.icon("list", "lg"),
				__("Select a DocType"),
				__("View, edit, bulk-apply, or export permissions for any DocType.")
			));
		}
	}

	// ── Role tab ──────────────────────────────────────────────────────────────

	_render_role_tab() {
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-role-select"></div>
			</div>
		`);

		this.role_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Role", fieldname: "role",
				placeholder: __("Select Role…"), label: __("Role"),
				change: () => {
					const role = this.role_field.get_value();
					if (role) { this._current_role = role; this.load_role_matrix(role); }
				},
			},
			parent: this.$search.find("#ps-role-select"),
			render_input: true,
		});

		this.$content.html(this._welcome_html(
			frappe.utils.icon("tool", "lg"),
			__("Select a Role"),
			__("View or edit permissions for a role, grouped by module.")
		));
	}

	// ── Lookup tab ────────────────────────────────────────────────────────────

	_render_lookup_tab() {
		this.components.lookup = new ReverseLookup({ wrapper: this.$content });
	}

	// ── Compare tab ───────────────────────────────────────────────────────────

	_render_compare_tab() {
		this.components.compare = new RoleComparison({ wrapper: this.$content });
	}

	// ── Dashboard tab ─────────────────────────────────────────────────────────

	_render_dashboard_tab() {
		this.components.dashboard = new HealthDashboard({ wrapper: this.$content });
	}

	// ── Data loaders ──────────────────────────────────────────────────────────

	_apply_dt_filter() {
		const q = (this.search_field?.get_value() || "").toLowerCase();
		this.$content.find(".ps-matrix-row").each(function () {
			$(this).toggle(!q || ($(this).data("doctype") || "").toLowerCase().includes(q));
		});
	}

	load_user_matrix(user) {
		this.$content.html(this._show_skeleton(8));
		const module = this.module_field?.get_value() || null;

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.get_user_matrix",
			args: { user, module },
			callback: (r) => {
				if (r.message) {
					// Show Quick Tools button now that a user is loaded
					this.$search.find(".ps-quick-tools-wrap").show();
					this.$search.find(".ps-quick-tools-btn").off("click").on("click", () => {
						this._show_quick_tools_dialog(user);
					});
					this.components.matrix = new MatrixView({
						wrapper:               this.$content,
						data:                  r.message,
						mode:                  "user",
						on_why_click:          (doctype, ptype) => this.show_why(user, doctype, ptype),
						on_restrictions_click: () => this.show_restrictions(user),
						on_edit_doctype:       (doctype) => this._open_doctype_edit_dialog(doctype),
						on_export:             (type, id) => this._export_csv(type, id),
						on_simulate:           (u) => showUserSimulation(u),
					});
				}
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load permission matrix."), () => this.load_user_matrix(user))
				);
			},
		});
	}

	load_doctype_matrix(doctype, enter_edit_mode = false) {
		this.$content.html(this._show_skeleton(6));

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
			args: { doctype },
			callback: (r) => {
				if (r.message) {
					const view = new MatrixView({
						wrapper:      this.$content,
						data:         r.message,
						mode:         "doctype",
						on_reload:    () => this.load_doctype_matrix(doctype),
						on_export:    (type, id) => this._export_csv(type, id),
						on_bulk_apply: () => this._show_bulk_apply_dialog(doctype),
					});
					this.components.matrix = view;
					if (enter_edit_mode) view._toggle_edit_mode();
				}
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load DocType permissions."), () => this.load_doctype_matrix(doctype))
				);
			},
		});
	}

	load_role_matrix(role) {
		this.$content.html(this._show_skeleton(6));

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.get_role_matrix",
			args: { role },
			callback: (r) => {
				if (r.message) {
					this.components.matrix = new RoleExplorer({
						wrapper:   this.$content,
						data:      r.message,
						on_export: () => this._export_csv("role", role),
					});
				}
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load role permissions."), () => this.load_role_matrix(role))
				);
			},
		});
	}

	// ── Quick Tools ───────────────────────────────────────────────────────────

	_show_quick_tools_dialog(user) {
		const dlg = new frappe.ui.Dialog({
			title: __("Quick Tools — {0}", [user]),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "tools_html",
				},
			],
		});

		const $w = dlg.fields_dict.tools_html.$wrapper;
		$w.html(`<div class="ps-loading">${__("Loading…")}</div>`);

		// Load roles + issues in parallel
		Promise.all([
			new Promise((res) => frappe.call({
				method: "permission_manager.permission_manager.api.quickfix.get_user_roles",
				args: { user },
				callback: (r) => res(r.message || []),
			})),
			new Promise((res) => frappe.call({
				method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
				args: { user },
				callback: (r) => res(r.message || []),
			})),
		]).then(([roles, issues]) => {
			this._render_quick_tools($w, dlg, user, roles, issues);
		});

		dlg.show();
	}

	_render_quick_tools($w, dlg, user, roles, issues) {
		const severity_icon = { error: "🔴", warning: "🟡", info: "🔵" };

		// ── Roles section ─────────────────────────────────────────────────────
		const role_chips = roles.map((r) => `
			<span class="ps-role-chip ${r.is_custom ? "ps-role-custom" : ""}">
				${esc(r.role)}
				${r.is_custom ? `<span title="${__("Custom role")}">★</span>` : ""}
			</span>
		`).join("");

		// ── Issues section ────────────────────────────────────────────────────
		const issue_rows = issues.length
			? issues.map((issue) => `
				<div class="ps-issue-row ps-issue-${issue.severity}">
					<span class="ps-issue-icon">${severity_icon[issue.severity] || "ℹ️"}</span>
					<div class="ps-issue-body">
						<strong>${esc(issue.title)}</strong>
						<div class="ps-issue-desc">${esc(issue.description)}</div>
					</div>
					${issue.fix_label ? `
						<button class="btn btn-xs btn-warning ps-fix-btn"
							data-fix="${esc(issue.fix_type)}"
							data-fix-data='${JSON.stringify(issue.fix_data || {})}'
							style="margin-left:auto;flex-shrink:0;">
							${esc(issue.fix_label)}
						</button>` : ""}
				</div>
			`).join("")
			: `<div class="ps-issue-none">${__("✅ No issues found for this user.")}</div>`;

		$w.html(`
			<div class="ps-quick-tools">

				<div class="ps-qt-section">
					<div class="ps-qt-section-header">
						<strong>${__("Current Roles")} (${roles.length})</strong>
						<button class="btn btn-xs btn-primary ps-manage-roles-btn">${__("Manage Roles")}</button>
					</div>
					<div class="ps-role-chips">${role_chips || `<em>${__("No roles assigned.")}</em>`}</div>
				</div>

				<div class="ps-qt-section">
					<div class="ps-qt-section-header">
						<strong>${__("Permission Issues")} (${issues.length})</strong>
						<button class="btn btn-xs btn-default ps-recheck-btn">${frappe.utils.icon("refresh", "xs")} ${__("Re-check")}</button>
					</div>
					<div class="ps-issues-list">${issue_rows}</div>
				</div>

				<div class="ps-qt-section">
					<div class="ps-qt-section-header"><strong>${__("More Actions")}</strong></div>
					<div style="display:flex;gap:8px;flex-wrap:wrap;">
						<button class="btn btn-sm btn-default ps-copy-roles-btn">
							${frappe.utils.icon("copy", "xs")} ${__("Copy Roles From User")}
						</button>
						<button class="btn btn-sm btn-default ps-clear-custom-btn">
							${frappe.utils.icon("delete", "xs")} ${__("Clear All Custom Perms")}
						</button>
					</div>
				</div>

			</div>
		`);

		// Manage Roles
		$w.find(".ps-manage-roles-btn").on("click", () => {
			dlg.hide();
			this._show_manage_roles_dialog(user, roles);
		});

		// Re-check issues
		$w.find(".ps-recheck-btn").on("click", () => {
			$w.html(`<div class="ps-loading">${__("Checking…")}</div>`);
			frappe.call({
				method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
				args: { user },
				callback: (r) => this._render_quick_tools($w, dlg, user, roles, r.message || []),
			});
		});

		// Apply quick fix buttons
		$w.find(".ps-fix-btn").on("click", (e) => {
			const fix_type = $(e.currentTarget).data("fix");
			const fix_data = JSON.parse($(e.currentTarget).attr("data-fix-data") || "{}");
			frappe.dom.freeze(__("Applying fix…"));
			frappe.call({
				method: "permission_manager.permission_manager.api.quickfix.apply_quick_fix",
				args: { user, fix_type, fix_data: JSON.stringify(fix_data) },
				callback: (r) => {
					frappe.dom.unfreeze();
					frappe.show_alert({ message: r.message?.msg || __("Fix applied."), indicator: "green" });
					// Re-check issues
					frappe.call({
						method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
						args: { user },
						callback: (r2) => this._render_quick_tools($w, dlg, user, roles, r2.message || []),
					});
				},
				error: () => frappe.dom.unfreeze(),
			});
		});

		// Copy Roles From User
		$w.find(".ps-copy-roles-btn").on("click", () => {
			frappe.prompt(
				{ fieldtype: "Link", options: "User", fieldname: "source_user", label: __("Copy Roles From"), reqd: 1 },
				(vals) => {
					frappe.dom.freeze(__("Copying roles…"));
					frappe.call({
						method: "permission_manager.permission_manager.api.quickfix.copy_roles_from_user",
						args: { target_user: user, source_user: vals.source_user },
						callback: (r) => {
							frappe.dom.unfreeze();
							frappe.show_alert({ message: r.message?.msg || __("Roles copied."), indicator: "green" });
							dlg.hide();
							this.load_user_matrix(user);
						},
						error: () => frappe.dom.unfreeze(),
					});
				},
				__("Copy Roles From User"), __("Copy")
			);
		});

		// Clear All Custom Perms
		$w.find(".ps-clear-custom-btn").on("click", () => {
			frappe.confirm(
				__("Remove all Custom DocPerms for <b>{0}</b>? This resets them to standard role-based permissions.", [user]),
				() => {
					frappe.dom.freeze(__("Clearing…"));
					frappe.call({
						method: "permission_manager.permission_manager.api.quickfix.clear_custom_perms_for_user",
						args: { user },
						callback: (r) => {
							frappe.dom.unfreeze();
							frappe.show_alert({ message: r.message?.msg || __("Done."), indicator: "green" });
							dlg.hide();
							this.load_user_matrix(user);
						},
						error: () => frappe.dom.unfreeze(),
					});
				}
			);
		});
	}

	_show_manage_roles_dialog(user, current_roles) {
		const current_role_names = new Set(current_roles.map((r) => r.role));

		const dlg = new frappe.ui.Dialog({
			title: __("Manage Roles — {0}", [user]),
			fields: [
				{
					fieldtype: "Link",
					fieldname: "add_role",
					options: "Role",
					label: __("Add Role"),
					description: __("Type and select a role to add"),
				},
				{
					fieldtype: "HTML",
					fieldname: "current_roles_html",
				},
			],
			primary_action_label: __("Close"),
			primary_action: () => dlg.hide(),
		});

		const _refresh_roles = () => {
			const $html = dlg.fields_dict.current_roles_html.$wrapper;
			const rows = [...current_role_names].sort().map((role) => `
				<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f3f5;">
					<span style="flex:1;">${esc(role)}</span>
					<button class="btn btn-xs btn-danger ps-remove-role-btn" data-role="${esc(role)}">
						${frappe.utils.icon("delete", "xs")} ${__("Remove")}
					</button>
				</div>
			`).join("");
			$html.html(rows || `<em>${__("No roles assigned.")}</em>`);
			$html.find(".ps-remove-role-btn").on("click", (e) => {
				const role = $(e.currentTarget).data("role");
				frappe.call({
					method: "permission_manager.permission_manager.api.quickfix.update_user_roles",
					args: { user, add_roles: "[]", remove_roles: JSON.stringify([role]) },
					callback: (r) => {
						if (r.message?.success) {
							current_role_names.delete(role);
							_refresh_roles();
							frappe.show_alert({ message: __("Role removed."), indicator: "orange" });
						}
					},
				});
			});
		};

		dlg.fields_dict.add_role.df.change = () => {
			const role = dlg.get_value("add_role");
			if (!role || current_role_names.has(role)) return;
			frappe.call({
				method: "permission_manager.permission_manager.api.quickfix.update_user_roles",
				args: { user, add_roles: JSON.stringify([role]), remove_roles: "[]" },
				callback: (r) => {
					if (r.message?.success) {
						current_role_names.add(role);
						dlg.set_value("add_role", "");
						_refresh_roles();
						frappe.show_alert({ message: __("Role added."), indicator: "green" });
					}
				},
			});
		};

		_refresh_roles();
		dlg.show();
	}

	// ── DocType Edit Dialog (User View shortcut) ──────────────────────────────

	_open_doctype_edit_dialog(doctype) {
		const dialog = new frappe.ui.Dialog({
			title: __("Edit Permissions — {0}", [doctype]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "dt_matrix_html" }],
		});

		const $w = dialog.fields_dict.dt_matrix_html.$wrapper;
		$w.html(`<div class="ps-loading">${__("Loading…")}</div>`);

		frappe.call({
			method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
			args: { doctype },
			callback: (r) => {
				if (!r.message) return;
				const _make_view = (data) => {
					$w.empty();
					const v = new MatrixView({
						wrapper: $w,
						data,
						mode: "doctype",
						on_reload: () => {
							frappe.call({
								method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
								args: { doctype },
								callback: (r2) => r2.message && _make_view(r2.message),
							});
						},
						on_export: (t, id) => this._export_csv(t, id),
					});
					v._toggle_edit_mode();
				};
				_make_view(r.message);
			},
		});

		dialog.show();
	}

	// ── Bulk Apply Dialog ─────────────────────────────────────────────────────

	_show_bulk_apply_dialog(current_doctype) {
		const PERMS = MATRIX_RIGHTS;

		// Build checkbox fields for each permission type
		const perm_fields = PERMS.map((r) => ({
			fieldtype: "Check",
			fieldname: `perm_${r}`,
			label: RIGHT_FULL_LABELS[r] || r,
			default: 0,
		}));

		const dlg = new frappe.ui.Dialog({
			title: __("Bulk Apply Role Permissions"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "intro_html",
					options: `<div class="ps-bulk-intro">
						${__("Apply the same permission set for a role across multiple DocTypes at once.")}
					</div>`,
				},
				{
					fieldtype: "Link",
					fieldname: "role",
					label: __("Role"),
					options: "Role",
					reqd: 1,
				},
				{
					fieldtype: "Section Break",
					label: __("Permissions to Apply"),
				},
				...perm_fields,
				{
					fieldtype: "Section Break",
					label: __("Target DocTypes"),
				},
				{
					fieldtype: "Small Text",
					fieldname: "doctypes_text",
					label: __("DocType List"),
					reqd: 1,
					description: __("One DocType per line. Current DocType is pre-filled."),
					default: current_doctype,
				},
			],
			primary_action_label: __("Apply to All"),
			primary_action: (vals) => {
				const doctypes = (vals.doctypes_text || "")
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean);

				if (!doctypes.length) {
					frappe.show_alert({ message: __("No DocTypes specified."), indicator: "orange" });
					return;
				}

				const permissions = {};
				PERMS.forEach((r) => {
					permissions[r] = vals[`perm_${r}`] ? 1 : 0;
				});

				dlg.hide();
				frappe.dom.freeze(__("Applying permissions…"));

				frappe.call({
					method: "permission_manager.permission_manager.api.lookup.bulk_apply_role_permissions",
					args: {
						doctypes: JSON.stringify(doctypes),
						role: vals.role,
						permissions: JSON.stringify(permissions),
					},
					callback: (r) => {
						frappe.dom.unfreeze();
						const res = r.message || {};
						if (res.success?.length) {
							frappe.show_alert({
								message: __("{0} DocTypes updated.", [res.success.length]),
								indicator: "green",
							});
						}
						if (res.failed?.length) {
							frappe.msgprint({
								title: __("Some DocTypes Failed"),
								indicator: "red",
								message: res.failed
									.map((f) => `<b>${esc(f.doctype)}</b>: ${esc(f.error)}`)
									.join("<br>"),
							});
						}
						// Reload current doctype view if it was included
						if (res.success?.includes(current_doctype)) {
							this.load_doctype_matrix(current_doctype);
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			},
		});

		dlg.show();
	}

	// ── CSV Export ────────────────────────────────────────────────────────────

	_export_csv(data_type, identifier) {
		frappe.dom.freeze(__("Generating CSV…"));

		frappe.call({
			method: "permission_manager.permission_manager.api.lookup.export_matrix_csv",
			args: { data_type, identifier },
			callback: (r) => {
				frappe.dom.unfreeze();
				if (r.message) {
					_download_csv_raw(r.message.csv, r.message.filename);
					frappe.show_alert({ message: __("CSV downloaded."), indicator: "green" });
				}
			},
			error: () => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Export failed."), indicator: "red" });
			},
		});
	}

	// ── Generic helpers ───────────────────────────────────────────────────────

	show_why(user, doctype, ptype) {
		new WhyExplainer({ user, doctype, ptype });
	}

	show_restrictions(user) {
		new UserExplorer({ user });
	}

	_show_skeleton(count = 6) {
		let rows = "";
		for (let i = 0; i < count; i++) {
			rows += `<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`;
		}
		return `<div class="ps-loading">${rows}</div>`;
	}

	_welcome_html(icon, title, desc) {
		return `<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${icon}</div>
			<div class="ps-welcome-title">${title}</div>
			<div class="ps-welcome-desc">${desc}</div>
		</div>`;
	}

	_error_html(msg, retry_fn) {
		const id = "ps-retry-" + Date.now();
		setTimeout(() => { $(`#${id}`).on("click", retry_fn); }, 0);
		return `<div class="ps-error-state">
			<div class="ps-error-icon">${frappe.utils.icon("error", "lg")}</div>
			<div class="ps-error-msg">${msg}</div>
			<button id="${id}" class="btn btn-sm btn-default">
				${frappe.utils.icon("refresh", "xs")} ${__("Retry")}
			</button>
		</div>`;
	}

	on_show() {}
}

// Raw CSV download from pre-built string
function _download_csv_raw(csv_string, filename) {
	const blob = new Blob([csv_string], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

Object.assign(window.permission_manager_studio, {
	PermissionStudio,
	MatrixView,
	WhyExplainer,
	UserExplorer,
	RoleExplorer,
	ReverseLookup,
	RoleComparison,
	HealthDashboard,
	showUserSimulation,
	MATRIX_RIGHTS,
	RIGHT_LABELS,
	PERM_ICONS,
	esc,
});
