// Permission Manager — Main Bundle
// Author: siva <siva@enfono.com>
// All JS (including pm_workflow) is bundled here so every build gets
// a new content-hash filename — automatic cache busting in production.

import "./pm_workflow";            // workflow action buttons on all doc forms
import "./pm_realtime";            // real-time approval inbox notifications
import { MatrixView } from "./components/matrix_view";
import { WhyExplainer } from "./components/why_explainer";
import { UserExplorer } from "./components/user_explorer";
import { RoleExplorer } from "./components/role_explorer";
import { RoleProfileExplorer } from "./components/role_profile_explorer";
import { ReverseLookup, _download_csv } from "./components/reverse_lookup";
import { RoleComparison } from "./components/role_comparison";
import { HealthDashboard, showUserSimulation } from "./components/health_dashboard";
import { ApprovalInbox } from "./components/approval_inbox";
import { WorkflowDiagram } from "./components/workflow_diagram";
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
			{ key: "profile",   label: __("Profile View"), icon: "group"    },
			{ key: "accounts",  label: __("Accounts"),     icon: "bank"     },
			{ key: "lookup",    label: __("Who Can?"),     icon: "search"   },
			{ key: "compare",   label: __("Compare"),      icon: "compare"  },
			{ key: "dashboard", label: __("Health"),       icon: "dashboard"},
			{ key: "auditlog",  label: __("Audit Log"),    icon: "file"     },
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
			case "profile":   this._render_profile_tab();   break;
			case "accounts":  this._render_accounts_tab();  break;
			case "lookup":    this._render_lookup_tab();    break;
			case "compare":   this._render_compare_tab();   break;
			case "dashboard": this._render_dashboard_tab(); break;
			case "auditlog":  this._render_auditlog_tab();  break;
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

	// ── Audit Log tab ─────────────────────────────────────────────────────────

	_render_auditlog_tab() {
		// Search controls
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-al-doctype-field"></div>
				<div class="ps-search-field" id="ps-al-role-field"></div>
				<button class="btn btn-sm btn-primary ps-al-search-btn">${__("Search")}</button>
				<button class="btn btn-sm btn-default ps-al-clear-btn">${__("Clear")}</button>
			</div>
		`);

		const dt_field = frappe.ui.form.make_control({
			parent: this.$search.find("#ps-al-doctype-field"),
			df: { fieldtype: "Link", options: "DocType", label: __("DocType"), placeholder: __("All DocTypes") },
			render_input: true,
		});
		const role_field = frappe.ui.form.make_control({
			parent: this.$search.find("#ps-al-role-field"),
			df: { fieldtype: "Data", label: __("Role"), placeholder: __("All Roles") },
			render_input: true,
		});

		const _load = () => {
			this.$content.html(`<div class="ps-loading">${__("Loading audit log…")}</div>`);
			frappe.call({
				method: "permission_manager.permission_manager.api.approvals.get_permission_audit_log",
				args: {
					doctype_name: dt_field.get_value() || "",
					role: role_field.get_value() || "",
					limit: 200,
				},
				callback: (r) => {
					const rows = r.message || [];
					if (!rows.length) {
						this.$content.html(`<div class="ps-empty-state">${__("No audit log entries found.")}</div>`);
						return;
					}
					let html = `
						<div class="ps-al-wrap">
						<table class="ps-matrix-table">
							<thead><tr>
								<th>${__("Date")}</th>
								<th>${__("By")}</th>
								<th>${__("Source")}</th>
								<th>${__("DocType")}</th>
								<th>${__("Role")}</th>
								<th>${__("Field")}</th>
								<th>${__("From")}</th>
								<th>${__("To")}</th>
								<th>${__("Note")}</th>
							</tr></thead>
							<tbody>
					`;
					rows.forEach((row) => {
						html += `<tr>
							<td style="white-space:nowrap;font-size:11px">${esc(row.changed_on || "")}</td>
							<td>${esc(row.changed_by || "")}</td>
							<td><span class="ps-badge ps-badge-custom ps-xs-badge">${esc(row.source || "")}</span></td>
							<td>${esc(row.doctype_name || "")}</td>
							<td>${esc(row.role || "")}</td>
							<td>${esc(row.ptype || "")}</td>
							<td class="ps-al-old">${esc(String(row.old_value || ""))}</td>
							<td class="ps-al-new">${esc(String(row.new_value || ""))}</td>
							<td class="text-muted" style="font-size:11px">${esc(row.note || "")}</td>
						</tr>`;
					});
					html += `</tbody></table></div>`;
					this.$content.html(html);
				},
			});
		};

		this.$search.find(".ps-al-search-btn").on("click", _load);
		this.$search.find(".ps-al-clear-btn").on("click", () => {
			dt_field.set_value("");
			role_field.set_value("");
			_load();
		});

		_load();
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

					// Inject Override button into the rendered user header
					this._inject_override_button(user);
				}
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load permission matrix."), () => this.load_user_matrix(user))
				);
			},
		});
	}

	_inject_override_button(user) {
		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.get_user_override_status",
			args: { user },
			callback: (r) => {
				if (!r.message) return;
				const status = r.message;
				const $actions = this.$content.find(".ps-header-actions").first();

				// Account Restrictions button
				const $acct_btn = $(`
					<button class="btn btn-xs btn-default ps-acct-restrict-btn">
						${frappe.utils.icon("account", "xs")} ${__("Account Restrictions")}
					</button>
				`);
				$acct_btn.on("click", () => this._show_account_restrictions_dialog(user));
				$actions.prepend($acct_btn);

				// Override button
				const is_active = status.is_active;
				const $btn = $(`
					<button class="btn btn-xs ${is_active ? "btn-warning" : "btn-default"} ps-override-btn">
						${frappe.utils.icon("lock", "xs")}
						${is_active ? `⚡ ${__("Override Active")}` : __("Override for User")}
					</button>
				`);
				$btn.on("click", () => this._show_user_override_dialog(user, status));
				$actions.prepend($btn);
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

	// ── Accounts tab (drag-and-drop account restrictions) ─────────────────────

	_render_accounts_tab() {
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-acctab-user-select"></div>
			</div>
		`);

		this.acctab_user_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "User", fieldname: "acctab_user",
				placeholder: __("Select User…"), label: __("User"),
				change: () => {
					const user = this.acctab_user_field.get_value();
					if (user) { this._current_acctab_user = user; this._load_user_accounts(user); }
				},
			},
			parent: this.$search.find("#ps-acctab-user-select"),
			render_input: true,
		});

		this.$content.html(this._welcome_html(
			frappe.utils.icon("bank", "lg"),
			__("Select a User"),
			__("Control which accounts this user can access. Drag accounts into the Restricted zone to limit access.")
		));
	}

	_load_user_accounts(user) {
		this.$content.html(this._show_skeleton(5));
		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.get_user_account_restrictions",
			args: { user },
			callback: (r) => {
				if (r.message) this._render_account_dnd(user, r.message);
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load accounts."), () => this._load_user_accounts(user))
				);
			},
		});
	}

	_render_account_dnd(user, data) {
		// Build lookup: account name → restriction record
		const restricted_map = {};
		for (const r of data.restrictions) restricted_map[r.for_value] = r;

		const available = data.all_accounts.filter((a) => !restricted_map[a.name]);

		// ── COA tree builder ───────────────────────────────────────────────────
		const _coa_html = (accounts) => {
			if (!accounts.length) return `<div class="ps-ac-zone-empty">${__("No accounts available.")}</div>`;

			const ROOT_ORDER = ["Asset", "Liability", "Income", "Expense", "Equity"];
			const ROOT_ICON  = { Asset: "📊", Liability: "📋", Income: "📈", Expense: "📉", Equity: "⚖️" };

			// Build parent → children tree from lft-ordered flat list
			const name_map = {};
			accounts.forEach((a) => { name_map[a.name] = { ...a, children: [] }; });
			const root_nodes = [];
			accounts.forEach((a) => {
				const node = name_map[a.name];
				if (a.parent_account && name_map[a.parent_account]) {
					name_map[a.parent_account].children.push(node);
				} else {
					root_nodes.push(node);
				}
			});

			// Count draggable leaf accounts under a node
			const count_leaves = (node) => {
				if (!node.is_group) return 1;
				return node.children.reduce((s, c) => s + count_leaves(c), 0);
			};

			// Recursively render a node as a nested folder or draggable chip
			const render_node = (node) => {
				const label = node.account_name || node.name.split(" - ")[0];
				const search_val = (node.account_name + " " + node.name).toLowerCase();

				if (node.is_group) {
					const leaf_count = count_leaves(node);
					const children_html = node.children.map(render_node).join("");
					return `<div class="ps-ac-folder-row">
						<div class="ps-ac-folder-hdr ps-ac-expanded"
						     data-name="${esc(node.name)}"
						     data-search="${esc(search_val)}">
							<span class="ps-ac-folder-icon">▶</span>
							<span class="ps-ac-folder-name">${esc(label)}</span>
							${leaf_count ? `<span class="ps-ac-node-count">${leaf_count}</span>` : ""}
						</div>
						<div class="ps-ac-folder-body">
							${children_html}
						</div>
					</div>`;
				} else {
					return `<div class="ps-ac-chip ps-ac-avail" draggable="true"
						data-account="${esc(node.name)}"
						data-source="available"
						data-company="${esc(node.company || "")}"
						data-root="${esc(node.root_type || "")}"
						data-search="${esc(search_val)}"
						title="${esc(node.name)}">
						<span class="ps-ac-chip-label">${esc(label)}</span>
						${node.account_type ? `<span class="ps-ac-type-badge">${esc(node.account_type)}</span>` : ""}
					</div>`;
				}
			};

			// Group by company → root_type
			const companies = [...new Set(accounts.map((a) => a.company || ""))].sort();
			let html = "";

			companies.forEach((co) => {
				const co_tops = root_nodes.filter((n) => (n.company || "") === co);
				const roots   = [...new Set(accounts.filter((a) => (a.company || "") === co).map((a) => a.root_type || "Other"))];
				const sorted_roots = [...ROOT_ORDER.filter((r) => roots.includes(r)), ...roots.filter((r) => !ROOT_ORDER.includes(r))];

				html += `<div class="ps-ac-company-block" data-company="${esc(co)}">
					<div class="ps-ac-company-hdr">${frappe.utils.icon("building", "xs")} ${esc(co)}</div>`;

				sorted_roots.forEach((root) => {
					const root_tops = co_tops.filter((n) => (n.root_type || "Other") === root);
					html += `<div class="ps-ac-root-block" data-root="${esc(root)}">
						<div class="ps-ac-root-hdr">${ROOT_ICON[root] || "📁"} ${esc(root)}</div>
						${root_tops.map(render_node).join("")}
					</div>`;
				});

				html += `</div>`;
			});
			return html;
		};

		// ── Restricted zone ────────────────────────────────────────────────────
		const restricted_html = data.restrictions.map((r) => {
			const label = r.for_value.includes(" - ") ? r.for_value.split(" - ")[0] : r.for_value;
			return `<div class="ps-ac-chip ps-ac-restricted" draggable="true"
						data-account="${esc(r.for_value)}"
						data-perm-name="${esc(r.name)}"
						data-source="restricted"
						title="${esc(r.for_value)}">
						<span class="ps-ac-chip-label">${esc(label)}</span>
						<button class="ps-ac-chip-x btn-naked" data-perm-name="${esc(r.name)}" title="${__("Remove")}">✕</button>
					</div>`;
		}).join("");

		const restricted_zone_content = data.is_restricted
			? `<div class="ps-ac-restricted-chips">${restricted_html}</div>`
			: `<div class="ps-ac-zone-unrestricted">
				${frappe.utils.icon("tick-circle", "sm")}
				<span>${__("No restrictions — user has access to all accounts.")}</span>
				<small>${__("Drag accounts here to restrict.")}</small>
			   </div>`;

		// Company filter options (for the dropdown)
		const companies = [...new Set(available.map((a) => a.company || ""))].sort();
		const co_notice = (data.company_restrictions || []).length
			? `<span class="ps-ac-co-notice">🔒 ${__("Filtered to {0} company restriction(s)", [data.company_restrictions.length])}</span>`
			: "";

		this.$content.html(`
			<div class="ps-accounts-dnd">

				<div class="ps-ac-topbar">
					<div class="ps-ac-topbar-left">
						<span class="ps-ac-user-badge">${esc(user)}</span>
						<span class="ps-ac-status-badge ${data.is_restricted ? "ps-ac-status-restricted" : "ps-ac-status-open"}">
							${data.is_restricted ? `🔒 ${__("{0} restricted", [data.restrictions.length])}` : `✓ ${__("All accounts open")}`}
						</span>
						${co_notice}
					</div>
					<div class="ps-ac-topbar-right">
						${data.is_restricted ? `<button class="btn btn-sm btn-default ps-ac-clear-btn">
							${frappe.utils.icon("undo", "xs")} ${__("Clear All")}
						</button>` : ""}
					</div>
				</div>

				<div class="ps-ac-filter-row">
					<input class="form-control ps-ac-search" placeholder="${__("Search accounts…")}" type="text" autocomplete="off" />
					<select class="form-control ps-ac-company-sel">
						<option value="">${__("All Companies")}</option>
						${companies.map((co) => `<option value="${esc(co)}">${esc(co)}</option>`).join("")}
					</select>
				</div>

				<div class="ps-ac-panels">
					<div class="ps-ac-panel">
						<div class="ps-ac-panel-header">
							${frappe.utils.icon("list", "xs")}
							<strong>${__("Chart of Accounts")}</strong>
							<div class="ps-ac-tree-btns">
								<button class="btn btn-xs btn-default ps-ac-expand-all-btn" title="${__("Expand All")}">⊞ ${__("Expand")}</button>
								<button class="btn btn-xs btn-default ps-ac-collapse-all-btn" title="${__("Collapse All")}">⊟ ${__("Collapse")}</button>
							</div>
							<span class="ps-ac-panel-hint">${__("drag → to restrict")}</span>
						</div>
						<div class="ps-drop-zone ps-ac-avail-zone ps-ac-scroll" data-target="available">
							<div class="ps-ac-avail-inner">${_coa_html(available)}</div>
						</div>
					</div>

					<div class="ps-ac-arrow">⇄</div>

					<div class="ps-ac-panel">
						<div class="ps-ac-panel-header">
							${frappe.utils.icon("lock", "xs")}
							<strong>${__("Restricted To")}</strong>
							<span class="ps-ac-panel-hint">${__("drag ← to unrestrict")}</span>
						</div>
						<div class="ps-drop-zone ps-ac-restr-zone ps-ac-scroll" data-target="restricted">
							${restricted_zone_content}
						</div>
					</div>
				</div>
			</div>
		`);

		this._bind_account_dnd(user);
	}

	_bind_account_dnd(user) {
		const $c = this.$content;

		// ── Folder expand / collapse (namespaced to prevent accumulation on re-render)
		$c.off("click.ps-folder");
		$c.on("click.ps-folder", ".ps-ac-folder-hdr", function () {
			const $hdr  = $(this);
			const $body = $hdr.next(".ps-ac-folder-body");
			if ($hdr.hasClass("ps-ac-expanded")) {
				$hdr.removeClass("ps-ac-expanded");
				$body.hide();
			} else {
				$hdr.addClass("ps-ac-expanded");
				$body.show();
			}
		});

		$c.find(".ps-ac-expand-all-btn").off("click").on("click", () => {
			$c.find(".ps-ac-folder-hdr").addClass("ps-ac-expanded");
			$c.find(".ps-ac-folder-body").show();
		});

		$c.find(".ps-ac-collapse-all-btn").off("click").on("click", () => {
			$c.find(".ps-ac-folder-hdr").removeClass("ps-ac-expanded");
			$c.find(".ps-ac-folder-body").hide();
		});

		// ── Shared refresh: apply both search + company filter ────────────────
		const _refresh_tree = () => {
			const q  = ($c.find(".ps-ac-search").val()  || "").trim().toLowerCase();
			const co = ($c.find(".ps-ac-company-sel").val() || "");

			// Company filter: show/hide company blocks
			$c.find(".ps-ac-company-block").each(function () {
				$(this).toggle(!co || $(this).attr("data-company") === co);
			});

			if (!q) {
				// Restore all, then re-apply each folder's collapsed/expanded state
				$c.find(".ps-ac-root-block, .ps-ac-folder-row, .ps-ac-chip.ps-ac-avail").show();
				$c.find(".ps-ac-folder-hdr").each(function () {
					const $body = $(this).next(".ps-ac-folder-body");
					if ($(this).hasClass("ps-ac-expanded")) $body.show();
					else $body.hide();
				});
				return;
			}

			// During search: expand all so chips are reachable regardless of collapse state
			$c.find(".ps-ac-folder-body").show();
			$c.find(".ps-ac-folder-row").show();

			// Filter chips by query
			$c.find(".ps-ac-chip.ps-ac-avail").each(function () {
				const s = ($(this).attr("data-search") || "").toLowerCase();
				$(this).toggle(s.includes(q));
			});

			// Hide folder rows that have no visible chips (process innermost first)
			$c.find(".ps-ac-folder-row").get().reverse().forEach((row) => {
				const has_visible = $(row).find(".ps-ac-chip.ps-ac-avail:visible").length > 0;
				$(row).toggle(has_visible);
			});

			// Show/hide root blocks
			$c.find(".ps-ac-root-block").each(function () {
				$(this).toggle($(this).find(".ps-ac-chip.ps-ac-avail:visible").length > 0);
			});
		};

		$c.find(".ps-ac-search").on("input", _refresh_tree);
		$c.find(".ps-ac-company-sel").on("change", _refresh_tree);

		// ── Clear all restrictions ─────────────────────────────────────────────
		$c.find(".ps-ac-clear-btn").on("click", () => {
			frappe.confirm(
				__("Remove ALL account restrictions for this user? They will have access to all accounts."),
				() => {
					frappe.call({
						method: "permission_manager.permission_manager.api.user_profile.clear_user_account_restrictions",
						args: { user },
						callback: () => {
							frappe.show_alert({ message: __("All restrictions cleared."), indicator: "green" });
							this._load_user_accounts(user);
						},
					});
				}
			);
		});

		// ── ✕ button on restricted chips ──────────────────────────────────────
		$c.find(".ps-ac-chip-x").on("click", (e) => {
			e.stopPropagation();
			const perm_name = $(e.currentTarget).data("permName");
			this._do_remove_account_restriction(user, perm_name);
		});

		// ── Drag-and-drop ──────────────────────────────────────────────────────
		const _make_draggable = (selector) => {
			$c.find(selector).each(function () {
				const chip = this;
				chip.addEventListener("dragstart", (e) => {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("account",  chip.getAttribute("data-account")   || "");
					e.dataTransfer.setData("source",   chip.getAttribute("data-source")    || "");
					e.dataTransfer.setData("permname", chip.getAttribute("data-perm-name") || "");
					// Use setTimeout so the "dragging" style is visible during the drag
					setTimeout(() => chip.classList.add("ps-chip-dragging"), 0);
				});
				chip.addEventListener("dragend", () => {
					chip.classList.remove("ps-chip-dragging");
				});
			});
		};

		_make_draggable(".ps-ac-chip.ps-ac-avail");
		_make_draggable(".ps-ac-chip.ps-ac-restricted");

		// ── Drop zones ─────────────────────────────────────────────────────────
		// Use enter/leave counter to prevent false dragleave from child elements
		const _make_droppable = (selector) => {
			const el = $c.find(selector)[0];
			if (!el) return;
			let enter_count = 0;

			el.addEventListener("dragenter", (e) => {
				e.preventDefault();
				enter_count++;
				el.classList.add("ps-dz-over");
			});
			el.addEventListener("dragover", (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
			});
			el.addEventListener("dragleave", () => {
				enter_count--;
				if (enter_count <= 0) {
					enter_count = 0;
					el.classList.remove("ps-dz-over");
				}
			});
			el.addEventListener("drop", (e) => {
				e.preventDefault();
				enter_count = 0;
				el.classList.remove("ps-dz-over");
				const account  = e.dataTransfer.getData("account");
				const source   = e.dataTransfer.getData("source");
				const permName = e.dataTransfer.getData("permname");
				const target   = el.getAttribute("data-target");

				if (source === "available" && target === "restricted" && account) {
					this._do_add_account_restriction(user, account);
				} else if (source === "restricted" && target === "available" && permName) {
					this._do_remove_account_restriction(user, permName);
				}
			});
		};

		_make_droppable(".ps-ac-avail-zone");
		_make_droppable(".ps-ac-restr-zone");
	}

	_do_add_account_restriction(user, account) {
		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.add_user_account_restriction",
			args:   { user, account },
			callback: (r) => {
				if (r.message?.success) {
					frappe.show_alert({ message: __("{0} restricted.", [account]), indicator: "orange" });
					this._load_user_accounts(user);
				}
			},
		});
	}

	_do_remove_account_restriction(user, perm_name) {
		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",
			args:   { perm_name },
			callback: (r) => {
				if (r.message?.success) {
					frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
					this._load_user_accounts(user);
				}
			},
		});
	}

	// ── Profile tab ──────────────────────────────────────────────────────────

	_render_profile_tab() {
		this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-profile-select"></div>
			</div>
		`);

		this.profile_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", options: "Role Profile", fieldname: "profile",
				placeholder: __("Select Role Profile…"), label: __("Role Profile"),
				change: () => {
					const profile = this.profile_field.get_value();
					if (profile) { this._current_profile = profile; this.load_profile_matrix(profile); }
				},
			},
			parent: this.$search.find("#ps-profile-select"),
			render_input: true,
		});

		this.$content.html(this._welcome_html(
			frappe.utils.icon("group", "lg"),
			__("Select a Role Profile"),
			__("View the combined permission matrix for all roles inside a profile, and see which users are on it.")
		));
	}

	load_profile_matrix(profile) {
		this.$content.html(this._show_skeleton(6));

		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.get_role_profile_matrix",
			args: { profile },
			callback: (r) => {
				if (r.message) {
					this.components.profile = new RoleProfileExplorer({
						wrapper:   this.$content,
						data:      r.message,
						on_export: (p) => this._export_profile_csv(p),
					});
				}
			},
			error: () => {
				this.$content.html(
					this._error_html(__("Failed to load profile matrix."), () => this.load_profile_matrix(profile))
				);
			},
		});
	}

	_export_profile_csv(profile) {
		frappe.dom.freeze(__("Generating CSV…"));
		frappe.call({
			method: "permission_manager.permission_manager.api.user_profile.get_role_profile_matrix",
			args: { profile },
			callback: (r) => {
				frappe.dom.unfreeze();
				if (!r.message) return;
				const d = r.message;
				const rows = [
					["Role Profile", d.profile],
					["Roles", d.roles.join(", ")],
					["User Count", d.user_count],
					[],
					["Module", "DocType", "Source", ...MATRIX_RIGHTS],
				];
				for (const mod of d.modules) {
					for (const dt of mod.doctypes) {
						rows.push([
							mod.module,
							dt.doctype,
							dt.source,
							...MATRIX_RIGHTS.map((r) => {
								const v = dt.permissions[r];
								return v === "na" ? "N/A" : v ? "1" : "0";
							}),
						]);
					}
				}
				const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
				const safe = profile.replace(/[^a-z0-9]/gi, "_");
				_download_csv_raw(csv, `permissions_profile_${safe}.csv`);
				frappe.show_alert({ message: __("CSV downloaded."), indicator: "green" });
			},
			error: () => {
				frappe.dom.unfreeze();
				frappe.show_alert({ message: __("Export failed."), indicator: "red" });
			},
		});
	}

	// ── User Override Dialog ──────────────────────────────────────────────────

	_show_user_override_dialog(user, status) {
		const is_active = status.is_active;

		const dlg = new frappe.ui.Dialog({
			title: __("Override Permissions — {0}", [user]),
			size:  "extra-large",
			fields: [
				{ fieldtype: "HTML", fieldname: "status_html" },
				{ fieldtype: "HTML", fieldname: "editor_html" },
			],
		});

		const $status = dlg.fields_dict.status_html.$wrapper;
		const $editor = dlg.fields_dict.editor_html.$wrapper;

		// ── Status banner ────────────────────────────────────────────────────────
		const saved_items = status.override_permissions || [];

		if (is_active) {
			// Build a compact chip list of currently overridden DocTypes
			const dt_chips = saved_items.map((item) => {
				const rights = MATRIX_RIGHTS.filter((r) => item.permissions?.[r]).join(", ");
				const is_owner = item.permissions?.if_owner;
				const rights_label = (rights || "—") + (is_owner ? " ★" : "");
				return `<span class="ps-oe-cur-chip" title="${esc(rights_label)}${is_owner ? " — " + __("Only If Creator") : ""}">
					${esc(item.doctype)}
					<em class="ps-oe-cur-rights">${esc(rights_label)}</em>
				</span>`;
			}).join("");

			$status.html(`
				<div class="ps-override-status-section">
					<div class="ps-override-active-banner">
						${frappe.utils.icon("tick-circle", "sm")}
						<strong>${__("Override Active")}</strong>
						&nbsp;—&nbsp; ${__("Profile")}: <code>${esc(status.profile_name)}</code>
						&nbsp;|&nbsp; <span class="ps-oe-cur-count">${saved_items.length} ${__("DocType(s)")}</span>
					</div>
					${saved_items.length ? `<div class="ps-oe-cur-list">${dt_chips}</div>` : ""}
					<div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
						<button class="btn btn-sm btn-danger ps-remove-override-btn">
							${frappe.utils.icon("delete", "xs")} ${__("Remove Override")}
						</button>
						<span style="color:var(--text-muted);font-size:12px;">
							${__("Update the rows below and click Apply to save changes.")}
						</span>
					</div>
				</div>
			`);

			$status.find(".ps-remove-override-btn").on("click", () => {
				frappe.confirm(
					__("Remove override for {0}? The user will revert to standard role permissions.", [user]),
					() => {
						frappe.dom.freeze(__("Removing override…"));
						frappe.call({
							method: "permission_manager.permission_manager.api.user_profile.remove_user_override",
							args:   { user },
							callback: (r) => {
								frappe.dom.unfreeze();
								frappe.show_alert({ message: r.message?.msg || __("Override removed."), indicator: "green" });
								dlg.hide();
								this.load_user_matrix(user);
							},
							error: () => frappe.dom.unfreeze(),
						});
					}
				);
			});
		} else {
			$status.html(`
				<div class="ps-override-status-section">
					<div class="ps-oe-mode-hint">
						<span class="ps-mode-hint-restrict">
							${__("A full permission snapshot is taken for this user. For each DocType you add, they will have EXACTLY the permissions you check — original roles are replaced so nothing can win them back. All other DocTypes stay as-is.")}
						</span>
					</div>
				</div>
			`);
		}

		// ── Permission editor ────────────────────────────────────────────────────
		const initial_rows = saved_items.map((item) => ({
			doctype:     item.doctype,
			permissions: item.permissions || {},
		}));

		this._render_override_editor($editor, initial_rows);

		// ── Apply button ──────────────────────────────────────────────────────────
		dlg.set_primary_action(__("Apply Override"), () => {
			const rows = this._collect_override_rows($editor);
			if (!rows.length) {
				frappe.show_alert({ message: __("Add at least one DocType row."), indicator: "orange" });
				return;
			}
			dlg.hide();
			frappe.dom.freeze(__("Snapshotting permissions and applying override…"));

			frappe.call({
				method: "permission_manager.permission_manager.api.user_profile.create_user_override",
				args:   { user, override_items: JSON.stringify(rows), mode: "restrict" },
				callback: (r) => {
					frappe.dom.unfreeze();
					if (r.message?.success) {
						frappe.show_alert({ message: r.message.msg, indicator: "green" });
						frappe.msgprint({
							title:   __("Override Applied"),
							message: `
								<b>${__("Role")}:</b> <code>${esc(r.message.role_name)}</code><br>
								<b>${__("Profile")}:</b> <code>${esc(r.message.profile_name)}</code><br>
								<b>${__("Roles in profile")}:</b> ${(r.message.roles_included || []).map(esc).join(", ")}
							`,
							indicator: "green",
						});
						this.load_user_matrix(user);
					}
				},
				error: () => frappe.dom.unfreeze(),
			});
		});

		dlg.show();
	}

	_render_override_editor($editor, initial_rows) {
		$editor.empty();

		const cols_html = MATRIX_RIGHTS.map(
			(r) => `<th class="ps-oe-perm-col" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`
		).join("");

		$editor.html(`
			<div class="ps-override-editor">
				<div class="ps-oe-header">
					<span class="ps-oe-header-label">${__("Per-DocType permissions:")}</span>
					<div style="display:flex;gap:6px;align-items:center;">
						<button class="btn btn-xs btn-default ps-oe-deps-btn" title="${__("For every DocType with Create checked, auto-add read access to its linked DocTypes")}">
							🔗 ${__("Suggest dependencies")}
						</button>
						<span class="ps-oe-row-count"></span>
					</div>
				</div>
				<div class="ps-oe-search-wrap">
					<div class="ps-oe-search-icon">${frappe.utils.icon("search", "xs")}</div>
					<input class="form-control ps-oe-dt-search"
						placeholder="${__("Filter rows or type to add a new DocType…")}"
						type="text" autocomplete="off" />
					<ul class="ps-oe-suggestions"></ul>
				</div>
				<div class="ps-oe-table-wrap">
					<table class="ps-matrix-table ps-oe-table">
						<thead>
							<tr>
								<th class="ps-oe-dt-col">${__("DocType")}</th>
								<th class="ps-oe-perm-col ps-oe-owner-col" title="${__("Only If Creator — permissions apply only to documents this user owns")}">Own</th>
								${cols_html}
								<th></th>
							</tr>
						</thead>
						<tbody class="ps-oe-tbody"></tbody>
					</table>
				</div>
				<div class="ps-oe-empty" style="${initial_rows.length ? "display:none;" : ""}">
					<em>${__("No rows yet — type a DocType name above to add one.")}</em>
				</div>
			</div>
		`);

		const $tbody      = $editor.find(".ps-oe-tbody");
		const $search     = $editor.find(".ps-oe-dt-search");
		const $suggestions = $editor.find(".ps-oe-suggestions");

		const $row_count = $editor.find(".ps-oe-row-count");
		const _update_count = () => {
			const total   = $tbody.find("tr").length;
			const visible = $tbody.find("tr:visible").length;
			if (!total) { $row_count.text(""); return; }
			$row_count.text(visible < total
				? __("{0} / {1} DocType(s)", [visible, total])
				: __("{0} DocType(s)", [total])
			);
		};

		const _add_row = (doctype, permissions = {}) => {
			if (!doctype) return;
			if ($tbody.find(`tr[data-doctype="${doctype}"]`).length) {
				// Row already exists — scroll to it and flash highlight
				const $existing = $tbody.find(`tr[data-doctype="${doctype}"]`);
				$existing[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
				$existing.addClass("ps-oe-row-flash");
				setTimeout(() => $existing.removeClass("ps-oe-row-flash"), 1200);
				return;
			}
			const owner_cell = `<td class="ps-oe-perm-col ps-oe-owner-col" title="${__("Only If Creator")}">
				<input type="checkbox" class="ps-oe-check" data-ptype="if_owner"
					${permissions["if_owner"] ? "checked" : ""} />
			</td>`;

			const checks_html = MATRIX_RIGHTS.map((r) => `
				<td class="ps-oe-perm-col">
					<input type="checkbox" class="ps-oe-check" data-ptype="${r}"
						${permissions[r] ? "checked" : ""} />
				</td>
			`).join("");

			const $row = $(`
				<tr data-doctype="${esc(doctype)}">
					<td class="ps-oe-dt-col ps-oe-dt-name">${esc(doctype)}</td>
					${owner_cell}
					${checks_html}
					<td>
						<button class="btn btn-xs btn-danger ps-oe-remove-btn" title="${__("Remove")}">
							${frappe.utils.icon("delete", "xs")}
						</button>
					</td>
				</tr>
			`);
			$tbody.append($row);
			$row.find(".ps-oe-remove-btn").on("click", () => {
				$row.remove();
				if (!$tbody.find("tr").length) $editor.find(".ps-oe-empty").show();
				_update_count();
			});
			$editor.find(".ps-oe-empty").hide();
			_update_count();
		};

		// ── Search: filter existing rows + suggest new DocTypes to add ───────────
		let _timer = null;

		const _refresh_suggestions = (q) => {
			if (!q) { $suggestions.empty().hide(); return; }
			clearTimeout(_timer);
			_timer = setTimeout(() => {
				// Collect already-added DocTypes so we don't suggest them
				const added = new Set(
					$tbody.find("tr").map((_, r) => $(r).attr("data-doctype")).get()
				);
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype:  "DocType",
						filters:  [["name", "like", `%${q}%`], ["istable", "=", 0]],
						fields:   ["name"],
						limit:    10,
						order_by: "name asc",
					},
					callback: (r) => {
						$suggestions.empty();
						const fresh = (r.message || []).filter((dt) => !added.has(dt.name));
						if (!fresh.length) { $suggestions.hide(); return; }
						fresh.forEach((dt) => {
							$(`<li class="ps-oe-sug-item">
								<span class="ps-sug-plus">+</span> ${esc(dt.name)}
							</li>`)
								.on("mousedown", (e) => {
									e.preventDefault();
									_add_row(dt.name);
									$search.val("").trigger("input");
								})
								.appendTo($suggestions);
						});
						$suggestions.show();
					},
				});
			}, 200);
		};

		$search.on("input", function () {
			const q = $(this).val().trim();

			// 1. Instantly filter existing rows
			$tbody.find("tr").each(function () {
				const dt = $(this).attr("data-doctype") || "";
				$(this).toggle(!q || dt.toLowerCase().includes(q.toLowerCase()));
			});
			$editor.find(".ps-oe-empty").toggle(!q && !$tbody.find("tr").length);
			_update_count();

			// 2. Show suggestions for DocTypes not yet in the table
			_refresh_suggestions(q);
		});

		$search.on("blur",  () => setTimeout(() => $suggestions.hide(), 160));
		$search.on("focus", () => { if ($suggestions.children().length) $suggestions.show(); });

		$search.on("keydown", (e) => {
			if (e.key === "Escape") {
				$suggestions.hide();
				$search.val("").trigger("input");
			}
			if (e.key === "Enter") {
				const $first = $suggestions.find(".ps-oe-sug-item").first();
				if ($first.length) {
					const name = $first.text().replace(/^\+\s*/, "").trim();
					_add_row(name);
					$search.val("").trigger("input");
					$suggestions.hide();
				}
			}
		});

		initial_rows.forEach((r) => _add_row(r.doctype, r.permissions));

		// ── "Suggest dependencies" button ─────────────────────────────────────────
		$editor.find(".ps-oe-deps-btn").on("click", () => {
			// Collect all rows that have "create" checked
			const create_dts = [];
			$tbody.find("tr").each(function () {
				const dt = $(this).attr("data-doctype");
				const has_create = $(this).find(".ps-oe-check[data-ptype='create']").is(":checked");
				if (dt && has_create) create_dts.push(dt);
			});

			if (!create_dts.length) {
				frappe.show_alert({ message: __("Check 'C' (Create) on at least one DocType first."), indicator: "orange" });
				return;
			}

			const $btn = $editor.find(".ps-oe-deps-btn").prop("disabled", true).text(__("Analyzing…"));
			let pending = create_dts.length;
			let total_added = 0;

			create_dts.forEach((dt) => {
				frappe.call({
					method: "permission_manager.permission_manager.api.user_profile.get_doctype_create_deps",
					args: { doctype: dt },
					callback: (r) => {
						(r.message || []).forEach((dep) => {
							if (!$tbody.find(`tr[data-doctype="${dep}"]`).length) {
								_add_row(dep, { read: 1 });
								total_added++;
							}
						});
						pending--;
						if (pending === 0) {
							$btn.prop("disabled", false).html(`🔗 ${__("Suggest dependencies")}`);
							frappe.show_alert({
								message: total_added
									? __("Added {0} linked DocType(s) with read access.", [total_added])
									: __("All linked DocTypes already present."),
								indicator: total_added ? "blue" : "green",
							});
						}
					},
					error: () => {
						pending--;
						if (pending === 0) $btn.prop("disabled", false).html(`🔗 ${__("Suggest dependencies")}`);
					},
				});
			});
		});
	}

	_collect_override_rows($editor) {
		const rows = [];
		$editor.find(".ps-oe-tbody tr").each(function () {
			const dt = $(this).attr("data-doctype");
			if (!dt) return;
			const permissions = {};
			$(this).find(".ps-oe-check").each(function () {
				permissions[$(this).data("ptype")] = $(this).is(":checked") ? 1 : 0;
			});
			rows.push({ doctype: dt, permissions });
		});
		return rows;
	}

	// ── Account Restrictions Dialog ───────────────────────────────────────────

	_show_account_restrictions_dialog(user) {
		const dlg = new frappe.ui.Dialog({
			title: __("Account Restrictions — {0}", [user]),
			size:  "large",
			fields: [{ fieldtype: "HTML", fieldname: "content_html" }],
		});

		const $w = dlg.fields_dict.content_html.$wrapper;
		$w.html(`<div class="ps-loading">${__("Loading…")}</div>`);

		const _reload = () => {
			frappe.call({
				method: "permission_manager.permission_manager.api.user_profile.get_user_account_restrictions",
				args: { user },
				callback: (r) => r.message && _render(r.message),
			});
		};

		const _render = (data) => {
			const has_restrictions = data.is_restricted;
			const restricted_set  = new Set(data.restrictions.map((r) => r.for_value));

			// Build accounts grouped by company
			const company_map = {};
			for (const acct of data.all_accounts) {
				const co = acct.company || "Other";
				company_map[co] = company_map[co] || [];
				company_map[co].push(acct);
			}

			const restriction_rows = has_restrictions
				? data.restrictions.map((r) => `
					<div class="ps-ar-row">
						<span class="ps-badge ps-badge-custom">${esc(r.for_value)}</span>
						<button class="btn btn-xs btn-danger ps-ar-remove-btn" data-name="${esc(r.name)}">
							${frappe.utils.icon("delete", "xs")}
						</button>
					</div>
				`).join("")
				: `<div class="ps-ar-unrestricted">
					${frappe.utils.icon("tick-circle", "sm")}
					${__("No restrictions — user can access ALL accounts.")}
				   </div>`;

			const company_opts = Object.keys(company_map).sort().map(
				(co) => `<option value="${esc(co)}">${esc(co)}</option>`
			).join("");

			$w.html(`
				<div class="ps-accounts-control">

					<div class="ps-ar-section">
						<div class="ps-ar-section-header">
							<strong>${__("Current Account Restrictions")}</strong>
							${has_restrictions ? `
								<button class="btn btn-xs btn-default ps-ar-clear-btn">
									${frappe.utils.icon("undo", "xs")} ${__("Clear All (Allow All)")}
								</button>` : ""}
						</div>
						<div class="ps-ar-restrictions-list">${restriction_rows}</div>
					</div>

					<div class="ps-ar-section">
						<div class="ps-ar-section-header">
							<strong>${__("Add Account Restriction")}</strong>
						</div>
						<div class="ps-ar-add-row">
							<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
								<div style="flex:0 0 160px;">
									<label class="control-label">${__("Filter by Company")}</label>
									<select class="form-control ps-ar-company-filter">
										<option value="">${__("All Companies")}</option>
										${company_opts}
									</select>
								</div>
								<div style="flex:1;min-width:200px;" id="ps-ar-acct-field"></div>
								<div>
									<button class="btn btn-sm btn-primary ps-ar-add-btn" style="margin-bottom:4px;">
										${frappe.utils.icon("add", "xs")} ${__("Add Restriction")}
									</button>
								</div>
							</div>
						</div>
					</div>

					<div class="ps-ar-help">
						${frappe.utils.icon("info", "xs")}
						${__("When any Account restriction is set, this user can only access the listed accounts (and linked records). No restrictions = access all accounts.")}
					</div>

				</div>
			`);

			// Account link control
			const acct_ctl = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link", options: "Account", fieldname: "account",
					placeholder: __("Select Account…"), label: __("Account"),
				},
				parent: $w.find("#ps-ar-acct-field"),
				render_input: true,
			});

			// Company filter changes account filter query
			$w.find(".ps-ar-company-filter").on("change", function () {
				const co = $(this).val();
				acct_ctl.df.get_query = co
					? () => ({ filters: { company: co, disabled: 0 } })
					: () => ({ filters: { disabled: 0 } });
				acct_ctl.set_value("");
			});

			// Add restriction
			$w.find(".ps-ar-add-btn").on("click", () => {
				const account = acct_ctl.get_value();
				if (!account) {
					frappe.show_alert({ message: __("Select an account first."), indicator: "orange" });
					return;
				}
				if (restricted_set.has(account)) {
					frappe.show_alert({ message: __("Account already restricted."), indicator: "orange" });
					return;
				}
				frappe.dom.freeze(__("Adding restriction…"));
				frappe.call({
					method: "permission_manager.permission_manager.api.user_profile.add_user_account_restriction",
					args:   { user, account },
					callback: (r) => {
						frappe.dom.unfreeze();
						if (r.message?.success) {
							frappe.show_alert({ message: __("Restriction added."), indicator: "green" });
							_reload();
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			});

			// Remove individual restriction
			$w.find(".ps-ar-remove-btn").on("click", (e) => {
				const name = $(e.currentTarget).data("name");
				frappe.dom.freeze(__("Removing…"));
				frappe.call({
					method: "permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",
					args:   { perm_name: name },
					callback: (r) => {
						frappe.dom.unfreeze();
						if (r.message?.success) {
							frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
							_reload();
						}
					},
					error: () => frappe.dom.unfreeze(),
				});
			});

			// Clear all
			$w.find(".ps-ar-clear-btn").on("click", () => {
				frappe.confirm(
					__("Clear ALL account restrictions for {0}? The user will have access to all accounts.", [user]),
					() => {
						frappe.dom.freeze(__("Clearing…"));
						frappe.call({
							method: "permission_manager.permission_manager.api.user_profile.clear_user_account_restrictions",
							args:   { user },
							callback: (r) => {
								frappe.dom.unfreeze();
								frappe.show_alert({ message: __("All restrictions cleared."), indicator: "green" });
								_reload();
							},
							error: () => frappe.dom.unfreeze(),
						});
					}
				);
			});
		};

		dlg.set_primary_action(__("Close"), () => dlg.hide());
		dlg.show();
		_reload();
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
					fieldtype: "Check",
					fieldname: "perm_if_owner",
					label: __("Only If Creator"),
					description: __("When checked, all above permissions apply only to documents owned/created by this user"),
					default: 0,
				},
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
				permissions["if_owner"] = vals["perm_if_owner"] ? 1 : 0;

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
	RoleProfileExplorer,
	ReverseLookup,
	RoleComparison,
	HealthDashboard,
	showUserSimulation,
	WorkflowDiagram,
	MATRIX_RIGHTS,
	RIGHT_LABELS,
	PERM_ICONS,
	esc,
});

// Standalone Approval Inbox — exported globally for the pm-approval-inbox page
window.pm_approval_inbox = { ApprovalInbox };
