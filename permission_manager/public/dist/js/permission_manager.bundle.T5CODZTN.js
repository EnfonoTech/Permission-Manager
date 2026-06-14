(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // ../permission_manager/permission_manager/public/js/pm_workflow.js
  $(document).on("form-refresh", function(event, frm) {
    if (!frm || !frm.doctype)
      return;
    if (frm.doc.__islocal)
      return;
    try {
      frappe.call({
        method: "permission_manager.permission_manager.workflow.get_workflow_info",
        args: { doc: frm.doc },
        callback(res) {
          var _a, _b;
          if (!((_a = res == null ? void 0 : res.message) == null ? void 0 : _a.workflow) && !((_b = res == null ? void 0 : res.message) == null ? void 0 : _b.current_state))
            return;
          const workflow = res.message.workflow;
          const workflow_name = res.message.workflow.name;
          const current_state = res.message.current_state;
          if (!res.message.allow_edit) {
            frm.set_read_only(true);
          }
          if (workflow_name) {
            frm.page.clear_primary_action();
            if (!workflow.override_status) {
              _override_document_status(frm, current_state, workflow.workflow_state_field);
            }
            _load_allowed_transitions(frm, workflow, current_state);
            _load_pending_approver_info(frm);
          }
        }
      });
    } catch (err) {
      console.error("Permission Manager: Error initialising PM Workflow:", err);
    }
  });
  function _check_mandatory(frm) {
    const skip_types = ["Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Fold", "Button"];
    const skip_fields = ["name", "owner", "modified_by", "creation", "modified", "docstatus", "idx"];
    const missing = [];
    (frm.fields || []).forEach((f) => {
      const df = f && f.df;
      if (!df || !df.reqd)
        return;
      if (skip_types.includes(df.fieldtype))
        return;
      if (skip_fields.includes(df.fieldname))
        return;
      if (df.hidden || df.read_only)
        return;
      if (f.disp_status === "None")
        return;
      const val = frm.doc[df.fieldname];
      if (val === void 0 || val === null || val === "") {
        missing.push(__(df.label || df.fieldname));
      }
    });
    if (missing.length) {
      frappe.msgprint({
        title: __("Mandatory Fields Required"),
        message: __("Please fill in the following required fields:") + "<br><ul><li>" + missing.join("</li><li>") + "</li></ul>",
        indicator: "red"
      });
      return false;
    }
    return true;
  }
  function _load_allowed_transitions(frm, workflow, current_state) {
    frappe.call({
      method: "permission_manager.permission_manager.workflow.get_transitions",
      args: { doc: frm.doc, workflow: workflow.name, current_state },
      callback(r) {
        const transitions = r.message || [];
        frm.page.clear_actions_menu();
        if (!transitions.length)
          return;
        transitions.forEach((t) => {
          frm.page.add_action_item(__(t.action), function() {
            frm.selected_workflow_action = t.action;
            if (!_check_mandatory(frm))
              return;
            _open_comment_dialog(frm, t);
          });
        });
        _add_workflow_help_action(frm, transitions, current_state);
      }
    });
  }
  function _load_pending_approver_info(frm) {
    if (frm.doc.docstatus !== 0)
      return;
    frappe.call({
      method: "permission_manager.permission_manager.workflow.get_pending_workflow_action",
      args: { doctype: frm.doctype, docname: frm.doc.name },
      callback(r) {
        const action = r.message;
        if (!action)
          return;
        const assigned_to = action.assigned_to;
        const assigned_name = action.assigned_to_name || assigned_to;
        if (assigned_to) {
          if (!frm.$wrapper.find(".pm-approver-info").length) {
            const $info = $(`
						<div class="pm-approver-info">
							${frappe.utils.icon("users", "xs")}
							<span>${__("Pending approval from:")}</span>
							<strong class="pm-approver-name">${frappe.utils.escape_html(assigned_name)}</strong>
						</div>
					`);
            frm.$wrapper.find(".page-head").after($info);
          } else {
            frm.$wrapper.find(".pm-approver-name").text(assigned_name);
          }
        }
        if (frappe.user.has_role(["System Manager", "HR Manager"])) {
          frm.remove_custom_button(__("Reassign Approver"));
          frm.add_custom_button(__("Reassign Approver"), () => {
            _show_reassign_dialog(frm, action);
          }, __("Workflow"));
        }
      }
    });
  }
  function _show_reassign_dialog(frm, current_action) {
    const dlg = new frappe.ui.Dialog({
      title: __("Reassign Approver"),
      fields: [
        {
          fieldtype: "HTML",
          fieldname: "current_info",
          options: current_action.assigned_to ? `<div class="pm-reassign-current">
						<strong>${__("Current Approver")}:</strong>
						${frappe.utils.escape_html(current_action.assigned_to_name || current_action.assigned_to)}
					   </div>` : `<div class="pm-reassign-current">${__("Currently routed by role (no specific user assigned).")}</div>`
        },
        {
          fieldtype: "Link",
          fieldname: "new_approver",
          label: __("Reassign To"),
          options: "User",
          reqd: 1,
          filters: { enabled: 1 },
          description: __("This user will receive the pending approval notification.")
        },
        {
          fieldtype: "Small Text",
          fieldname: "reason",
          label: __("Reason"),
          description: __("Optional. Added as a comment on the document.")
        }
      ],
      primary_action_label: __("Reassign"),
      primary_action(vals) {
        dlg.hide();
        frappe.call({
          method: "permission_manager.permission_manager.workflow.reassign_workflow_approver",
          args: {
            doctype: frm.doctype,
            docname: frm.doc.name,
            new_approver: vals.new_approver,
            reason: vals.reason || ""
          },
          callback(r) {
            var _a;
            if ((_a = r.message) == null ? void 0 : _a.success) {
              frappe.show_alert({
                message: __("Approver reassigned to {0}.", [vals.new_approver]),
                indicator: "green"
              });
              frm.reload_doc();
            }
          }
        });
      }
    });
    dlg.show();
  }
  function _add_workflow_help_action(frm, transitions, current_state) {
    try {
      frm.page.add_action_item(__("Workflow Help"), function() {
        const state = current_state || __("Unknown");
        const next_actions = transitions.length ? transitions.map((d) => `${d.action.bold()} (${d.allowed || __("matrix")})`).join(", ") : __("None \u2014 End of Workflow").bold();
        new frappe.ui.Dialog({
          title: __("Workflow: {0}", [frm.doctype]),
          fields: [
            {
              fieldtype: "HTML",
              fieldname: "info",
              options: `
							<p>${__("Current status")}: ${state.bold()}</p>
							<p>${__("Next actions")}: ${next_actions}</p>
							<p>${__("Only authorised users can perform these transitions.")}</p>
						`
            }
          ]
        }).show();
      });
    } catch (err) {
      console.warn("Permission Manager: Failed to add Workflow Help action:", err);
    }
  }
  function _override_document_status(frm, current_state, workflow_state_field) {
    var _a, _b, _c, _d;
    try {
      const doc = frm.doc;
      const doctype = frm.doctype;
      if (!doc || !doctype)
        return;
      const meta = frappe.get_meta(doctype);
      const is_submittable = meta == null ? void 0 : meta.is_submittable;
      if (doc.__unsaved) {
        (_b = (_a = frm.page).set_indicator) == null ? void 0 : _b.call(_a, __("Not Saved"), "orange");
        return;
      }
      if (current_state) {
        frappe.call({
          method: "frappe.client.get_value",
          args: { doctype: "Workflow State", fieldname: "style", filters: { name: current_state } },
          callback(r) {
            var _a2, _b2, _c2;
            const color_map = {
              Success: "green",
              Warning: "orange",
              Danger: "red",
              Primary: "blue",
              Inverse: "black",
              Info: "light-blue"
            };
            const color = color_map[(_a2 = r == null ? void 0 : r.message) == null ? void 0 : _a2.style] || "gray";
            (_c2 = (_b2 = frm.page).set_indicator) == null ? void 0 : _c2.call(_b2, __(current_state), color, `${workflow_state_field},=,${current_state}`);
          }
        });
        return;
      }
      if (is_submittable) {
        const m = { 0: ["Draft", "red"], 1: ["Submitted", "blue"], 2: ["Cancelled", "red"] };
        const [label, color] = m[doc.docstatus] || ["Unknown", "gray"];
        (_d = (_c = frm.page).set_indicator) == null ? void 0 : _d.call(_c, __(label), color, `docstatus,=,${doc.docstatus}`);
      }
    } catch (err) {
      console.warn("Permission Manager: Failed to override document status:", err);
    }
  }
  function _open_comment_dialog(frm, transition) {
    const require_comment = !!transition.require_comment;
    const d = new frappe.ui.Dialog({
      title: __("Workflow Action: {0}", [transition.action]),
      fields: [
        {
          fieldtype: "Select",
          fieldname: "priority",
          label: __("Priority"),
          options: ["Low", "Medium", "High", "Critical"].join("\n"),
          default: "Medium"
        },
        {
          fieldtype: "Small Text",
          fieldname: "comment",
          label: __("Comment"),
          reqd: require_comment,
          description: require_comment ? __("A comment is required for this transition.") : __("Optional")
        }
      ],
      primary_action_label: __("Apply"),
      primary_action(values) {
        if (require_comment && !values.comment) {
          frappe.msgprint(__("Comment is required."));
          return;
        }
        d.hide();
        _apply_workflow_with_comment(frm, transition.action, values.comment, values.priority);
      }
    });
    d.show();
  }
  function _apply_workflow_with_comment(frm, action, comment, priority) {
    frappe.dom.freeze();
    frappe.xcall("permission_manager.permission_manager.workflow.apply_workflow", {
      doc: frm.doc,
      action,
      comment,
      priority: priority || "Medium"
    }).then((doc) => {
      frappe.model.sync(doc);
      frm.refresh();
      frappe.show_alert({
        message: __("Workflow action applied: {0}", [action]),
        indicator: "green"
      });
    }).finally(() => frappe.dom.unfreeze());
  }

  // ../permission_manager/permission_manager/public/js/utils/helpers.js
  var MATRIX_RIGHTS = [
    "select",
    "read",
    "write",
    "create",
    "delete",
    "submit",
    "cancel",
    "amend",
    "print",
    "email",
    "report",
    "import",
    "export",
    "share"
  ];
  var RIGHT_LABELS = {
    select: "Se",
    read: "R",
    write: "W",
    create: "C",
    delete: "D",
    submit: "S",
    cancel: "X",
    amend: "A",
    print: "Pr",
    email: "Em",
    report: "Rp",
    import: "Im",
    export: "Ex",
    share: "Sh"
  };
  var RIGHT_FULL_LABELS = {
    select: "Select",
    read: "Read",
    write: "Write",
    create: "Create",
    delete: "Delete",
    submit: "Submit",
    cancel: "Cancel",
    amend: "Amend",
    print: "Print",
    email: "Email",
    report: "Report",
    import: "Import",
    export: "Export",
    share: "Share"
  };
  var PERM_ICONS = {
    allow: "\u2713",
    deny: "\u2717",
    cond: "\u25D0",
    na: "\u2014"
  };
  function esc(str) {
    return frappe.utils.escape_html(str || "");
  }

  // ../permission_manager/permission_manager/public/js/components/matrix_view.js
  var MatrixView = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this.data = opts.data;
      this.mode = opts.mode;
      this.on_why_click = opts.on_why_click;
      this.on_restrictions_click = opts.on_restrictions_click;
      this.on_edit_doctype = opts.on_edit_doctype;
      this.on_export = opts.on_export;
      this.on_simulate = opts.on_simulate;
      this.on_reload = opts.on_reload;
      this.on_bulk_apply = opts.on_bulk_apply;
      this._edit_mode = false;
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
    _render_user_header() {
      const d = this.data;
      const roles_html = d.roles.map((r) => `<span class="ps-badge">${esc(r)}</span>`).join(" ");
      const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-user-info">
					<div class="ps-user-details">
						<h3>${esc(d.user)}</h3>
						<div class="ps-roles-list">${roles_html}</div>
						${d.role_profile ? `<div class="ps-role-profile">${__("Role Profile")}: <strong>${esc(d.role_profile)}</strong></div>` : ""}
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
        if (this.on_restrictions_click)
          this.on_restrictions_click();
      });
      $header.find(".ps-export-user-btn").on("click", () => {
        if (this.on_export)
          this.on_export("user", this.data.user);
      });
      $header.find(".ps-simulate-btn").on("click", () => {
        if (this.on_simulate)
          this.on_simulate(this.data.user);
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
      if (has_edit)
        html += `<th class="ps-col-action" title="${__("Edit")}"></th>`;
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
					title="${RIGHT_FULL_LABELS[r]}: ${label} \u2014 ${__("Click to explain")}"
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
        if (this.on_why_click)
          this.on_why_click($c.data("doctype"), $c.data("ptype"));
      });
      $table.find(".ps-edit-dt-btn").on("click", (e) => {
        const dt = $(e.currentTarget).data("doctype");
        if (this.on_edit_doctype)
          this.on_edit_doctype(dt);
      });
      this.wrapper.append($table);
    }
    _render_doctype_header() {
      const d = this.data;
      const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-doctype-info">
					<h3>${esc(d.doctype)}</h3>
					<div class="ps-stats">
						${__("Module")}: ${esc(d.module)} &nbsp;|&nbsp;
						${d.is_submittable ? __("Submittable") : __("Not Submittable")} &nbsp;|&nbsp;
						${d.is_custom ? `<span class="ps-badge ps-badge-custom">${__("Custom Perms Active")}</span>` : `<span class="ps-badge">${__("Standard Perms")}</span>`}
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					${d.is_custom ? `<button class="btn btn-xs btn-danger ps-reset-btn">
							${frappe.utils.icon("undo", "xs")} ${__("Reset to Standard")}
						   </button>` : ""}
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
        if (this.on_export)
          this.on_export("doctype", this.data.doctype);
      });
      $header.find(".ps-bulk-apply-btn").on("click", () => {
        if (this.on_bulk_apply)
          this.on_bulk_apply();
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
        if (edit)
          this._render_add_role_row();
        return;
      }
      const $search_wrap = $(`
			<div class="ps-re-search-wrap">
				<span class="ps-re-search-icon">${frappe.utils.icon("search", "xs")}</span>
				<input class="form-control ps-re-search"
					placeholder="${__("Search roles\u2026")}"
					type="text" autocomplete="off"
					value="${esc(this._search_query || "")}" />
				${this._search_query ? `<button class="ps-re-search-clear btn-naked" title="${__("Clear")}">\u2715</button>` : ""}
			</div>
		`);
      this.wrapper.append($search_wrap);
      if (edit) {
        this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info", "xs")}
					${__("Click any \u2713 / \u2717 cell to toggle. Changes save instantly.")}
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
      if (edit)
        html += `<th class="ps-col-action"></th>`;
      html += `</tr></thead><tbody>`;
      d.roles.forEach((row) => {
        html += `<tr class="ps-matrix-row" data-role="${esc(row.role)}" data-level="${row.permlevel}">`;
        html += `<td class="ps-col-role">
				<span class="ps-role-name">${esc(row.role)}</span>
				${row.source === "custom" ? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>' : ""}
			</td>`;
        html += `<td class="ps-col-level">${row.permlevel}</td>`;
        if (edit) {
          html += `<td class="ps-col-owner ps-cell-owner-edit"
					data-role="${esc(row.role)}" data-level="${row.permlevel}"
					data-value="${row.if_owner ? 1 : 0}" title="${__("If Owner Only")}">
					<span class="ps-owner-toggle ${row.if_owner ? "ps-owner-on" : "ps-owner-off"}">
						${row.if_owner ? "\u2713" : "\u25CB"}
					</span>
				</td>`;
        } else {
          html += `<td class="ps-col-owner">
					${row.if_owner ? '<span class="ps-owner-badge">\u2713</span>' : ""}
				</td>`;
        }
        MATRIX_RIGHTS.forEach((r) => {
          const val = row.permissions[r];
          if (val === "na") {
            html += `<td class="ps-cell ps-cell-na" title="${__("Not applicable")}">\u2014</td>`;
          } else if (edit) {
            const is_on = Boolean(val);
            html += `<td class="ps-cell ps-cell-editable ${is_on ? "ps-cell-allow" : "ps-cell-deny"}"
						title="${__("Click to toggle")} ${RIGHT_FULL_LABELS[r]}"
						data-role="${esc(row.role)}" data-level="${row.permlevel}"
						data-ptype="${r}" data-value="${is_on ? 1 : 0}">
						${is_on ? "\u2713" : "\u2717"}
					</td>`;
          } else {
            html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "\u2713" : "\u2717"}</td>`;
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
      if (edit)
        this._render_add_role_row();
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
      if (this._search_query)
        _apply();
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
    _toggle_edit_mode() {
      if (!this._edit_mode) {
        frappe.dom.freeze(__("Initialising custom permissions\u2026"));
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
          }
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
          var _a;
          $cell.removeClass("ps-cell-saving");
          if ((_a = r.message) == null ? void 0 : _a.success) {
            $cell.data("value", new_val).removeClass("ps-cell-allow ps-cell-deny").addClass(new_val ? "ps-cell-allow" : "ps-cell-deny").text(new_val ? "\u2713" : "\u2717");
            frappe.show_alert({
              message: `${role} \u2014 ${ptype}: ${new_val ? __("Allowed") : __("Denied")}`,
              indicator: new_val ? "green" : "orange"
            });
          }
        },
        error: () => {
          $cell.removeClass("ps-cell-saving");
          frappe.show_alert({ message: __("Failed to update permission."), indicator: "red" });
        }
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
          var _a;
          if ((_a = r.message) == null ? void 0 : _a.success) {
            $cell.data("value", new_val).find(".ps-owner-toggle").removeClass("ps-owner-on ps-owner-off").addClass(new_val ? "ps-owner-on" : "ps-owner-off").text(new_val ? "\u2713" : "\u25CB");
          }
        }
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
            error: () => frappe.dom.unfreeze()
          });
        }
      );
    }
    _show_add_role_dialog() {
      const dlg = new frappe.ui.Dialog({
        title: __("Add Role Permission \u2014 {0}", [this.data.doctype]),
        fields: [
          { fieldtype: "Link", fieldname: "role", label: __("Role"), options: "Role", reqd: 1 },
          {
            fieldtype: "Int",
            fieldname: "permlevel",
            label: __("Permission Level"),
            default: 0,
            description: __("0 = document level. Higher = field-level security.")
          }
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
            error: () => frappe.dom.unfreeze()
          });
        }
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
            error: () => frappe.dom.unfreeze()
          });
        }
      );
    }
  };

  // ../permission_manager/permission_manager/public/js/components/why_explainer.js
  var WhyExplainer = class {
    constructor(opts) {
      this.user = opts.user;
      this.doctype = opts.doctype;
      this.ptype = opts.ptype || "read";
      this.show();
    }
    show() {
      this.dialog = new frappe.ui.Dialog({
        title: __("Permission Explainer"),
        size: "large",
        fields: [
          { fieldtype: "HTML", fieldname: "header_html" },
          {
            fieldtype: "Select",
            fieldname: "ptype",
            label: __("Permission Type"),
            options: [
              "select",
              "read",
              "write",
              "create",
              "delete",
              "submit",
              "cancel",
              "amend",
              "print",
              "email",
              "report",
              "import",
              "export",
              "share"
            ].join("\n"),
            default: this.ptype,
            change: () => this.load_explanation()
          },
          { fieldtype: "HTML", fieldname: "steps_html" }
        ]
      });
      this.dialog.fields_dict.header_html.$wrapper.html(`
			<div class="ps-why-header">
				<strong>${__("User")}:</strong> ${esc(this.user)}<br>
				<strong>${__("DocType")}:</strong> ${esc(this.doctype)}
			</div>
		`);
      this.dialog.show();
      this.load_explanation();
    }
    load_explanation() {
      const ptype = this.dialog.get_value("ptype") || this.ptype;
      const $container = this.dialog.fields_dict.steps_html.$wrapper;
      $container.html(this._skeleton_html(3));
      frappe.call({
        method: "permission_manager.permission_manager.api.resolver.explain_permission",
        args: { user: this.user, doctype: this.doctype, ptype },
        callback: (r) => {
          if (r.message)
            this._render_steps($container, r.message);
        },
        error: () => {
          $container.html(`
					<div class="ps-error-state">
						<div class="ps-error-icon">${frappe.utils.icon("error", "lg")}</div>
						<div class="ps-error-msg">${__("Failed to analyse permissions. Please try again.")}</div>
						<button class="btn btn-sm btn-default ps-why-retry">
							${frappe.utils.icon("refresh", "xs")} ${__("Retry")}
						</button>
					</div>
				`);
          $container.find(".ps-why-retry").on("click", () => this.load_explanation());
        }
      });
    }
    _skeleton_html(count) {
      let rows = "";
      for (let i = 0; i < count; i++) {
        rows += `<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`;
      }
      return `<div class="ps-loading">${rows}</div>`;
    }
    _render_steps($container, data) {
      const status_icons = { pass: "\u2705", fail: "\u274C", warn: "\u26A0\uFE0F", info: "\u2139\uFE0F" };
      const status_classes = { pass: "ps-step-pass", fail: "ps-step-fail", warn: "ps-step-warn", info: "ps-step-info" };
      const result_class = data.result === "allow" ? "ps-result-allow" : data.result === "cond" ? "ps-result-cond" : "ps-result-deny";
      let html = `
			<div class="ps-result-banner ${result_class}">
				<strong>${data.result === "allow" ? __("ALLOWED") : data.result === "cond" ? __("CONDITIONAL") : __("DENIED")}</strong>
				<span>${esc(data.result_reason)}</span>
			</div>
			<div class="ps-steps">`;
      data.steps.forEach((step) => {
        const icon = status_icons[step.status] || "\u2139\uFE0F";
        const cls = status_classes[step.status] || "";
        html += `<div class="ps-step ${cls}">
				<div class="ps-step-header">
					<span class="ps-step-icon">${icon}</span>
					<span class="ps-step-num">${__("Step")} ${step.step}</span>
					<span class="ps-step-title">${esc(step.title)}</span>
				</div>
				<div class="ps-step-body">
					<p>${esc(step.description)}</p>`;
        if (step.details && step.details.length) {
          html += `<ul class="ps-step-details">`;
          step.details.forEach((d) => html += `<li>${esc(d)}</li>`);
          html += `</ul>`;
        }
        html += `</div></div>`;
      });
      html += `</div>`;
      $container.html(html);
    }
  };

  // ../permission_manager/permission_manager/public/js/components/user_explorer.js
  var UserExplorer = class {
    constructor(opts) {
      this.user = opts.user;
      this.load();
    }
    load() {
      Promise.all([
        new Promise((resolve) => {
          frappe.call({
            method: "permission_manager.permission_manager.api.restrictions.get_user_restrictions",
            args: { user: this.user },
            callback: (r) => resolve(r.message)
          });
        }),
        new Promise((resolve) => {
          frappe.call({
            method: "permission_manager.permission_manager.api.restrictions.get_user_shares",
            args: { user: this.user },
            callback: (r) => resolve(r.message)
          });
        })
      ]).then(([restrictions, shares]) => this.render(restrictions, shares)).catch(() => {
        frappe.msgprint({
          title: __("Error"),
          indicator: "red",
          message: __("Failed to load restrictions and shares. Please try again.")
        });
      });
    }
    render(restrictions_data, shares_data) {
      this.dialog = new frappe.ui.Dialog({
        title: __("Restrictions & Shares: {0}", [this.user]),
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "content_html" }]
      });
      this._restrictions_data = restrictions_data;
      this._shares_data = shares_data;
      this._render_content();
      this.dialog.show();
    }
    _render_content() {
      const $container = this.dialog.fields_dict.content_html.$wrapper;
      const r = this._restrictions_data;
      const s = this._shares_data;
      let html = `<div class="ps-explorer">`;
      html += `
			<div class="ps-section-header">
				<h4 class="ps-section-title" style="margin:0">${__("User Permission Restrictions")}</h4>
				<button class="btn btn-xs btn-primary ps-add-restriction-btn">
					${frappe.utils.icon("add", "xs")} ${__("Add Restriction")}
				</button>
			</div>`;
      if (!r.restrictions.length) {
        html += `<div class="ps-empty-state">${__("No restrictions \u2014 full role-based access.")}</div>`;
      } else {
        html += `<div class="ps-restriction-summary">`;
        for (const [dt, values] of Object.entries(r.restriction_summary)) {
          html += `<div class="ps-restriction-badge">
					<strong>${esc(dt)}:</strong>
					${values.map((v) => `<span class="ps-badge">${esc(v)}</span>`).join(" ")}
				</div>`;
        }
        html += `</div>`;
        html += `<div class="ps-restriction-cards">`;
        r.restrictions.forEach((item) => {
          html += `
					<div class="ps-card" data-perm-name="${esc(item.name)}">
						<div class="ps-card-header">
							<strong>${esc(item.allow)}</strong> =
							<span class="ps-badge">${esc(item.for_value)}</span>
							${item.is_default ? `<span class="ps-badge ps-badge-default">${__("Default")}</span>` : ""}
							<button class="btn btn-xs btn-danger ps-remove-restriction-btn"
								data-name="${esc(item.name)}"
								style="margin-left:auto"
								title="${__("Remove this restriction")}">
								${frappe.utils.icon("delete", "xs")} ${__("Remove")}
							</button>
						</div>
						<div class="ps-card-body">
							<div class="ps-card-detail">
								<strong>${__("Applied to")}:</strong>
								${item.apply_to_all ? __("All DocTypes with link to {0}", [item.allow]) : esc(item.applicable_for || __("All"))}
							</div>
							<div class="ps-card-detail">
								<strong>${__("Affected DocTypes")} (${item.affected_doctypes.length}):</strong>
								<div class="ps-affected-list">
									${item.affected_doctypes.slice(0, 15).map((dt) => `<span class="ps-mini-badge">${esc(dt)}</span>`).join(" ")}
									${item.affected_doctypes.length > 15 ? `<span class="ps-mini-badge">+${item.affected_doctypes.length - 15} ${__("more")}</span>` : ""}
								</div>
							</div>
						</div>
					</div>`;
        });
        html += `</div>`;
      }
      html += `<h4 class="ps-section-title">${__("Shared Documents")}</h4>`;
      if (!s.shares.length) {
        html += `<div class="ps-empty-state">${__("No documents shared with this user.")}</div>`;
      } else {
        html += `<table class="ps-shares-table">
				<thead><tr>
					<th>${__("DocType")}</th><th>${__("Document")}</th>
					<th>${__("Read")}</th><th>${__("Write")}</th>
					<th>${__("Share")}</th><th>${__("Shared By")}</th>
				</tr></thead><tbody>`;
        s.shares.forEach((item) => {
          html += `<tr>
					<td>${esc(item.doctype)}</td>
					<td><a href="/app/${frappe.router.slug(item.doctype)}/${item.docname}">${esc(item.docname)}</a></td>
					<td>${item.read ? "\u2713" : "\u2717"}</td>
					<td>${item.write ? "\u2713" : "\u2717"}</td>
					<td>${item.share ? "\u2713" : "\u2717"}</td>
					<td>${esc(item.owner)}</td>
				</tr>`;
        });
        html += `</tbody></table>`;
      }
      html += `</div>`;
      $container.html(html);
      $container.find(".ps-add-restriction-btn").on("click", () => this._show_add_dialog());
      $container.find(".ps-remove-restriction-btn").on("click", (e) => {
        const name = $(e.currentTarget).data("name");
        this._remove_restriction(name, $container);
      });
    }
    _show_add_dialog() {
      const dlg = new frappe.ui.Dialog({
        title: __("Add User Permission Restriction \u2014 {0}", [this.user]),
        fields: [
          {
            fieldtype: "Link",
            fieldname: "allow",
            label: __("Restrict By (DocType)"),
            options: "DocType",
            reqd: 1,
            description: __("e.g. Company, Cost Center, Warehouse")
          },
          {
            fieldtype: "Dynamic Link",
            fieldname: "for_value",
            label: __("Allowed Value"),
            options: "allow",
            reqd: 1,
            description: __("Pick the specific record this user is restricted to.")
          },
          {
            fieldtype: "Check",
            fieldname: "apply_to_all_doctypes",
            label: __("Apply to All DocTypes"),
            default: 1,
            description: __("If unchecked, you can specify a single DocType below.")
          },
          {
            fieldtype: "Link",
            fieldname: "applicable_for",
            label: __("Applicable For (DocType)"),
            options: "DocType",
            depends_on: "eval: !doc.apply_to_all_doctypes"
          },
          {
            fieldtype: "HTML",
            fieldname: "impact_preview",
            label: __("Impact Preview")
          }
        ],
        primary_action_label: __("Add"),
        primary_action: (vals) => {
          dlg.hide();
          frappe.call({
            method: "permission_manager.permission_manager.api.restrictions.add_user_permission",
            args: {
              user: this.user,
              allow: vals.allow,
              for_value: vals.for_value,
              applicable_for: vals.applicable_for || "",
              apply_to_all_doctypes: vals.apply_to_all_doctypes ? 1 : 0
            },
            callback: (r) => {
              if (r.message) {
                this._restrictions_data = r.message;
                this._render_content();
                frappe.show_alert({ message: __("Restriction added."), indicator: "green" });
              }
            }
          });
        }
      });
      let _preview_timer = null;
      const _run_preview = () => {
        const allow = dlg.get_value("allow");
        const for_value = dlg.get_value("for_value");
        const $preview = dlg.fields_dict.impact_preview.$wrapper;
        if (!allow || !for_value) {
          $preview.empty();
          return;
        }
        $preview.html(`<div class="ps-impact-loading">${frappe.utils.icon("refresh", "xs")} ${__("Previewing impact\u2026")}</div>`);
        frappe.call({
          method: "permission_manager.permission_manager.api.restrictions.preview_restriction_impact",
          args: { allow, for_value },
          callback: (r) => {
            if (!r.message)
              return;
            const d = r.message;
            if (!d.impact.length) {
              $preview.html(`<div class="ps-impact-empty">${__("No DocTypes link to {0}.", [allow])}</div>`);
              return;
            }
            let html = `<div class="ps-impact-header">
						<strong>${__("Impact Preview")}</strong> \u2014 ${d.affected_doctypes_count} ${__("DocTypes affected")}
					</div>
					<table class="ps-impact-table">
						<thead><tr>
							<th>${__("DocType")}</th>
							<th>${__("Total Records")}</th>
							<th>${__("Will See")}</th>
							<th>${__("Restricted Out")}</th>
						</tr></thead><tbody>`;
            d.impact.forEach((row) => {
              const pct = row.total_records ? Math.round(row.accessible_after / row.total_records * 100) : 0;
              const warn = pct < 20 && row.total_records > 0;
              html += `<tr class="${warn ? "ps-impact-warn-row" : ""}">
							<td>${esc(row.doctype)}</td>
							<td>${row.total_records}</td>
							<td><strong style="color:var(--ps-green)">${row.accessible_after}</strong> (${pct}%)</td>
							<td style="color:var(--ps-red)">${row.restricted_out}</td>
						</tr>`;
            });
            html += `</tbody></table>`;
            $preview.html(html);
          }
        });
      };
      const _debounced_preview = () => {
        clearTimeout(_preview_timer);
        _preview_timer = setTimeout(_run_preview, 600);
      };
      dlg.fields_dict.allow.df.change = () => {
        dlg.set_value("for_value", "");
        _debounced_preview();
      };
      dlg.fields_dict.for_value.df.change = _debounced_preview;
      dlg.show();
    }
    _remove_restriction(name, $container) {
      frappe.confirm(__("Remove this restriction?"), () => {
        frappe.call({
          method: "permission_manager.permission_manager.api.restrictions.remove_user_permission",
          args: { name },
          callback: (r) => {
            if (r.message) {
              this._restrictions_data = r.message;
              this._render_content();
              frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
            }
          }
        });
      });
    }
  };

  // ../permission_manager/permission_manager/public/js/components/role_explorer.js
  var RoleExplorer = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this.data = opts.data;
      this._edit_mode = false;
      this.render();
    }
    render() {
      this.wrapper.empty();
      const d = this.data;
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
      const $search_wrap = $(`
			<div class="ps-re-search-wrap">
				<span class="ps-re-search-icon">${frappe.utils.icon("search", "xs")}</span>
				<input class="form-control ps-re-search"
					placeholder="${__("Search DocTypes\u2026")}"
					type="text" autocomplete="off"
					value="${esc(this._search_query || "")}" />
				${this._search_query ? `<button class="ps-re-search-clear btn-naked" title="${__("Clear")}">\u2715</button>` : ""}
			</div>
		`);
      this.wrapper.append($search_wrap);
      if (this._edit_mode) {
        this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info", "xs")}
					${__("Click any \u2713 / \u2717 cell to toggle. Changes save and reload instantly.")}
				</div>
			`));
      }
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
				<thead><tr>
					<th class="ps-col-doctype">${__("DocType")}</th>
					<th class="ps-col-owner" title="${__("Only If Creator")}">Own</th>`;
        MATRIX_RIGHTS.forEach((r) => {
          html += `<th class="ps-col-perm" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
        });
        html += `</tr></thead><tbody>`;
        mod.doctypes.forEach((row) => {
          html += `<tr class="ps-matrix-row" data-doctype="${esc(row.doctype)}">`;
          html += `<td class="ps-col-doctype">
					<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
					${row.source === "custom" ? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>' : ""}
				</td>`;
          if (this._edit_mode) {
            html += `<td class="ps-col-owner ps-cell ps-cell-owner-edit ${row.if_owner ? "ps-owner-on" : ""}"
						data-doctype="${esc(row.doctype)}" data-value="${row.if_owner ? 1 : 0}"
						title="${__("Click to toggle Only If Creator")}">
						${row.if_owner ? "\u2713" : "\u25CB"}
					</td>`;
          } else {
            html += `<td class="ps-col-owner ps-cell">
						${row.if_owner ? '<span class="ps-owner-badge" title="' + __("Only If Creator") + '">\u2713</span>' : ""}
					</td>`;
          }
          MATRIX_RIGHTS.forEach((r) => {
            const val = row.permissions[r];
            if (val === "na") {
              html += `<td class="ps-cell ps-cell-na">\u2014</td>`;
            } else if (this._edit_mode) {
              const is_on = Boolean(val);
              html += `<td class="ps-cell ps-cell-editable ${is_on ? "ps-cell-allow" : "ps-cell-deny"}"
							title="${__("Click to toggle")} ${RIGHT_FULL_LABELS[r]} ${__("for")} ${row.doctype}"
							data-doctype="${esc(row.doctype)}" data-ptype="${r}" data-value="${is_on ? 1 : 0}">
							${is_on ? "\u2713" : "\u2717"}
						</td>`;
            } else {
              html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "\u2713" : "\u2717"}</td>`;
            }
          });
          html += `</tr>`;
        });
        html += `</tbody></table>`;
        $group.append($(html));
        if (this._edit_mode) {
          $group.find(".ps-cell-editable").on("click", (e) => {
            this._toggle_cell($(e.currentTarget));
          });
          $group.find(".ps-cell-owner-edit").on("click", (e) => {
            this._toggle_if_owner($(e.currentTarget));
          });
        }
        this.wrapper.append($group);
      });
      const $search = this.wrapper.find(".ps-re-search");
      $search.on("input", () => {
        this._search_query = $search.val().trim();
        this._apply_search();
        const has_q = !!this._search_query;
        this.wrapper.find(".ps-re-search-clear").toggle(has_q);
      });
      this.wrapper.find(".ps-re-search-clear").on("click", () => {
        this._search_query = "";
        $search.val("").trigger("input");
      });
      if (this._search_query)
        this._apply_search();
    }
    _apply_search() {
      const q = (this._search_query || "").toLowerCase();
      this.wrapper.find(".ps-module-group").each((_, grp) => {
        const $grp = $(grp);
        $grp.find(".ps-matrix-row").each((_2, row) => {
          const dt = ($(row).attr("data-doctype") || "").toLowerCase();
          $(row).toggle(!q || dt.includes(q));
        });
        const has_visible = $grp.find(".ps-matrix-row:visible").length > 0;
        $grp.toggle(has_visible);
      });
    }
    _toggle_edit_mode() {
      this._edit_mode = !this._edit_mode;
      this.render();
    }
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
          var _a;
          $cell.removeClass("ps-cell-saving");
          if ((_a = r.message) == null ? void 0 : _a.success) {
            $cell.data("value", new_val).removeClass("ps-cell-allow ps-cell-deny").addClass(new_val ? "ps-cell-allow" : "ps-cell-deny").text(new_val ? "\u2713" : "\u2717");
            frappe.show_alert({
              message: `${doctype} \u2014 ${ptype}: ${new_val ? __("Allowed") : __("Denied")}`,
              indicator: new_val ? "green" : "orange"
            });
            this._update_local(doctype, ptype, new_val);
          }
        },
        error: () => {
          $cell.removeClass("ps-cell-saving");
          frappe.show_alert({ message: __("Failed to update permission."), indicator: "red" });
        }
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
    _toggle_if_owner($cell) {
      const doctype = $cell.data("doctype");
      const new_val = $cell.data("value") ? 0 : 1;
      const role = this.data.role;
      $cell.addClass("ps-cell-saving");
      frappe.call({
        method: "permission_manager.permission_manager.api.matrix.update_if_owner",
        args: { doctype, role, permlevel: 0, value: new_val },
        callback: (r) => {
          var _a;
          $cell.removeClass("ps-cell-saving");
          if ((_a = r.message) == null ? void 0 : _a.success) {
            $cell.data("value", new_val).toggleClass("ps-owner-on", !!new_val).text(new_val ? "\u2713" : "\u25CB");
            this._update_local_if_owner(doctype, new_val);
            frappe.show_alert({
              message: `${doctype} \u2014 ${__("Only If Creator")}: ${new_val ? __("On") : __("Off")}`,
              indicator: new_val ? "blue" : "orange"
            });
          }
        },
        error: () => {
          $cell.removeClass("ps-cell-saving");
          frappe.show_alert({ message: __("Failed to update owner flag."), indicator: "red" });
        }
      });
    }
    _update_local_if_owner(doctype, value) {
      for (const mod of this.data.modules) {
        const row = mod.doctypes.find((r) => r.doctype === doctype);
        if (row) {
          row.if_owner = value;
          break;
        }
      }
    }
  };

  // ../permission_manager/permission_manager/public/js/components/role_profile_explorer.js
  var RoleProfileExplorer = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this.data = opts.data;
      this.on_export = opts.on_export;
      this.render();
    }
    render() {
      this.wrapper.empty();
      const d = this.data;
      const role_chips = d.roles.map((r) => `<span class="ps-badge">${esc(r)}</span>`).join(" ");
      const $header = $(`
			<div class="ps-matrix-header">
				<div class="ps-role-info">
					<h3>${esc(d.profile)}</h3>
					<div class="ps-roles-list ps-profile-roles">${role_chips || `<em>${__("No roles in this profile.")}</em>`}</div>
					<div class="ps-stats">
						${__("{0} roles", [d.roles.length])}
						&nbsp;|&nbsp;
						${__("{0} DocTypes", [d.total_doctypes])}
						&nbsp;|&nbsp;
						${__("{0} users assigned", [d.user_count])}
					</div>
				</div>
				<div class="ps-header-actions">
					<a class="btn btn-xs btn-default ps-open-profile-btn"
						href="/app/role-profile/${encodeURIComponent(d.profile)}" target="_blank">
						${frappe.utils.icon("edit", "xs")} ${__("Edit Profile")}
					</a>
					<button class="btn btn-xs btn-default ps-export-profile-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>
		`);
      $header.find(".ps-export-profile-btn").on("click", () => {
        if (this.on_export)
          this.on_export(d.profile);
      });
      this.wrapper.append($header);
      if (!d.modules || !d.modules.length) {
        this.wrapper.append(
          $(`<div class="ps-empty-state">${__("This profile has no permissions (no roles or roles have no permissions).")}</div>`)
        );
        return;
      }
      this.wrapper.append($(`
			<div class="ps-table-hint">
				${frappe.utils.icon("info", "xs")}
				${__("Showing the combined (unioned) permissions for all roles in this profile. \u2713 means at least one role grants this right.")}
			</div>
		`));
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
					${row.source === "custom" ? '<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>' : ""}
				</td>`;
          MATRIX_RIGHTS.forEach((r) => {
            const val = row.permissions[r];
            if (val === "na") {
              html += `<td class="ps-cell ps-cell-na">\u2014</td>`;
            } else {
              html += `<td class="ps-cell ${val ? "ps-cell-allow" : "ps-cell-deny"}">${val ? "\u2713" : "\u2717"}</td>`;
            }
          });
          html += `</tr>`;
        });
        html += `</tbody></table>`;
        $group.append($(html));
        this.wrapper.append($group);
      });
    }
  };

  // ../permission_manager/permission_manager/public/js/components/reverse_lookup.js
  var ReverseLookup = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this._doctype = null;
      this._ptype = "read";
      this._data = null;
      this.render();
    }
    render() {
      this.wrapper.empty();
      const $search = $(`
			<div class="ps-lookup-controls">
				<div class="ps-search-row">
					<div class="ps-search-field" id="ps-lookup-dt"></div>
					<div class="ps-search-field" id="ps-lookup-ptype"></div>
					<button class="btn btn-sm btn-primary ps-lookup-search-btn" disabled>
						${frappe.utils.icon("search", "sm")} ${__("Find Users")}
					</button>
				</div>
			</div>
		`);
      this.wrapper.append($search);
      this._dt_ctrl = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "DocType",
          fieldname: "lookup_doctype",
          placeholder: __("Select DocType\u2026"),
          label: __("DocType"),
          change: () => {
            this._doctype = this._dt_ctrl.get_value();
            this._update_search_btn();
          }
        },
        parent: $search.find("#ps-lookup-dt"),
        render_input: true
      });
      this._ptype_ctrl = frappe.ui.form.make_control({
        df: {
          fieldtype: "Select",
          fieldname: "lookup_ptype",
          label: __("Permission Type"),
          options: MATRIX_RIGHTS.map((r) => ({ value: r, label: RIGHT_FULL_LABELS[r] || r })),
          default: "read",
          change: () => {
            this._ptype = this._ptype_ctrl.get_value() || "read";
          }
        },
        parent: $search.find("#ps-lookup-ptype"),
        render_input: true
      });
      this._ptype_ctrl.set_value("read");
      $search.find(".ps-lookup-search-btn").on("click", () => this._run_lookup());
      this.$results = $(`<div class="ps-lookup-results"></div>`);
      this.wrapper.append(this.$results);
      this.$results.html(this._empty_state(
        frappe.utils.icon("search", "lg"),
        __("Who can do what?"),
        __("Select a DocType and permission type above, then click Find Users.")
      ));
    }
    _update_search_btn() {
      const $btn = this.wrapper.find(".ps-lookup-search-btn");
      $btn.prop("disabled", !this._doctype);
    }
    _run_lookup() {
      if (!this._doctype)
        return;
      this.$results.html(`<div class="ps-loading">${this._skeleton(4)}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.lookup.get_users_with_permission",
        args: { doctype: this._doctype, ptype: this._ptype },
        callback: (r) => {
          if (r.message) {
            this._data = r.message;
            this._render_results(r.message);
          }
        },
        error: () => {
          this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to run lookup.")}</div>
				</div>`);
        }
      });
    }
    _render_results(data) {
      const ptype_label = RIGHT_FULL_LABELS[data.ptype] || data.ptype;
      const source_badge = data.source === "custom" ? `<span class="ps-badge ps-badge-custom">${__("Custom Perms")}</span>` : `<span class="ps-badge">${__("Standard Perms")}</span>`;
      let html = `
			<div class="ps-lookup-summary">
				<div class="ps-lookup-title">
					<strong>${__("{0} users</strong> can <strong>{1}</strong> on <strong>{2}", [data.total_users, ptype_label, data.doctype])}</strong>
					&nbsp;${source_badge}
				</div>
				<div class="ps-lookup-roles">`;
      if (data.granting_roles.length) {
        html += `<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("Granting roles")}:</span>
				${data.granting_roles.map((r) => `<span class="ps-badge ps-badge-green">${esc(r)}</span>`).join(" ")}
			</div>`;
      }
      if (data.conditional_roles.length) {
        html += `<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("If-owner only")}:</span>
				${data.conditional_roles.map((r) => `<span class="ps-badge ps-badge-amber">${esc(r)}</span>`).join(" ")}
			</div>`;
      }
      html += `</div>`;
      html += `<button class="btn btn-xs btn-default ps-export-lookup-btn">
			${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
		</button>`;
      html += `</div>`;
      if (!data.users.length) {
        html += `<div class="ps-empty-state">${__("No active users have this permission.")}</div>`;
      } else {
        html += `<div class="ps-lookup-user-grid">`;
        data.users.forEach((u) => {
          const is_direct = u.access_type === "direct";
          const roles_html = [
            ...u.direct_roles.map((r) => `<span class="ps-badge ps-badge-green ps-xs-badge">${esc(r)}</span>`),
            ...u.cond_roles.map((r) => `<span class="ps-badge ps-badge-amber ps-xs-badge">${esc(r)}</span>`)
          ].join(" ");
          html += `<div class="ps-user-card ${is_direct ? "" : "ps-user-card-cond"}">
					<div class="ps-user-card-avatar">
						${u.user_image ? `<img src="${esc(u.user_image)}" class="ps-avatar-img">` : `<div class="ps-avatar-placeholder">${(u.full_name || u.user)[0].toUpperCase()}</div>`}
					</div>
					<div class="ps-user-card-info">
						<div class="ps-user-card-name">${esc(u.full_name || u.user)}</div>
						<div class="ps-user-card-email">${esc(u.email || u.user)}</div>
						<div class="ps-user-card-roles">${roles_html}</div>
					</div>
					<div class="ps-user-card-badge">
						${is_direct ? `<span class="ps-access-direct">${__("Direct")}</span>` : `<span class="ps-access-cond">${__("If Owner")}</span>`}
					</div>
				</div>`;
        });
        html += `</div>`;
      }
      this.$results.html(html);
      this.$results.find(".ps-export-lookup-btn").on("click", () => this._export_csv(data));
    }
    _export_csv(data) {
      const rows = [
        ["DocType", data.doctype, "Permission", RIGHT_FULL_LABELS[data.ptype] || data.ptype],
        [],
        ["User", "Email", "Access Type", "Granting Roles"],
        ...data.users.map((u) => [
          u.full_name || u.user,
          u.email || u.user,
          u.access_type,
          [...u.direct_roles, ...u.cond_roles].join(", ")
        ])
      ];
      _download_csv(rows, `lookup_${data.doctype}_${data.ptype}`);
    }
    _skeleton(n) {
      return Array(n).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("");
    }
    _empty_state(icon, title, desc) {
      return `<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${icon}</div>
			<div class="ps-welcome-title">${title}</div>
			<div class="ps-welcome-desc">${desc}</div>
		</div>`;
    }
  };
  function _download_csv(rows, filename_prefix) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${filename_prefix}_${ts}.csv`;
    const csv_content = rows.map(
      (row) => row.map((cell) => {
        const s = String(cell == null ? "" : cell);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ).join("\n");
    const blob = new Blob([csv_content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ../permission_manager/permission_manager/public/js/components/role_comparison.js
  var DIFF_STYLES = {
    both: { cls: "ps-diff-both", icon: "\u2713", title: "Both roles" },
    only_1: { cls: "ps-diff-only1", icon: "\u2460", title: "Role 1 only" },
    only_2: { cls: "ps-diff-only2", icon: "\u2461", title: "Role 2 only" },
    neither: { cls: "ps-diff-neither", icon: "\u2717", title: "Neither role" },
    na: { cls: "ps-cell-na", icon: "\u2014", title: "Not applicable" }
  };
  var RoleComparison = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this._role1 = null;
      this._role2 = null;
      this._show_diff_only = false;
      this._data = null;
      this.render();
    }
    render() {
      this.wrapper.empty();
      const $ctrl = $(`
			<div class="ps-compare-controls">
				<div class="ps-search-row ps-compare-row">
					<div class="ps-search-field" id="ps-role1-select"></div>
					<div class="ps-compare-vs">${__("vs")}</div>
					<div class="ps-search-field" id="ps-role2-select"></div>
					<button class="btn btn-sm btn-primary ps-compare-btn" disabled>
						${frappe.utils.icon("compare", "sm")} ${__("Compare")}
					</button>
				</div>
			</div>
		`);
      this.wrapper.append($ctrl);
      const make_role_ctrl = (id, field_name, cb) => {
        return frappe.ui.form.make_control({
          df: {
            fieldtype: "Link",
            options: "Role",
            fieldname: field_name,
            placeholder: __("Select Role\u2026"),
            label: __("Role"),
            change: () => {
              var _a;
              cb((_a = this[field_name]) == null ? void 0 : _a.get_value());
              this._update_compare_btn();
            }
          },
          parent: $ctrl.find(`#${id}`),
          render_input: true
        });
      };
      this._r1_ctrl = make_role_ctrl("ps-role1-select", "_r1_ctrl", (v) => {
        this._role1 = v;
      });
      this._r2_ctrl = make_role_ctrl("ps-role2-select", "_r2_ctrl", (v) => {
        this._role2 = v;
      });
      this._r1_ctrl.df.change = () => {
        this._role1 = this._r1_ctrl.get_value();
        this._update_compare_btn();
      };
      this._r2_ctrl.df.change = () => {
        this._role2 = this._r2_ctrl.get_value();
        this._update_compare_btn();
      };
      $ctrl.find(".ps-compare-btn").on("click", () => this._run_compare());
      this.$results = $(`<div class="ps-compare-results"></div>`);
      this.wrapper.append(this.$results);
      this.$results.html(this._welcome_html());
    }
    _update_compare_btn() {
      this.wrapper.find(".ps-compare-btn").prop("disabled", !(this._role1 && this._role2));
    }
    _run_compare() {
      if (!this._role1 || !this._role2)
        return;
      if (this._role1 === this._role2) {
        frappe.show_alert({ message: __("Please select two different roles."), indicator: "orange" });
        return;
      }
      this.$results.html(`<div class="ps-loading">${this._skeleton(6)}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.lookup.compare_roles",
        args: { role1: this._role1, role2: this._role2 },
        callback: (r) => {
          if (r.message) {
            this._data = r.message;
            this._render_comparison(r.message);
          }
        },
        error: () => {
          this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Comparison failed.")}</div>
				</div>`);
        }
      });
    }
    _render_comparison(data) {
      let html = `
			<div class="ps-compare-header">
				<div class="ps-compare-stats">
					<span class="ps-stat-badge ps-stat-total">${data.total} ${__("DocTypes")}</span>
					<span class="ps-stat-badge ps-stat-diff">${data.diff_count} ${__("differ")}</span>
					<span class="ps-stat-badge ps-stat-only1">${data.only_in_role1} ${__("only in")} ${esc(data.role1)}</span>
					<span class="ps-stat-badge ps-stat-only2">${data.only_in_role2} ${__("only in")} ${esc(data.role2)}</span>
				</div>
				<div class="ps-compare-actions">
					<label class="ps-diff-toggle-label">
						<input type="checkbox" class="ps-diff-only-cb" ${this._show_diff_only ? "checked" : ""}>
						${__("Show differences only")}
					</label>
					<button class="btn btn-xs btn-default ps-compare-export-btn">
						${frappe.utils.icon("download", "xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>

			<!-- Legend -->
			<div class="ps-compare-legend">
				<span class="ps-diff-both">\u2713 ${__("Both")}</span>
				<span class="ps-diff-only1">\u2460 ${esc(data.role1)} only</span>
				<span class="ps-diff-only2">\u2461 ${esc(data.role2)} only</span>
				<span class="ps-diff-neither">\u2717 ${__("Neither")}</span>
			</div>

			<div class="ps-matrix-scroll">
				<table class="ps-matrix-table ps-compare-table">
					<thead>
						<tr>
							<th class="ps-col-module">${__("MODULE")}</th>
							<th class="ps-col-doctype">${__("DOCTYPE")}</th>`;
      MATRIX_RIGHTS.forEach((r) => {
        html += `<th class="ps-col-perm ps-compare-th" title="${RIGHT_FULL_LABELS[r] || r}">${RIGHT_LABELS[r]}</th>`;
      });
      html += `</tr>
					<tr class="ps-compare-role-names">
						<th colspan="2"></th>`;
      const half = Math.ceil(MATRIX_RIGHTS.length / 2);
      html += `<th colspan="${MATRIX_RIGHTS.length}" class="ps-compare-role-span">
			<span class="ps-compare-role1-label">\u2460 ${esc(data.role1)}</span>
			&nbsp;/&nbsp;
			<span class="ps-compare-role2-label">\u2461 ${esc(data.role2)}</span>
		</th>`;
      html += `</tr></thead><tbody>`;
      let last_module = "";
      let displayed = 0;
      data.rows.forEach((row) => {
        if (this._show_diff_only && !row.has_diff)
          return;
        displayed++;
        const show_module = row.module !== last_module;
        last_module = row.module;
        const row_cls = row.has_diff ? "ps-row-has-diff" : "";
        html += `<tr class="ps-matrix-row ${row_cls}" data-doctype="${esc(row.doctype)}">`;
        html += `<td class="ps-col-module">${show_module ? esc(row.module) : ""}</td>`;
        html += `<td class="ps-col-doctype">
				<a href="/app/${frappe.router.slug(row.doctype)}" target="_blank">${esc(row.doctype)}</a>
				${row.has_diff ? '<span class="ps-diff-dot"></span>' : ""}
			</td>`;
        MATRIX_RIGHTS.forEach((r) => {
          const d = DIFF_STYLES[row.diff[r]] || DIFF_STYLES.neither;
          html += `<td class="ps-cell ps-compare-cell ${d.cls}"
					title="${__("{0}: {1}", [RIGHT_FULL_LABELS[r], d.title])}">${d.icon}</td>`;
        });
        html += `</tr>`;
      });
      if (!displayed) {
        html += `<tr><td colspan="${MATRIX_RIGHTS.length + 2}" class="ps-empty-state" style="padding:24px;text-align:center">
				${__("No differences found between these roles.")}
			</td></tr>`;
      }
      html += `</tbody></table></div>`;
      this.$results.html(html);
      this.$results.find(".ps-diff-only-cb").on("change", (e) => {
        this._show_diff_only = e.target.checked;
        this._render_comparison(this._data);
      });
      this.$results.find(".ps-compare-export-btn").on("click", () => this._export_csv(data));
    }
    _export_csv(data) {
      const header = ["DocType", "Module", "Has Diff?"];
      MATRIX_RIGHTS.forEach((r) => {
        header.push(`${r} (${data.role1})`);
        header.push(`${r} (${data.role2})`);
      });
      const rows = [header];
      data.rows.forEach((row) => {
        const r = [row.doctype, row.module, row.has_diff ? "Yes" : "No"];
        MATRIX_RIGHTS.forEach((p) => {
          r.push(row.role1_perms[p] === "na" ? "na" : row.role1_perms[p] ? "\u2713" : "\u2717");
          r.push(row.role2_perms[p] === "na" ? "na" : row.role2_perms[p] ? "\u2713" : "\u2717");
        });
        rows.push(r);
      });
      _download_csv(rows, `compare_${data.role1}_vs_${data.role2}`);
    }
    _welcome_html() {
      return `<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${frappe.utils.icon("compare", "lg")}</div>
			<div class="ps-welcome-title">${__("Compare Two Roles")}</div>
			<div class="ps-welcome-desc">${__("Select two roles above to see a side-by-side permission comparison highlighting every difference.")}</div>
		</div>`;
    }
    _skeleton(n) {
      return Array(n).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("");
    }
  };

  // ../permission_manager/permission_manager/public/js/components/health_dashboard.js
  var HealthDashboard = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this.load();
    }
    load() {
      this.wrapper.empty();
      this.wrapper.html(`<div class="ps-loading">${this._skeleton(4)}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.lookup.get_permission_health",
        callback: (r) => {
          if (r.message)
            this._render(r.message);
        },
        error: () => {
          this.wrapper.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to load health data.")}</div>
					<button class="btn btn-sm btn-default ps-health-retry">
						${frappe.utils.icon("refresh", "xs")} ${__("Retry")}
					</button>
				</div>`);
          this.wrapper.find(".ps-health-retry").on("click", () => this.load());
        }
      });
    }
    _render(d) {
      const score = this._compute_score(d);
      let html = `
		<div class="ps-health-wrapper">

			<!-- Score card -->
			<div class="ps-health-score-row">
				<div class="ps-health-score-card ps-score-${score.grade}">
					<div class="ps-score-circle">${score.grade}</div>
					<div class="ps-score-info">
						<div class="ps-score-label">${__("Permission Health Score")}</div>
						<div class="ps-score-sub">${score.points}/100 &nbsp;\u2014&nbsp; ${score.label}</div>
					</div>
				</div>
				<button class="btn btn-xs btn-default ps-health-refresh-btn" style="align-self:flex-start">
					${frappe.utils.icon("refresh", "xs")} ${__("Refresh")}
				</button>
			</div>

			<!-- Stat tiles -->
			<div class="ps-health-tiles">
				${this._tile("tool", d.custom_perm_count, __("Custom Perm Rows"), d.custom_perm_count > 100 ? "warn" : "ok", __("{0} DocTypes overridden", [d.custom_perm_doctypes]))}
				${this._tile("users", d.system_manager_count, __("System Managers"), d.system_manager_count > 5 ? "warn" : "ok", __("Users with full access"))}
				${this._tile("warning", d.users_no_roles_count, __("Users with No Roles"), d.users_no_roles_count > 0 ? "alert" : "ok", __("Cannot access Frappe desk"))}
				${this._tile("delete", d.roles_no_users_count, __("Empty Roles"), d.roles_no_users_count > 0 ? "warn" : "ok", __("Roles with no users assigned"))}
				${this._tile("lock", d.orphan_role_perms.length, __("Orphan Perm Rows"), d.orphan_role_perms.length > 0 ? "alert" : "ok", __("Custom perms for deleted roles"))}
				${this._tile("shield", d.sensitive_with_custom.length, __("Sensitive Overrides"), d.sensitive_with_custom.length > 0 ? "warn" : "ok", __("Sensitive DocTypes with custom perms"))}
			</div>`;
      if (d.system_manager_users.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning", "sm")} ${__("System Manager Users")} (${d.system_manager_users.length})</h4>
				<div class="ps-health-pills">
					${d.system_manager_users.map((u) => `
						<a href="/app/user/${u}" target="_blank" class="ps-health-pill ps-pill-warn">${esc(u)}</a>
					`).join("")}
				</div>
			</div>`;
      }
      if (d.users_no_roles.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("error", "sm")} ${__("Users with No Roles")} (${d.users_no_roles_count})</h4>
				<div class="ps-health-pills">
					${d.users_no_roles.map((u) => `
						<a href="/app/user/${u}" target="_blank" class="ps-health-pill ps-pill-alert">${esc(u)}</a>
					`).join("")}
					${d.users_no_roles_count > 20 ? `<span class="ps-health-pill">+${d.users_no_roles_count - 20} more</span>` : ""}
				</div>
			</div>`;
      }
      if (d.roles_no_users.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("info", "sm")} ${__("Empty Roles (No Users)")} (${d.roles_no_users_count})</h4>
				<div class="ps-health-pills">
					${d.roles_no_users.map((r) => `<span class="ps-health-pill">${esc(r)}</span>`).join("")}
					${d.roles_no_users_count > 30 ? `<span class="ps-health-pill">+${d.roles_no_users_count - 30} more</span>` : ""}
				</div>
			</div>`;
      }
      if (d.sensitive_with_custom.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("shield", "sm")} ${__("Sensitive DocTypes with Custom Permissions")}</h4>
				<div class="ps-health-pills">
					${d.sensitive_with_custom.map((dt) => `
						<a class="ps-health-pill ps-pill-warn" href="/app/permission-studio#doctype=${encodeURIComponent(dt)}">${esc(dt)}</a>
					`).join("")}
				</div>
				<p class="ps-health-note">${__("These DocTypes have custom permission overrides. Review them to ensure they are intentional.")}</p>
			</div>`;
      }
      if (d.orphan_role_perms.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("delete", "sm")} ${__("Orphan Permission Rows (Role No Longer Exists)")}</h4>
				<div class="ps-health-pills">
					${d.orphan_role_perms.map((r) => `<span class="ps-health-pill ps-pill-alert">${esc(r)}</span>`).join("")}
				</div>
				<p class="ps-health-note">${__("These Custom DocPerm rows reference roles that no longer exist. They are harmless but waste space. Delete them via bench console: frappe.db.delete('Custom DocPerm', {'role': 'ROLE_NAME'})")}</p>
			</div>`;
      }
      if (d.over_privileged_users.length) {
        html += `<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning", "sm")} ${__("Users with Many Roles (>10)")}</h4>
				<table class="ps-health-table">
					<thead><tr><th>${__("User")}</th><th>${__("Role Count")}</th></tr></thead>
					<tbody>
						${d.over_privileged_users.map((u) => `
							<tr>
								<td><a href="/app/user/${u.user}" target="_blank">${esc(u.user)}</a></td>
								<td><strong>${u.role_count}</strong></td>
							</tr>
						`).join("")}
					</tbody>
				</table>
			</div>`;
      }
      html += `</div>`;
      this.wrapper.html(html);
      this.wrapper.find(".ps-health-refresh-btn").on("click", () => this.load());
    }
    _tile(icon, value, label, status, sub) {
      const color = { ok: "green", warn: "amber", alert: "red" }[status] || "gray";
      return `<div class="ps-health-tile ps-tile-${color}">
			<div class="ps-tile-icon">${frappe.utils.icon(icon, "md")}</div>
			<div class="ps-tile-value">${value}</div>
			<div class="ps-tile-label">${label}</div>
			<div class="ps-tile-sub">${sub}</div>
		</div>`;
    }
    _compute_score(d) {
      let points = 100;
      if (d.system_manager_count > 5)
        points -= 10;
      if (d.system_manager_count > 10)
        points -= 10;
      if (d.users_no_roles_count > 0)
        points -= Math.min(d.users_no_roles_count * 2, 15);
      if (d.orphan_role_perms.length > 0)
        points -= 10;
      if (d.sensitive_with_custom.length > 0)
        points -= d.sensitive_with_custom.length * 5;
      if (d.custom_perm_count > 200)
        points -= 5;
      points = Math.max(0, points);
      const grade = points >= 85 ? "A" : points >= 70 ? "B" : points >= 50 ? "C" : "D";
      const label = { A: __("Excellent"), B: __("Good"), C: __("Needs Attention"), D: __("Critical") }[grade];
      return { points, grade, label };
    }
    _skeleton(n) {
      return Array(n).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("");
    }
  };
  function showUserSimulation(user) {
    const dialog = new frappe.ui.Dialog({
      title: __("Access Simulation \u2014 {0}", [user]),
      size: "extra-large",
      fields: [{ fieldtype: "HTML", fieldname: "sim_html" }]
    });
    const $w = dialog.fields_dict.sim_html.$wrapper;
    $w.html(`<div class="ps-sim-loading">${frappe.utils.icon("refresh", "md")} ${__("Simulating access\u2026")}</div>`);
    dialog.show();
    frappe.call({
      method: "permission_manager.permission_manager.api.lookup.simulate_user_access",
      args: { user },
      callback: (r) => {
        if (r.message)
          _render_simulation($w, r.message);
      },
      error: () => {
        $w.html(`<div class="ps-error-state"><div class="ps-error-msg">${__("Simulation failed.")}</div></div>`);
      }
    });
  }
  function _render_simulation($w, d) {
    const last_login = d.last_login ? frappe.datetime.str_to_user(d.last_login) : __("Never");
    let html = `
		<div class="ps-sim-wrapper">
			<div class="ps-sim-user-card">
				${d.user_image ? `<img src="${esc(d.user_image)}" class="ps-sim-avatar">` : `<div class="ps-sim-avatar ps-avatar-placeholder">${(d.full_name || d.user)[0].toUpperCase()}</div>`}
				<div>
					<div class="ps-sim-name">${esc(d.full_name || d.user)}</div>
					<div class="ps-sim-email">${esc(d.email || d.user)}</div>
					<div class="ps-sim-meta">${__("Last login")}: ${last_login}</div>
					<div class="ps-sim-roles">
						${d.roles.map((r) => `<span class="ps-badge ps-xs-badge">${esc(r)}</span>`).join(" ")}
					</div>
				</div>
				<div class="ps-sim-actions">
					<a href="/app/user/${encodeURIComponent(d.user)}" target="_blank"
					   class="btn btn-xs btn-default">
						${frappe.utils.icon("link-url", "xs")} ${__("Open User Record")}
					</a>
				</div>
			</div>

			<!-- Summary tiles -->
			<div class="ps-sim-tiles">
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.total_accessible_doctypes}</div>
					<div class="ps-tile-label">${__("Accessible DocTypes")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.total_modules}</div>
					<div class="ps-tile-label">${__("Modules")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${d.roles.length}</div>
					<div class="ps-tile-label">${__("Roles")}</div>
				</div>
			</div>`;
    if (d.sensitive_access.length) {
      html += `<h4 class="ps-sim-section-title">${__("Sensitive DocType Access")}</h4>
		<table class="ps-health-table">
			<thead><tr>
				<th>${__("DocType")}</th>
				<th>${__("Read")}</th><th>${__("Write")}</th>
				<th>${__("Create")}</th><th>${__("Delete")}</th><th>${__("Submit")}</th>
			</tr></thead><tbody>`;
      d.sensitive_access.forEach((s) => {
        const icon = (v) => v ? `<span style="color:var(--ps-green)">\u2713</span>` : `<span style="color:var(--ps-red)">\u2717</span>`;
        html += `<tr>
				<td><strong>${esc(s.doctype)}</strong></td>
				<td>${icon(s.read)}</td><td>${icon(s.write)}</td>
				<td>${icon(s.create)}</td><td>${icon(s.delete)}</td><td>${icon(s.submit)}</td>
			</tr>`;
      });
      html += `</tbody></table>`;
    }
    html += `<h4 class="ps-sim-section-title">${__("Module Breakdown")}</h4>
	<div class="ps-sim-module-grid">`;
    d.modules.forEach((mod) => {
      const pct = mod.doctypes.length ? Math.round(mod.write / mod.read * 100) : 0;
      html += `<div class="ps-sim-module-card">
			<div class="ps-sim-mod-name">${esc(mod.module)}</div>
			<div class="ps-sim-mod-stats">
				<span title="${__("Can read")}" class="ps-sim-stat ps-stat-read">${frappe.utils.icon("eye", "xs")} ${mod.read}</span>
				<span title="${__("Can write")}" class="ps-sim-stat ps-stat-write">${frappe.utils.icon("edit", "xs")} ${mod.write}</span>
				<span title="${__("Can create")}" class="ps-sim-stat ps-stat-create">${frappe.utils.icon("add", "xs")} ${mod.create}</span>
				<span title="${__("Can delete")}" class="ps-sim-stat ps-stat-delete">${frappe.utils.icon("delete", "xs")} ${mod.delete}</span>
			</div>
			<div class="ps-sim-progress" title="${__("Write access: {0}%", [pct])}">
				<div class="ps-sim-progress-bar" style="width:${pct}%"></div>
			</div>
		</div>`;
    });
    html += `</div></div>`;
    $w.html(html);
  }

  // ../permission_manager/permission_manager/public/js/components/approval_inbox.js
  var CATEGORY_META = {
    "Approval Pending": { color: "ps-ai-grp-approval", icon: "review" },
    "Decision Pending": { color: "ps-ai-grp-decision", icon: "branch" },
    "Acknowledgement Pending": { color: "ps-ai-grp-ack", icon: "tick" }
  };
  var PRIORITY_CLASS = {
    Critical: "ps-ai-pri-critical",
    Urgent: "ps-ai-pri-urgent",
    High: "ps-ai-pri-high",
    Medium: "ps-ai-pri-medium",
    Low: "ps-ai-pri-low"
  };
  var ApprovalInbox = class {
    constructor(opts) {
      this.wrapper = opts.wrapper;
      this.data = null;
      this.collapsed = {};
      this._search = "";
      this._filter_doctype = "";
      this._from_date = "";
      this._to_date = "";
      this._date_sort = "desc";
      this._active_tab = "pending";
      this._build_shell();
      this.load();
    }
    _build_shell() {
      this.wrapper.html(`
            <div class="ps-ai-wrap">

                <div class="ps-ai-toolbar">
                    <div class="ps-ai-toolbar-left">
                        ${frappe.utils.icon("review", "sm")}
                        <strong class="ps-ai-title">${__("My Approvals")}</strong>
                        <span class="ps-ai-total-badge"></span>
                    </div>
                    <div class="ps-ai-toolbar-right">
                        <input  class="form-control ps-ai-search"
                                type="text"
                                placeholder="${__("Search documents, creators, states\u2026")}"
                                autocomplete="off" />
                        <select class="form-control ps-ai-dt-filter">
                            <option value="">${__("All Transactions")}</option>
                        </select>
                        <div class="ps-ai-date-range">
                            <input class="form-control ps-ai-from-date" type="date" title="${__("From Date")}" />
                            <span class="ps-ai-date-sep">\u2013</span>
                            <input class="form-control ps-ai-to-date"   type="date" title="${__("To Date")}" />
                        </div>
                        <button class="btn btn-sm btn-default ps-ai-refresh-btn">
                            ${frappe.utils.icon("refresh", "xs")} ${__("Refresh")}
                        </button>
                    </div>
                </div>

                <div class="ps-ai-nav-tabs">
                    <button class="ps-ai-nav-tab active" data-tab="pending">${__("Pending")}</button>
                    <button class="ps-ai-nav-tab" data-tab="history">${__("History")}</button>
                    <button class="ps-ai-nav-tab" data-tab="analytics">${__("Analytics")}</button>
                </div>

                <div class="ps-ai-stats-bar"></div>

                <div class="ps-ai-body">
                    <div class="ps-loading">${__("Loading\u2026")}</div>
                </div>

            </div>
        `);
      this.wrapper.find(".ps-ai-refresh-btn").on("click", () => this.load());
      this.wrapper.find(".ps-ai-search").on("input", (e) => {
        this._search = $(e.target).val().trim().toLowerCase();
        if (this._active_tab === "pending")
          this._apply_filter();
      });
      this.wrapper.find(".ps-ai-dt-filter").on("change", (e) => {
        this._filter_doctype = $(e.target).val();
        if (this._active_tab === "pending")
          this._apply_filter();
      });
      this.wrapper.find(".ps-ai-from-date").on("change", (e) => {
        this._from_date = $(e.target).val();
        if (this._active_tab === "pending")
          this._apply_filter();
      });
      this.wrapper.find(".ps-ai-to-date").on("change", (e) => {
        this._to_date = $(e.target).val();
        if (this._active_tab === "pending")
          this._apply_filter();
      });
      this.wrapper.find(".ps-ai-nav-tab").on("click", (e) => {
        const tab = $(e.currentTarget).data("tab");
        this.wrapper.find(".ps-ai-nav-tab").removeClass("active");
        $(e.currentTarget).addClass("active");
        this._active_tab = tab;
        this._switch_tab(tab);
      });
    }
    _switch_tab(tab) {
      const $search_row = this.wrapper.find(".ps-ai-search, .ps-ai-dt-filter, .ps-ai-date-range");
      $search_row.toggle(tab === "pending");
      this.wrapper.find(".ps-ai-stats-bar").toggle(tab === "pending");
      if (tab === "pending") {
        this._render();
      } else if (tab === "history") {
        this._render_history();
      } else if (tab === "analytics") {
        this._render_analytics();
      }
    }
    load() {
      const $body = this.wrapper.find(".ps-ai-body");
      $body.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`);
      this.wrapper.find(".ps-ai-stats-bar").empty();
      frappe.call({
        method: "permission_manager.permission_manager.api.approvals.get_my_pending_approvals",
        callback: (r) => {
          this.data = r.message || { groups: [], total: 0 };
          this._switch_tab(this._active_tab);
        },
        error: () => {
          $body.html(`
                    <div class="ps-ai-empty">
                        ${frappe.utils.icon("alert", "lg")}
                        <p>${__("Failed to load approvals. Check console for errors.")}</p>
                    </div>
                `);
        }
      });
    }
    _render() {
      const d = this.data;
      const $body = this.wrapper.find(".ps-ai-body");
      this.wrapper.find(".ps-ai-total-badge").text(d.total || "").toggle(!!d.total);
      const $dt_sel = this.wrapper.find(".ps-ai-dt-filter");
      const doctypes = [...new Set(d.groups.flatMap((g) => g.items.map((i) => i.doctype)))].sort();
      $dt_sel.html(`<option value="">${__("All Transactions")}</option>`);
      doctypes.forEach((dt) => $dt_sel.append(`<option value="${esc(dt)}">${esc(dt)}</option>`));
      this._render_stats_bar();
      if (!d.total) {
        $body.html(`
                <div class="ps-ai-empty">
                    ${frappe.utils.icon("tick-circle", "xl")}
                    <h4>${__("All Clear!")}</h4>
                    <p>${__("You have no pending approvals at this time.")}</p>
                </div>
            `);
        return;
      }
      $body.empty();
      d.groups.forEach((group) => this._render_group($body, group));
      if (this._search || this._filter_doctype)
        this._apply_filter();
    }
    _render_stats_bar() {
      const d = this.data;
      if (!d.total)
        return;
      const overdue = d.groups.flatMap((g) => g.items).filter((i) => i.days > 30).length;
      const high_pri = d.groups.flatMap((g) => g.items).filter((i) => ["High", "Urgent", "Critical"].includes(i.priority)).length;
      const cats = d.groups.map(
        (g) => `<span class="ps-ai-stat-cat">${esc(__(g.label))}: <strong>${g.items.length}</strong></span>`
      ).join("");
      this.wrapper.find(".ps-ai-stats-bar").html(`
            <div class="ps-ai-stats">
                ${cats}
                ${high_pri ? `<span class="ps-ai-stat-alert">\u{1F534} ${high_pri} ${__("high priority")}</span>` : ""}
                ${overdue ? `<span class="ps-ai-stat-overdue">\u26A0\uFE0F ${overdue} ${__("overdue (>30 days)")}</span>` : ""}
            </div>
        `);
    }
    _render_group($body, group) {
      const label = group.label;
      const meta = CATEGORY_META[label] || { color: "", icon: "list" };
      const is_collapsed = !!this.collapsed[label];
      const cat_key = label.replace(/\s+/g, "_").toLowerCase();
      const $grp = $(`
            <div class="ps-ai-group" data-category="${esc(cat_key)}">

                <div class="ps-ai-grp-hdr ${esc(meta.color)}">
                    <span class="ps-ai-grp-toggle">${is_collapsed ? "\u25B6" : "\u25BC"}</span>
                    <span class="ps-ai-grp-icon">${frappe.utils.icon(meta.icon, "xs")}</span>
                    <strong class="ps-ai-grp-label">${esc(__(label))}</strong>
                    <span class="ps-ai-grp-count">${group.items.length}</span>

                    <div class="ps-ai-bulk-bar" ${is_collapsed ? 'style="display:none"' : ""}>
                        <label class="ps-ai-sel-all-label">
                            <input type="checkbox" class="ps-ai-chk-all" />
                            <span>${__("Select all")}</span>
                        </label>
                        <button class="btn btn-xs btn-success ps-ai-bulk-btn" style="display:none">
                            \u2713 ${__("Bulk approve checked")}
                        </button>
                        <button class="btn btn-xs btn-danger ps-ai-bulk-reject-btn" style="display:none">
                            \u2717 ${__("Bulk reject checked")}
                        </button>
                    </div>
                </div>

                <div class="ps-ai-grp-body" ${is_collapsed ? 'style="display:none"' : ""}>
                    <div class="ps-ai-table-wrap">
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th class="ps-ai-col-chk"></th>
                                <th class="ps-ai-col-date ps-ai-col-sortable" data-sort="date">
                                    ${__("Date")} <span class="ps-ai-sort-icon">${this._date_sort === "asc" ? "\u2191" : "\u2193"}</span>
                                </th>
                                <th class="ps-ai-col-pri">${__("Priority")}</th>
                                <th class="ps-ai-col-trans">${__("Transaction")}</th>
                                <th class="ps-ai-col-num">${__("#")}</th>
                                <th class="ps-ai-col-role">${__("Role")}</th>
                                <th class="ps-ai-col-holder">${__("With")}</th>
                                <th class="ps-ai-col-state">${__("Approval")}</th>
                                <th class="ps-ai-col-days">${__("Days")}</th>
                                <th class="ps-ai-col-creator">${__("Creator")}</th>
                                <th class="ps-ai-col-actions">${__("Actions")}</th>
                            </tr></thead>
                            <tbody class="ps-ai-tbody"></tbody>
                        </table>
                    </div>
                </div>

            </div>
        `);
      const $tbody = $grp.find(".ps-ai-tbody");
      const $bulk_bar = $grp.find(".ps-ai-bulk-bar");
      const $bulk_btn = $grp.find(".ps-ai-bulk-btn");
      const $bulk_rej = $grp.find(".ps-ai-bulk-reject-btn");
      const sorted = [...group.items].sort((a, b) => {
        const cmp = (a.creation_iso || "").localeCompare(b.creation_iso || "");
        return this._date_sort === "asc" ? cmp : -cmp;
      });
      sorted.forEach((item) => this._render_row($tbody, item));
      $grp.find(".ps-ai-col-sortable").on("click", () => {
        this._date_sort = this._date_sort === "asc" ? "desc" : "asc";
        this._render();
      });
      $grp.find(".ps-ai-grp-hdr").on("click", (e) => {
        if ($(e.target).closest("input, button, label, a").length)
          return;
        const $panel = $grp.find(".ps-ai-grp-body");
        const now_vis = $panel.is(":visible");
        this.collapsed[label] = now_vis;
        $panel.toggle(!now_vis);
        $bulk_bar.toggle(!now_vis);
        $grp.find(".ps-ai-grp-toggle").text(now_vis ? "\u25B6" : "\u25BC");
      });
      $grp.find(".ps-ai-chk-all").on("change", function() {
        const checked = $(this).is(":checked");
        $tbody.find(".ps-ai-row-chk:not(:disabled)").prop("checked", checked);
        const any = $tbody.find(".ps-ai-row-chk:checked").length > 0;
        $bulk_btn.toggle(any);
        $bulk_rej.toggle(any);
      });
      $tbody.on("change", ".ps-ai-row-chk", () => {
        const any = $tbody.find(".ps-ai-row-chk:checked").length > 0;
        $bulk_btn.toggle(any);
        $bulk_rej.toggle(any);
      });
      $bulk_btn.on("click", () => this._bulk_action($tbody.find(".ps-ai-row-chk:checked").closest("tr"), group.items, 0));
      $bulk_rej.on("click", () => this._bulk_action($tbody.find(".ps-ai-row-chk:checked").closest("tr"), group.items, 1));
      $body.append($grp);
    }
    _render_row($tbody, item) {
      const pri_class = PRIORITY_CLASS[item.priority] || "ps-ai-pri-low";
      const days_class = item.days > 30 ? "ps-ai-days-critical" : item.days > 7 ? "ps-ai-days-warn" : "ps-ai-days-ok";
      const row_class = item.days > 30 ? "ps-ai-row ps-ai-row-overdue" : "ps-ai-row";
      const search_val = [item.doctype, item.docname, item.creator, item.role_id, item.state].join(" ").toLowerCase();
      let act_html = "";
      (item.available_actions || []).forEach((act_name, idx) => {
        const cls = idx === 0 ? "btn-success" : idx === 1 ? "btn-danger" : "btn-default";
        act_html += `<button class="btn btn-xs ${cls} ps-ai-act-btn"
                data-action="${esc(act_name)}"
                data-doctype="${esc(item.doctype)}"
                data-docname="${esc(item.docname)}"
                title="${esc(act_name)}">${esc(act_name)}</button>`;
      });
      if (!act_html)
        act_html = `<span class="ps-ai-no-action text-muted">${__("No action")}</span>`;
      act_html += `<a href="${esc(item.doc_url)}" target="_blank"
            class="btn btn-xs btn-default ps-ai-open-btn" title="${__("Open document")}">\u2192</a>`;
      const COL_COUNT = 11;
      const $row = $(`
            <tr class="${row_class}"
                data-name="${esc(item.name)}"
                data-doctype="${esc(item.doctype)}"
                data-docname="${esc(item.docname)}"
                data-search="${esc(search_val)}"
                data-creation="${esc(item.creation_iso || "")}">
                <td class="ps-ai-col-chk">
                    <input type="checkbox" class="ps-ai-row-chk" />
                </td>
                <td class="ps-ai-col-date ps-ai-preview-trigger" title="${__("Click to preview")}" style="cursor:pointer">
                    ${esc(item.date)}
                    <span class="ps-ai-expand-icon">\u25B8</span>
                </td>
                <td class="ps-ai-col-pri">
                    <span class="ps-ai-pri-badge ${pri_class}">${esc(item.priority)}</span>
                </td>
                <td class="ps-ai-col-trans" title="${esc(item.doctype)}">${esc(item.doctype)}</td>
                <td class="ps-ai-col-num">
                    <a class="ps-ai-doc-link" href="${esc(item.doc_url)}" target="_blank">
                        ${esc(item.docname)}
                    </a>
                </td>
                <td class="ps-ai-col-role">${esc(item.role_id)}</td>
                <td class="ps-ai-col-holder">
                    ${item.holder ? `<span class="ps-ai-holder-name">${esc(item.holder)}</span>` : `<span class="text-muted ps-ai-holder-role">${esc(item.role_id || "\u2014")}</span>`}
                </td>
                <td class="ps-ai-col-state">
                    <span class="ps-ai-state-badge">${esc(item.state)}</span>
                </td>
                <td class="ps-ai-col-days">
                    <span class="ps-ai-days-badge ${days_class}">${item.days}</span>
                </td>
                <td class="ps-ai-col-creator">${esc(item.creator)}</td>
                <td class="ps-ai-col-actions">${act_html}</td>
            </tr>
            <tr class="ps-ai-preview-row" style="display:none">
                <td colspan="${COL_COUNT}" class="ps-ai-preview-cell">
                    <div class="ps-ai-preview-body">
                        <span class="text-muted">${__("Loading\u2026")}</span>
                    </div>
                </td>
            </tr>
        `);
      $row.filter(".ps-ai-row").find(".ps-ai-preview-trigger").on("click", () => {
        const $preview_row = $row.filter(".ps-ai-preview-row");
        const $preview_body = $preview_row.find(".ps-ai-preview-body");
        if ($preview_row.is(":visible")) {
          $preview_row.hide();
          $row.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("\u25B8");
          return;
        }
        $preview_row.show();
        $row.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("\u25BE");
        if ($preview_body.data("loaded"))
          return;
        $preview_body.data("loaded", true);
        this._load_preview($preview_body, item.doctype, item.docname);
      });
      $row.filter(".ps-ai-row").find(".ps-ai-act-btn").on("click", (e) => {
        const $btn = $(e.currentTarget);
        this._do_action($btn.data("doctype"), $btn.data("docname"), $btn.data("action"));
      });
      $tbody.append($row);
    }
    _load_preview($container, doctype, docname) {
      frappe.call({
        method: "frappe.client.get",
        args: { doctype, name: docname },
        callback: (r) => {
          if (!r.message) {
            $container.html(`<span class="text-muted">${__("Could not load document.")}</span>`);
            return;
          }
          const doc = r.message;
          const meta = frappe.get_meta(doctype);
          if (!meta) {
            frappe.model.with_doctype(doctype, () => this._load_preview($container, doctype, docname));
            $container.data("loaded", false);
            return;
          }
          const SKIP_TYPES = /* @__PURE__ */ new Set([
            "Section Break",
            "Column Break",
            "HTML",
            "Button",
            "Tab Break",
            "Code",
            "JSON",
            "Long Text",
            "Small Text",
            "Text",
            "Text Editor",
            "Signature",
            "Attach",
            "Attach Image",
            "Barcode",
            "Geolocation",
            "Table",
            "Table MultiSelect",
            "Password"
          ]);
          const SKIP_NAMES = /* @__PURE__ */ new Set([
            "exchange_rate",
            "conversion_rate",
            "base_exchange_rate",
            "naming_series",
            "amended_from",
            "amended_to",
            "docstatus",
            "idx",
            "owner",
            "modified",
            "modified_by",
            "creation",
            "name",
            "workflow_state",
            "letter_head",
            "select_print_heading",
            "tc_name",
            "terms",
            "taxes_and_charges",
            "shipping_rule",
            "discount_amount",
            "additional_discount_percentage",
            "apply_discount_on",
            "in_words",
            "base_in_words",
            "language",
            "meta_image",
            "status_field",
            "source",
            "base_grand_total",
            "base_net_total",
            "base_total",
            "base_tax_withholding_net_total",
            "outstanding_amount",
            "debit_to",
            "credit_to",
            "against_expense_account",
            "against_income_account",
            "remarks",
            "user_remark",
            "instructions",
            "total_advance",
            "total_taxes_and_charges",
            "total_billing_amount",
            "update_stock",
            "set_warehouse",
            "set_target_warehouse",
            "scan_barcode",
            "barcode",
            "image",
            "company_address_display",
            "customer_address",
            "contact_display",
            "contact_email",
            "contact_mobile",
            "shipping_address_name",
            "billing_address"
          ]);
          const candidates = meta.fields.filter(
            (f) => !SKIP_TYPES.has(f.fieldtype) && !SKIP_NAMES.has(f.fieldname) && !f.hidden && !f.print_hide && doc[f.fieldname] != null && doc[f.fieldname] !== ""
          );
          const priority = (f) => f.in_preview ? 0 : f.bold ? 1 : f.in_list_view ? 2 : 3;
          candidates.sort((a, b) => priority(a) - priority(b));
          const _strip_html = (s) => {
            const d = document.createElement("div");
            d.innerHTML = s;
            return d.textContent || d.innerText || s;
          };
          const _fmt_val = (f, val) => {
            if (f.fieldtype === "Check")
              return val ? __("Yes") : __("No");
            if (f.fieldtype === "Date")
              return frappe.datetime.str_to_user(val) || val;
            if (f.fieldtype === "Datetime")
              return frappe.datetime.str_to_user(val) || val;
            if (["Currency", "Float", "Int", "Percent"].includes(f.fieldtype))
              return _strip_html(frappe.format(val, f) || String(val));
            if (typeof val === "object" || Array.isArray(val))
              return null;
            return String(val);
          };
          const rows = candidates.slice(0, 8).map((f) => {
            const rendered = _fmt_val(f, doc[f.fieldname]);
            if (rendered === null)
              return "";
            return `<div class="ps-ai-prev-row">
                            <span class="ps-ai-prev-label">${esc(__(f.label || f.fieldname))}</span>
                            <span class="ps-ai-prev-val">${esc(rendered)}</span>
                        </div>`;
          }).filter(Boolean);
          $container.html(
            rows.length ? `<div class="ps-ai-prev-grid">${rows.join("")}</div>` : `<span class="text-muted">${__("No key fields to preview.")}</span>`
          );
        },
        error: () => $container.html(`<span class="text-muted">${__("Preview failed.")}</span>`)
      });
    }
    _do_action(doctype, docname, action) {
      const dlg = new frappe.ui.Dialog({
        title: `${__(action)}: ${esc(docname)}`,
        fields: [
          {
            fieldtype: "HTML",
            fieldname: "doc_info",
            options: `<div class="ps-ai-dlg-info">
                        <strong>${__("DocType")}:</strong> ${esc(doctype)}<br>
                        <strong>${__("Document")}:</strong> ${esc(docname)}
                    </div>`
          },
          {
            fieldtype: "Select",
            fieldname: "priority",
            label: __("Priority"),
            options: "Low\nMedium\nHigh\nCritical",
            default: "Medium"
          },
          {
            fieldtype: "Small Text",
            fieldname: "comment",
            label: __("Comment"),
            description: __("Optional note added to the document.")
          }
        ],
        primary_action_label: __(action),
        primary_action: (vals) => {
          dlg.hide();
          frappe.dom.freeze(__("Applying \u2014 {0}\u2026", [action]));
          frappe.call({
            method: "permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",
            args: { doctype, docname, action, comment: vals.comment || "", priority: vals.priority || "Medium" },
            callback: (r) => {
              var _a;
              frappe.dom.unfreeze();
              if ((_a = r.message) == null ? void 0 : _a.success) {
                frappe.show_alert({ message: __("{0} \u2014 {1} applied.", [docname, action]), indicator: "green" });
                this.load();
              }
            },
            error: () => frappe.dom.unfreeze()
          });
        }
      });
      dlg.show();
    }
    _bulk_action($checked_rows, group_items, action_idx) {
      const rows = $checked_rows.toArray();
      if (!rows.length)
        return;
      const row_actions = rows.map((row) => {
        var _a;
        const docname = $(row).attr("data-docname");
        const item = group_items.find((i) => i.docname === docname);
        return {
          doctype: $(row).attr("data-doctype"),
          docname,
          action: ((_a = item == null ? void 0 : item.available_actions) == null ? void 0 : _a[action_idx]) || ""
        };
      }).filter((r) => r.action);
      if (!row_actions.length) {
        frappe.show_alert({ message: __("No applicable action found."), indicator: "orange" });
        return;
      }
      frappe.confirm(
        __("Apply <b>{0}</b> to {1} document(s)?", [row_actions[0].action, row_actions.length]),
        () => {
          let done = 0, failed = 0;
          frappe.dom.freeze(__("Processing {0} documents\u2026", [row_actions.length]));
          const process = (idx) => {
            if (idx >= row_actions.length) {
              frappe.dom.unfreeze();
              frappe.show_alert({
                message: __("{0} applied: {1} succeeded, {2} failed.", [row_actions[0].action, done, failed]),
                indicator: failed ? "orange" : "green"
              });
              this.load();
              return;
            }
            const { doctype, docname, action } = row_actions[idx];
            frappe.call({
              method: "permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",
              args: { doctype, docname, action, comment: "" },
              callback: () => {
                done++;
                process(idx + 1);
              },
              error: () => {
                failed++;
                process(idx + 1);
              }
            });
          };
          process(0);
        }
      );
    }
    _apply_filter() {
      const q = this._search;
      const dt = this._filter_doctype;
      const from = this._from_date;
      const to = this._to_date;
      this.wrapper.find(".ps-ai-row").each((_, row) => {
        const $row = $(row);
        const s = ($row.attr("data-search") || "").toLowerCase();
        const rdt = $row.attr("data-doctype") || "";
        const ciso = $row.attr("data-creation") || "";
        const in_date = (!from || ciso >= from) && (!to || ciso <= to);
        const show = (!q || s.includes(q)) && (!dt || rdt === dt) && in_date;
        $row.toggle(show);
        $row.next(".ps-ai-preview-row").toggle(show && $row.next(".ps-ai-preview-row").find(".ps-ai-preview-body").data("loaded"));
      });
      this.wrapper.find(".ps-ai-group").each((_, grp) => {
        const $grp = $(grp);
        const visible = $grp.find(".ps-ai-row:visible").length;
        $grp.find(".ps-ai-grp-count").text(visible);
        $grp.toggle(visible > 0 || !q && !dt);
      });
      const grand = this.wrapper.find(".ps-ai-row:visible").length;
      this.wrapper.find(".ps-ai-total-badge").text(grand || "").toggle(!!grand);
    }
    _render_history() {
      const $body = this.wrapper.find(".ps-ai-body");
      $body.html(`<div class="ps-loading">${__("Loading history\u2026")}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.approvals.get_my_approval_history",
        args: { limit: 200 },
        callback: (r) => {
          const rows = r.message || [];
          if (!rows.length) {
            $body.html(`<div class="ps-ai-empty"><h4>${__("No approval history yet.")}</h4><p class="text-muted">${__("Actions appear here once approvals are processed on your documents.")}</p></div>`);
            return;
          }
          const html = `
                    <div class="ps-ai-table-wrap">
                    <table class="ps-matrix-table ps-ai-table">
                        <thead><tr>
                            <th>${__("Date")}</th>
                            <th>${__("Transaction")}</th>
                            <th>${__("#")}</th>
                            <th>${__("Approved At State")}</th>
                            <th>${__("Current State")}</th>
                            <th>${__("Actioned By")}</th>
                            <th>${__("Via Role")}</th>
                        </tr></thead>
                        <tbody>
                        ${rows.map((row) => `<tr>
                                <td>${esc(row.date)}</td>
                                <td>${esc(row.doctype)}</td>
                                <td><a href="${esc(row.doc_url)}" target="_blank">${esc(row.docname)}</a></td>
                                <td><span class="ps-ai-state-badge">${esc(row.action_state || "\u2014")}</span></td>
                                <td><span class="ps-ai-state-badge ps-ai-state-current">${esc(row.current_state || "\u2014")}</span></td>
                                <td>${esc(row.completed_by || "\u2014")}</td>
                                <td>${esc(row.role || "\u2014")}</td>
                            </tr>`).join("")}
                        </tbody>
                    </table>
                    </div>
                `;
          $body.html(html);
        },
        error: () => $body.html(`<div class="ps-ai-empty"><p>${__("Failed to load history.")}</p></div>`)
      });
    }
    _render_analytics() {
      const $body = this.wrapper.find(".ps-ai-body");
      $body.html(`<div class="ps-loading">${__("Loading analytics\u2026")}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.approvals.get_approval_analytics",
        callback: (r) => {
          const d = r.message || {};
          const { summary, volume_by_doctype = [], longest_pending = [], top_approvers = [] } = d;
          if (!summary) {
            $body.html(`<div class="ps-ai-empty"><h4>${__("No data yet.")}</h4></div>`);
            return;
          }
          const summary_html = `
                    <div class="ps-ai-analytics-summary">
                        <div class="ps-ai-stat-tile ps-ai-tile-open">
                            <div class="ps-ai-tile-num">${summary.total_open}</div>
                            <div class="ps-ai-tile-label">${__("Currently Open")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-done">
                            <div class="ps-ai-tile-num">${summary.completed_last_30d}</div>
                            <div class="ps-ai-tile-label">${__("Completed (30 days)")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-overdue">
                            <div class="ps-ai-tile-num">${summary.overdue}</div>
                            <div class="ps-ai-tile-label">${__("Overdue (>30 days)")}</div>
                        </div>
                    </div>
                `;
          const volume_html = volume_by_doctype.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Volume & Avg Cycle Time (last 90 days)")}</h5>
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th>${__("DocType")}</th>
                                <th>${__("Completed")}</th>
                                <th>${__("Avg Days")}</th>
                                <th></th>
                            </tr></thead>
                            <tbody>
                            ${volume_by_doctype.map((v) => `
                                <tr>
                                    <td>${esc(v.doctype)}</td>
                                    <td>${v.count}</td>
                                    <td>${v.avg_days}</td>
                                    <td>
                                        <div class="ps-ai-bar-wrap">
                                            <div class="ps-ai-bar" style="width:${Math.min(100, v.avg_days * 5)}%"></div>
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                ` : "";
          const pending_html = longest_pending.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Longest Pending Approvals")}</h5>
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th>${__("Transaction")}</th>
                                <th>${__("#")}</th>
                                <th>${__("State")}</th>
                                <th>${__("Days Waiting")}</th>
                            </tr></thead>
                            <tbody>
                            ${longest_pending.map((a) => `
                                <tr>
                                    <td>${esc(a.doctype)}</td>
                                    <td><a href="${esc(a.doc_url)}" target="_blank">${esc(a.docname)}</a></td>
                                    <td><span class="ps-ai-state-badge">${esc(a.state)}</span></td>
                                    <td><span class="ps-ai-days-badge ${a.days > 30 ? "ps-ai-days-critical" : "ps-ai-days-warn"}">${a.days}</span></td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                ` : "";
          const approvers_html = top_approvers.length ? `
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Top Approvers (last 30 days)")}</h5>
                        <div class="ps-ai-approver-list">
                        ${top_approvers.map((a, i) => `
                            <div class="ps-ai-approver-row">
                                <span class="ps-ai-approver-rank">#${i + 1}</span>
                                <span class="ps-ai-approver-name">${esc(a.name)}</span>
                                <span class="ps-ai-approver-count">${a.count} ${__("approvals")}</span>
                                <div class="ps-ai-bar-wrap">
                                    <div class="ps-ai-bar ps-ai-bar-green" style="width:${Math.min(100, a.count / top_approvers[0].count * 100)}%"></div>
                                </div>
                            </div>
                        `).join("")}
                        </div>
                    </div>
                ` : "";
          $body.html(`
                    <div class="ps-ai-analytics-wrap">
                        ${summary_html}
                        ${volume_html}
                        ${pending_html}
                        ${approvers_html}
                    </div>
                `);
        },
        error: () => $body.html(`<div class="ps-ai-empty"><p>${__("Failed to load analytics.")}</p></div>`)
      });
    }
  };

  // ../permission_manager/permission_manager/public/js/components/workflow_diagram.js
  var WorkflowDiagram = class {
    constructor({ wrapper, workflow_name }) {
      this.$wrapper = $(wrapper);
      this.workflow_name = workflow_name;
      this._data = null;
    }
    load() {
      this.$wrapper.html(`<div class="ps-wfd-loading text-muted text-center py-5">
            ${frappe.utils.icon("refresh", "sm")} Loading diagram\u2026
        </div>`);
      frappe.call({
        method: "permission_manager.permission_manager.workflow.get_diagram_data",
        args: { workflow_name: this.workflow_name },
        callback: (r) => {
          if (r.message) {
            this._data = r.message;
            this._render();
          } else {
            this.$wrapper.html(`<div class="text-muted text-center py-5">No workflow data found.</div>`);
          }
        }
      });
    }
    _render() {
      const { states, transitions } = this._data;
      const layout = this._bfs_layout(states, transitions);
      const NODE_W = 140, NODE_H = 44, H_GAP = 80, V_GAP = 60;
      const PADDING = 40;
      let maxCol = 0, maxRow = 0;
      Object.values(layout).forEach(({ col, row }) => {
        if (col > maxCol)
          maxCol = col;
        if (row > maxRow)
          maxRow = row;
      });
      const svgW = (maxCol + 1) * (NODE_W + H_GAP) + PADDING * 2 - H_GAP;
      const svgH = (maxRow + 1) * (NODE_H + V_GAP) + PADDING * 2 - V_GAP;
      const centres = {};
      Object.entries(layout).forEach(([state, { col, row }]) => {
        centres[state] = {
          x: PADDING + col * (NODE_W + H_GAP),
          y: PADDING + row * (NODE_H + V_GAP)
        };
      });
      const SVG_NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("xmlns", SVG_NS);
      svg.setAttribute("width", svgW);
      svg.setAttribute("height", svgH);
      svg.setAttribute("class", "ps-wfd-svg");
      svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.innerHTML = `
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#5e72e4"/>
            </marker>
            <marker id="arrow-return" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#f5a623"/>
            </marker>
        `;
      svg.appendChild(defs);
      const edgeGroups = this._group_transitions(transitions);
      edgeGroups.forEach((edge) => {
        const from = centres[edge.from_state];
        const to = centres[edge.to_state];
        if (!from || !to)
          return;
        const isReturn = edge.is_return;
        const isSelf = edge.from_state === edge.to_state;
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", "ps-wfd-edge");
        let pathD;
        if (isSelf) {
          const cx = from.x + NODE_W / 2;
          const cy = from.y;
          pathD = `M ${cx - 20},${cy} C ${cx - 40},${cy - 60} ${cx + 40},${cy - 60} ${cx + 20},${cy}`;
        } else if (from.x === to.x) {
          pathD = `M ${from.x + NODE_W / 2},${from.y + NODE_H} L ${to.x + NODE_W / 2},${to.y}`;
        } else {
          const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
          const x2 = to.x, y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const curve_y = isReturn ? Math.max(y1, y2) + 40 : Math.min(y1, y2) - 30;
          pathD = `M ${x1},${y1} C ${mx},${curve_y} ${mx},${curve_y} ${x2},${y2}`;
        }
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", pathD);
        path.setAttribute("class", isReturn ? "ps-wfd-arrow ps-wfd-arrow--return" : "ps-wfd-arrow");
        path.setAttribute("marker-end", isReturn ? "url(#arrow-return)" : "url(#arrow)");
        g.appendChild(path);
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("class", "ps-wfd-edge-label");
        const actions_text = edge.actions.join(" / ");
        const midPt = path.getPointAtLength ? path.getPointAtLength(path.getTotalLength ? path.getTotalLength() / 2 : 50) : null;
        if (midPt) {
          label.setAttribute("x", midPt.x);
          label.setAttribute("y", midPt.y - 6);
        } else {
          label.setAttribute("x", (from.x + NODE_W + to.x) / 2);
          label.setAttribute("y", (from.y + to.y) / 2 + NODE_H / 2 - 6);
        }
        label.setAttribute("text-anchor", "middle");
        label.textContent = actions_text;
        g.appendChild(label);
        svg.appendChild(g);
      });
      states.forEach((st) => {
        const pos = centres[st.name];
        if (!pos)
          return;
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", `ps-wfd-node ps-wfd-node--${this._state_class(st)}`);
        g.setAttribute("transform", `translate(${pos.x},${pos.y})`);
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("width", NODE_W);
        rect.setAttribute("height", NODE_H);
        rect.setAttribute("rx", 8);
        g.appendChild(rect);
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", NODE_W / 2);
        text.setAttribute("y", NODE_H / 2 + 1);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("class", "ps-wfd-node-label");
        text.textContent = st.name;
        g.appendChild(text);
        if (st.doc_status) {
          const badge = document.createElementNS(SVG_NS, "text");
          badge.setAttribute("x", NODE_W - 6);
          badge.setAttribute("y", 10);
          badge.setAttribute("text-anchor", "end");
          badge.setAttribute("class", "ps-wfd-node-badge");
          badge.textContent = { "0": "Draft", "1": "Submitted", "2": "Cancelled" }[st.doc_status] || "";
          g.appendChild(badge);
        }
        svg.appendChild(g);
      });
      const legend = $(`<div class="ps-wfd-legend">
            <span class="ps-wfd-leg-item ps-wfd-leg--draft">Draft state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--submitted">Submitted state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--cancelled">Cancelled state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--other">Other state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--return">Return for correction</span>
        </div>`);
      this.$wrapper.empty().append($('<div class="ps-wfd-canvas">').append(svg)).append(legend);
    }
    _bfs_layout(states, transitions) {
      var _a;
      const children = {};
      const inDeg = {};
      states.forEach((s) => {
        children[s.name] = [];
        inDeg[s.name] = 0;
      });
      transitions.forEach((t) => {
        if (t.from_state !== t.to_state) {
          children[t.from_state] = children[t.from_state] || [];
          if (!children[t.from_state].includes(t.to_state)) {
            children[t.from_state].push(t.to_state);
          }
          inDeg[t.to_state] = (inDeg[t.to_state] || 0) + 1;
        }
      });
      const roots = states.map((s) => s.name).filter((n) => !inDeg[n]);
      if (!roots.length)
        roots.push((_a = states[0]) == null ? void 0 : _a.name);
      const layout = {};
      const queue = roots.map((r) => ({ name: r, col: 0 }));
      const rowCounts = {};
      const visited = /* @__PURE__ */ new Set();
      while (queue.length) {
        const { name, col } = queue.shift();
        if (visited.has(name))
          continue;
        visited.add(name);
        rowCounts[col] = rowCounts[col] || 0;
        layout[name] = { col, row: rowCounts[col]++ };
        (children[name] || []).forEach((child) => {
          if (!visited.has(child)) {
            queue.push({ name: child, col: col + 1 });
          }
        });
      }
      states.forEach((s) => {
        if (!layout[s.name]) {
          const col = Object.keys(rowCounts).length;
          rowCounts[col] = rowCounts[col] || 0;
          layout[s.name] = { col, row: rowCounts[col]++ };
        }
      });
      return layout;
    }
    _group_transitions(transitions) {
      const map = {};
      transitions.forEach((t) => {
        const key = `${t.from_state}|||${t.to_state}`;
        if (!map[key]) {
          map[key] = {
            from_state: t.from_state,
            to_state: t.to_state,
            actions: [],
            is_return: false
          };
        }
        if (t.action && !map[key].actions.includes(t.action))
          map[key].actions.push(t.action);
        if (t.is_return)
          map[key].is_return = true;
      });
      return Object.values(map);
    }
    _state_class(st) {
      const ds = String(st.doc_status);
      if (ds === "1")
        return "submitted";
      if (ds === "2")
        return "cancelled";
      if (ds === "0")
        return "draft";
      return "other";
    }
    show_dialog() {
      const d = new frappe.ui.Dialog({
        title: __("Workflow Diagram \u2014 {0}", [this.workflow_name]),
        size: "extra-large"
      });
      d.show();
      this.$wrapper = $(d.body);
      this.load();
    }
  };

  // ../permission_manager/permission_manager/public/js/permission_manager.bundle.js
  window.permission_manager_studio = window.permission_manager_studio || {};
  var PermissionStudio = class {
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
      this.$tabs = this.$wrapper.find(".ps-tabs");
      this.$search = this.$wrapper.find(".ps-search-bar");
      this.$content = this.$wrapper.find(".ps-content");
    }
    setup_tabs() {
      const tabs = [
        { key: "user", label: __("User View"), icon: "users" },
        { key: "doctype", label: __("DocType View"), icon: "list" },
        { key: "role", label: __("Role View"), icon: "tool" },
        { key: "profile", label: __("Profile View"), icon: "group" },
        { key: "accounts", label: __("Accounts"), icon: "bank" },
        { key: "lookup", label: __("Who Can?"), icon: "search" },
        { key: "compare", label: __("Compare"), icon: "compare" },
        { key: "dashboard", label: __("Health"), icon: "dashboard" },
        { key: "auditlog", label: __("Audit Log"), icon: "file" }
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
      if (tab_key === this.current_tab)
        return;
      this.current_tab = tab_key;
      this.$tabs.find(".ps-tab").removeClass("active");
      this.$tabs.find(`[data-tab="${tab_key}"]`).addClass("active");
      this.render_tab(tab_key);
    }
    render_tab(tab_key) {
      this.$search.empty();
      this.$content.empty();
      switch (tab_key) {
        case "user":
          this._render_user_tab();
          break;
        case "doctype":
          this._render_doctype_tab();
          break;
        case "role":
          this._render_role_tab();
          break;
        case "profile":
          this._render_profile_tab();
          break;
        case "accounts":
          this._render_accounts_tab();
          break;
        case "lookup":
          this._render_lookup_tab();
          break;
        case "compare":
          this._render_compare_tab();
          break;
        case "dashboard":
          this._render_dashboard_tab();
          break;
        case "auditlog":
          this._render_auditlog_tab();
          break;
      }
    }
    _render_user_tab() {
      var _a;
      this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-user-select"></div>
				<div class="ps-search-field" id="ps-module-filter"></div>
				<div class="ps-search-field" id="ps-dt-search"></div>
				<div class="ps-quick-tools-wrap" style="display:none;flex:0 0 auto;align-self:flex-end;">
					<button class="btn btn-sm btn-default ps-quick-tools-btn">
						\u26A1 ${__("Quick Tools")}
					</button>
				</div>
			</div>
		`);
      this.user_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "User",
          fieldname: "user",
          placeholder: __("Select User\u2026"),
          label: __("User"),
          change: () => {
            const user = this.user_field.get_value();
            if (user) {
              this._current_user = user;
              this.load_user_matrix(user);
            }
          }
        },
        parent: this.$search.find("#ps-user-select"),
        render_input: true
      });
      this.module_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "Module Def",
          fieldname: "module",
          placeholder: __("All Modules"),
          label: __("Module"),
          change: () => {
            if (this._current_user)
              this.load_user_matrix(this._current_user);
          }
        },
        parent: this.$search.find("#ps-module-filter"),
        render_input: true
      });
      this.search_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "DocType",
          fieldname: "dt_search",
          placeholder: __("Filter by DocType\u2026"),
          label: __("Search"),
          change: () => this._apply_dt_filter()
        },
        parent: this.$search.find("#ps-dt-search"),
        render_input: true
      });
      (_a = this.search_field.$input) == null ? void 0 : _a.on("input", () => this._apply_dt_filter());
      this.$content.html(this._welcome_html(
        frappe.utils.icon("users", "lg"),
        __("Select a User"),
        __("View permissions, test access, export, and manage restrictions for any user.")
      ));
    }
    _render_doctype_tab() {
      this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-doctype-select"></div>
			</div>
		`);
      this.doctype_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "DocType",
          fieldname: "doctype",
          placeholder: __("Select DocType\u2026"),
          label: __("DocType"),
          change: () => {
            const dt = this.doctype_field.get_value();
            if (dt) {
              this._current_doctype = dt;
              this.load_doctype_matrix(dt);
            }
          }
        },
        parent: this.$search.find("#ps-doctype-select"),
        render_input: true
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
    _render_role_tab() {
      this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-role-select"></div>
			</div>
		`);
      this.role_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "Role",
          fieldname: "role",
          placeholder: __("Select Role\u2026"),
          label: __("Role"),
          change: () => {
            const role = this.role_field.get_value();
            if (role) {
              this._current_role = role;
              this.load_role_matrix(role);
            }
          }
        },
        parent: this.$search.find("#ps-role-select"),
        render_input: true
      });
      this.$content.html(this._welcome_html(
        frappe.utils.icon("tool", "lg"),
        __("Select a Role"),
        __("View or edit permissions for a role, grouped by module.")
      ));
    }
    _render_lookup_tab() {
      this.components.lookup = new ReverseLookup({ wrapper: this.$content });
    }
    _render_compare_tab() {
      this.components.compare = new RoleComparison({ wrapper: this.$content });
    }
    _render_dashboard_tab() {
      this.components.dashboard = new HealthDashboard({ wrapper: this.$content });
    }
    _render_auditlog_tab() {
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
        render_input: true
      });
      const role_field = frappe.ui.form.make_control({
        parent: this.$search.find("#ps-al-role-field"),
        df: { fieldtype: "Data", label: __("Role"), placeholder: __("All Roles") },
        render_input: true
      });
      const _load = () => {
        this.$content.html(`<div class="ps-loading">${__("Loading audit log\u2026")}</div>`);
        frappe.call({
          method: "permission_manager.permission_manager.api.approvals.get_permission_audit_log",
          args: {
            doctype_name: dt_field.get_value() || "",
            role: role_field.get_value() || "",
            limit: 200
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
          }
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
    _apply_dt_filter() {
      var _a;
      const q = (((_a = this.search_field) == null ? void 0 : _a.get_value()) || "").toLowerCase();
      this.$content.find(".ps-matrix-row").each(function() {
        $(this).toggle(!q || ($(this).data("doctype") || "").toLowerCase().includes(q));
      });
    }
    load_user_matrix(user) {
      var _a;
      this.$content.html(this._show_skeleton(8));
      const module = ((_a = this.module_field) == null ? void 0 : _a.get_value()) || null;
      frappe.call({
        method: "permission_manager.permission_manager.api.matrix.get_user_matrix",
        args: { user, module },
        callback: (r) => {
          if (r.message) {
            this.$search.find(".ps-quick-tools-wrap").show();
            this.$search.find(".ps-quick-tools-btn").off("click").on("click", () => {
              this._show_quick_tools_dialog(user);
            });
            this.components.matrix = new MatrixView({
              wrapper: this.$content,
              data: r.message,
              mode: "user",
              on_why_click: (doctype, ptype) => this.show_why(user, doctype, ptype),
              on_restrictions_click: () => this.show_restrictions(user),
              on_edit_doctype: (doctype) => this._open_doctype_edit_dialog(doctype),
              on_export: (type, id) => this._export_csv(type, id),
              on_simulate: (u) => showUserSimulation(u)
            });
            this._inject_override_button(user);
          }
        },
        error: () => {
          this.$content.html(
            this._error_html(__("Failed to load permission matrix."), () => this.load_user_matrix(user))
          );
        }
      });
    }
    _inject_override_button(user) {
      frappe.call({
        method: "permission_manager.permission_manager.api.user_profile.get_user_override_status",
        args: { user },
        callback: (r) => {
          if (!r.message)
            return;
          const status = r.message;
          const $actions = this.$content.find(".ps-header-actions").first();
          const $acct_btn = $(`
					<button class="btn btn-xs btn-default ps-acct-restrict-btn">
						${frappe.utils.icon("account", "xs")} ${__("Account Restrictions")}
					</button>
				`);
          $acct_btn.on("click", () => this._show_account_restrictions_dialog(user));
          $actions.prepend($acct_btn);
          const is_active = status.is_active;
          const $btn = $(`
					<button class="btn btn-xs ${is_active ? "btn-warning" : "btn-default"} ps-override-btn">
						${frappe.utils.icon("lock", "xs")}
						${is_active ? `\u26A1 ${__("Override Active")}` : __("Override for User")}
					</button>
				`);
          $btn.on("click", () => this._show_user_override_dialog(user, status));
          $actions.prepend($btn);
        }
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
              wrapper: this.$content,
              data: r.message,
              mode: "doctype",
              on_reload: () => this.load_doctype_matrix(doctype),
              on_export: (type, id) => this._export_csv(type, id),
              on_bulk_apply: () => this._show_bulk_apply_dialog(doctype)
            });
            this.components.matrix = view;
            if (enter_edit_mode)
              view._toggle_edit_mode();
          }
        },
        error: () => {
          this.$content.html(
            this._error_html(__("Failed to load DocType permissions."), () => this.load_doctype_matrix(doctype))
          );
        }
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
              wrapper: this.$content,
              data: r.message,
              on_export: () => this._export_csv("role", role)
            });
          }
        },
        error: () => {
          this.$content.html(
            this._error_html(__("Failed to load role permissions."), () => this.load_role_matrix(role))
          );
        }
      });
    }
    _render_accounts_tab() {
      this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-acctab-user-select"></div>
			</div>
		`);
      this.acctab_user_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "User",
          fieldname: "acctab_user",
          placeholder: __("Select User\u2026"),
          label: __("User"),
          change: () => {
            const user = this.acctab_user_field.get_value();
            if (user) {
              this._current_acctab_user = user;
              this._load_user_accounts(user);
            }
          }
        },
        parent: this.$search.find("#ps-acctab-user-select"),
        render_input: true
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
          if (r.message)
            this._render_account_dnd(user, r.message);
        },
        error: () => {
          this.$content.html(
            this._error_html(__("Failed to load accounts."), () => this._load_user_accounts(user))
          );
        }
      });
    }
    _render_account_dnd(user, data) {
      const restricted_map = {};
      for (const r of data.restrictions)
        restricted_map[r.for_value] = r;
      const available = data.all_accounts.filter((a) => !restricted_map[a.name]);
      const _coa_html = (accounts) => {
        if (!accounts.length)
          return `<div class="ps-ac-zone-empty">${__("No accounts available.")}</div>`;
        const ROOT_ORDER = ["Asset", "Liability", "Income", "Expense", "Equity"];
        const ROOT_ICON = { Asset: "\u{1F4CA}", Liability: "\u{1F4CB}", Income: "\u{1F4C8}", Expense: "\u{1F4C9}", Equity: "\u2696\uFE0F" };
        const name_map = {};
        accounts.forEach((a) => {
          name_map[a.name] = __spreadProps(__spreadValues({}, a), { children: [] });
        });
        const root_nodes = [];
        accounts.forEach((a) => {
          const node = name_map[a.name];
          if (a.parent_account && name_map[a.parent_account]) {
            name_map[a.parent_account].children.push(node);
          } else {
            root_nodes.push(node);
          }
        });
        const count_leaves = (node) => {
          if (!node.is_group)
            return 1;
          return node.children.reduce((s, c) => s + count_leaves(c), 0);
        };
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
							<span class="ps-ac-folder-icon">\u25B6</span>
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
        const companies2 = [...new Set(accounts.map((a) => a.company || ""))].sort();
        let html = "";
        companies2.forEach((co) => {
          const co_tops = root_nodes.filter((n) => (n.company || "") === co);
          const roots = [...new Set(accounts.filter((a) => (a.company || "") === co).map((a) => a.root_type || "Other"))];
          const sorted_roots = [...ROOT_ORDER.filter((r) => roots.includes(r)), ...roots.filter((r) => !ROOT_ORDER.includes(r))];
          html += `<div class="ps-ac-company-block" data-company="${esc(co)}">
					<div class="ps-ac-company-hdr">${frappe.utils.icon("building", "xs")} ${esc(co)}</div>`;
          sorted_roots.forEach((root) => {
            const root_tops = co_tops.filter((n) => (n.root_type || "Other") === root);
            html += `<div class="ps-ac-root-block" data-root="${esc(root)}">
						<div class="ps-ac-root-hdr">${ROOT_ICON[root] || "\u{1F4C1}"} ${esc(root)}</div>
						${root_tops.map(render_node).join("")}
					</div>`;
          });
          html += `</div>`;
        });
        return html;
      };
      const restricted_html = data.restrictions.map((r) => {
        const label = r.for_value.includes(" - ") ? r.for_value.split(" - ")[0] : r.for_value;
        return `<div class="ps-ac-chip ps-ac-restricted" draggable="true"
						data-account="${esc(r.for_value)}"
						data-perm-name="${esc(r.name)}"
						data-source="restricted"
						title="${esc(r.for_value)}">
						<span class="ps-ac-chip-label">${esc(label)}</span>
						<button class="ps-ac-chip-x btn-naked" data-perm-name="${esc(r.name)}" title="${__("Remove")}">\u2715</button>
					</div>`;
      }).join("");
      const restricted_zone_content = data.is_restricted ? `<div class="ps-ac-restricted-chips">${restricted_html}</div>` : `<div class="ps-ac-zone-unrestricted">
				${frappe.utils.icon("tick-circle", "sm")}
				<span>${__("No restrictions \u2014 user has access to all accounts.")}</span>
				<small>${__("Drag accounts here to restrict.")}</small>
			   </div>`;
      const companies = [...new Set(available.map((a) => a.company || ""))].sort();
      const co_notice = (data.company_restrictions || []).length ? `<span class="ps-ac-co-notice">\u{1F512} ${__("Filtered to {0} company restriction(s)", [data.company_restrictions.length])}</span>` : "";
      this.$content.html(`
			<div class="ps-accounts-dnd">

				<div class="ps-ac-topbar">
					<div class="ps-ac-topbar-left">
						<span class="ps-ac-user-badge">${esc(user)}</span>
						<span class="ps-ac-status-badge ${data.is_restricted ? "ps-ac-status-restricted" : "ps-ac-status-open"}">
							${data.is_restricted ? `\u{1F512} ${__("{0} restricted", [data.restrictions.length])}` : `\u2713 ${__("All accounts open")}`}
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
					<input class="form-control ps-ac-search" placeholder="${__("Search accounts\u2026")}" type="text" autocomplete="off" />
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
								<button class="btn btn-xs btn-default ps-ac-expand-all-btn" title="${__("Expand All")}">\u229E ${__("Expand")}</button>
								<button class="btn btn-xs btn-default ps-ac-collapse-all-btn" title="${__("Collapse All")}">\u229F ${__("Collapse")}</button>
							</div>
							<span class="ps-ac-panel-hint">${__("drag \u2192 to restrict")}</span>
						</div>
						<div class="ps-drop-zone ps-ac-avail-zone ps-ac-scroll" data-target="available">
							<div class="ps-ac-avail-inner">${_coa_html(available)}</div>
						</div>
					</div>

					<div class="ps-ac-arrow">\u21C4</div>

					<div class="ps-ac-panel">
						<div class="ps-ac-panel-header">
							${frappe.utils.icon("lock", "xs")}
							<strong>${__("Restricted To")}</strong>
							<span class="ps-ac-panel-hint">${__("drag \u2190 to unrestrict")}</span>
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
      $c.off("click.ps-folder");
      $c.on("click.ps-folder", ".ps-ac-folder-hdr", function() {
        const $hdr = $(this);
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
      const _refresh_tree = () => {
        const q = ($c.find(".ps-ac-search").val() || "").trim().toLowerCase();
        const co = $c.find(".ps-ac-company-sel").val() || "";
        $c.find(".ps-ac-company-block").each(function() {
          $(this).toggle(!co || $(this).attr("data-company") === co);
        });
        if (!q) {
          $c.find(".ps-ac-root-block, .ps-ac-folder-row, .ps-ac-chip.ps-ac-avail").show();
          $c.find(".ps-ac-folder-hdr").each(function() {
            const $body = $(this).next(".ps-ac-folder-body");
            if ($(this).hasClass("ps-ac-expanded"))
              $body.show();
            else
              $body.hide();
          });
          return;
        }
        $c.find(".ps-ac-folder-body").show();
        $c.find(".ps-ac-folder-row").show();
        $c.find(".ps-ac-chip.ps-ac-avail").each(function() {
          const s = ($(this).attr("data-search") || "").toLowerCase();
          $(this).toggle(s.includes(q));
        });
        $c.find(".ps-ac-folder-row").get().reverse().forEach((row) => {
          const has_visible = $(row).find(".ps-ac-chip.ps-ac-avail:visible").length > 0;
          $(row).toggle(has_visible);
        });
        $c.find(".ps-ac-root-block").each(function() {
          $(this).toggle($(this).find(".ps-ac-chip.ps-ac-avail:visible").length > 0);
        });
      };
      $c.find(".ps-ac-search").on("input", _refresh_tree);
      $c.find(".ps-ac-company-sel").on("change", _refresh_tree);
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
              }
            });
          }
        );
      });
      $c.find(".ps-ac-chip-x").on("click", (e) => {
        e.stopPropagation();
        const perm_name = $(e.currentTarget).data("permName");
        this._do_remove_account_restriction(user, perm_name);
      });
      const _make_draggable = (selector) => {
        $c.find(selector).each(function() {
          const chip = this;
          chip.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("account", chip.getAttribute("data-account") || "");
            e.dataTransfer.setData("source", chip.getAttribute("data-source") || "");
            e.dataTransfer.setData("permname", chip.getAttribute("data-perm-name") || "");
            setTimeout(() => chip.classList.add("ps-chip-dragging"), 0);
          });
          chip.addEventListener("dragend", () => {
            chip.classList.remove("ps-chip-dragging");
          });
        });
      };
      _make_draggable(".ps-ac-chip.ps-ac-avail");
      _make_draggable(".ps-ac-chip.ps-ac-restricted");
      const _make_droppable = (selector) => {
        const el = $c.find(selector)[0];
        if (!el)
          return;
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
          const account = e.dataTransfer.getData("account");
          const source = e.dataTransfer.getData("source");
          const permName = e.dataTransfer.getData("permname");
          const target = el.getAttribute("data-target");
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
        args: { user, account },
        callback: (r) => {
          var _a;
          if ((_a = r.message) == null ? void 0 : _a.success) {
            frappe.show_alert({ message: __("{0} restricted.", [account]), indicator: "orange" });
            this._load_user_accounts(user);
          }
        }
      });
    }
    _do_remove_account_restriction(user, perm_name) {
      frappe.call({
        method: "permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",
        args: { perm_name },
        callback: (r) => {
          var _a;
          if ((_a = r.message) == null ? void 0 : _a.success) {
            frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
            this._load_user_accounts(user);
          }
        }
      });
    }
    _render_profile_tab() {
      this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-profile-select"></div>
			</div>
		`);
      this.profile_field = frappe.ui.form.make_control({
        df: {
          fieldtype: "Link",
          options: "Role Profile",
          fieldname: "profile",
          placeholder: __("Select Role Profile\u2026"),
          label: __("Role Profile"),
          change: () => {
            const profile = this.profile_field.get_value();
            if (profile) {
              this._current_profile = profile;
              this.load_profile_matrix(profile);
            }
          }
        },
        parent: this.$search.find("#ps-profile-select"),
        render_input: true
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
              wrapper: this.$content,
              data: r.message,
              on_export: (p) => this._export_profile_csv(p)
            });
          }
        },
        error: () => {
          this.$content.html(
            this._error_html(__("Failed to load profile matrix."), () => this.load_profile_matrix(profile))
          );
        }
      });
    }
    _export_profile_csv(profile) {
      frappe.dom.freeze(__("Generating CSV\u2026"));
      frappe.call({
        method: "permission_manager.permission_manager.api.user_profile.get_role_profile_matrix",
        args: { profile },
        callback: (r) => {
          frappe.dom.unfreeze();
          if (!r.message)
            return;
          const d = r.message;
          const rows = [
            ["Role Profile", d.profile],
            ["Roles", d.roles.join(", ")],
            ["User Count", d.user_count],
            [],
            ["Module", "DocType", "Source", ...MATRIX_RIGHTS]
          ];
          for (const mod of d.modules) {
            for (const dt of mod.doctypes) {
              rows.push([
                mod.module,
                dt.doctype,
                dt.source,
                ...MATRIX_RIGHTS.map((r2) => {
                  const v = dt.permissions[r2];
                  return v === "na" ? "N/A" : v ? "1" : "0";
                })
              ]);
            }
          }
          const csv = rows.map((r2) => r2.map((c) => `"${String(c != null ? c : "").replace(/"/g, '""')}"`).join(",")).join("\n");
          const safe = profile.replace(/[^a-z0-9]/gi, "_");
          _download_csv_raw(csv, `permissions_profile_${safe}.csv`);
          frappe.show_alert({ message: __("CSV downloaded."), indicator: "green" });
        },
        error: () => {
          frappe.dom.unfreeze();
          frappe.show_alert({ message: __("Export failed."), indicator: "red" });
        }
      });
    }
    _show_user_override_dialog(user, status) {
      const is_active = status.is_active;
      const dlg = new frappe.ui.Dialog({
        title: __("Override Permissions \u2014 {0}", [user]),
        size: "extra-large",
        fields: [
          { fieldtype: "HTML", fieldname: "status_html" },
          { fieldtype: "HTML", fieldname: "editor_html" }
        ]
      });
      const $status = dlg.fields_dict.status_html.$wrapper;
      const $editor = dlg.fields_dict.editor_html.$wrapper;
      const saved_items = status.override_permissions || [];
      if (is_active) {
        const dt_chips = saved_items.map((item) => {
          var _a;
          const rights = MATRIX_RIGHTS.filter((r) => {
            var _a2;
            return (_a2 = item.permissions) == null ? void 0 : _a2[r];
          }).join(", ");
          const is_owner = (_a = item.permissions) == null ? void 0 : _a.if_owner;
          const rights_label = (rights || "\u2014") + (is_owner ? " \u2605" : "");
          return `<span class="ps-oe-cur-chip" title="${esc(rights_label)}${is_owner ? " \u2014 " + __("Only If Creator") : ""}">
					${esc(item.doctype)}
					<em class="ps-oe-cur-rights">${esc(rights_label)}</em>
				</span>`;
        }).join("");
        $status.html(`
				<div class="ps-override-status-section">
					<div class="ps-override-active-banner">
						${frappe.utils.icon("tick-circle", "sm")}
						<strong>${__("Override Active")}</strong>
						&nbsp;\u2014&nbsp; ${__("Profile")}: <code>${esc(status.profile_name)}</code>
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
              frappe.dom.freeze(__("Removing override\u2026"));
              frappe.call({
                method: "permission_manager.permission_manager.api.user_profile.remove_user_override",
                args: { user },
                callback: (r) => {
                  var _a;
                  frappe.dom.unfreeze();
                  frappe.show_alert({ message: ((_a = r.message) == null ? void 0 : _a.msg) || __("Override removed."), indicator: "green" });
                  dlg.hide();
                  this.load_user_matrix(user);
                },
                error: () => frappe.dom.unfreeze()
              });
            }
          );
        });
      } else {
        $status.html(`
				<div class="ps-override-status-section">
					<div class="ps-oe-mode-hint">
						<span class="ps-mode-hint-restrict">
							${__("A full permission snapshot is taken for this user. For each DocType you add, they will have EXACTLY the permissions you check \u2014 original roles are replaced so nothing can win them back. All other DocTypes stay as-is.")}
						</span>
					</div>
				</div>
			`);
      }
      const initial_rows = saved_items.map((item) => ({
        doctype: item.doctype,
        permissions: item.permissions || {}
      }));
      this._render_override_editor($editor, initial_rows);
      dlg.set_primary_action(__("Apply Override"), () => {
        const rows = this._collect_override_rows($editor);
        if (!rows.length) {
          frappe.show_alert({ message: __("Add at least one DocType row."), indicator: "orange" });
          return;
        }
        dlg.hide();
        frappe.dom.freeze(__("Snapshotting permissions and applying override\u2026"));
        frappe.call({
          method: "permission_manager.permission_manager.api.user_profile.create_user_override",
          args: { user, override_items: JSON.stringify(rows), mode: "restrict" },
          callback: (r) => {
            var _a;
            frappe.dom.unfreeze();
            if ((_a = r.message) == null ? void 0 : _a.success) {
              frappe.show_alert({ message: r.message.msg, indicator: "green" });
              frappe.msgprint({
                title: __("Override Applied"),
                message: `
								<b>${__("Role")}:</b> <code>${esc(r.message.role_name)}</code><br>
								<b>${__("Profile")}:</b> <code>${esc(r.message.profile_name)}</code><br>
								<b>${__("Roles in profile")}:</b> ${(r.message.roles_included || []).map(esc).join(", ")}
							`,
                indicator: "green"
              });
              this.load_user_matrix(user);
            }
          },
          error: () => frappe.dom.unfreeze()
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
							\u{1F517} ${__("Suggest dependencies")}
						</button>
						<span class="ps-oe-row-count"></span>
					</div>
				</div>
				<div class="ps-oe-search-wrap">
					<div class="ps-oe-search-icon">${frappe.utils.icon("search", "xs")}</div>
					<input class="form-control ps-oe-dt-search"
						placeholder="${__("Filter rows or type to add a new DocType\u2026")}"
						type="text" autocomplete="off" />
					<ul class="ps-oe-suggestions"></ul>
				</div>
				<div class="ps-oe-table-wrap">
					<table class="ps-matrix-table ps-oe-table">
						<thead>
							<tr>
								<th class="ps-oe-dt-col">${__("DocType")}</th>
								<th class="ps-oe-perm-col ps-oe-owner-col" title="${__("Only If Creator \u2014 permissions apply only to documents this user owns")}">Own</th>
								${cols_html}
								<th></th>
							</tr>
						</thead>
						<tbody class="ps-oe-tbody"></tbody>
					</table>
				</div>
				<div class="ps-oe-empty" style="${initial_rows.length ? "display:none;" : ""}">
					<em>${__("No rows yet \u2014 type a DocType name above to add one.")}</em>
				</div>
			</div>
		`);
      const $tbody = $editor.find(".ps-oe-tbody");
      const $search = $editor.find(".ps-oe-dt-search");
      const $suggestions = $editor.find(".ps-oe-suggestions");
      const $row_count = $editor.find(".ps-oe-row-count");
      const _update_count = () => {
        const total = $tbody.find("tr").length;
        const visible = $tbody.find("tr:visible").length;
        if (!total) {
          $row_count.text("");
          return;
        }
        $row_count.text(
          visible < total ? __("{0} / {1} DocType(s)", [visible, total]) : __("{0} DocType(s)", [total])
        );
      };
      const _add_row = (doctype, permissions = {}) => {
        var _a;
        if (!doctype)
          return;
        if ($tbody.find(`tr[data-doctype="${doctype}"]`).length) {
          const $existing = $tbody.find(`tr[data-doctype="${doctype}"]`);
          (_a = $existing[0]) == null ? void 0 : _a.scrollIntoView({ behavior: "smooth", block: "center" });
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
          if (!$tbody.find("tr").length)
            $editor.find(".ps-oe-empty").show();
          _update_count();
        });
        $editor.find(".ps-oe-empty").hide();
        _update_count();
      };
      let _timer = null;
      const _refresh_suggestions = (q) => {
        if (!q) {
          $suggestions.empty().hide();
          return;
        }
        clearTimeout(_timer);
        _timer = setTimeout(() => {
          const added = new Set(
            $tbody.find("tr").map((_, r) => $(r).attr("data-doctype")).get()
          );
          frappe.call({
            method: "frappe.client.get_list",
            args: {
              doctype: "DocType",
              filters: [["name", "like", `%${q}%`], ["istable", "=", 0]],
              fields: ["name"],
              limit: 10,
              order_by: "name asc"
            },
            callback: (r) => {
              $suggestions.empty();
              const fresh = (r.message || []).filter((dt) => !added.has(dt.name));
              if (!fresh.length) {
                $suggestions.hide();
                return;
              }
              fresh.forEach((dt) => {
                $(`<li class="ps-oe-sug-item">
								<span class="ps-sug-plus">+</span> ${esc(dt.name)}
							</li>`).on("mousedown", (e) => {
                  e.preventDefault();
                  _add_row(dt.name);
                  $search.val("").trigger("input");
                }).appendTo($suggestions);
              });
              $suggestions.show();
            }
          });
        }, 200);
      };
      $search.on("input", function() {
        const q = $(this).val().trim();
        $tbody.find("tr").each(function() {
          const dt = $(this).attr("data-doctype") || "";
          $(this).toggle(!q || dt.toLowerCase().includes(q.toLowerCase()));
        });
        $editor.find(".ps-oe-empty").toggle(!q && !$tbody.find("tr").length);
        _update_count();
        _refresh_suggestions(q);
      });
      $search.on("blur", () => setTimeout(() => $suggestions.hide(), 160));
      $search.on("focus", () => {
        if ($suggestions.children().length)
          $suggestions.show();
      });
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
      $editor.find(".ps-oe-deps-btn").on("click", () => {
        const create_dts = [];
        $tbody.find("tr").each(function() {
          const dt = $(this).attr("data-doctype");
          const has_create = $(this).find(".ps-oe-check[data-ptype='create']").is(":checked");
          if (dt && has_create)
            create_dts.push(dt);
        });
        if (!create_dts.length) {
          frappe.show_alert({ message: __("Check 'C' (Create) on at least one DocType first."), indicator: "orange" });
          return;
        }
        const $btn = $editor.find(".ps-oe-deps-btn").prop("disabled", true).text(__("Analyzing\u2026"));
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
                $btn.prop("disabled", false).html(`\u{1F517} ${__("Suggest dependencies")}`);
                frappe.show_alert({
                  message: total_added ? __("Added {0} linked DocType(s) with read access.", [total_added]) : __("All linked DocTypes already present."),
                  indicator: total_added ? "blue" : "green"
                });
              }
            },
            error: () => {
              pending--;
              if (pending === 0)
                $btn.prop("disabled", false).html(`\u{1F517} ${__("Suggest dependencies")}`);
            }
          });
        });
      });
    }
    _collect_override_rows($editor) {
      const rows = [];
      $editor.find(".ps-oe-tbody tr").each(function() {
        const dt = $(this).attr("data-doctype");
        if (!dt)
          return;
        const permissions = {};
        $(this).find(".ps-oe-check").each(function() {
          permissions[$(this).data("ptype")] = $(this).is(":checked") ? 1 : 0;
        });
        rows.push({ doctype: dt, permissions });
      });
      return rows;
    }
    _show_account_restrictions_dialog(user) {
      const dlg = new frappe.ui.Dialog({
        title: __("Account Restrictions \u2014 {0}", [user]),
        size: "large",
        fields: [{ fieldtype: "HTML", fieldname: "content_html" }]
      });
      const $w = dlg.fields_dict.content_html.$wrapper;
      $w.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`);
      const _reload = () => {
        frappe.call({
          method: "permission_manager.permission_manager.api.user_profile.get_user_account_restrictions",
          args: { user },
          callback: (r) => r.message && _render(r.message)
        });
      };
      const _render = (data) => {
        const has_restrictions = data.is_restricted;
        const restricted_set = new Set(data.restrictions.map((r) => r.for_value));
        const company_map = {};
        for (const acct of data.all_accounts) {
          const co = acct.company || "Other";
          company_map[co] = company_map[co] || [];
          company_map[co].push(acct);
        }
        const restriction_rows = has_restrictions ? data.restrictions.map((r) => `
					<div class="ps-ar-row">
						<span class="ps-badge ps-badge-custom">${esc(r.for_value)}</span>
						<button class="btn btn-xs btn-danger ps-ar-remove-btn" data-name="${esc(r.name)}">
							${frappe.utils.icon("delete", "xs")}
						</button>
					</div>
				`).join("") : `<div class="ps-ar-unrestricted">
					${frappe.utils.icon("tick-circle", "sm")}
					${__("No restrictions \u2014 user can access ALL accounts.")}
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
        const acct_ctl = frappe.ui.form.make_control({
          df: {
            fieldtype: "Link",
            options: "Account",
            fieldname: "account",
            placeholder: __("Select Account\u2026"),
            label: __("Account")
          },
          parent: $w.find("#ps-ar-acct-field"),
          render_input: true
        });
        $w.find(".ps-ar-company-filter").on("change", function() {
          const co = $(this).val();
          acct_ctl.df.get_query = co ? () => ({ filters: { company: co, disabled: 0 } }) : () => ({ filters: { disabled: 0 } });
          acct_ctl.set_value("");
        });
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
          frappe.dom.freeze(__("Adding restriction\u2026"));
          frappe.call({
            method: "permission_manager.permission_manager.api.user_profile.add_user_account_restriction",
            args: { user, account },
            callback: (r) => {
              var _a;
              frappe.dom.unfreeze();
              if ((_a = r.message) == null ? void 0 : _a.success) {
                frappe.show_alert({ message: __("Restriction added."), indicator: "green" });
                _reload();
              }
            },
            error: () => frappe.dom.unfreeze()
          });
        });
        $w.find(".ps-ar-remove-btn").on("click", (e) => {
          const name = $(e.currentTarget).data("name");
          frappe.dom.freeze(__("Removing\u2026"));
          frappe.call({
            method: "permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",
            args: { perm_name: name },
            callback: (r) => {
              var _a;
              frappe.dom.unfreeze();
              if ((_a = r.message) == null ? void 0 : _a.success) {
                frappe.show_alert({ message: __("Restriction removed."), indicator: "green" });
                _reload();
              }
            },
            error: () => frappe.dom.unfreeze()
          });
        });
        $w.find(".ps-ar-clear-btn").on("click", () => {
          frappe.confirm(
            __("Clear ALL account restrictions for {0}? The user will have access to all accounts.", [user]),
            () => {
              frappe.dom.freeze(__("Clearing\u2026"));
              frappe.call({
                method: "permission_manager.permission_manager.api.user_profile.clear_user_account_restrictions",
                args: { user },
                callback: (r) => {
                  frappe.dom.unfreeze();
                  frappe.show_alert({ message: __("All restrictions cleared."), indicator: "green" });
                  _reload();
                },
                error: () => frappe.dom.unfreeze()
              });
            }
          );
        });
      };
      dlg.set_primary_action(__("Close"), () => dlg.hide());
      dlg.show();
      _reload();
    }
    _show_quick_tools_dialog(user) {
      const dlg = new frappe.ui.Dialog({
        title: __("Quick Tools \u2014 {0}", [user]),
        size: "large",
        fields: [
          {
            fieldtype: "HTML",
            fieldname: "tools_html"
          }
        ]
      });
      const $w = dlg.fields_dict.tools_html.$wrapper;
      $w.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`);
      Promise.all([
        new Promise((res) => frappe.call({
          method: "permission_manager.permission_manager.api.quickfix.get_user_roles",
          args: { user },
          callback: (r) => res(r.message || [])
        })),
        new Promise((res) => frappe.call({
          method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
          args: { user },
          callback: (r) => res(r.message || [])
        }))
      ]).then(([roles, issues]) => {
        this._render_quick_tools($w, dlg, user, roles, issues);
      });
      dlg.show();
    }
    _render_quick_tools($w, dlg, user, roles, issues) {
      const severity_icon = { error: "\u{1F534}", warning: "\u{1F7E1}", info: "\u{1F535}" };
      const role_chips = roles.map((r) => `
			<span class="ps-role-chip ${r.is_custom ? "ps-role-custom" : ""}">
				${esc(r.role)}
				${r.is_custom ? `<span title="${__("Custom role")}">\u2605</span>` : ""}
			</span>
		`).join("");
      const issue_rows = issues.length ? issues.map((issue) => `
				<div class="ps-issue-row ps-issue-${issue.severity}">
					<span class="ps-issue-icon">${severity_icon[issue.severity] || "\u2139\uFE0F"}</span>
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
			`).join("") : `<div class="ps-issue-none">${__("\u2705 No issues found for this user.")}</div>`;
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
      $w.find(".ps-manage-roles-btn").on("click", () => {
        dlg.hide();
        this._show_manage_roles_dialog(user, roles);
      });
      $w.find(".ps-recheck-btn").on("click", () => {
        $w.html(`<div class="ps-loading">${__("Checking\u2026")}</div>`);
        frappe.call({
          method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
          args: { user },
          callback: (r) => this._render_quick_tools($w, dlg, user, roles, r.message || [])
        });
      });
      $w.find(".ps-fix-btn").on("click", (e) => {
        const fix_type = $(e.currentTarget).data("fix");
        const fix_data = JSON.parse($(e.currentTarget).attr("data-fix-data") || "{}");
        frappe.dom.freeze(__("Applying fix\u2026"));
        frappe.call({
          method: "permission_manager.permission_manager.api.quickfix.apply_quick_fix",
          args: { user, fix_type, fix_data: JSON.stringify(fix_data) },
          callback: (r) => {
            var _a;
            frappe.dom.unfreeze();
            frappe.show_alert({ message: ((_a = r.message) == null ? void 0 : _a.msg) || __("Fix applied."), indicator: "green" });
            frappe.call({
              method: "permission_manager.permission_manager.api.quickfix.find_user_issues",
              args: { user },
              callback: (r2) => this._render_quick_tools($w, dlg, user, roles, r2.message || [])
            });
          },
          error: () => frappe.dom.unfreeze()
        });
      });
      $w.find(".ps-copy-roles-btn").on("click", () => {
        frappe.prompt(
          { fieldtype: "Link", options: "User", fieldname: "source_user", label: __("Copy Roles From"), reqd: 1 },
          (vals) => {
            frappe.dom.freeze(__("Copying roles\u2026"));
            frappe.call({
              method: "permission_manager.permission_manager.api.quickfix.copy_roles_from_user",
              args: { target_user: user, source_user: vals.source_user },
              callback: (r) => {
                var _a;
                frappe.dom.unfreeze();
                frappe.show_alert({ message: ((_a = r.message) == null ? void 0 : _a.msg) || __("Roles copied."), indicator: "green" });
                dlg.hide();
                this.load_user_matrix(user);
              },
              error: () => frappe.dom.unfreeze()
            });
          },
          __("Copy Roles From User"),
          __("Copy")
        );
      });
      $w.find(".ps-clear-custom-btn").on("click", () => {
        frappe.confirm(
          __("Remove all Custom DocPerms for <b>{0}</b>? This resets them to standard role-based permissions.", [user]),
          () => {
            frappe.dom.freeze(__("Clearing\u2026"));
            frappe.call({
              method: "permission_manager.permission_manager.api.quickfix.clear_custom_perms_for_user",
              args: { user },
              callback: (r) => {
                var _a;
                frappe.dom.unfreeze();
                frappe.show_alert({ message: ((_a = r.message) == null ? void 0 : _a.msg) || __("Done."), indicator: "green" });
                dlg.hide();
                this.load_user_matrix(user);
              },
              error: () => frappe.dom.unfreeze()
            });
          }
        );
      });
    }
    _show_manage_roles_dialog(user, current_roles) {
      const current_role_names = new Set(current_roles.map((r) => r.role));
      const dlg = new frappe.ui.Dialog({
        title: __("Manage Roles \u2014 {0}", [user]),
        fields: [
          {
            fieldtype: "Link",
            fieldname: "add_role",
            options: "Role",
            label: __("Add Role"),
            description: __("Type and select a role to add")
          },
          {
            fieldtype: "HTML",
            fieldname: "current_roles_html"
          }
        ],
        primary_action_label: __("Close"),
        primary_action: () => dlg.hide()
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
              var _a;
              if ((_a = r.message) == null ? void 0 : _a.success) {
                current_role_names.delete(role);
                _refresh_roles();
                frappe.show_alert({ message: __("Role removed."), indicator: "orange" });
              }
            }
          });
        });
      };
      dlg.fields_dict.add_role.df.change = () => {
        const role = dlg.get_value("add_role");
        if (!role || current_role_names.has(role))
          return;
        frappe.call({
          method: "permission_manager.permission_manager.api.quickfix.update_user_roles",
          args: { user, add_roles: JSON.stringify([role]), remove_roles: "[]" },
          callback: (r) => {
            var _a;
            if ((_a = r.message) == null ? void 0 : _a.success) {
              current_role_names.add(role);
              dlg.set_value("add_role", "");
              _refresh_roles();
              frappe.show_alert({ message: __("Role added."), indicator: "green" });
            }
          }
        });
      };
      _refresh_roles();
      dlg.show();
    }
    _open_doctype_edit_dialog(doctype) {
      const dialog = new frappe.ui.Dialog({
        title: __("Edit Permissions \u2014 {0}", [doctype]),
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "dt_matrix_html" }]
      });
      const $w = dialog.fields_dict.dt_matrix_html.$wrapper;
      $w.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`);
      frappe.call({
        method: "permission_manager.permission_manager.api.matrix.get_doctype_matrix",
        args: { doctype },
        callback: (r) => {
          if (!r.message)
            return;
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
                  callback: (r2) => r2.message && _make_view(r2.message)
                });
              },
              on_export: (t, id) => this._export_csv(t, id)
            });
            v._toggle_edit_mode();
          };
          _make_view(r.message);
        }
      });
      dialog.show();
    }
    _show_bulk_apply_dialog(current_doctype) {
      const PERMS = MATRIX_RIGHTS;
      const perm_fields = PERMS.map((r) => ({
        fieldtype: "Check",
        fieldname: `perm_${r}`,
        label: RIGHT_FULL_LABELS[r] || r,
        default: 0
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
					</div>`
          },
          {
            fieldtype: "Link",
            fieldname: "role",
            label: __("Role"),
            options: "Role",
            reqd: 1
          },
          {
            fieldtype: "Section Break",
            label: __("Permissions to Apply")
          },
          ...perm_fields,
          {
            fieldtype: "Check",
            fieldname: "perm_if_owner",
            label: __("Only If Creator"),
            description: __("When checked, all above permissions apply only to documents owned/created by this user"),
            default: 0
          },
          {
            fieldtype: "Section Break",
            label: __("Target DocTypes")
          },
          {
            fieldtype: "Small Text",
            fieldname: "doctypes_text",
            label: __("DocType List"),
            reqd: 1,
            description: __("One DocType per line. Current DocType is pre-filled."),
            default: current_doctype
          }
        ],
        primary_action_label: __("Apply to All"),
        primary_action: (vals) => {
          const doctypes = (vals.doctypes_text || "").split("\n").map((s) => s.trim()).filter(Boolean);
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
          frappe.dom.freeze(__("Applying permissions\u2026"));
          frappe.call({
            method: "permission_manager.permission_manager.api.lookup.bulk_apply_role_permissions",
            args: {
              doctypes: JSON.stringify(doctypes),
              role: vals.role,
              permissions: JSON.stringify(permissions)
            },
            callback: (r) => {
              var _a, _b, _c;
              frappe.dom.unfreeze();
              const res = r.message || {};
              if ((_a = res.success) == null ? void 0 : _a.length) {
                frappe.show_alert({
                  message: __("{0} DocTypes updated.", [res.success.length]),
                  indicator: "green"
                });
              }
              if ((_b = res.failed) == null ? void 0 : _b.length) {
                frappe.msgprint({
                  title: __("Some DocTypes Failed"),
                  indicator: "red",
                  message: res.failed.map((f) => `<b>${esc(f.doctype)}</b>: ${esc(f.error)}`).join("<br>")
                });
              }
              if ((_c = res.success) == null ? void 0 : _c.includes(current_doctype)) {
                this.load_doctype_matrix(current_doctype);
              }
            },
            error: () => frappe.dom.unfreeze()
          });
        }
      });
      dlg.show();
    }
    _export_csv(data_type, identifier) {
      frappe.dom.freeze(__("Generating CSV\u2026"));
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
        }
      });
    }
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
      setTimeout(() => {
        $(`#${id}`).on("click", retry_fn);
      }, 0);
      return `<div class="ps-error-state">
			<div class="ps-error-icon">${frappe.utils.icon("error", "lg")}</div>
			<div class="ps-error-msg">${msg}</div>
			<button id="${id}" class="btn btn-sm btn-default">
				${frappe.utils.icon("refresh", "xs")} ${__("Retry")}
			</button>
		</div>`;
    }
    on_show() {
    }
  };
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
    esc
  });
  window.pm_approval_inbox = { ApprovalInbox };
})();
//# sourceMappingURL=permission_manager.bundle.T5CODZTN.js.map
