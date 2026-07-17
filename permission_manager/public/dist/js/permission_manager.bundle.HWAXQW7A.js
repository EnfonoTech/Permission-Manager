(()=>{var be=Object.defineProperty,$e=Object.defineProperties;var ye=Object.getOwnPropertyDescriptors;var te=Object.getOwnPropertySymbols;var we=Object.prototype.hasOwnProperty,ke=Object.prototype.propertyIsEnumerable;var ae=(p,e,s)=>e in p?be(p,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):p[e]=s,ie=(p,e)=>{for(var s in e||(e={}))we.call(e,s)&&ae(p,s,e[s]);if(te)for(var s of te(e))ke.call(e,s)&&ae(p,s,e[s]);return p},oe=(p,e)=>$e(p,ye(e));$(document).on("form-refresh",function(p,e){if(!(!e||!e.doctype)&&!e.doc.__islocal)try{frappe.call({method:"permission_manager.permission_manager.workflow.get_workflow_info",args:{doc:e.doc},callback(s){var o,r;if(!((o=s==null?void 0:s.message)!=null&&o.workflow)&&!((r=s==null?void 0:s.message)!=null&&r.current_state))return;let a=s.message.workflow,t=s.message.workflow.name,i=s.message.current_state;s.message.allow_edit||e.set_read_only(!0),t&&(e.page.clear_primary_action(),a.override_status||Se(e,i,a.workflow_state_field),xe(e,a,i),Te(e))}})}catch(s){console.error("Permission Manager: Error initialising PM Workflow:",s)}});function re(p){let e=["Section Break","Column Break","Tab Break","HTML","Heading","Fold","Button"],s=["name","owner","modified_by","creation","modified","docstatus","idx"],a=[];return(p.fields||[]).forEach(t=>{let i=t&&t.df;if(!i||!i.reqd||e.includes(i.fieldtype)||s.includes(i.fieldname)||i.hidden||i.read_only||t.disp_status==="None")return;let o=p.doc[i.fieldname];(o==null||o==="")&&a.push(__(i.label||i.fieldname))}),a.length?(frappe.msgprint({title:__("Mandatory Fields Required"),message:__("Please fill in the following required fields:")+"<br><ul><li>"+a.join("</li><li>")+"</li></ul>",indicator:"red"}),!1):!0}function xe(p,e,s){frappe.call({method:"permission_manager.permission_manager.workflow.get_transitions",args:{doc:p.doc,workflow:e.name,current_state:s},callback(a){let t=a.message||[];p.page.clear_actions_menu(),p._pm_transitions=t,t.length&&(t.forEach(i=>{p.page.add_action_item(__(i.action),function(){p.selected_workflow_action=i.action,re(p)&&ne(p,i)})}),pe(p),Ae(p,t,s))}})}function Te(p){p.doc.docstatus===0&&frappe.call({method:"permission_manager.permission_manager.workflow.get_pending_workflow_action",args:{doctype:p.doctype,docname:p.doc.name},callback(e){let s=e.message;if(!s)return;let a=s.assigned_to,t=s.assigned_to_name||(a||"").split("@")[0],i=s.pending_roles||[],o=i.length?i.join(", "):t;if(o)if(p.$wrapper.find(".pm-approver-info").length)p.$wrapper.find(".pm-approver-name").text(o);else{let r=$(`
						<div class="pm-approver-info">
							${frappe.utils.icon("users","xs")}
							<span>${__("Pending approval from:")}</span>
							<strong class="pm-approver-name">${frappe.utils.escape_html(o)}</strong>
						</div>
					`);p.$wrapper.find(".page-head").after(r)}frappe.user.has_role(["System Manager","HR Manager"])&&(p.remove_custom_button(__("Reassign Approver")),p.add_custom_button(__("Reassign Approver"),()=>{Ce(p,s)},__("Workflow")))}})}function Ce(p,e){let s=new frappe.ui.Dialog({title:__("Reassign Approver"),fields:[{fieldtype:"HTML",fieldname:"current_info",options:e.assigned_to?`<div class="pm-reassign-current">
						<strong>${__("Current Approver")}:</strong>
						${frappe.utils.escape_html(e.assigned_to_name||e.assigned_to)}
					   </div>`:`<div class="pm-reassign-current">${__("Currently routed by role (no specific user assigned).")}</div>`},{fieldtype:"Link",fieldname:"new_approver",label:__("Reassign To"),options:"User",reqd:1,filters:{enabled:1},description:__("This user will receive the pending approval notification.")},{fieldtype:"Small Text",fieldname:"reason",label:__("Reason"),description:__("Optional. Added as a comment on the document.")}],primary_action_label:__("Reassign"),primary_action(a){s.hide(),frappe.call({method:"permission_manager.permission_manager.workflow.reassign_workflow_approver",args:{doctype:p.doctype,docname:p.doc.name,new_approver:a.new_approver,reason:a.reason||""},callback(t){var i;(i=t.message)!=null&&i.success&&(frappe.show_alert({message:__("Approver reassigned to {0}.",[a.new_approver]),indicator:"green"}),p.reload_doc())}})}});s.show()}function Ae(p,e,s){try{p.page.add_action_item(__("Workflow Help"),function(){let a=s||__("Unknown"),t=e.length?e.map(i=>`${i.action.bold()} (${i.allowed||__("matrix")})`).join(", "):__("None \u2014 End of Workflow").bold();new frappe.ui.Dialog({title:__("Workflow: {0}",[p.doctype]),fields:[{fieldtype:"HTML",fieldname:"info",options:`
							<p>${__("Current status")}: ${a.bold()}</p>
							<p>${__("Next actions")}: ${t}</p>
							<p>${__("Only authorised users can perform these transitions.")}</p>
						`}]}).show()})}catch(a){console.warn("Permission Manager: Failed to add Workflow Help action:",a)}}function Se(p,e,s){var a,t,i,o;try{let r=p.doc,l=p.doctype;if(!r||!l)return;let c=frappe.get_meta(l),d=c==null?void 0:c.is_submittable;if(r.__unsaved){(t=(a=p.page).set_indicator)==null||t.call(a,__("Not Saved"),"orange");return}if(e){frappe.call({method:"frappe.client.get_value",args:{doctype:"Workflow State",fieldname:"style",filters:{name:e}},callback(_){var f,u,y;let m={Success:"green",Warning:"orange",Danger:"red",Primary:"blue",Inverse:"black",Info:"light-blue"}[(f=_==null?void 0:_.message)==null?void 0:f.style]||"gray";(y=(u=p.page).set_indicator)==null||y.call(u,__(e),m,`${s},=,${e}`)}});return}if(d){let _={0:["Draft","red"],1:["Submitted","blue"],2:["Cancelled","red"]},[h,m]=_[r.docstatus]||["Unknown","gray"];(o=(i=p.page).set_indicator)==null||o.call(i,__(h),m,`docstatus,=,${r.docstatus}`)}}catch(r){console.warn("Permission Manager: Failed to override document status:",r)}}function ne(p,e){let s=!!e.require_comment,a=new frappe.ui.Dialog({title:__("Workflow Action: {0}",[e.action]),fields:[{fieldtype:"Select",fieldname:"priority",label:__("Priority"),options:["Low","Medium","High","Critical"].join(`
`),default:"Medium"},{fieldtype:"Small Text",fieldname:"comment",label:__("Comment"),reqd:s,description:s?__("A comment is required for this transition."):__("Optional")}],primary_action_label:__("Apply"),primary_action(t){if(s&&!t.comment){frappe.msgprint(__("Comment is required."));return}a.hide(),le(p,e.action,t.comment,t.priority)}});a.show()}function le(p,e,s,a){frappe.dom.freeze(),frappe.call({method:"permission_manager.permission_manager.workflow.apply_workflow",args:{doc:p.doc,action:e,comment:s||"",priority:a||"Medium"},callback(t){frappe.dom.unfreeze(),p._pm_pending_action=null,p.dashboard.clear_headline(),frappe.model.sync(t.message),p.refresh(),frappe.show_alert({message:__("Workflow action applied: {0}",[e]),indicator:"green"})},error(t){frappe.dom.unfreeze(),Re(t)&&(p._pm_pending_action={action:e,comment:s,priority:a},pe(p)),frappe.request.report_error(t,{})}})}function Re(p){try{let e=JSON.parse(p.responseText||"{}");return JSON.parse(e._server_messages||"[]").some(function(a){return(typeof a=="string"?a:a.message||"").toLowerCase().includes("attachment")})}catch(e){return!1}}function pe(p){let e=p.attachments;if(!e||typeof e.attachment_uploaded!="function"||e._pm_hooked)return;e._pm_hooked=!0;let s=e.attachment_uploaded.bind(e);e.attachment_uploaded=function(a){s(a),Le(p)}}function Le(p){if(p._pm_pending_action){De(p,p._pm_pending_action);return}let e=p._pm_transitions||[];e.length&&Ee(p,e)}function De(p,e){let s=__(e.action);p.dashboard.clear_headline(),p.dashboard.set_headline(`<span style="color:#dc3545;font-weight:bold">\u26A0</span>&nbsp;&nbsp;<strong>${__("File attached.")}</strong>&nbsp;${__("Click to continue:")}&nbsp;<button class="btn btn-xs btn-danger pm-wf-proceed-btn" style="margin-left:4px">${s} &rarr;</button>`,"red"),setTimeout(function(){p.$wrapper.find(".pm-wf-proceed-btn").off("click").on("click",function(){p._pm_pending_action=null,p.dashboard.clear_headline(),le(p,e.action,e.comment,e.priority)})},0)}function Ee(p,e){let s=frappe.utils.escape_html,a="";e.forEach(function(t,i){a+=`<button class="btn btn-xs btn-primary pm-wf-ann-btn" data-idx="${i}" style="margin-left:6px;margin-top:2px">${s(__(t.action))} &rarr;</button>`}),p.dashboard.clear_headline(),p.dashboard.set_headline(`<span style="font-size:15px">\u{1F4CE}</span>&nbsp;&nbsp;<strong>${__("File attached.")}</strong>&nbsp;${__("Don't forget to apply the next step:")}${a}`,"orange"),setTimeout(function(){p.$wrapper.find(".pm-wf-ann-btn").off("click").on("click",function(){let t=e[parseInt($(this).attr("data-idx"),10)];!t||(p.dashboard.clear_headline(),p.selected_workflow_action=t.action,re(p)&&ne(p,t))})},0)}var J=null;function _e(){try{var p=window.AudioContext||window.webkitAudioContext;return p?(J||(J=new p),J):null}catch(e){return null}}document.addEventListener("click",function(){try{var p=_e();p&&p.state==="suspended"&&p.resume()}catch(e){}});function ce(p){[[587.33,0],[739.99,.22]].forEach(function(e){var s=e[0],a=e[1],t=p.createOscillator(),i=p.createGain();t.connect(i),i.connect(p.destination),t.type="sine",t.frequency.value=s;var o=p.currentTime+a;i.gain.setValueAtTime(0,o),i.gain.linearRampToValueAtTime(.22,o+.015),i.gain.exponentialRampToValueAtTime(.001,o+.55),t.start(o),t.stop(o+.6)})}function Pe(){try{var p=_e();if(!p)return;p.state==="running"?ce(p):p.state==="suspended"&&p.resume().then(function(){ce(p)}).catch(function(){})}catch(e){}}function Oe(p,e){if("Notification"in window&&Notification.permission==="granted")try{var s=new Notification(p,{body:e,tag:"pm-approval",requireInteraction:!1});s.onclick=function(){window.focus(),frappe.set_route("pm-approval-inbox"),s.close()}}catch(a){}}var de=!1;function Ne(){if("Notification"in window&&Notification.permission==="default"&&!de){de=!0;try{Notification.requestPermission()}catch(p){}}}document.addEventListener("click",function(){Ne()},{once:!0});var F=function(){try{return new BroadcastChannel("pm_approval_notifications")}catch(p){return null}}();function he(p,e){var s=!e||e.alert!==!1;Pe(),s&&frappe.show_alert({message:__("New approval: {0} {1}",[p.doctype,p.docname]),indicator:"orange"},8),Oe(__("Approval Required"),p.subject||__("{0} {1} is waiting for your approval.",[p.doctype,p.docname]));var a=frappe.pages&&frappe.pages["pm-approval-inbox"];a&&a.approval_inbox&&a.approval_inbox.load()}F&&(F.onmessage=function(p){try{he(p.data,{alert:!1})}catch(e){}});(function p(e){try{if(frappe.realtime&&frappe.realtime.socket){frappe.realtime.on("pm_new_approval_action",function(s){try{F&&F.postMessage(s),he(s)}catch(a){}});return}}catch(s){}e<100&&setTimeout(function(){p(e+1)},300)})(0);var b=["select","read","write","create","delete","submit","cancel","amend","print","email","report","import","export","share"],S={select:"Se",read:"R",write:"W",create:"C",delete:"D",submit:"S",cancel:"X",amend:"A",print:"Pr",email:"Em",report:"Rp",import:"Im",export:"Ex",share:"Sh"},x={select:"Select",read:"Read",write:"Write",create:"Create",delete:"Delete",submit:"Submit",cancel:"Cancel",amend:"Amend",print:"Print",email:"Email",report:"Report",import:"Import",export:"Export",share:"Share"},B={allow:"\u2713",deny:"\u2717",cond:"\u25D0",na:"\u2014"};function n(p){return frappe.utils.escape_html(p||"")}var O=class{constructor(e){this.wrapper=e.wrapper,this.data=e.data,this.mode=e.mode,this.on_why_click=e.on_why_click,this.on_restrictions_click=e.on_restrictions_click,this.on_edit_doctype=e.on_edit_doctype,this.on_export=e.on_export,this.on_simulate=e.on_simulate,this.on_reload=e.on_reload,this.on_bulk_apply=e.on_bulk_apply,this._edit_mode=!1,this.render()}render(){this.wrapper.empty(),this.mode==="user"?(this._render_user_header(),this._render_user_matrix()):(this._render_doctype_header(),this._render_doctype_matrix())}_render_user_header(){let e=this.data,s=e.roles.map(t=>`<span class="ps-badge">${n(t)}</span>`).join(" "),a=$(`
			<div class="ps-matrix-header">
				<div class="ps-user-info">
					<div class="ps-user-details">
						<h3>${n(e.user)}</h3>
						<div class="ps-roles-list">${s}</div>
						${e.role_profile?`<div class="ps-role-profile">${__("Role Profile")}: <strong>${n(e.role_profile)}</strong></div>`:""}
						<div class="ps-stats">${__("Showing {0} DocTypes",[e.total_doctypes])}</div>
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					<button class="btn btn-xs btn-default ps-simulate-btn">
						${frappe.utils.icon("eye","xs")} ${__("Test as User")}
					</button>
					<button class="btn btn-xs btn-default ps-export-user-btn">
						${frappe.utils.icon("download","xs")} ${__("Export CSV")}
					</button>
					<button class="btn btn-xs btn-default ps-restrictions-btn">
						${frappe.utils.icon("lock","xs")} ${__("Manage Restrictions")}
					</button>
				</div>
			</div>
		`);a.find(".ps-restrictions-btn").on("click",()=>{this.on_restrictions_click&&this.on_restrictions_click()}),a.find(".ps-export-user-btn").on("click",()=>{this.on_export&&this.on_export("user",this.data.user)}),a.find(".ps-simulate-btn").on("click",()=>{this.on_simulate&&this.on_simulate(this.data.user)}),this.wrapper.append(a)}_render_user_matrix(){let e=this.data;if(!e.matrix||!e.matrix.length){this.wrapper.append($(`<div class="ps-empty-state">${__("No permissions found for this user.")}</div>`));return}let s=!!this.on_edit_doctype;this.wrapper.append($(`
			<div class="ps-table-hint">
				${frappe.utils.icon("info","xs")}
				${__("Click any cell to explain why it is allowed or denied.")}
				${s?__(" Click the pencil icon to edit that DocType's permissions."):""}
			</div>
		`));let a=`<div class="ps-matrix-scroll"><table class="ps-matrix-table">
			<thead><tr>
				<th class="ps-col-module">${__("MODULE")}</th>
				<th class="ps-col-doctype">${__("DOCTYPE")}</th>`;b.forEach(o=>{a+=`<th class="ps-col-perm" title="${x[o]||o}">${S[o]}</th>`}),s&&(a+=`<th class="ps-col-action" title="${__("Edit")}"></th>`),a+="</tr></thead><tbody>";let t="";e.matrix.forEach(o=>{let r=o.module!==t;t=o.module,a+=`<tr class="ps-matrix-row" data-doctype="${n(o.doctype)}">`,a+=`<td class="ps-col-module">${r?n(o.module):""}</td>`,a+=`<td class="ps-col-doctype">
				<a href="/app/${frappe.router.slug(o.doctype)}" target="_blank">${n(o.doctype)}</a>
			</td>`,b.forEach(l=>{let c=o.permissions[l],d=this.on_why_click?"ps-cell-clickable":"",_={allow:"Allowed",deny:"Denied",cond:"Conditional",na:"N/A"}[c]||c;a+=`<td class="ps-cell ps-cell-${c} ${d}"
					title="${x[l]}: ${_} \u2014 ${__("Click to explain")}"
					data-doctype="${n(o.doctype)}" data-ptype="${l}">${B[c]}</td>`}),s&&(a+=`<td class="ps-col-action">
					<button class="btn btn-xs btn-default ps-edit-dt-btn"
						data-doctype="${n(o.doctype)}"
						title="${__("Edit permissions for {0}",[o.doctype])}">
						${frappe.utils.icon("edit","xs")}
					</button>
				</td>`),a+="</tr>"}),a+="</tbody></table></div>";let i=$(a);i.find(".ps-cell-clickable").on("click",o=>{let r=$(o.currentTarget);this.on_why_click&&this.on_why_click(r.data("doctype"),r.data("ptype"))}),i.find(".ps-edit-dt-btn").on("click",o=>{let r=$(o.currentTarget).data("doctype");this.on_edit_doctype&&this.on_edit_doctype(r)}),this.wrapper.append(i)}_render_doctype_header(){let e=this.data,s=$(`
			<div class="ps-matrix-header">
				<div class="ps-doctype-info">
					<h3>${n(e.doctype)}</h3>
					<div class="ps-stats">
						${__("Module")}: ${n(e.module)} &nbsp;|&nbsp;
						${e.is_submittable?__("Submittable"):__("Not Submittable")} &nbsp;|&nbsp;
						${e.is_custom?`<span class="ps-badge ps-badge-custom">${__("Custom Perms Active")}</span>`:`<span class="ps-badge">${__("Standard Perms")}</span>`}
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					${e.is_custom?`<button class="btn btn-xs btn-danger ps-reset-btn">
							${frappe.utils.icon("undo","xs")} ${__("Reset to Standard")}
						   </button>`:""}
					<button class="btn btn-xs btn-default ps-bulk-apply-btn">
						${frappe.utils.icon("settings","xs")} ${__("Bulk Apply")}
					</button>
					<button class="btn btn-xs btn-default ps-export-dt-btn">
						${frappe.utils.icon("download","xs")} ${__("Export CSV")}
					</button>
					<button class="btn btn-xs ${this._edit_mode?"btn-primary":"btn-default"} ps-edit-toggle-btn">
						${frappe.utils.icon(this._edit_mode?"tick":"edit","xs")}
						${this._edit_mode?__("Done Editing"):__("Edit Permissions")}
					</button>
				</div>
			</div>
		`);s.find(".ps-edit-toggle-btn").on("click",()=>this._toggle_edit_mode()),s.find(".ps-reset-btn").on("click",()=>this._confirm_reset()),s.find(".ps-export-dt-btn").on("click",()=>{this.on_export&&this.on_export("doctype",this.data.doctype)}),s.find(".ps-bulk-apply-btn").on("click",()=>{this.on_bulk_apply&&this.on_bulk_apply()}),this.wrapper.append(s)}_render_doctype_matrix(){let e=this.data,s=this._edit_mode;if(!e.roles||!e.roles.length){this.wrapper.append($(`<div class="ps-empty-state">${__("No role permissions defined for this DocType.")}</div>`)),s&&this._render_add_role_row();return}let a=$(`
			<div class="ps-re-search-wrap">
				<span class="ps-re-search-icon">${frappe.utils.icon("search","xs")}</span>
				<input class="form-control ps-re-search"
					placeholder="${__("Search roles\u2026")}"
					type="text" autocomplete="off"
					value="${n(this._search_query||"")}" />
				${this._search_query?`<button class="ps-re-search-clear btn-naked" title="${__("Clear")}">\u2715</button>`:""}
			</div>
		`);this.wrapper.append(a),s&&this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info","xs")}
					${__("Click any \u2713 / \u2717 cell to toggle. Changes save instantly.")}
				</div>
			`));let t=`<div class="ps-matrix-scroll"><table class="ps-matrix-table">
			<thead><tr>
				<th class="ps-col-role">${__("Role")}</th>
				<th class="ps-col-level">${__("Level")}</th>
				<th class="ps-col-owner">${__("Owner")}</th>`;b.forEach(l=>{t+=`<th class="ps-col-perm" title="${x[l]||l}">${S[l]}</th>`}),s&&(t+='<th class="ps-col-action"></th>'),t+="</tr></thead><tbody>",e.roles.forEach(l=>{t+=`<tr class="ps-matrix-row" data-role="${n(l.role)}" data-level="${l.permlevel}">`,t+=`<td class="ps-col-role">
				<span class="ps-role-name">${n(l.role)}</span>
				${l.source==="custom"?'<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>':""}
			</td>`,t+=`<td class="ps-col-level">${l.permlevel}</td>`,s?t+=`<td class="ps-col-owner ps-cell-owner-edit"
					data-role="${n(l.role)}" data-level="${l.permlevel}"
					data-value="${l.if_owner?1:0}" title="${__("If Owner Only")}">
					<span class="ps-owner-toggle ${l.if_owner?"ps-owner-on":"ps-owner-off"}">
						${l.if_owner?"\u2713":"\u25CB"}
					</span>
				</td>`:t+=`<td class="ps-col-owner">
					${l.if_owner?'<span class="ps-owner-badge">\u2713</span>':""}
				</td>`,b.forEach(c=>{let d=l.permissions[c];if(d==="na")t+=`<td class="ps-cell ps-cell-na" title="${__("Not applicable")}">\u2014</td>`;else if(s){let _=Boolean(d);t+=`<td class="ps-cell ps-cell-editable ${_?"ps-cell-allow":"ps-cell-deny"}"
						title="${__("Click to toggle")} ${x[c]}"
						data-role="${n(l.role)}" data-level="${l.permlevel}"
						data-ptype="${c}" data-value="${_?1:0}">
						${_?"\u2713":"\u2717"}
					</td>`}else t+=`<td class="ps-cell ${d?"ps-cell-allow":"ps-cell-deny"}">${d?"\u2713":"\u2717"}</td>`}),s&&(t+=`<td class="ps-col-action">
					<button class="btn btn-xs btn-danger ps-remove-role-btn"
						data-role="${n(l.role)}" data-level="${l.permlevel}"
						title="${__("Remove")}">
						${frappe.utils.icon("delete","xs")}
					</button>
				</td>`),t+="</tr>"}),t+="</tbody></table></div>";let i=$(t);s&&(i.find(".ps-cell-editable").on("click",l=>this._toggle_cell($(l.currentTarget))),i.find(".ps-cell-owner-edit").on("click",l=>this._toggle_if_owner($(l.currentTarget))),i.find(".ps-remove-role-btn").on("click",l=>{let c=$(l.currentTarget);this._remove_role(c.data("role"),c.data("level"))})),this.wrapper.append(i),s&&this._render_add_role_row();let o=this.wrapper.find(".ps-re-search"),r=()=>{let l=(this._search_query||"").toLowerCase();i.find(".ps-matrix-row").each((c,d)=>{let _=($(d).attr("data-role")||"").toLowerCase();$(d).toggle(!l||_.includes(l))}),this.wrapper.find(".ps-re-search-clear").toggle(!!l)};o.on("input",()=>{this._search_query=o.val().trim(),r()}),this.wrapper.find(".ps-re-search-clear").on("click",()=>{this._search_query="",o.val("").trigger("input")}),this._search_query&&r()}_render_add_role_row(){let e=$(`
			<div class="ps-add-role-row">
				<button class="btn btn-xs btn-default ps-add-role-btn">
					${frappe.utils.icon("add","xs")} ${__("Add Role")}
				</button>
			</div>
		`);e.find(".ps-add-role-btn").on("click",()=>this._show_add_role_dialog()),this.wrapper.append(e)}_toggle_edit_mode(){this._edit_mode?(this._edit_mode=!1,this.render()):(frappe.dom.freeze(__("Initialising custom permissions\u2026")),frappe.call({method:"permission_manager.permission_manager.api.matrix.init_custom_perms",args:{doctype:this.data.doctype},callback:e=>{frappe.dom.unfreeze(),e.message&&(this.data=e.message,this._edit_mode=!0,this.render())},error:()=>{frappe.dom.unfreeze(),frappe.show_alert({message:__("Failed to initialise custom permissions."),indicator:"red"})}}))}_toggle_cell(e){let s=e.data("role"),a=e.data("level"),t=e.data("ptype"),i=e.data("value")?0:1;e.addClass("ps-cell-saving"),frappe.call({method:"permission_manager.permission_manager.api.matrix.update_permission",args:{doctype:this.data.doctype,role:s,permlevel:a,ptype:t,value:i},callback:o=>{var r;e.removeClass("ps-cell-saving"),(r=o.message)!=null&&r.success&&(e.data("value",i).removeClass("ps-cell-allow ps-cell-deny").addClass(i?"ps-cell-allow":"ps-cell-deny").text(i?"\u2713":"\u2717"),frappe.show_alert({message:`${s} \u2014 ${t}: ${i?__("Allowed"):__("Denied")}`,indicator:i?"green":"orange"}))},error:()=>{e.removeClass("ps-cell-saving"),frappe.show_alert({message:__("Failed to update permission."),indicator:"red"})}})}_toggle_if_owner(e){let s=e.data("role"),a=e.data("level"),t=e.data("value")?0:1;frappe.call({method:"permission_manager.permission_manager.api.matrix.update_if_owner",args:{doctype:this.data.doctype,role:s,permlevel:a,value:t},callback:i=>{var o;(o=i.message)!=null&&o.success&&e.data("value",t).find(".ps-owner-toggle").removeClass("ps-owner-on ps-owner-off").addClass(t?"ps-owner-on":"ps-owner-off").text(t?"\u2713":"\u25CB")}})}_remove_role(e,s){frappe.confirm(__("Remove permission for role '{0}' from '{1}'?",[e,this.data.doctype]),()=>{frappe.dom.freeze(),frappe.call({method:"permission_manager.permission_manager.api.matrix.remove_role_permission",args:{doctype:this.data.doctype,role:e,permlevel:s},callback:a=>{frappe.dom.unfreeze(),a.message&&(this.data=a.message,this.render(),frappe.show_alert({message:__("Role removed."),indicator:"green"}))},error:()=>frappe.dom.unfreeze()})})}_show_add_role_dialog(){let e=new frappe.ui.Dialog({title:__("Add Role Permission \u2014 {0}",[this.data.doctype]),fields:[{fieldtype:"Link",fieldname:"role",label:__("Role"),options:"Role",reqd:1},{fieldtype:"Int",fieldname:"permlevel",label:__("Permission Level"),default:0,description:__("0 = document level. Higher = field-level security.")}],primary_action_label:__("Add"),primary_action:s=>{e.hide(),frappe.dom.freeze(),frappe.call({method:"permission_manager.permission_manager.api.matrix.add_role_permission",args:{doctype:this.data.doctype,role:s.role,permlevel:s.permlevel||0},callback:a=>{frappe.dom.unfreeze(),a.message&&(this.data=a.message,this.render(),frappe.show_alert({message:__("Role '{0}' added.",[s.role]),indicator:"green"}))},error:()=>frappe.dom.unfreeze()})}});e.show()}_confirm_reset(){frappe.confirm(__("Reset '{0}' to standard permissions? All custom changes will be lost.",[this.data.doctype]),()=>{frappe.dom.freeze(),frappe.call({method:"permission_manager.permission_manager.api.matrix.reset_to_standard",args:{doctype:this.data.doctype},callback:e=>{frappe.dom.unfreeze(),e.message&&(this.data=e.message,this._edit_mode=!1,this.render(),frappe.show_alert({message:__("Permissions reset to standard."),indicator:"green"}))},error:()=>frappe.dom.unfreeze()})})}};var z=class{constructor(e){this.user=e.user,this.doctype=e.doctype,this.ptype=e.ptype||"read",this.show()}show(){this.dialog=new frappe.ui.Dialog({title:__("Permission Explainer"),size:"large",fields:[{fieldtype:"HTML",fieldname:"header_html"},{fieldtype:"Select",fieldname:"ptype",label:__("Permission Type"),options:["select","read","write","create","delete","submit","cancel","amend","print","email","report","import","export","share"].join(`
`),default:this.ptype,change:()=>this.load_explanation()},{fieldtype:"HTML",fieldname:"steps_html"}]}),this.dialog.fields_dict.header_html.$wrapper.html(`
			<div class="ps-why-header">
				<strong>${__("User")}:</strong> ${n(this.user)}<br>
				<strong>${__("DocType")}:</strong> ${n(this.doctype)}
			</div>
		`),this.dialog.show(),this.load_explanation()}load_explanation(){let e=this.dialog.get_value("ptype")||this.ptype,s=this.dialog.fields_dict.steps_html.$wrapper;s.html(this._skeleton_html(3)),frappe.call({method:"permission_manager.permission_manager.api.resolver.explain_permission",args:{user:this.user,doctype:this.doctype,ptype:e},callback:a=>{a.message&&this._render_steps(s,a.message)},error:()=>{s.html(`
					<div class="ps-error-state">
						<div class="ps-error-icon">${frappe.utils.icon("error","lg")}</div>
						<div class="ps-error-msg">${__("Failed to analyse permissions. Please try again.")}</div>
						<button class="btn btn-sm btn-default ps-why-retry">
							${frappe.utils.icon("refresh","xs")} ${__("Retry")}
						</button>
					</div>
				`),s.find(".ps-why-retry").on("click",()=>this.load_explanation())}})}_skeleton_html(e){let s="";for(let a=0;a<e;a++)s+=`<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`;return`<div class="ps-loading">${s}</div>`}_render_steps(e,s){let a={pass:"\u2705",fail:"\u274C",warn:"\u26A0\uFE0F",info:"\u2139\uFE0F"},t={pass:"ps-step-pass",fail:"ps-step-fail",warn:"ps-step-warn",info:"ps-step-info"},o=`
			<div class="ps-result-banner ${s.result==="allow"?"ps-result-allow":s.result==="cond"?"ps-result-cond":"ps-result-deny"}">
				<strong>${s.result==="allow"?__("ALLOWED"):s.result==="cond"?__("CONDITIONAL"):__("DENIED")}</strong>
				<span>${n(s.result_reason)}</span>
			</div>
			<div class="ps-steps">`;s.steps.forEach(r=>{let l=a[r.status]||"\u2139\uFE0F";o+=`<div class="ps-step ${t[r.status]||""}">
				<div class="ps-step-header">
					<span class="ps-step-icon">${l}</span>
					<span class="ps-step-num">${__("Step")} ${r.step}</span>
					<span class="ps-step-title">${n(r.title)}</span>
				</div>
				<div class="ps-step-body">
					<p>${n(r.description)}</p>`,r.details&&r.details.length&&(o+='<ul class="ps-step-details">',r.details.forEach(d=>o+=`<li>${n(d)}</li>`),o+="</ul>"),o+="</div></div>"}),o+="</div>",e.html(o)}};var M=class{constructor(e){this.user=e.user,this.load()}load(){Promise.all([new Promise(e=>{frappe.call({method:"permission_manager.permission_manager.api.restrictions.get_user_restrictions",args:{user:this.user},callback:s=>e(s.message)})}),new Promise(e=>{frappe.call({method:"permission_manager.permission_manager.api.restrictions.get_user_shares",args:{user:this.user},callback:s=>e(s.message)})})]).then(([e,s])=>this.render(e,s)).catch(()=>{frappe.msgprint({title:__("Error"),indicator:"red",message:__("Failed to load restrictions and shares. Please try again.")})})}render(e,s){this.dialog=new frappe.ui.Dialog({title:__("Restrictions & Shares: {0}",[this.user]),size:"extra-large",fields:[{fieldtype:"HTML",fieldname:"content_html"}]}),this._restrictions_data=e,this._shares_data=s,this._render_content(),this.dialog.show()}_render_content(){let e=this.dialog.fields_dict.content_html.$wrapper,s=this._restrictions_data,a=this._shares_data,t='<div class="ps-explorer">';if(t+=`
			<div class="ps-section-header">
				<h4 class="ps-section-title" style="margin:0">${__("User Permission Restrictions")}</h4>
				<button class="btn btn-xs btn-primary ps-add-restriction-btn">
					${frappe.utils.icon("add","xs")} ${__("Add Restriction")}
				</button>
			</div>`,!s.restrictions.length)t+=`<div class="ps-empty-state">${__("No restrictions \u2014 full role-based access.")}</div>`;else{t+='<div class="ps-restriction-summary">';for(let[i,o]of Object.entries(s.restriction_summary))t+=`<div class="ps-restriction-badge">
					<strong>${n(i)}:</strong>
					${o.map(r=>`<span class="ps-badge">${n(r)}</span>`).join(" ")}
				</div>`;t+="</div>",t+='<div class="ps-restriction-cards">',s.restrictions.forEach(i=>{t+=`
					<div class="ps-card" data-perm-name="${n(i.name)}">
						<div class="ps-card-header">
							<strong>${n(i.allow)}</strong> =
							<span class="ps-badge">${n(i.for_value)}</span>
							${i.is_default?`<span class="ps-badge ps-badge-default">${__("Default")}</span>`:""}
							<button class="btn btn-xs btn-danger ps-remove-restriction-btn"
								data-name="${n(i.name)}"
								style="margin-left:auto"
								title="${__("Remove this restriction")}">
								${frappe.utils.icon("delete","xs")} ${__("Remove")}
							</button>
						</div>
						<div class="ps-card-body">
							<div class="ps-card-detail">
								<strong>${__("Applied to")}:</strong>
								${i.apply_to_all?__("All DocTypes with link to {0}",[i.allow]):n(i.applicable_for||__("All"))}
							</div>
							<div class="ps-card-detail">
								<strong>${__("Affected DocTypes")} (${i.affected_doctypes.length}):</strong>
								<div class="ps-affected-list">
									${i.affected_doctypes.slice(0,15).map(o=>`<span class="ps-mini-badge">${n(o)}</span>`).join(" ")}
									${i.affected_doctypes.length>15?`<span class="ps-mini-badge">+${i.affected_doctypes.length-15} ${__("more")}</span>`:""}
								</div>
							</div>
						</div>
					</div>`}),t+="</div>"}t+=`<h4 class="ps-section-title">${__("Shared Documents")}</h4>`,a.shares.length?(t+=`<table class="ps-shares-table">
				<thead><tr>
					<th>${__("DocType")}</th><th>${__("Document")}</th>
					<th>${__("Read")}</th><th>${__("Write")}</th>
					<th>${__("Share")}</th><th>${__("Shared By")}</th>
				</tr></thead><tbody>`,a.shares.forEach(i=>{t+=`<tr>
					<td>${n(i.doctype)}</td>
					<td><a href="/app/${frappe.router.slug(i.doctype)}/${i.docname}">${n(i.docname)}</a></td>
					<td>${i.read?"\u2713":"\u2717"}</td>
					<td>${i.write?"\u2713":"\u2717"}</td>
					<td>${i.share?"\u2713":"\u2717"}</td>
					<td>${n(i.owner)}</td>
				</tr>`}),t+="</tbody></table>"):t+=`<div class="ps-empty-state">${__("No documents shared with this user.")}</div>`,t+="</div>",e.html(t),e.find(".ps-add-restriction-btn").on("click",()=>this._show_add_dialog()),e.find(".ps-remove-restriction-btn").on("click",i=>{let o=$(i.currentTarget).data("name");this._remove_restriction(o,e)})}_show_add_dialog(){let e=new frappe.ui.Dialog({title:__("Add User Permission Restriction \u2014 {0}",[this.user]),fields:[{fieldtype:"Link",fieldname:"allow",label:__("Restrict By (DocType)"),options:"DocType",reqd:1,description:__("e.g. Company, Cost Center, Warehouse")},{fieldtype:"Dynamic Link",fieldname:"for_value",label:__("Allowed Value"),options:"allow",reqd:1,description:__("Pick the specific record this user is restricted to.")},{fieldtype:"Check",fieldname:"apply_to_all_doctypes",label:__("Apply to All DocTypes"),default:1,description:__("If unchecked, you can specify a single DocType below.")},{fieldtype:"Link",fieldname:"applicable_for",label:__("Applicable For (DocType)"),options:"DocType",depends_on:"eval: !doc.apply_to_all_doctypes"},{fieldtype:"HTML",fieldname:"impact_preview",label:__("Impact Preview")}],primary_action_label:__("Add"),primary_action:i=>{e.hide(),frappe.call({method:"permission_manager.permission_manager.api.restrictions.add_user_permission",args:{user:this.user,allow:i.allow,for_value:i.for_value,applicable_for:i.applicable_for||"",apply_to_all_doctypes:i.apply_to_all_doctypes?1:0},callback:o=>{o.message&&(this._restrictions_data=o.message,this._render_content(),frappe.show_alert({message:__("Restriction added."),indicator:"green"}))}})}}),s=null,a=()=>{let i=e.get_value("allow"),o=e.get_value("for_value"),r=e.fields_dict.impact_preview.$wrapper;if(!i||!o){r.empty();return}r.html(`<div class="ps-impact-loading">${frappe.utils.icon("refresh","xs")} ${__("Previewing impact\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.restrictions.preview_restriction_impact",args:{allow:i,for_value:o},callback:l=>{if(!l.message)return;let c=l.message;if(!c.impact.length){r.html(`<div class="ps-impact-empty">${__("No DocTypes link to {0}.",[i])}</div>`);return}let d=`<div class="ps-impact-header">
						<strong>${__("Impact Preview")}</strong> \u2014 ${c.affected_doctypes_count} ${__("DocTypes affected")}
					</div>
					<table class="ps-impact-table">
						<thead><tr>
							<th>${__("DocType")}</th>
							<th>${__("Total Records")}</th>
							<th>${__("Will See")}</th>
							<th>${__("Restricted Out")}</th>
						</tr></thead><tbody>`;c.impact.forEach(_=>{let h=_.total_records?Math.round(_.accessible_after/_.total_records*100):0;d+=`<tr class="${h<20&&_.total_records>0?"ps-impact-warn-row":""}">
							<td>${n(_.doctype)}</td>
							<td>${_.total_records}</td>
							<td><strong style="color:var(--ps-green)">${_.accessible_after}</strong> (${h}%)</td>
							<td style="color:var(--ps-red)">${_.restricted_out}</td>
						</tr>`}),d+="</tbody></table>",r.html(d)}})},t=()=>{clearTimeout(s),s=setTimeout(a,600)};e.fields_dict.allow.df.change=()=>{e.set_value("for_value",""),t()},e.fields_dict.for_value.df.change=t,e.show()}_remove_restriction(e,s){frappe.confirm(__("Remove this restriction?"),()=>{frappe.call({method:"permission_manager.permission_manager.api.restrictions.remove_user_permission",args:{name:e},callback:a=>{a.message&&(this._restrictions_data=a.message,this._render_content(),frappe.show_alert({message:__("Restriction removed."),indicator:"green"}))}})})}};var q=class{constructor(e){this.wrapper=e.wrapper,this.data=e.data,this._edit_mode=!1,this.render()}render(){this.wrapper.empty();let e=this.data;if(this.wrapper.append($(`
			<div class="ps-matrix-header">
				<div class="ps-role-info">
					<h3>${n(e.role)}</h3>
					<div class="ps-stats">
						${__("{0} DocTypes across {1} modules",[e.total_doctypes,e.modules.length])}
						&nbsp;|&nbsp;
						${__("{0} users have this role",[e.user_count])}
					</div>
				</div>
				<div class="ps-header-actions ps-edit-actions">
					<button class="btn btn-xs ${this._edit_mode?"btn-primary":"btn-default"} ps-role-edit-btn">
						${frappe.utils.icon(this._edit_mode?"tick":"edit","xs")}
						${this._edit_mode?__("Done Editing"):__("Edit Permissions")}
					</button>
				</div>
			</div>
		`)),this.wrapper.find(".ps-role-edit-btn").on("click",()=>this._toggle_edit_mode()),!e.modules||!e.modules.length){this.wrapper.append($(`<div class="ps-empty-state">${__("This role has no permissions assigned to any DocType.")}</div>`));return}let s=$(`
			<div class="ps-re-search-wrap">
				<span class="ps-re-search-icon">${frappe.utils.icon("search","xs")}</span>
				<input class="form-control ps-re-search"
					placeholder="${__("Search DocTypes\u2026")}"
					type="text" autocomplete="off"
					value="${n(this._search_query||"")}" />
				${this._search_query?`<button class="ps-re-search-clear btn-naked" title="${__("Clear")}">\u2715</button>`:""}
			</div>
		`);this.wrapper.append(s),this._edit_mode&&this.wrapper.append($(`
				<div class="ps-edit-hint">
					${frappe.utils.icon("info","xs")}
					${__("Click any \u2713 / \u2717 cell to toggle. Changes save and reload instantly.")}
				</div>
			`)),e.modules.forEach(t=>{let i=$(`
				<div class="ps-module-group">
					<div class="ps-module-header">
						<strong>${n(t.module)}</strong>
						<span class="ps-module-count">(${t.doctypes.length})</span>
					</div>
				</div>
			`),o=`<table class="ps-matrix-table ps-matrix-compact">
				<thead><tr>
					<th class="ps-col-doctype">${__("DocType")}</th>
					<th class="ps-col-owner" title="${__("Only If Creator")}">Own</th>`;b.forEach(r=>{o+=`<th class="ps-col-perm" title="${x[r]||r}">${S[r]}</th>`}),o+="</tr></thead><tbody>",t.doctypes.forEach(r=>{o+=`<tr class="ps-matrix-row" data-doctype="${n(r.doctype)}">`,o+=`<td class="ps-col-doctype">
					<a href="/app/${frappe.router.slug(r.doctype)}" target="_blank">${n(r.doctype)}</a>
					${r.source==="custom"?'<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>':""}
				</td>`,this._edit_mode?o+=`<td class="ps-col-owner ps-cell ps-cell-owner-edit ${r.if_owner?"ps-owner-on":""}"
						data-doctype="${n(r.doctype)}" data-value="${r.if_owner?1:0}"
						title="${__("Click to toggle Only If Creator")}">
						${r.if_owner?"\u2713":"\u25CB"}
					</td>`:o+=`<td class="ps-col-owner ps-cell">
						${r.if_owner?'<span class="ps-owner-badge" title="'+__("Only If Creator")+'">\u2713</span>':""}
					</td>`,b.forEach(l=>{let c=r.permissions[l];if(c==="na")o+='<td class="ps-cell ps-cell-na">\u2014</td>';else if(this._edit_mode){let d=Boolean(c);o+=`<td class="ps-cell ps-cell-editable ${d?"ps-cell-allow":"ps-cell-deny"}"
							title="${__("Click to toggle")} ${x[l]} ${__("for")} ${r.doctype}"
							data-doctype="${n(r.doctype)}" data-ptype="${l}" data-value="${d?1:0}">
							${d?"\u2713":"\u2717"}
						</td>`}else o+=`<td class="ps-cell ${c?"ps-cell-allow":"ps-cell-deny"}">${c?"\u2713":"\u2717"}</td>`}),o+="</tr>"}),o+="</tbody></table>",i.append($(o)),this._edit_mode&&(i.find(".ps-cell-editable").on("click",r=>{this._toggle_cell($(r.currentTarget))}),i.find(".ps-cell-owner-edit").on("click",r=>{this._toggle_if_owner($(r.currentTarget))})),this.wrapper.append(i)});let a=this.wrapper.find(".ps-re-search");a.on("input",()=>{this._search_query=a.val().trim(),this._apply_search();let t=!!this._search_query;this.wrapper.find(".ps-re-search-clear").toggle(t)}),this.wrapper.find(".ps-re-search-clear").on("click",()=>{this._search_query="",a.val("").trigger("input")}),this._search_query&&this._apply_search()}_apply_search(){let e=(this._search_query||"").toLowerCase();this.wrapper.find(".ps-module-group").each((s,a)=>{let t=$(a);t.find(".ps-matrix-row").each((o,r)=>{let l=($(r).attr("data-doctype")||"").toLowerCase();$(r).toggle(!e||l.includes(e))});let i=t.find(".ps-matrix-row:visible").length>0;t.toggle(i)})}_toggle_edit_mode(){this._edit_mode=!this._edit_mode,this.render()}_toggle_cell(e){let s=e.data("doctype"),a=e.data("ptype"),t=e.data("value")?0:1,i=this.data.role;e.addClass("ps-cell-saving"),frappe.call({method:"permission_manager.permission_manager.api.matrix.update_permission",args:{doctype:s,role:i,permlevel:0,ptype:a,value:t},callback:o=>{var r;e.removeClass("ps-cell-saving"),(r=o.message)!=null&&r.success&&(e.data("value",t).removeClass("ps-cell-allow ps-cell-deny").addClass(t?"ps-cell-allow":"ps-cell-deny").text(t?"\u2713":"\u2717"),frappe.show_alert({message:`${s} \u2014 ${a}: ${t?__("Allowed"):__("Denied")}`,indicator:t?"green":"orange"}),this._update_local(s,a,t))},error:()=>{e.removeClass("ps-cell-saving"),frappe.show_alert({message:__("Failed to update permission."),indicator:"red"})}})}_update_local(e,s,a){for(let t of this.data.modules){let i=t.doctypes.find(o=>o.doctype===e);if(i){i.permissions[s]=a,i.source="custom";break}}}_toggle_if_owner(e){let s=e.data("doctype"),a=e.data("value")?0:1,t=this.data.role;e.addClass("ps-cell-saving"),frappe.call({method:"permission_manager.permission_manager.api.matrix.update_if_owner",args:{doctype:s,role:t,permlevel:0,value:a},callback:i=>{var o;e.removeClass("ps-cell-saving"),(o=i.message)!=null&&o.success&&(e.data("value",a).toggleClass("ps-owner-on",!!a).text(a?"\u2713":"\u25CB"),this._update_local_if_owner(s,a),frappe.show_alert({message:`${s} \u2014 ${__("Only If Creator")}: ${a?__("On"):__("Off")}`,indicator:a?"blue":"orange"}))},error:()=>{e.removeClass("ps-cell-saving"),frappe.show_alert({message:__("Failed to update owner flag."),indicator:"red"})}})}_update_local_if_owner(e,s){for(let a of this.data.modules){let t=a.doctypes.find(i=>i.doctype===e);if(t){t.if_owner=s;break}}}};var I=class{constructor(e){this.wrapper=e.wrapper,this.data=e.data,this.on_export=e.on_export,this.render()}render(){this.wrapper.empty();let e=this.data,s=e.roles.map(t=>`<span class="ps-badge">${n(t)}</span>`).join(" "),a=$(`
			<div class="ps-matrix-header">
				<div class="ps-role-info">
					<h3>${n(e.profile)}</h3>
					<div class="ps-roles-list ps-profile-roles">${s||`<em>${__("No roles in this profile.")}</em>`}</div>
					<div class="ps-stats">
						${__("{0} roles",[e.roles.length])}
						&nbsp;|&nbsp;
						${__("{0} DocTypes",[e.total_doctypes])}
						&nbsp;|&nbsp;
						${__("{0} users assigned",[e.user_count])}
					</div>
				</div>
				<div class="ps-header-actions">
					<a class="btn btn-xs btn-default ps-open-profile-btn"
						href="/app/role-profile/${encodeURIComponent(e.profile)}" target="_blank">
						${frappe.utils.icon("edit","xs")} ${__("Edit Profile")}
					</a>
					<button class="btn btn-xs btn-default ps-export-profile-btn">
						${frappe.utils.icon("download","xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>
		`);if(a.find(".ps-export-profile-btn").on("click",()=>{this.on_export&&this.on_export(e.profile)}),this.wrapper.append(a),!e.modules||!e.modules.length){this.wrapper.append($(`<div class="ps-empty-state">${__("This profile has no permissions (no roles or roles have no permissions).")}</div>`));return}this.wrapper.append($(`
			<div class="ps-table-hint">
				${frappe.utils.icon("info","xs")}
				${__("Showing the combined (unioned) permissions for all roles in this profile. \u2713 means at least one role grants this right.")}
			</div>
		`)),e.modules.forEach(t=>{let i=$(`
				<div class="ps-module-group">
					<div class="ps-module-header">
						<strong>${n(t.module)}</strong>
						<span class="ps-module-count">(${t.doctypes.length})</span>
					</div>
				</div>
			`),o=`<table class="ps-matrix-table ps-matrix-compact">
				<thead><tr><th class="ps-col-doctype">${__("DocType")}</th>`;b.forEach(r=>{o+=`<th class="ps-col-perm" title="${x[r]||r}">${S[r]}</th>`}),o+="</tr></thead><tbody>",t.doctypes.forEach(r=>{o+=`<tr class="ps-matrix-row" data-doctype="${n(r.doctype)}">`,o+=`<td class="ps-col-doctype">
					<a href="/app/${frappe.router.slug(r.doctype)}" target="_blank">${n(r.doctype)}</a>
					${r.source==="custom"?'<span class="ps-badge ps-badge-custom ps-xs-badge">custom</span>':""}
				</td>`,b.forEach(l=>{let c=r.permissions[l];c==="na"?o+='<td class="ps-cell ps-cell-na">\u2014</td>':o+=`<td class="ps-cell ${c?"ps-cell-allow":"ps-cell-deny"}">${c?"\u2713":"\u2717"}</td>`}),o+="</tr>"}),o+="</tbody></table>",i.append($(o)),this.wrapper.append(i)})}};var j=class{constructor(e){this.wrapper=e.wrapper,this._doctype=null,this._ptype="read",this._data=null,this.render()}render(){this.wrapper.empty();let e=$(`
			<div class="ps-lookup-controls">
				<div class="ps-search-row">
					<div class="ps-search-field" id="ps-lookup-dt"></div>
					<div class="ps-search-field" id="ps-lookup-ptype"></div>
					<button class="btn btn-sm btn-primary ps-lookup-search-btn" disabled>
						${frappe.utils.icon("search","sm")} ${__("Find Users")}
					</button>
				</div>
			</div>
		`);this.wrapper.append(e),this._dt_ctrl=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"DocType",fieldname:"lookup_doctype",placeholder:__("Select DocType\u2026"),label:__("DocType"),change:()=>{this._doctype=this._dt_ctrl.get_value(),this._update_search_btn()}},parent:e.find("#ps-lookup-dt"),render_input:!0}),this._ptype_ctrl=frappe.ui.form.make_control({df:{fieldtype:"Select",fieldname:"lookup_ptype",label:__("Permission Type"),options:b.map(s=>({value:s,label:x[s]||s})),default:"read",change:()=>{this._ptype=this._ptype_ctrl.get_value()||"read"}},parent:e.find("#ps-lookup-ptype"),render_input:!0}),this._ptype_ctrl.set_value("read"),e.find(".ps-lookup-search-btn").on("click",()=>this._run_lookup()),this.$results=$('<div class="ps-lookup-results"></div>'),this.wrapper.append(this.$results),this.$results.html(this._empty_state(frappe.utils.icon("search","lg"),__("Who can do what?"),__("Select a DocType and permission type above, then click Find Users.")))}_update_search_btn(){this.wrapper.find(".ps-lookup-search-btn").prop("disabled",!this._doctype)}_run_lookup(){!this._doctype||(this.$results.html(`<div class="ps-loading">${this._skeleton(4)}</div>`),frappe.call({method:"permission_manager.permission_manager.api.lookup.get_users_with_permission",args:{doctype:this._doctype,ptype:this._ptype},callback:e=>{e.message&&(this._data=e.message,this._render_results(e.message))},error:()=>{this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to run lookup.")}</div>
				</div>`)}}))}_render_results(e){let s=x[e.ptype]||e.ptype,a=e.source==="custom"?`<span class="ps-badge ps-badge-custom">${__("Custom Perms")}</span>`:`<span class="ps-badge">${__("Standard Perms")}</span>`,t=`
			<div class="ps-lookup-summary">
				<div class="ps-lookup-title">
					<strong>${__("{0} users</strong> can <strong>{1}</strong> on <strong>{2}",[e.total_users,s,e.doctype])}</strong>
					&nbsp;${a}
				</div>
				<div class="ps-lookup-roles">`;e.granting_roles.length&&(t+=`<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("Granting roles")}:</span>
				${e.granting_roles.map(i=>`<span class="ps-badge ps-badge-green">${n(i)}</span>`).join(" ")}
			</div>`),e.conditional_roles.length&&(t+=`<div class="ps-lookup-role-group">
				<span class="ps-lookup-role-label">${__("If-owner only")}:</span>
				${e.conditional_roles.map(i=>`<span class="ps-badge ps-badge-amber">${n(i)}</span>`).join(" ")}
			</div>`),t+="</div>",t+=`<button class="btn btn-xs btn-default ps-export-lookup-btn">
			${frappe.utils.icon("download","xs")} ${__("Export CSV")}
		</button>`,t+="</div>",e.users.length?(t+='<div class="ps-lookup-user-grid">',e.users.forEach(i=>{let o=i.access_type==="direct",r=[...i.direct_roles.map(l=>`<span class="ps-badge ps-badge-green ps-xs-badge">${n(l)}</span>`),...i.cond_roles.map(l=>`<span class="ps-badge ps-badge-amber ps-xs-badge">${n(l)}</span>`)].join(" ");t+=`<div class="ps-user-card ${o?"":"ps-user-card-cond"}">
					<div class="ps-user-card-avatar">
						${i.user_image?`<img src="${n(i.user_image)}" class="ps-avatar-img">`:`<div class="ps-avatar-placeholder">${(i.full_name||i.user)[0].toUpperCase()}</div>`}
					</div>
					<div class="ps-user-card-info">
						<div class="ps-user-card-name">${n(i.full_name||i.user)}</div>
						<div class="ps-user-card-email">${n(i.email||i.user)}</div>
						<div class="ps-user-card-roles">${r}</div>
					</div>
					<div class="ps-user-card-badge">
						${o?`<span class="ps-access-direct">${__("Direct")}</span>`:`<span class="ps-access-cond">${__("If Owner")}</span>`}
					</div>
				</div>`}),t+="</div>"):t+=`<div class="ps-empty-state">${__("No active users have this permission.")}</div>`,this.$results.html(t),this.$results.find(".ps-export-lookup-btn").on("click",()=>this._export_csv(e))}_export_csv(e){let s=[["DocType",e.doctype,"Permission",x[e.ptype]||e.ptype],[],["User","Email","Access Type","Granting Roles"],...e.users.map(a=>[a.full_name||a.user,a.email||a.user,a.access_type,[...a.direct_roles,...a.cond_roles].join(", ")])];X(s,`lookup_${e.doctype}_${e.ptype}`)}_skeleton(e){return Array(e).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("")}_empty_state(e,s,a){return`<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${e}</div>
			<div class="ps-welcome-title">${s}</div>
			<div class="ps-welcome-desc">${a}</div>
		</div>`}};function X(p,e){let s=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19),a=`${e}_${s}.csv`,t=p.map(l=>l.map(c=>{let d=String(c==null?"":c);return d.includes(",")||d.includes('"')||d.includes(`
`)?`"${d.replace(/"/g,'""')}"`:d}).join(",")).join(`
`),i=new Blob([t],{type:"text/csv;charset=utf-8;"}),o=URL.createObjectURL(i),r=document.createElement("a");r.href=o,r.download=a,document.body.appendChild(r),r.click(),document.body.removeChild(r),URL.revokeObjectURL(o)}var me={both:{cls:"ps-diff-both",icon:"\u2713",title:"Both roles"},only_1:{cls:"ps-diff-only1",icon:"\u2460",title:"Role 1 only"},only_2:{cls:"ps-diff-only2",icon:"\u2461",title:"Role 2 only"},neither:{cls:"ps-diff-neither",icon:"\u2717",title:"Neither role"},na:{cls:"ps-cell-na",icon:"\u2014",title:"Not applicable"}},U=class{constructor(e){this.wrapper=e.wrapper,this._role1=null,this._role2=null,this._show_diff_only=!1,this._data=null,this.render()}render(){this.wrapper.empty();let e=$(`
			<div class="ps-compare-controls">
				<div class="ps-search-row ps-compare-row">
					<div class="ps-search-field" id="ps-role1-select"></div>
					<div class="ps-compare-vs">${__("vs")}</div>
					<div class="ps-search-field" id="ps-role2-select"></div>
					<button class="btn btn-sm btn-primary ps-compare-btn" disabled>
						${frappe.utils.icon("compare","sm")} ${__("Compare")}
					</button>
				</div>
			</div>
		`);this.wrapper.append(e);let s=(a,t,i)=>frappe.ui.form.make_control({df:{fieldtype:"Link",options:"Role",fieldname:t,placeholder:__("Select Role\u2026"),label:__("Role"),change:()=>{var o;i((o=this[t])==null?void 0:o.get_value()),this._update_compare_btn()}},parent:e.find(`#${a}`),render_input:!0});this._r1_ctrl=s("ps-role1-select","_r1_ctrl",a=>{this._role1=a}),this._r2_ctrl=s("ps-role2-select","_r2_ctrl",a=>{this._role2=a}),this._r1_ctrl.df.change=()=>{this._role1=this._r1_ctrl.get_value(),this._update_compare_btn()},this._r2_ctrl.df.change=()=>{this._role2=this._r2_ctrl.get_value(),this._update_compare_btn()},e.find(".ps-compare-btn").on("click",()=>this._run_compare()),this.$results=$('<div class="ps-compare-results"></div>'),this.wrapper.append(this.$results),this.$results.html(this._welcome_html())}_update_compare_btn(){this.wrapper.find(".ps-compare-btn").prop("disabled",!(this._role1&&this._role2))}_run_compare(){if(!(!this._role1||!this._role2)){if(this._role1===this._role2){frappe.show_alert({message:__("Please select two different roles."),indicator:"orange"});return}this.$results.html(`<div class="ps-loading">${this._skeleton(6)}</div>`),frappe.call({method:"permission_manager.permission_manager.api.lookup.compare_roles",args:{role1:this._role1,role2:this._role2},callback:e=>{e.message&&(this._data=e.message,this._render_comparison(e.message))},error:()=>{this.$results.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Comparison failed.")}</div>
				</div>`)}})}}_render_comparison(e){let s=`
			<div class="ps-compare-header">
				<div class="ps-compare-stats">
					<span class="ps-stat-badge ps-stat-total">${e.total} ${__("DocTypes")}</span>
					<span class="ps-stat-badge ps-stat-diff">${e.diff_count} ${__("differ")}</span>
					<span class="ps-stat-badge ps-stat-only1">${e.only_in_role1} ${__("only in")} ${n(e.role1)}</span>
					<span class="ps-stat-badge ps-stat-only2">${e.only_in_role2} ${__("only in")} ${n(e.role2)}</span>
				</div>
				<div class="ps-compare-actions">
					<label class="ps-diff-toggle-label">
						<input type="checkbox" class="ps-diff-only-cb" ${this._show_diff_only?"checked":""}>
						${__("Show differences only")}
					</label>
					<button class="btn btn-xs btn-default ps-compare-export-btn">
						${frappe.utils.icon("download","xs")} ${__("Export CSV")}
					</button>
				</div>
			</div>

			<!-- Legend -->
			<div class="ps-compare-legend">
				<span class="ps-diff-both">\u2713 ${__("Both")}</span>
				<span class="ps-diff-only1">\u2460 ${n(e.role1)} only</span>
				<span class="ps-diff-only2">\u2461 ${n(e.role2)} only</span>
				<span class="ps-diff-neither">\u2717 ${__("Neither")}</span>
			</div>

			<div class="ps-matrix-scroll">
				<table class="ps-matrix-table ps-compare-table">
					<thead>
						<tr>
							<th class="ps-col-module">${__("MODULE")}</th>
							<th class="ps-col-doctype">${__("DOCTYPE")}</th>`;b.forEach(o=>{s+=`<th class="ps-col-perm ps-compare-th" title="${x[o]||o}">${S[o]}</th>`}),s+=`</tr>
					<tr class="ps-compare-role-names">
						<th colspan="2"></th>`;let a=Math.ceil(b.length/2);s+=`<th colspan="${b.length}" class="ps-compare-role-span">
			<span class="ps-compare-role1-label">\u2460 ${n(e.role1)}</span>
			&nbsp;/&nbsp;
			<span class="ps-compare-role2-label">\u2461 ${n(e.role2)}</span>
		</th>`,s+="</tr></thead><tbody>";let t="",i=0;e.rows.forEach(o=>{if(this._show_diff_only&&!o.has_diff)return;i++;let r=o.module!==t;t=o.module,s+=`<tr class="ps-matrix-row ${o.has_diff?"ps-row-has-diff":""}" data-doctype="${n(o.doctype)}">`,s+=`<td class="ps-col-module">${r?n(o.module):""}</td>`,s+=`<td class="ps-col-doctype">
				<a href="/app/${frappe.router.slug(o.doctype)}" target="_blank">${n(o.doctype)}</a>
				${o.has_diff?'<span class="ps-diff-dot"></span>':""}
			</td>`,b.forEach(c=>{let d=me[o.diff[c]]||me.neither;s+=`<td class="ps-cell ps-compare-cell ${d.cls}"
					title="${__("{0}: {1}",[x[c],d.title])}">${d.icon}</td>`}),s+="</tr>"}),i||(s+=`<tr><td colspan="${b.length+2}" class="ps-empty-state" style="padding:24px;text-align:center">
				${__("No differences found between these roles.")}
			</td></tr>`),s+="</tbody></table></div>",this.$results.html(s),this.$results.find(".ps-diff-only-cb").on("change",o=>{this._show_diff_only=o.target.checked,this._render_comparison(this._data)}),this.$results.find(".ps-compare-export-btn").on("click",()=>this._export_csv(e))}_export_csv(e){let s=["DocType","Module","Has Diff?"];b.forEach(t=>{s.push(`${t} (${e.role1})`),s.push(`${t} (${e.role2})`)});let a=[s];e.rows.forEach(t=>{let i=[t.doctype,t.module,t.has_diff?"Yes":"No"];b.forEach(o=>{i.push(t.role1_perms[o]==="na"?"na":t.role1_perms[o]?"\u2713":"\u2717"),i.push(t.role2_perms[o]==="na"?"na":t.role2_perms[o]?"\u2713":"\u2717")}),a.push(i)}),X(a,`compare_${e.role1}_vs_${e.role2}`)}_welcome_html(){return`<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${frappe.utils.icon("compare","lg")}</div>
			<div class="ps-welcome-title">${__("Compare Two Roles")}</div>
			<div class="ps-welcome-desc">${__("Select two roles above to see a side-by-side permission comparison highlighting every difference.")}</div>
		</div>`}_skeleton(e){return Array(e).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("")}};var H=class{constructor(e){this.wrapper=e.wrapper,this.load()}load(){this.wrapper.empty(),this.wrapper.html(`<div class="ps-loading">${this._skeleton(4)}</div>`),frappe.call({method:"permission_manager.permission_manager.api.lookup.get_permission_health",callback:e=>{e.message&&this._render(e.message)},error:()=>{this.wrapper.html(`<div class="ps-error-state">
					<div class="ps-error-msg">${__("Failed to load health data.")}</div>
					<button class="btn btn-sm btn-default ps-health-retry">
						${frappe.utils.icon("refresh","xs")} ${__("Retry")}
					</button>
				</div>`),this.wrapper.find(".ps-health-retry").on("click",()=>this.load())}})}_render(e){let s=this._compute_score(e),a=`
		<div class="ps-health-wrapper">

			<!-- Score card -->
			<div class="ps-health-score-row">
				<div class="ps-health-score-card ps-score-${s.grade}">
					<div class="ps-score-circle">${s.grade}</div>
					<div class="ps-score-info">
						<div class="ps-score-label">${__("Permission Health Score")}</div>
						<div class="ps-score-sub">${s.points}/100 &nbsp;\u2014&nbsp; ${s.label}</div>
					</div>
				</div>
				<button class="btn btn-xs btn-default ps-health-refresh-btn" style="align-self:flex-start">
					${frappe.utils.icon("refresh","xs")} ${__("Refresh")}
				</button>
			</div>

			<!-- Stat tiles -->
			<div class="ps-health-tiles">
				${this._tile("tool",e.custom_perm_count,__("Custom Perm Rows"),e.custom_perm_count>100?"warn":"ok",__("{0} DocTypes overridden",[e.custom_perm_doctypes]))}
				${this._tile("users",e.system_manager_count,__("System Managers"),e.system_manager_count>5?"warn":"ok",__("Users with full access"))}
				${this._tile("warning",e.users_no_roles_count,__("Users with No Roles"),e.users_no_roles_count>0?"alert":"ok",__("Cannot access Frappe desk"))}
				${this._tile("delete",e.roles_no_users_count,__("Empty Roles"),e.roles_no_users_count>0?"warn":"ok",__("Roles with no users assigned"))}
				${this._tile("lock",e.orphan_role_perms.length,__("Orphan Perm Rows"),e.orphan_role_perms.length>0?"alert":"ok",__("Custom perms for deleted roles"))}
				${this._tile("shield",e.sensitive_with_custom.length,__("Sensitive Overrides"),e.sensitive_with_custom.length>0?"warn":"ok",__("Sensitive DocTypes with custom perms"))}
			</div>`;e.system_manager_users.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning","sm")} ${__("System Manager Users")} (${e.system_manager_users.length})</h4>
				<div class="ps-health-pills">
					${e.system_manager_users.map(t=>`
						<a href="/app/user/${t}" target="_blank" class="ps-health-pill ps-pill-warn">${n(t)}</a>
					`).join("")}
				</div>
			</div>`),e.users_no_roles.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("error","sm")} ${__("Users with No Roles")} (${e.users_no_roles_count})</h4>
				<div class="ps-health-pills">
					${e.users_no_roles.map(t=>`
						<a href="/app/user/${t}" target="_blank" class="ps-health-pill ps-pill-alert">${n(t)}</a>
					`).join("")}
					${e.users_no_roles_count>20?`<span class="ps-health-pill">+${e.users_no_roles_count-20} more</span>`:""}
				</div>
			</div>`),e.roles_no_users.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("info","sm")} ${__("Empty Roles (No Users)")} (${e.roles_no_users_count})</h4>
				<div class="ps-health-pills">
					${e.roles_no_users.map(t=>`<span class="ps-health-pill">${n(t)}</span>`).join("")}
					${e.roles_no_users_count>30?`<span class="ps-health-pill">+${e.roles_no_users_count-30} more</span>`:""}
				</div>
			</div>`),e.sensitive_with_custom.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("shield","sm")} ${__("Sensitive DocTypes with Custom Permissions")}</h4>
				<div class="ps-health-pills">
					${e.sensitive_with_custom.map(t=>`
						<a class="ps-health-pill ps-pill-warn" href="/app/permission-studio#doctype=${encodeURIComponent(t)}">${n(t)}</a>
					`).join("")}
				</div>
				<p class="ps-health-note">${__("These DocTypes have custom permission overrides. Review them to ensure they are intentional.")}</p>
			</div>`),e.orphan_role_perms.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("delete","sm")} ${__("Orphan Permission Rows (Role No Longer Exists)")}</h4>
				<div class="ps-health-pills">
					${e.orphan_role_perms.map(t=>`<span class="ps-health-pill ps-pill-alert">${n(t)}</span>`).join("")}
				</div>
				<p class="ps-health-note">${__("These Custom DocPerm rows reference roles that no longer exist. They are harmless but waste space. Delete them via bench console: frappe.db.delete('Custom DocPerm', {'role': 'ROLE_NAME'})")}</p>
			</div>`),e.over_privileged_users.length&&(a+=`<div class="ps-health-section">
				<h4 class="ps-health-section-title">${frappe.utils.icon("warning","sm")} ${__("Users with Many Roles (>10)")}</h4>
				<table class="ps-health-table">
					<thead><tr><th>${__("User")}</th><th>${__("Role Count")}</th></tr></thead>
					<tbody>
						${e.over_privileged_users.map(t=>`
							<tr>
								<td><a href="/app/user/${t.user}" target="_blank">${n(t.user)}</a></td>
								<td><strong>${t.role_count}</strong></td>
							</tr>
						`).join("")}
					</tbody>
				</table>
			</div>`),a+="</div>",this.wrapper.html(a),this.wrapper.find(".ps-health-refresh-btn").on("click",()=>this.load())}_tile(e,s,a,t,i){return`<div class="ps-health-tile ps-tile-${{ok:"green",warn:"amber",alert:"red"}[t]||"gray"}">
			<div class="ps-tile-icon">${frappe.utils.icon(e,"md")}</div>
			<div class="ps-tile-value">${s}</div>
			<div class="ps-tile-label">${a}</div>
			<div class="ps-tile-sub">${i}</div>
		</div>`}_compute_score(e){let s=100;e.system_manager_count>5&&(s-=10),e.system_manager_count>10&&(s-=10),e.users_no_roles_count>0&&(s-=Math.min(e.users_no_roles_count*2,15)),e.orphan_role_perms.length>0&&(s-=10),e.sensitive_with_custom.length>0&&(s-=e.sensitive_with_custom.length*5),e.custom_perm_count>200&&(s-=5),s=Math.max(0,s);let a=s>=85?"A":s>=70?"B":s>=50?"C":"D",t={A:__("Excellent"),B:__("Good"),C:__("Needs Attention"),D:__("Critical")}[a];return{points:s,grade:a,label:t}}_skeleton(e){return Array(e).fill(`
			<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`).join("")}};function K(p){let e=new frappe.ui.Dialog({title:__("Access Simulation \u2014 {0}",[p]),size:"extra-large",fields:[{fieldtype:"HTML",fieldname:"sim_html"}]}),s=e.fields_dict.sim_html.$wrapper;s.html(`<div class="ps-sim-loading">${frappe.utils.icon("refresh","md")} ${__("Simulating access\u2026")}</div>`),e.show(),frappe.call({method:"permission_manager.permission_manager.api.lookup.simulate_user_access",args:{user:p},callback:a=>{a.message&&ze(s,a.message)},error:()=>{s.html(`<div class="ps-error-state"><div class="ps-error-msg">${__("Simulation failed.")}</div></div>`)}})}function ze(p,e){let s=e.last_login?frappe.datetime.str_to_user(e.last_login):__("Never"),a=`
		<div class="ps-sim-wrapper">
			<div class="ps-sim-user-card">
				${e.user_image?`<img src="${n(e.user_image)}" class="ps-sim-avatar">`:`<div class="ps-sim-avatar ps-avatar-placeholder">${(e.full_name||e.user)[0].toUpperCase()}</div>`}
				<div>
					<div class="ps-sim-name">${n(e.full_name||e.user)}</div>
					<div class="ps-sim-email">${n(e.email||e.user)}</div>
					<div class="ps-sim-meta">${__("Last login")}: ${s}</div>
					<div class="ps-sim-roles">
						${e.roles.map(t=>`<span class="ps-badge ps-xs-badge">${n(t)}</span>`).join(" ")}
					</div>
				</div>
				<div class="ps-sim-actions">
					<a href="/app/user/${encodeURIComponent(e.user)}" target="_blank"
					   class="btn btn-xs btn-default">
						${frappe.utils.icon("link-url","xs")} ${__("Open User Record")}
					</a>
				</div>
			</div>

			<!-- Summary tiles -->
			<div class="ps-sim-tiles">
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${e.total_accessible_doctypes}</div>
					<div class="ps-tile-label">${__("Accessible DocTypes")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${e.total_modules}</div>
					<div class="ps-tile-label">${__("Modules")}</div>
				</div>
				<div class="ps-sim-tile">
					<div class="ps-tile-value">${e.roles.length}</div>
					<div class="ps-tile-label">${__("Roles")}</div>
				</div>
			</div>`;e.sensitive_access.length&&(a+=`<h4 class="ps-sim-section-title">${__("Sensitive DocType Access")}</h4>
		<table class="ps-health-table">
			<thead><tr>
				<th>${__("DocType")}</th>
				<th>${__("Read")}</th><th>${__("Write")}</th>
				<th>${__("Create")}</th><th>${__("Delete")}</th><th>${__("Submit")}</th>
			</tr></thead><tbody>`,e.sensitive_access.forEach(t=>{let i=o=>o?'<span style="color:var(--ps-green)">\u2713</span>':'<span style="color:var(--ps-red)">\u2717</span>';a+=`<tr>
				<td><strong>${n(t.doctype)}</strong></td>
				<td>${i(t.read)}</td><td>${i(t.write)}</td>
				<td>${i(t.create)}</td><td>${i(t.delete)}</td><td>${i(t.submit)}</td>
			</tr>`}),a+="</tbody></table>"),a+=`<h4 class="ps-sim-section-title">${__("Module Breakdown")}</h4>
	<div class="ps-sim-module-grid">`,e.modules.forEach(t=>{let i=t.doctypes.length?Math.round(t.write/t.read*100):0;a+=`<div class="ps-sim-module-card">
			<div class="ps-sim-mod-name">${n(t.module)}</div>
			<div class="ps-sim-mod-stats">
				<span title="${__("Can read")}" class="ps-sim-stat ps-stat-read">${frappe.utils.icon("eye","xs")} ${t.read}</span>
				<span title="${__("Can write")}" class="ps-sim-stat ps-stat-write">${frappe.utils.icon("edit","xs")} ${t.write}</span>
				<span title="${__("Can create")}" class="ps-sim-stat ps-stat-create">${frappe.utils.icon("add","xs")} ${t.create}</span>
				<span title="${__("Can delete")}" class="ps-sim-stat ps-stat-delete">${frappe.utils.icon("delete","xs")} ${t.delete}</span>
			</div>
			<div class="ps-sim-progress" title="${__("Write access: {0}%",[i])}">
				<div class="ps-sim-progress-bar" style="width:${i}%"></div>
			</div>
		</div>`}),a+="</div></div>",p.html(a)}var Me={"Approval Pending":{color:"ps-ai-grp-approval",icon:"review"},"Decision Pending":{color:"ps-ai-grp-decision",icon:"branch"},"Acknowledgement Pending":{color:"ps-ai-grp-ack",icon:"tick"}};function ue(p){let e=(p||"").toLowerCase();return/\b(accept|approve|submit|confirm|complete|done|pass)\b/.test(e)?"btn-success":/\b(reject|decline|cancel|return|refuse|deny|refuse)\b/.test(e)?"btn-danger":"btn-default"}function fe(p){let e=ue(p);return e==="btn-success"?0:e==="btn-danger"?2:1}function qe(p){(p&&p.groups||[]).forEach(e=>{(e.items||[]).forEach(s=>{Array.isArray(s.available_actions)&&s.available_actions.sort((a,t)=>fe(a)-fe(t))})})}var Ie={Critical:"ps-ai-pri-critical",Urgent:"ps-ai-pri-urgent",High:"ps-ai-pri-high",Medium:"ps-ai-pri-medium",Low:"ps-ai-pri-low"},G=class{constructor(e){this.wrapper=e.wrapper,this.data=null,this.collapsed={},this._search="",this._filter_doctype="",this._from_date="",this._to_date="",this._date_sort="desc",this._active_tab="pending",this._build_shell(),this.load()}_build_shell(){this.wrapper.html(`
            <div class="ps-ai-wrap">

                <div class="ps-ai-toolbar">
                    <div class="ps-ai-toolbar-left">
                        ${frappe.utils.icon("review","sm")}
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
                            ${frappe.utils.icon("refresh","xs")} ${__("Refresh")}
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
        `),this.wrapper.find(".ps-ai-refresh-btn").on("click",()=>this.load()),this.wrapper.find(".ps-ai-search").on("input",e=>{this._search=$(e.target).val().trim().toLowerCase(),this._active_tab==="pending"&&this._apply_filter()}),this.wrapper.find(".ps-ai-dt-filter").on("change",e=>{this._filter_doctype=$(e.target).val(),this._active_tab==="pending"&&this._apply_filter()}),this.wrapper.find(".ps-ai-from-date").on("change",e=>{this._from_date=$(e.target).val(),this._active_tab==="pending"&&this._apply_filter()}),this.wrapper.find(".ps-ai-to-date").on("change",e=>{this._to_date=$(e.target).val(),this._active_tab==="pending"&&this._apply_filter()}),this.wrapper.find(".ps-ai-nav-tab").on("click",e=>{let s=$(e.currentTarget).data("tab");this.wrapper.find(".ps-ai-nav-tab").removeClass("active"),$(e.currentTarget).addClass("active"),this._active_tab=s,this._switch_tab(s)})}_switch_tab(e){this.wrapper.find(".ps-ai-search, .ps-ai-dt-filter, .ps-ai-date-range").toggle(e==="pending"),this.wrapper.find(".ps-ai-stats-bar").toggle(e==="pending"),e==="pending"?this._render():e==="history"?this._render_history():e==="analytics"&&this._render_analytics()}load(){let e=this.wrapper.find(".ps-ai-body");e.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`),this.wrapper.find(".ps-ai-stats-bar").empty(),frappe.call({method:"permission_manager.permission_manager.api.approvals.get_my_pending_approvals",callback:s=>{this.data=s.message||{groups:[],total:0},qe(this.data),this._switch_tab(this._active_tab)},error:()=>{e.html(`
                    <div class="ps-ai-empty">
                        ${frappe.utils.icon("alert","lg")}
                        <p>${__("Failed to load approvals. Check console for errors.")}</p>
                    </div>
                `)}})}_render(){let e=this.data,s=this.wrapper.find(".ps-ai-body");this.wrapper.find(".ps-ai-total-badge").text(e.total||"").toggle(!!e.total);let a=this.wrapper.find(".ps-ai-dt-filter"),t=[...new Set(e.groups.flatMap(i=>i.items.map(o=>o.doctype)))].sort();if(a.html(`<option value="">${__("All Transactions")}</option>`),t.forEach(i=>a.append(`<option value="${n(i)}">${n(i)}</option>`)),this._render_stats_bar(),!e.total){s.html(`
                <div class="ps-ai-empty">
                    ${frappe.utils.icon("tick-circle","xl")}
                    <h4>${__("All Clear!")}</h4>
                    <p>${__("You have no pending approvals at this time.")}</p>
                </div>
            `);return}s.empty(),e.groups.forEach(i=>this._render_group(s,i)),(this._search||this._filter_doctype)&&this._apply_filter()}_render_stats_bar(){let e=this.data;if(!e.total)return;let s=e.groups.flatMap(i=>i.items).filter(i=>i.days>30).length,a=e.groups.flatMap(i=>i.items).filter(i=>["High","Urgent","Critical"].includes(i.priority)).length,t=e.groups.map(i=>`<span class="ps-ai-stat-cat">${n(__(i.label))}: <strong>${i.items.length}</strong></span>`).join("");this.wrapper.find(".ps-ai-stats-bar").html(`
            <div class="ps-ai-stats">
                ${t}
                ${a?`<span class="ps-ai-stat-alert">\u{1F534} ${a} ${__("high priority")}</span>`:""}
                ${s?`<span class="ps-ai-stat-overdue">\u26A0\uFE0F ${s} ${__("overdue (>30 days)")}</span>`:""}
            </div>
        `)}_render_group(e,s){let a=s.label,t=Me[a]||{color:"",icon:"list"},i=!!this.collapsed[a],o=a.replace(/\s+/g,"_").toLowerCase(),r=$(`
            <div class="ps-ai-group" data-category="${n(o)}">

                <div class="ps-ai-grp-hdr ${n(t.color)}">
                    <span class="ps-ai-grp-toggle">${i?"\u25B6":"\u25BC"}</span>
                    <span class="ps-ai-grp-icon">${frappe.utils.icon(t.icon,"xs")}</span>
                    <strong class="ps-ai-grp-label">${n(__(a))}</strong>
                    <span class="ps-ai-grp-count">${s.items.length}</span>

                    <div class="ps-ai-bulk-bar" ${i?'style="display:none"':""}>
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

                <div class="ps-ai-grp-body" ${i?'style="display:none"':""}>
                    <div class="ps-ai-table-wrap">
                        <table class="ps-matrix-table ps-ai-table">
                            <thead><tr>
                                <th class="ps-ai-col-chk"></th>
                                <th class="ps-ai-col-date ps-ai-col-sortable" data-sort="date">
                                    ${__("Date")} <span class="ps-ai-sort-icon">${this._date_sort==="asc"?"\u2191":"\u2193"}</span>
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
        `),l=r.find(".ps-ai-tbody"),c=r.find(".ps-ai-bulk-bar"),d=r.find(".ps-ai-bulk-btn"),_=r.find(".ps-ai-bulk-reject-btn");[...s.items].sort((m,f)=>{let u=(m.creation_iso||"").localeCompare(f.creation_iso||"");return this._date_sort==="asc"?u:-u}).forEach(m=>this._render_row(l,m)),r.find(".ps-ai-col-sortable").on("click",()=>{this._date_sort=this._date_sort==="asc"?"desc":"asc",this._render()}),r.find(".ps-ai-grp-hdr").on("click",m=>{if($(m.target).closest("input, button, label, a").length)return;let f=r.find(".ps-ai-grp-body"),u=f.is(":visible");this.collapsed[a]=u,f.toggle(!u),c.toggle(!u),r.find(".ps-ai-grp-toggle").text(u?"\u25B6":"\u25BC")}),r.find(".ps-ai-chk-all").on("change",function(){let m=$(this).is(":checked");l.find(".ps-ai-row-chk:not(:disabled)").prop("checked",m);let f=l.find(".ps-ai-row-chk:checked").length>0;d.toggle(f),_.toggle(f)}),l.on("change",".ps-ai-row-chk",()=>{let m=l.find(".ps-ai-row-chk:checked").length>0;d.toggle(m),_.toggle(m)}),d.on("click",()=>this._bulk_action(l.find(".ps-ai-row-chk:checked").closest("tr"),s.items,0)),_.on("click",()=>this._bulk_action(l.find(".ps-ai-row-chk:checked").closest("tr"),s.items,1)),e.append(r)}_render_row(e,s){let a=Ie[s.priority]||"ps-ai-pri-low",t=s.days>30?"ps-ai-days-critical":s.days>7?"ps-ai-days-warn":"ps-ai-days-ok",i=s.days>30?"ps-ai-row ps-ai-row-overdue":"ps-ai-row",o=[s.doctype,s.docname,s.creator,s.role_id,s.state].join(" ").toLowerCase(),r="";(s.available_actions||[]).forEach(d=>{r+=`<button class="btn btn-xs ${ue(d)} ps-ai-act-btn"
                data-action="${n(d)}"
                data-doctype="${n(s.doctype)}"
                data-docname="${n(s.docname)}"
                title="${n(d)}">${n(d)}</button>`}),r||(r=`<span class="ps-ai-no-action text-muted">${__("No action")}</span>`),s.is_adhoc?r+=`<span class="ps-ai-adhoc-badge" title="${__("Ad-hoc approval \u2014 forwarded to you")}">${__("Ad-hoc")}</span>`:r+=`<button class="btn btn-xs btn-default ps-ai-fwd-btn"
                data-name="${n(s.name)}"
                data-docname="${n(s.docname)}"
                title="${__("Forward to another approver")}">\u21E2</button>`,r+=`<a href="${n(s.doc_url)}" target="_blank"
            class="btn btn-xs btn-default ps-ai-open-btn" title="${__("Open document")}">\u2192</a>`;let l=11,c=$(`
            <tr class="${i}"
                data-name="${n(s.name)}"
                data-doctype="${n(s.doctype)}"
                data-docname="${n(s.docname)}"
                data-search="${n(o)}"
                data-creation="${n(s.creation_iso||"")}">
                <td class="ps-ai-col-chk">
                    <input type="checkbox" class="ps-ai-row-chk" />
                </td>
                <td class="ps-ai-col-date ps-ai-preview-trigger" title="${__("Click to preview")}" style="cursor:pointer">
                    ${n(s.date)}
                    <span class="ps-ai-expand-icon">\u25B8</span>
                </td>
                <td class="ps-ai-col-pri">
                    <span class="ps-ai-pri-badge ${a}">${n(s.priority)}</span>
                </td>
                <td class="ps-ai-col-trans" title="${n(s.doctype)}">${n(s.doctype)}</td>
                <td class="ps-ai-col-num">
                    <a class="ps-ai-doc-link" href="${n(s.doc_url)}" target="_blank">
                        ${n(s.docname)}
                    </a>
                </td>
                <td class="ps-ai-col-role">${n(s.role_id)}</td>
                <td class="ps-ai-col-holder">
                    ${s.role_id&&s.role_id!=="Direct"?`<span class="text-muted ps-ai-holder-role">${n(s.role_id)}</span>`:s.holder?`<span class="ps-ai-holder-name">${n(s.holder)}</span>`:'<span class="text-muted">\u2014</span>'}
                </td>
                <td class="ps-ai-col-state">
                    <span class="ps-ai-state-badge">${n(s.state)}</span>
                </td>
                <td class="ps-ai-col-days">
                    <span class="ps-ai-days-badge ${t}">${s.days}</span>
                </td>
                <td class="ps-ai-col-creator">${n(s.creator)}</td>
                <td class="ps-ai-col-actions">${r}</td>
            </tr>
            <tr class="ps-ai-preview-row" style="display:none">
                <td colspan="${l}" class="ps-ai-preview-cell">
                    <div class="ps-ai-preview-body">
                        <span class="text-muted">${__("Loading\u2026")}</span>
                    </div>
                </td>
            </tr>
        `);c.filter(".ps-ai-row").find(".ps-ai-preview-trigger").on("click",()=>{let d=c.filter(".ps-ai-preview-row"),_=d.find(".ps-ai-preview-body");if(d.is(":visible")){d.hide(),c.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("\u25B8");return}d.show(),c.filter(".ps-ai-row").find(".ps-ai-expand-icon").text("\u25BE"),!_.data("loaded")&&(_.data("loaded",!0),this._load_preview(_,s.doctype,s.docname))}),c.filter(".ps-ai-row").find(".ps-ai-act-btn").on("click",d=>{let _=$(d.currentTarget);this._do_action(_.data("doctype"),_.data("docname"),_.data("action"))}),c.filter(".ps-ai-row").find(".ps-ai-fwd-btn").on("click",d=>{let _=$(d.currentTarget);this._do_forward(_.data("name"),_.data("docname"))}),e.append(c)}_load_preview(e,s,a){frappe.call({method:"frappe.client.get",args:{doctype:s,name:a},callback:t=>{if(!t.message){e.html(`<span class="text-muted">${__("Could not load document.")}</span>`);return}let i=t.message,o=frappe.get_meta(s);if(!o){frappe.model.with_doctype(s,()=>this._load_preview(e,s,a)),e.data("loaded",!1);return}let r=new Set(["Section Break","Column Break","HTML","Button","Tab Break","Code","JSON","Long Text","Small Text","Text","Text Editor","Signature","Attach","Attach Image","Barcode","Geolocation","Table","Table MultiSelect","Password"]),l=new Set(["exchange_rate","conversion_rate","base_exchange_rate","naming_series","amended_from","amended_to","docstatus","idx","owner","modified","modified_by","creation","name","workflow_state","letter_head","select_print_heading","tc_name","terms","taxes_and_charges","shipping_rule","discount_amount","additional_discount_percentage","apply_discount_on","in_words","base_in_words","language","meta_image","status_field","source","base_grand_total","base_net_total","base_total","base_tax_withholding_net_total","outstanding_amount","debit_to","credit_to","against_expense_account","against_income_account","remarks","user_remark","instructions","total_advance","total_taxes_and_charges","total_billing_amount","update_stock","set_warehouse","set_target_warehouse","scan_barcode","barcode","image","company_address_display","customer_address","contact_display","contact_email","contact_mobile","shipping_address_name","billing_address"]),c=o.fields.filter(f=>!r.has(f.fieldtype)&&!l.has(f.fieldname)&&!f.hidden&&!f.print_hide&&i[f.fieldname]!=null&&i[f.fieldname]!==""),d=f=>f.in_preview?0:f.bold?1:f.in_list_view?2:3;c.sort((f,u)=>d(f)-d(u));let _=f=>{let u=document.createElement("div");return u.innerHTML=f,u.textContent||u.innerText||f},h=(f,u)=>f.fieldtype==="Check"?u?__("Yes"):__("No"):f.fieldtype==="Date"||f.fieldtype==="Datetime"?frappe.datetime.str_to_user(u)||u:["Currency","Float","Int","Percent"].includes(f.fieldtype)?_(frappe.format(u,f)||String(u)):typeof u=="object"||Array.isArray(u)?null:String(u),m=c.slice(0,8).map(f=>{let u=h(f,i[f.fieldname]);return u===null?"":`<div class="ps-ai-prev-row">
                            <span class="ps-ai-prev-label">${n(__(f.label||f.fieldname))}</span>
                            <span class="ps-ai-prev-val">${n(u)}</span>
                        </div>`}).filter(Boolean);e.html(m.length?`<div class="ps-ai-prev-grid">${m.join("")}</div>`:`<span class="text-muted">${__("No key fields to preview.")}</span>`)},error:()=>e.html(`<span class="text-muted">${__("Preview failed.")}</span>`)})}_do_action(e,s,a){let t=new frappe.ui.Dialog({title:`${__(a)}: ${n(s)}`,fields:[{fieldtype:"HTML",fieldname:"doc_info",options:`<div class="ps-ai-dlg-info">
                        <strong>${__("DocType")}:</strong> ${n(e)}<br>
                        <strong>${__("Document")}:</strong> ${n(s)}
                    </div>`},{fieldtype:"Select",fieldname:"priority",label:__("Priority"),options:`Low
Medium
High
Critical`,default:"Medium"},{fieldtype:"Small Text",fieldname:"comment",label:__("Comment"),description:__("Optional note added to the document.")}],primary_action_label:__(a),primary_action:i=>{t.hide(),frappe.dom.freeze(__("Applying \u2014 {0}\u2026",[a])),frappe.call({method:"permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",args:{doctype:e,docname:s,action:a,comment:i.comment||"",priority:i.priority||"Medium"},callback:o=>{var r;frappe.dom.unfreeze(),(r=o.message)!=null&&r.success&&(frappe.show_alert({message:__("{0} \u2014 {1} applied.",[s,a]),indicator:"green"}),this.load())},error:()=>frappe.dom.unfreeze()})}});t.show()}_do_forward(e,s){let a=new frappe.ui.Dialog({title:__("Forward: {0}",[s]),fields:[{fieldtype:"HTML",fieldname:"info",options:`<p class="text-muted small">${__("The selected user will receive this action as an ad-hoc approver. Your action will be marked Forwarded.")}</p>`},{fieldtype:"Link",fieldname:"to_user",label:__("Forward To"),options:"User",reqd:1,filters:{enabled:1,user_type:"System User"}},{fieldtype:"Small Text",fieldname:"comment",label:__("Note"),description:__("Optional reason for forwarding.")}],primary_action_label:__("Forward"),primary_action:t=>{if(!t.to_user){frappe.msgprint(__("Please select a user to forward to."));return}a.hide(),frappe.dom.freeze(__("Forwarding\u2026")),frappe.call({method:"permission_manager.permission_manager.doctype.pm_workflow_action.pm_workflow_action.forward_workflow_action",args:{action_name:e,to_user:t.to_user,comment:t.comment||""},callback:i=>{var o;frappe.dom.unfreeze(),(o=i.message)!=null&&o.adhoc_action&&(frappe.show_alert({message:__("{0} forwarded successfully.",[s]),indicator:"green"}),this.load())},error:()=>frappe.dom.unfreeze()})}});a.show()}_bulk_action(e,s,a){let t=e.toArray();if(!t.length)return;let i=t.map(o=>{var c;let r=$(o).attr("data-docname"),l=s.find(d=>d.docname===r);return{doctype:$(o).attr("data-doctype"),docname:r,action:((c=l==null?void 0:l.available_actions)==null?void 0:c[a])||""}}).filter(o=>o.action);if(!i.length){frappe.show_alert({message:__("No applicable action found."),indicator:"orange"});return}frappe.confirm(__("Apply <b>{0}</b> to {1} document(s)?",[i[0].action,i.length]),()=>{let o=0,r=0;frappe.dom.freeze(__("Processing {0} documents\u2026",[i.length]));let l=c=>{if(c>=i.length){frappe.dom.unfreeze(),frappe.show_alert({message:__("{0} applied: {1} succeeded, {2} failed.",[i[0].action,o,r]),indicator:r?"orange":"green"}),this.load();return}let{doctype:d,docname:_,action:h}=i[c];frappe.call({method:"permission_manager.permission_manager.api.approvals.quick_apply_workflow_action",args:{doctype:d,docname:_,action:h,comment:""},callback:()=>{o++,l(c+1)},error:()=>{r++,l(c+1)}})};l(0)})}_apply_filter(){let e=this._search,s=this._filter_doctype,a=this._from_date,t=this._to_date;this.wrapper.find(".ps-ai-row").each((o,r)=>{let l=$(r),c=(l.attr("data-search")||"").toLowerCase(),d=l.attr("data-doctype")||"",_=l.attr("data-creation")||"",h=(!a||_>=a)&&(!t||_<=t),m=(!e||c.includes(e))&&(!s||d===s)&&h;l.toggle(m),l.next(".ps-ai-preview-row").toggle(m&&l.next(".ps-ai-preview-row").find(".ps-ai-preview-body").data("loaded"))}),this.wrapper.find(".ps-ai-group").each((o,r)=>{let l=$(r),c=l.find(".ps-ai-row:visible").length;l.find(".ps-ai-grp-count").text(c),l.toggle(c>0||!e&&!s)});let i=this.wrapper.find(".ps-ai-row:visible").length;this.wrapper.find(".ps-ai-total-badge").text(i||"").toggle(!!i)}_render_history(){let e=this.wrapper.find(".ps-ai-body");e.html(`<div class="ps-loading">${__("Loading history\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.approvals.get_my_approval_history",args:{limit:200},callback:s=>{let a=s.message||[];if(!a.length){e.html(`<div class="ps-ai-empty"><h4>${__("No approval history yet.")}</h4><p class="text-muted">${__("Actions appear here once approvals are processed on your documents.")}</p></div>`);return}let t=`
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
                        ${a.map(i=>`<tr>
                                <td>${n(i.date)}</td>
                                <td>${n(i.doctype)}</td>
                                <td><a href="${n(i.doc_url)}" target="_blank">${n(i.docname)}</a></td>
                                <td><span class="ps-ai-state-badge">${n(i.action_state||"\u2014")}</span></td>
                                <td><span class="ps-ai-state-badge ps-ai-state-current">${n(i.current_state||"\u2014")}</span></td>
                                <td>${n(i.completed_by||"\u2014")}</td>
                                <td>${n(i.role||"\u2014")}</td>
                            </tr>`).join("")}
                        </tbody>
                    </table>
                    </div>
                `;e.html(t)},error:()=>e.html(`<div class="ps-ai-empty"><p>${__("Failed to load history.")}</p></div>`)})}_render_analytics(){let e=this.wrapper.find(".ps-ai-body");e.html(`<div class="ps-loading">${__("Loading analytics\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.approvals.get_approval_analytics",callback:s=>{let a=s.message||{},{summary:t,volume_by_doctype:i=[],longest_pending:o=[],top_approvers:r=[]}=a;if(!t){e.html(`<div class="ps-ai-empty"><h4>${__("No data yet.")}</h4></div>`);return}let l=`
                    <div class="ps-ai-analytics-summary">
                        <div class="ps-ai-stat-tile ps-ai-tile-open">
                            <div class="ps-ai-tile-num">${t.total_open}</div>
                            <div class="ps-ai-tile-label">${__("Currently Open")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-done">
                            <div class="ps-ai-tile-num">${t.completed_last_30d}</div>
                            <div class="ps-ai-tile-label">${__("Completed (30 days)")}</div>
                        </div>
                        <div class="ps-ai-stat-tile ps-ai-tile-overdue">
                            <div class="ps-ai-tile-num">${t.overdue}</div>
                            <div class="ps-ai-tile-label">${__("Overdue (>30 days)")}</div>
                        </div>
                    </div>
                `,c=i.length?`
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
                            ${i.map(h=>`
                                <tr>
                                    <td>${n(h.doctype)}</td>
                                    <td>${h.count}</td>
                                    <td>${h.avg_days}</td>
                                    <td>
                                        <div class="ps-ai-bar-wrap">
                                            <div class="ps-ai-bar" style="width:${Math.min(100,h.avg_days*5)}%"></div>
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                `:"",d=o.length?`
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
                            ${o.map(h=>`
                                <tr>
                                    <td>${n(h.doctype)}</td>
                                    <td><a href="${n(h.doc_url)}" target="_blank">${n(h.docname)}</a></td>
                                    <td><span class="ps-ai-state-badge">${n(h.state)}</span></td>
                                    <td><span class="ps-ai-days-badge ${h.days>30?"ps-ai-days-critical":"ps-ai-days-warn"}">${h.days}</span></td>
                                </tr>
                            `).join("")}
                            </tbody>
                        </table>
                    </div>
                `:"",_=r.length?`
                    <div class="ps-ai-analytics-section">
                        <h5>${__("Top Approvers (last 30 days)")}</h5>
                        <div class="ps-ai-approver-list">
                        ${r.map((h,m)=>`
                            <div class="ps-ai-approver-row">
                                <span class="ps-ai-approver-rank">#${m+1}</span>
                                <span class="ps-ai-approver-name">${n(h.name)}</span>
                                <span class="ps-ai-approver-count">${h.count} ${__("approvals")}</span>
                                <div class="ps-ai-bar-wrap">
                                    <div class="ps-ai-bar ps-ai-bar-green" style="width:${Math.min(100,h.count/r[0].count*100)}%"></div>
                                </div>
                            </div>
                        `).join("")}
                        </div>
                    </div>
                `:"";e.html(`
                    <div class="ps-ai-analytics-wrap">
                        ${l}
                        ${c}
                        ${d}
                        ${_}
                    </div>
                `)},error:()=>e.html(`<div class="ps-ai-empty"><p>${__("Failed to load analytics.")}</p></div>`)})}};var W=class{constructor({wrapper:e,workflow_name:s}){this.$wrapper=$(e),this.workflow_name=s,this._data=null}load(){this.$wrapper.html(`<div class="ps-wfd-loading text-muted text-center py-5">
            ${frappe.utils.icon("refresh","sm")} Loading diagram\u2026
        </div>`),frappe.call({method:"permission_manager.permission_manager.workflow.get_diagram_data",args:{workflow_name:this.workflow_name},callback:e=>{e.message?(this._data=e.message,this._render()):this.$wrapper.html('<div class="text-muted text-center py-5">No workflow data found.</div>')}})}_render(){let{states:e,transitions:s}=this._data,a=this._bfs_layout(e,s),t=140,i=44,o=80,r=60,l=40,c=0,d=0;Object.values(a).forEach(({col:g,row:v})=>{g>c&&(c=g),v>d&&(d=v)});let _=(c+1)*(t+o)+l*2-o,h=(d+1)*(i+r)+l*2-r,m={};Object.entries(a).forEach(([g,{col:v,row:k}])=>{m[g]={x:l+v*(t+o),y:l+k*(i+r)}});let f="http://www.w3.org/2000/svg",u=document.createElementNS(f,"svg");u.setAttribute("xmlns",f),u.setAttribute("width",_),u.setAttribute("height",h),u.setAttribute("class","ps-wfd-svg"),u.setAttribute("viewBox",`0 0 ${_} ${h}`);let y=document.createElementNS(f,"defs");y.innerHTML=`
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#5e72e4"/>
            </marker>
            <marker id="arrow-return" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#f5a623"/>
            </marker>
        `,u.appendChild(y),this._group_transitions(s).forEach(g=>{let v=m[g.from_state],k=m[g.to_state];if(!v||!k)return;let C=g.is_return,w=g.from_state===g.to_state,A=document.createElementNS(f,"g");A.setAttribute("class","ps-wfd-edge");let N;if(w){let P=v.x+t/2,E=v.y;N=`M ${P-20},${E} C ${P-40},${E-60} ${P+40},${E-60} ${P+20},${E}`}else if(v.x===k.x)N=`M ${v.x+t/2},${v.y+i} L ${k.x+t/2},${k.y}`;else{let P=v.x+t,E=v.y+i/2,Z=k.x,Y=k.y+i/2,ee=(P+Z)/2,se=C?Math.max(E,Y)+40:Math.min(E,Y)-30;N=`M ${P},${E} C ${ee},${se} ${ee},${se} ${Z},${Y}`}let L=document.createElementNS(f,"path");L.setAttribute("d",N),L.setAttribute("class",C?"ps-wfd-arrow ps-wfd-arrow--return":"ps-wfd-arrow"),L.setAttribute("marker-end",C?"url(#arrow-return)":"url(#arrow)"),A.appendChild(L);let D=document.createElementNS(f,"text");D.setAttribute("class","ps-wfd-edge-label");let ve=g.actions.join(" / "),V=L.getPointAtLength?L.getPointAtLength(L.getTotalLength?L.getTotalLength()/2:50):null;V?(D.setAttribute("x",V.x),D.setAttribute("y",V.y-6)):(D.setAttribute("x",(v.x+t+k.x)/2),D.setAttribute("y",(v.y+k.y)/2+i/2-6)),D.setAttribute("text-anchor","middle"),D.textContent=ve,A.appendChild(D),u.appendChild(A)}),e.forEach(g=>{let v=m[g.name];if(!v)return;let k=document.createElementNS(f,"g");k.setAttribute("class",`ps-wfd-node ps-wfd-node--${this._state_class(g)}`),k.setAttribute("transform",`translate(${v.x},${v.y})`);let C=document.createElementNS(f,"rect");C.setAttribute("width",t),C.setAttribute("height",i),C.setAttribute("rx",8),k.appendChild(C);let w=document.createElementNS(f,"text");if(w.setAttribute("x",t/2),w.setAttribute("y",i/2+1),w.setAttribute("text-anchor","middle"),w.setAttribute("dominant-baseline","middle"),w.setAttribute("class","ps-wfd-node-label"),w.textContent=g.name,k.appendChild(w),g.doc_status){let A=document.createElementNS(f,"text");A.setAttribute("x",t-6),A.setAttribute("y",10),A.setAttribute("text-anchor","end"),A.setAttribute("class","ps-wfd-node-badge"),A.textContent={0:"Draft",1:"Submitted",2:"Cancelled"}[g.doc_status]||"",k.appendChild(A)}u.appendChild(k)});let T=$(`<div class="ps-wfd-legend">
            <span class="ps-wfd-leg-item ps-wfd-leg--draft">Draft state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--submitted">Submitted state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--cancelled">Cancelled state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--other">Other state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--return">Return for correction</span>
        </div>`);this.$wrapper.empty().append($('<div class="ps-wfd-canvas">').append(u)).append(T)}_bfs_layout(e,s){var d;let a={},t={};e.forEach(_=>{a[_.name]=[],t[_.name]=0}),s.forEach(_=>{_.from_state!==_.to_state&&(a[_.from_state]=a[_.from_state]||[],a[_.from_state].includes(_.to_state)||a[_.from_state].push(_.to_state),t[_.to_state]=(t[_.to_state]||0)+1)});let i=e.map(_=>_.name).filter(_=>!t[_]);i.length||i.push((d=e[0])==null?void 0:d.name);let o={},r=i.map(_=>({name:_,col:0})),l={},c=new Set;for(;r.length;){let{name:_,col:h}=r.shift();c.has(_)||(c.add(_),l[h]=l[h]||0,o[_]={col:h,row:l[h]++},(a[_]||[]).forEach(m=>{c.has(m)||r.push({name:m,col:h+1})}))}return e.forEach(_=>{if(!o[_.name]){let h=Object.keys(l).length;l[h]=l[h]||0,o[_.name]={col:h,row:l[h]++}}}),o}_group_transitions(e){let s={};return e.forEach(a=>{let t=`${a.from_state}|||${a.to_state}`;s[t]||(s[t]={from_state:a.from_state,to_state:a.to_state,actions:[],is_return:!1}),a.action&&!s[t].actions.includes(a.action)&&s[t].actions.push(a.action),a.is_return&&(s[t].is_return=!0)}),Object.values(s)}_state_class(e){let s=String(e.doc_status);return s==="1"?"submitted":s==="2"?"cancelled":s==="0"?"draft":"other"}show_dialog(){let e=new frappe.ui.Dialog({title:__("Workflow Diagram \u2014 {0}",[this.workflow_name]),size:"extra-large"});e.show(),this.$wrapper=$(e.body),this.load()}};window.permission_manager_studio=window.permission_manager_studio||{};var Q=class{constructor(e){this.page=e,this.current_tab="user",this.components={},this._current_user=null,this._current_doctype=null,this._current_role=null,this.setup_page(),this.setup_tabs(),this.render_tab("user")}setup_page(){this.page.set_title(__("Permission Studio")),this.$wrapper=$(`
			<div class="ps-app">
				<div class="ps-tabs"></div>
				<div class="ps-search-bar"></div>
				<div class="ps-content"></div>
			</div>
		`).appendTo(this.page.body),this.$tabs=this.$wrapper.find(".ps-tabs"),this.$search=this.$wrapper.find(".ps-search-bar"),this.$content=this.$wrapper.find(".ps-content")}setup_tabs(){[{key:"user",label:__("User View"),icon:"users"},{key:"doctype",label:__("DocType View"),icon:"list"},{key:"role",label:__("Role View"),icon:"tool"},{key:"profile",label:__("Profile View"),icon:"group"},{key:"accounts",label:__("Accounts"),icon:"bank"},{key:"lookup",label:__("Who Can?"),icon:"search"},{key:"compare",label:__("Compare"),icon:"compare"},{key:"dashboard",label:__("Health"),icon:"dashboard"},{key:"auditlog",label:__("Audit Log"),icon:"file"}].forEach(s=>{let a=$(`
				<button class="ps-tab ${s.key===this.current_tab?"active":""}"
						data-tab="${s.key}">
					${frappe.utils.icon(s.icon,"sm")}
					<span>${s.label}</span>
				</button>
			`);a.on("click",()=>this.switch_tab(s.key)),this.$tabs.append(a)})}switch_tab(e){e!==this.current_tab&&(this.current_tab=e,this.$tabs.find(".ps-tab").removeClass("active"),this.$tabs.find(`[data-tab="${e}"]`).addClass("active"),this.render_tab(e))}render_tab(e){switch(this.$search.empty(),this.$content.empty(),e){case"user":this._render_user_tab();break;case"doctype":this._render_doctype_tab();break;case"role":this._render_role_tab();break;case"profile":this._render_profile_tab();break;case"accounts":this._render_accounts_tab();break;case"lookup":this._render_lookup_tab();break;case"compare":this._render_compare_tab();break;case"dashboard":this._render_dashboard_tab();break;case"auditlog":this._render_auditlog_tab();break}}_render_user_tab(){var e;this.$search.html(`
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
		`),this.user_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"User",fieldname:"user",placeholder:__("Select User\u2026"),label:__("User"),change:()=>{let s=this.user_field.get_value();s&&(this._current_user=s,this.load_user_matrix(s))}},parent:this.$search.find("#ps-user-select"),render_input:!0}),this.module_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"Module Def",fieldname:"module",placeholder:__("All Modules"),label:__("Module"),change:()=>{this._current_user&&this.load_user_matrix(this._current_user)}},parent:this.$search.find("#ps-module-filter"),render_input:!0}),this.search_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"DocType",fieldname:"dt_search",placeholder:__("Filter by DocType\u2026"),label:__("Search"),change:()=>this._apply_dt_filter()},parent:this.$search.find("#ps-dt-search"),render_input:!0}),(e=this.search_field.$input)==null||e.on("input",()=>this._apply_dt_filter()),this.$content.html(this._welcome_html(frappe.utils.icon("users","lg"),__("Select a User"),__("View permissions, test access, export, and manage restrictions for any user.")))}_render_doctype_tab(){if(this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-doctype-select"></div>
			</div>
		`),this.doctype_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"DocType",fieldname:"doctype",placeholder:__("Select DocType\u2026"),label:__("DocType"),change:()=>{let e=this.doctype_field.get_value();e&&(this._current_doctype=e,this.load_doctype_matrix(e))}},parent:this.$search.find("#ps-doctype-select"),render_input:!0}),this._pending_doctype_edit){let e=this._pending_doctype_edit;this._pending_doctype_edit=null,setTimeout(()=>{this.doctype_field.set_value(e),this._current_doctype=e,this.load_doctype_matrix(e,!0)},100)}else this.$content.html(this._welcome_html(frappe.utils.icon("list","lg"),__("Select a DocType"),__("View, edit, bulk-apply, or export permissions for any DocType.")))}_render_role_tab(){this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-role-select"></div>
			</div>
		`),this.role_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"Role",fieldname:"role",placeholder:__("Select Role\u2026"),label:__("Role"),change:()=>{let e=this.role_field.get_value();e&&(this._current_role=e,this.load_role_matrix(e))}},parent:this.$search.find("#ps-role-select"),render_input:!0}),this.$content.html(this._welcome_html(frappe.utils.icon("tool","lg"),__("Select a Role"),__("View or edit permissions for a role, grouped by module.")))}_render_lookup_tab(){this.components.lookup=new j({wrapper:this.$content})}_render_compare_tab(){this.components.compare=new U({wrapper:this.$content})}_render_dashboard_tab(){this.components.dashboard=new H({wrapper:this.$content})}_render_auditlog_tab(){this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-al-doctype-field"></div>
				<div class="ps-search-field" id="ps-al-role-field"></div>
				<button class="btn btn-sm btn-primary ps-al-search-btn">${__("Search")}</button>
				<button class="btn btn-sm btn-default ps-al-clear-btn">${__("Clear")}</button>
			</div>
		`);let e=frappe.ui.form.make_control({parent:this.$search.find("#ps-al-doctype-field"),df:{fieldtype:"Link",options:"DocType",label:__("DocType"),placeholder:__("All DocTypes")},render_input:!0}),s=frappe.ui.form.make_control({parent:this.$search.find("#ps-al-role-field"),df:{fieldtype:"Data",label:__("Role"),placeholder:__("All Roles")},render_input:!0}),a=()=>{this.$content.html(`<div class="ps-loading">${__("Loading audit log\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.approvals.get_permission_audit_log",args:{doctype_name:e.get_value()||"",role:s.get_value()||"",limit:200},callback:t=>{let i=t.message||[];if(!i.length){this.$content.html(`<div class="ps-empty-state">${__("No audit log entries found.")}</div>`);return}let o=`
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
					`;i.forEach(r=>{o+=`<tr>
							<td style="white-space:nowrap;font-size:11px">${n(r.changed_on||"")}</td>
							<td>${n(r.changed_by||"")}</td>
							<td><span class="ps-badge ps-badge-custom ps-xs-badge">${n(r.source||"")}</span></td>
							<td>${n(r.doctype_name||"")}</td>
							<td>${n(r.role||"")}</td>
							<td>${n(r.ptype||"")}</td>
							<td class="ps-al-old">${n(String(r.old_value||""))}</td>
							<td class="ps-al-new">${n(String(r.new_value||""))}</td>
							<td class="text-muted" style="font-size:11px">${n(r.note||"")}</td>
						</tr>`}),o+="</tbody></table></div>",this.$content.html(o)}})};this.$search.find(".ps-al-search-btn").on("click",a),this.$search.find(".ps-al-clear-btn").on("click",()=>{e.set_value(""),s.set_value(""),a()}),a()}_apply_dt_filter(){var s;let e=(((s=this.search_field)==null?void 0:s.get_value())||"").toLowerCase();this.$content.find(".ps-matrix-row").each(function(){$(this).toggle(!e||($(this).data("doctype")||"").toLowerCase().includes(e))})}load_user_matrix(e){var a;this.$content.html(this._show_skeleton(8));let s=((a=this.module_field)==null?void 0:a.get_value())||null;frappe.call({method:"permission_manager.permission_manager.api.matrix.get_user_matrix",args:{user:e,module:s},callback:t=>{t.message&&(this.$search.find(".ps-quick-tools-wrap").show(),this.$search.find(".ps-quick-tools-btn").off("click").on("click",()=>{this._show_quick_tools_dialog(e)}),this.components.matrix=new O({wrapper:this.$content,data:t.message,mode:"user",on_why_click:(i,o)=>this.show_why(e,i,o),on_restrictions_click:()=>this.show_restrictions(e),on_edit_doctype:i=>this._open_doctype_edit_dialog(i),on_export:(i,o)=>this._export_csv(i,o),on_simulate:i=>K(i)}),this._inject_override_button(e))},error:()=>{this.$content.html(this._error_html(__("Failed to load permission matrix."),()=>this.load_user_matrix(e)))}})}_inject_override_button(e){frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_user_override_status",args:{user:e},callback:s=>{if(!s.message)return;let a=s.message,t=this.$content.find(".ps-header-actions").first(),i=$(`
					<button class="btn btn-xs btn-default ps-acct-restrict-btn">
						${frappe.utils.icon("account","xs")} ${__("Account Restrictions")}
					</button>
				`);i.on("click",()=>this._show_account_restrictions_dialog(e)),t.prepend(i);let o=a.is_active,r=$(`
					<button class="btn btn-xs ${o?"btn-warning":"btn-default"} ps-override-btn">
						${frappe.utils.icon("lock","xs")}
						${o?`\u26A1 ${__("Override Active")}`:__("Override for User")}
					</button>
				`);r.on("click",()=>this._show_user_override_dialog(e,a)),t.prepend(r)}})}load_doctype_matrix(e,s=!1){this.$content.html(this._show_skeleton(6)),frappe.call({method:"permission_manager.permission_manager.api.matrix.get_doctype_matrix",args:{doctype:e},callback:a=>{if(a.message){let t=new O({wrapper:this.$content,data:a.message,mode:"doctype",on_reload:()=>this.load_doctype_matrix(e),on_export:(i,o)=>this._export_csv(i,o),on_bulk_apply:()=>this._show_bulk_apply_dialog(e)});this.components.matrix=t,s&&t._toggle_edit_mode()}},error:()=>{this.$content.html(this._error_html(__("Failed to load DocType permissions."),()=>this.load_doctype_matrix(e)))}})}load_role_matrix(e){this.$content.html(this._show_skeleton(6)),frappe.call({method:"permission_manager.permission_manager.api.matrix.get_role_matrix",args:{role:e},callback:s=>{s.message&&(this.components.matrix=new q({wrapper:this.$content,data:s.message,on_export:()=>this._export_csv("role",e)}))},error:()=>{this.$content.html(this._error_html(__("Failed to load role permissions."),()=>this.load_role_matrix(e)))}})}_render_accounts_tab(){this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-acctab-user-select"></div>
			</div>
		`),this.acctab_user_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"User",fieldname:"acctab_user",placeholder:__("Select User\u2026"),label:__("User"),change:()=>{let e=this.acctab_user_field.get_value();e&&(this._current_acctab_user=e,this._load_user_accounts(e))}},parent:this.$search.find("#ps-acctab-user-select"),render_input:!0}),this.$content.html(this._welcome_html(frappe.utils.icon("bank","lg"),__("Select a User"),__("Control which accounts this user can access. Drag accounts into the Restricted zone to limit access.")))}_load_user_accounts(e){this.$content.html(this._show_skeleton(5)),frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_user_account_restrictions",args:{user:e},callback:s=>{s.message&&this._render_account_dnd(e,s.message)},error:()=>{this.$content.html(this._error_html(__("Failed to load accounts."),()=>this._load_user_accounts(e)))}})}_render_account_dnd(e,s){let a={};for(let d of s.restrictions)a[d.for_value]=d;let t=s.all_accounts.filter(d=>!a[d.name]),i=d=>{if(!d.length)return`<div class="ps-ac-zone-empty">${__("No accounts available.")}</div>`;let _=["Asset","Liability","Income","Expense","Equity"],h={Asset:"\u{1F4CA}",Liability:"\u{1F4CB}",Income:"\u{1F4C8}",Expense:"\u{1F4C9}",Equity:"\u2696\uFE0F"},m={};d.forEach(g=>{m[g.name]=oe(ie({},g),{children:[]})});let f=[];d.forEach(g=>{let v=m[g.name];g.parent_account&&m[g.parent_account]?m[g.parent_account].children.push(v):f.push(v)});let u=g=>g.is_group?g.children.reduce((v,k)=>v+u(k),0):1,y=g=>{let v=g.account_name||g.name.split(" - ")[0],k=(g.account_name+" "+g.name).toLowerCase();if(g.is_group){let C=u(g),w=g.children.map(y).join("");return`<div class="ps-ac-folder-row">
						<div class="ps-ac-folder-hdr ps-ac-expanded"
						     data-name="${n(g.name)}"
						     data-search="${n(k)}">
							<span class="ps-ac-folder-icon">\u25B6</span>
							<span class="ps-ac-folder-name">${n(v)}</span>
							${C?`<span class="ps-ac-node-count">${C}</span>`:""}
						</div>
						<div class="ps-ac-folder-body">
							${w}
						</div>
					</div>`}else return`<div class="ps-ac-chip ps-ac-avail" draggable="true"
						data-account="${n(g.name)}"
						data-source="available"
						data-company="${n(g.company||"")}"
						data-root="${n(g.root_type||"")}"
						data-search="${n(k)}"
						title="${n(g.name)}">
						<span class="ps-ac-chip-label">${n(v)}</span>
						${g.account_type?`<span class="ps-ac-type-badge">${n(g.account_type)}</span>`:""}
					</div>`},R=[...new Set(d.map(g=>g.company||""))].sort(),T="";return R.forEach(g=>{let v=f.filter(w=>(w.company||"")===g),k=[...new Set(d.filter(w=>(w.company||"")===g).map(w=>w.root_type||"Other"))],C=[..._.filter(w=>k.includes(w)),...k.filter(w=>!_.includes(w))];T+=`<div class="ps-ac-company-block" data-company="${n(g)}">
					<div class="ps-ac-company-hdr">${frappe.utils.icon("building","xs")} ${n(g)}</div>`,C.forEach(w=>{let A=v.filter(N=>(N.root_type||"Other")===w);T+=`<div class="ps-ac-root-block" data-root="${n(w)}">
						<div class="ps-ac-root-hdr">${h[w]||"\u{1F4C1}"} ${n(w)}</div>
						${A.map(y).join("")}
					</div>`}),T+="</div>"}),T},o=s.restrictions.map(d=>{let _=d.for_value.includes(" - ")?d.for_value.split(" - ")[0]:d.for_value;return`<div class="ps-ac-chip ps-ac-restricted" draggable="true"
						data-account="${n(d.for_value)}"
						data-perm-name="${n(d.name)}"
						data-source="restricted"
						title="${n(d.for_value)}">
						<span class="ps-ac-chip-label">${n(_)}</span>
						<button class="ps-ac-chip-x btn-naked" data-perm-name="${n(d.name)}" title="${__("Remove")}">\u2715</button>
					</div>`}).join(""),r=s.is_restricted?`<div class="ps-ac-restricted-chips">${o}</div>`:`<div class="ps-ac-zone-unrestricted">
				${frappe.utils.icon("tick-circle","sm")}
				<span>${__("No restrictions \u2014 user has access to all accounts.")}</span>
				<small>${__("Drag accounts here to restrict.")}</small>
			   </div>`,l=[...new Set(t.map(d=>d.company||""))].sort(),c=(s.company_restrictions||[]).length?`<span class="ps-ac-co-notice">\u{1F512} ${__("Filtered to {0} company restriction(s)",[s.company_restrictions.length])}</span>`:"";this.$content.html(`
			<div class="ps-accounts-dnd">

				<div class="ps-ac-topbar">
					<div class="ps-ac-topbar-left">
						<span class="ps-ac-user-badge">${n(e)}</span>
						<span class="ps-ac-status-badge ${s.is_restricted?"ps-ac-status-restricted":"ps-ac-status-open"}">
							${s.is_restricted?`\u{1F512} ${__("{0} restricted",[s.restrictions.length])}`:`\u2713 ${__("All accounts open")}`}
						</span>
						${c}
					</div>
					<div class="ps-ac-topbar-right">
						${s.is_restricted?`<button class="btn btn-sm btn-default ps-ac-clear-btn">
							${frappe.utils.icon("undo","xs")} ${__("Clear All")}
						</button>`:""}
					</div>
				</div>

				<div class="ps-ac-filter-row">
					<input class="form-control ps-ac-search" placeholder="${__("Search accounts\u2026")}" type="text" autocomplete="off" />
					<select class="form-control ps-ac-company-sel">
						<option value="">${__("All Companies")}</option>
						${l.map(d=>`<option value="${n(d)}">${n(d)}</option>`).join("")}
					</select>
				</div>

				<div class="ps-ac-panels">
					<div class="ps-ac-panel">
						<div class="ps-ac-panel-header">
							${frappe.utils.icon("list","xs")}
							<strong>${__("Chart of Accounts")}</strong>
							<div class="ps-ac-tree-btns">
								<button class="btn btn-xs btn-default ps-ac-expand-all-btn" title="${__("Expand All")}">\u229E ${__("Expand")}</button>
								<button class="btn btn-xs btn-default ps-ac-collapse-all-btn" title="${__("Collapse All")}">\u229F ${__("Collapse")}</button>
							</div>
							<span class="ps-ac-panel-hint">${__("drag \u2192 to restrict")}</span>
						</div>
						<div class="ps-drop-zone ps-ac-avail-zone ps-ac-scroll" data-target="available">
							<div class="ps-ac-avail-inner">${i(t)}</div>
						</div>
					</div>

					<div class="ps-ac-arrow">\u21C4</div>

					<div class="ps-ac-panel">
						<div class="ps-ac-panel-header">
							${frappe.utils.icon("lock","xs")}
							<strong>${__("Restricted To")}</strong>
							<span class="ps-ac-panel-hint">${__("drag \u2190 to unrestrict")}</span>
						</div>
						<div class="ps-drop-zone ps-ac-restr-zone ps-ac-scroll" data-target="restricted">
							${r}
						</div>
					</div>
				</div>
			</div>
		`),this._bind_account_dnd(e)}_bind_account_dnd(e){let s=this.$content;s.off("click.ps-folder"),s.on("click.ps-folder",".ps-ac-folder-hdr",function(){let o=$(this),r=o.next(".ps-ac-folder-body");o.hasClass("ps-ac-expanded")?(o.removeClass("ps-ac-expanded"),r.hide()):(o.addClass("ps-ac-expanded"),r.show())}),s.find(".ps-ac-expand-all-btn").off("click").on("click",()=>{s.find(".ps-ac-folder-hdr").addClass("ps-ac-expanded"),s.find(".ps-ac-folder-body").show()}),s.find(".ps-ac-collapse-all-btn").off("click").on("click",()=>{s.find(".ps-ac-folder-hdr").removeClass("ps-ac-expanded"),s.find(".ps-ac-folder-body").hide()});let a=()=>{let o=(s.find(".ps-ac-search").val()||"").trim().toLowerCase(),r=s.find(".ps-ac-company-sel").val()||"";if(s.find(".ps-ac-company-block").each(function(){$(this).toggle(!r||$(this).attr("data-company")===r)}),!o){s.find(".ps-ac-root-block, .ps-ac-folder-row, .ps-ac-chip.ps-ac-avail").show(),s.find(".ps-ac-folder-hdr").each(function(){let l=$(this).next(".ps-ac-folder-body");$(this).hasClass("ps-ac-expanded")?l.show():l.hide()});return}s.find(".ps-ac-folder-body").show(),s.find(".ps-ac-folder-row").show(),s.find(".ps-ac-chip.ps-ac-avail").each(function(){let l=($(this).attr("data-search")||"").toLowerCase();$(this).toggle(l.includes(o))}),s.find(".ps-ac-folder-row").get().reverse().forEach(l=>{let c=$(l).find(".ps-ac-chip.ps-ac-avail:visible").length>0;$(l).toggle(c)}),s.find(".ps-ac-root-block").each(function(){$(this).toggle($(this).find(".ps-ac-chip.ps-ac-avail:visible").length>0)})};s.find(".ps-ac-search").on("input",a),s.find(".ps-ac-company-sel").on("change",a),s.find(".ps-ac-clear-btn").on("click",()=>{frappe.confirm(__("Remove ALL account restrictions for this user? They will have access to all accounts."),()=>{frappe.call({method:"permission_manager.permission_manager.api.user_profile.clear_user_account_restrictions",args:{user:e},callback:()=>{frappe.show_alert({message:__("All restrictions cleared."),indicator:"green"}),this._load_user_accounts(e)}})})}),s.find(".ps-ac-chip-x").on("click",o=>{o.stopPropagation();let r=$(o.currentTarget).data("permName");this._do_remove_account_restriction(e,r)});let t=o=>{s.find(o).each(function(){let r=this;r.addEventListener("dragstart",l=>{l.dataTransfer.effectAllowed="move",l.dataTransfer.setData("account",r.getAttribute("data-account")||""),l.dataTransfer.setData("source",r.getAttribute("data-source")||""),l.dataTransfer.setData("permname",r.getAttribute("data-perm-name")||""),setTimeout(()=>r.classList.add("ps-chip-dragging"),0)}),r.addEventListener("dragend",()=>{r.classList.remove("ps-chip-dragging")})})};t(".ps-ac-chip.ps-ac-avail"),t(".ps-ac-chip.ps-ac-restricted");let i=o=>{let r=s.find(o)[0];if(!r)return;let l=0;r.addEventListener("dragenter",c=>{c.preventDefault(),l++,r.classList.add("ps-dz-over")}),r.addEventListener("dragover",c=>{c.preventDefault(),c.dataTransfer.dropEffect="move"}),r.addEventListener("dragleave",()=>{l--,l<=0&&(l=0,r.classList.remove("ps-dz-over"))}),r.addEventListener("drop",c=>{c.preventDefault(),l=0,r.classList.remove("ps-dz-over");let d=c.dataTransfer.getData("account"),_=c.dataTransfer.getData("source"),h=c.dataTransfer.getData("permname"),m=r.getAttribute("data-target");_==="available"&&m==="restricted"&&d?this._do_add_account_restriction(e,d):_==="restricted"&&m==="available"&&h&&this._do_remove_account_restriction(e,h)})};i(".ps-ac-avail-zone"),i(".ps-ac-restr-zone")}_do_add_account_restriction(e,s){frappe.call({method:"permission_manager.permission_manager.api.user_profile.add_user_account_restriction",args:{user:e,account:s},callback:a=>{var t;(t=a.message)!=null&&t.success&&(frappe.show_alert({message:__("{0} restricted.",[s]),indicator:"orange"}),this._load_user_accounts(e))}})}_do_remove_account_restriction(e,s){frappe.call({method:"permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",args:{perm_name:s},callback:a=>{var t;(t=a.message)!=null&&t.success&&(frappe.show_alert({message:__("Restriction removed."),indicator:"green"}),this._load_user_accounts(e))}})}_render_profile_tab(){this.$search.html(`
			<div class="ps-search-row">
				<div class="ps-search-field" id="ps-profile-select"></div>
			</div>
		`),this.profile_field=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"Role Profile",fieldname:"profile",placeholder:__("Select Role Profile\u2026"),label:__("Role Profile"),change:()=>{let e=this.profile_field.get_value();e&&(this._current_profile=e,this.load_profile_matrix(e))}},parent:this.$search.find("#ps-profile-select"),render_input:!0}),this.$content.html(this._welcome_html(frappe.utils.icon("group","lg"),__("Select a Role Profile"),__("View the combined permission matrix for all roles inside a profile, and see which users are on it.")))}load_profile_matrix(e){this.$content.html(this._show_skeleton(6)),frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_role_profile_matrix",args:{profile:e},callback:s=>{s.message&&(this.components.profile=new I({wrapper:this.$content,data:s.message,on_export:a=>this._export_profile_csv(a)}))},error:()=>{this.$content.html(this._error_html(__("Failed to load profile matrix."),()=>this.load_profile_matrix(e)))}})}_export_profile_csv(e){frappe.dom.freeze(__("Generating CSV\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_role_profile_matrix",args:{profile:e},callback:s=>{if(frappe.dom.unfreeze(),!s.message)return;let a=s.message,t=[["Role Profile",a.profile],["Roles",a.roles.join(", ")],["User Count",a.user_count],[],["Module","DocType","Source",...b]];for(let r of a.modules)for(let l of r.doctypes)t.push([r.module,l.doctype,l.source,...b.map(c=>{let d=l.permissions[c];return d==="na"?"N/A":d?"1":"0"})]);let i=t.map(r=>r.map(l=>`"${String(l!=null?l:"").replace(/"/g,'""')}"`).join(",")).join(`
`),o=e.replace(/[^a-z0-9]/gi,"_");ge(i,`permissions_profile_${o}.csv`),frappe.show_alert({message:__("CSV downloaded."),indicator:"green"})},error:()=>{frappe.dom.unfreeze(),frappe.show_alert({message:__("Export failed."),indicator:"red"})}})}_show_user_override_dialog(e,s){let a=s.is_active,t=new frappe.ui.Dialog({title:__("Override Permissions \u2014 {0}",[e]),size:"extra-large",fields:[{fieldtype:"HTML",fieldname:"status_html"},{fieldtype:"HTML",fieldname:"editor_html"}]}),i=t.fields_dict.status_html.$wrapper,o=t.fields_dict.editor_html.$wrapper,r=s.override_permissions||[];if(a){let c=r.map(d=>{var f;let _=b.filter(u=>{var y;return(y=d.permissions)==null?void 0:y[u]}).join(", "),h=(f=d.permissions)==null?void 0:f.if_owner,m=(_||"\u2014")+(h?" \u2605":"");return`<span class="ps-oe-cur-chip" title="${n(m)}${h?" \u2014 "+__("Only If Creator"):""}">
					${n(d.doctype)}
					<em class="ps-oe-cur-rights">${n(m)}</em>
				</span>`}).join("");i.html(`
				<div class="ps-override-status-section">
					<div class="ps-override-active-banner">
						${frappe.utils.icon("tick-circle","sm")}
						<strong>${__("Override Active")}</strong>
						&nbsp;\u2014&nbsp; ${__("Profile")}: <code>${n(s.profile_name)}</code>
						&nbsp;|&nbsp; <span class="ps-oe-cur-count">${r.length} ${__("DocType(s)")}</span>
					</div>
					${r.length?`<div class="ps-oe-cur-list">${c}</div>`:""}
					<div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
						<button class="btn btn-sm btn-danger ps-remove-override-btn">
							${frappe.utils.icon("delete","xs")} ${__("Remove Override")}
						</button>
						<span style="color:var(--text-muted);font-size:12px;">
							${__("Update the rows below and click Apply to save changes.")}
						</span>
					</div>
				</div>
			`),i.find(".ps-remove-override-btn").on("click",()=>{frappe.confirm(__("Remove override for {0}? The user will revert to standard role permissions.",[e]),()=>{frappe.dom.freeze(__("Removing override\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.remove_user_override",args:{user:e},callback:d=>{var _;frappe.dom.unfreeze(),frappe.show_alert({message:((_=d.message)==null?void 0:_.msg)||__("Override removed."),indicator:"green"}),t.hide(),this.load_user_matrix(e)},error:()=>frappe.dom.unfreeze()})})})}else i.html(`
				<div class="ps-override-status-section">
					<div class="ps-oe-mode-hint">
						<span class="ps-mode-hint-restrict">
							${__("A full permission snapshot is taken for this user. For each DocType you add, they will have EXACTLY the permissions you check \u2014 original roles are replaced so nothing can win them back. All other DocTypes stay as-is.")}
						</span>
					</div>
				</div>
			`);let l=r.map(c=>({doctype:c.doctype,permissions:c.permissions||{}}));this._render_override_editor(o,l),t.set_primary_action(__("Apply Override"),()=>{let c=this._collect_override_rows(o);if(!c.length){frappe.show_alert({message:__("Add at least one DocType row."),indicator:"orange"});return}t.hide(),frappe.dom.freeze(__("Snapshotting permissions and applying override\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.create_user_override",args:{user:e,override_items:JSON.stringify(c),mode:"restrict"},callback:d=>{var _;frappe.dom.unfreeze(),(_=d.message)!=null&&_.success&&(frappe.show_alert({message:d.message.msg,indicator:"green"}),frappe.msgprint({title:__("Override Applied"),message:`
								<b>${__("Role")}:</b> <code>${n(d.message.role_name)}</code><br>
								<b>${__("Profile")}:</b> <code>${n(d.message.profile_name)}</code><br>
								<b>${__("Roles in profile")}:</b> ${(d.message.roles_included||[]).map(n).join(", ")}
							`,indicator:"green"}),this.load_user_matrix(e))},error:()=>frappe.dom.unfreeze()})}),t.show()}_render_override_editor(e,s){e.empty();let a=b.map(h=>`<th class="ps-oe-perm-col" title="${x[h]||h}">${S[h]}</th>`).join("");e.html(`
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
					<div class="ps-oe-search-icon">${frappe.utils.icon("search","xs")}</div>
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
								${a}
								<th></th>
							</tr>
						</thead>
						<tbody class="ps-oe-tbody"></tbody>
					</table>
				</div>
				<div class="ps-oe-empty" style="${s.length?"display:none;":""}">
					<em>${__("No rows yet \u2014 type a DocType name above to add one.")}</em>
				</div>
			</div>
		`);let t=e.find(".ps-oe-tbody"),i=e.find(".ps-oe-dt-search"),o=e.find(".ps-oe-suggestions"),r=e.find(".ps-oe-row-count"),l=()=>{let h=t.find("tr").length,m=t.find("tr:visible").length;if(!h){r.text("");return}r.text(m<h?__("{0} / {1} DocType(s)",[m,h]):__("{0} DocType(s)",[h]))},c=(h,m={})=>{var R;if(!h)return;if(t.find(`tr[data-doctype="${h}"]`).length){let T=t.find(`tr[data-doctype="${h}"]`);(R=T[0])==null||R.scrollIntoView({behavior:"smooth",block:"center"}),T.addClass("ps-oe-row-flash"),setTimeout(()=>T.removeClass("ps-oe-row-flash"),1200);return}let f=`<td class="ps-oe-perm-col ps-oe-owner-col" title="${__("Only If Creator")}">
				<input type="checkbox" class="ps-oe-check" data-ptype="if_owner"
					${m.if_owner?"checked":""} />
			</td>`,u=b.map(T=>`
				<td class="ps-oe-perm-col">
					<input type="checkbox" class="ps-oe-check" data-ptype="${T}"
						${m[T]?"checked":""} />
				</td>
			`).join(""),y=$(`
				<tr data-doctype="${n(h)}">
					<td class="ps-oe-dt-col ps-oe-dt-name">${n(h)}</td>
					${f}
					${u}
					<td>
						<button class="btn btn-xs btn-danger ps-oe-remove-btn" title="${__("Remove")}">
							${frappe.utils.icon("delete","xs")}
						</button>
					</td>
				</tr>
			`);t.append(y),y.find(".ps-oe-remove-btn").on("click",()=>{y.remove(),t.find("tr").length||e.find(".ps-oe-empty").show(),l()}),e.find(".ps-oe-empty").hide(),l()},d=null,_=h=>{if(!h){o.empty().hide();return}clearTimeout(d),d=setTimeout(()=>{let m=new Set(t.find("tr").map((f,u)=>$(u).attr("data-doctype")).get());frappe.call({method:"frappe.client.get_list",args:{doctype:"DocType",filters:[["name","like",`%${h}%`],["istable","=",0]],fields:["name"],limit:10,order_by:"name asc"},callback:f=>{o.empty();let u=(f.message||[]).filter(y=>!m.has(y.name));if(!u.length){o.hide();return}u.forEach(y=>{$(`<li class="ps-oe-sug-item">
								<span class="ps-sug-plus">+</span> ${n(y.name)}
							</li>`).on("mousedown",R=>{R.preventDefault(),c(y.name),i.val("").trigger("input")}).appendTo(o)}),o.show()}})},200)};i.on("input",function(){let h=$(this).val().trim();t.find("tr").each(function(){let m=$(this).attr("data-doctype")||"";$(this).toggle(!h||m.toLowerCase().includes(h.toLowerCase()))}),e.find(".ps-oe-empty").toggle(!h&&!t.find("tr").length),l(),_(h)}),i.on("blur",()=>setTimeout(()=>o.hide(),160)),i.on("focus",()=>{o.children().length&&o.show()}),i.on("keydown",h=>{if(h.key==="Escape"&&(o.hide(),i.val("").trigger("input")),h.key==="Enter"){let m=o.find(".ps-oe-sug-item").first();if(m.length){let f=m.text().replace(/^\+\s*/,"").trim();c(f),i.val("").trigger("input"),o.hide()}}}),s.forEach(h=>c(h.doctype,h.permissions)),e.find(".ps-oe-deps-btn").on("click",()=>{let h=[];if(t.find("tr").each(function(){let y=$(this).attr("data-doctype"),R=$(this).find(".ps-oe-check[data-ptype='create']").is(":checked");y&&R&&h.push(y)}),!h.length){frappe.show_alert({message:__("Check 'C' (Create) on at least one DocType first."),indicator:"orange"});return}let m=e.find(".ps-oe-deps-btn").prop("disabled",!0).text(__("Analyzing\u2026")),f=h.length,u=0;h.forEach(y=>{frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_doctype_create_deps",args:{doctype:y},callback:R=>{(R.message||[]).forEach(T=>{t.find(`tr[data-doctype="${T}"]`).length||(c(T,{read:1}),u++)}),f--,f===0&&(m.prop("disabled",!1).html(`\u{1F517} ${__("Suggest dependencies")}`),frappe.show_alert({message:u?__("Added {0} linked DocType(s) with read access.",[u]):__("All linked DocTypes already present."),indicator:u?"blue":"green"}))},error:()=>{f--,f===0&&m.prop("disabled",!1).html(`\u{1F517} ${__("Suggest dependencies")}`)}})})})}_collect_override_rows(e){let s=[];return e.find(".ps-oe-tbody tr").each(function(){let a=$(this).attr("data-doctype");if(!a)return;let t={};$(this).find(".ps-oe-check").each(function(){t[$(this).data("ptype")]=$(this).is(":checked")?1:0}),s.push({doctype:a,permissions:t})}),s}_show_account_restrictions_dialog(e){let s=new frappe.ui.Dialog({title:__("Account Restrictions \u2014 {0}",[e]),size:"large",fields:[{fieldtype:"HTML",fieldname:"content_html"}]}),a=s.fields_dict.content_html.$wrapper;a.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`);let t=()=>{frappe.call({method:"permission_manager.permission_manager.api.user_profile.get_user_account_restrictions",args:{user:e},callback:o=>o.message&&i(o.message)})},i=o=>{let r=o.is_restricted,l=new Set(o.restrictions.map(m=>m.for_value)),c={};for(let m of o.all_accounts){let f=m.company||"Other";c[f]=c[f]||[],c[f].push(m)}let d=r?o.restrictions.map(m=>`
					<div class="ps-ar-row">
						<span class="ps-badge ps-badge-custom">${n(m.for_value)}</span>
						<button class="btn btn-xs btn-danger ps-ar-remove-btn" data-name="${n(m.name)}">
							${frappe.utils.icon("delete","xs")}
						</button>
					</div>
				`).join(""):`<div class="ps-ar-unrestricted">
					${frappe.utils.icon("tick-circle","sm")}
					${__("No restrictions \u2014 user can access ALL accounts.")}
				   </div>`,_=Object.keys(c).sort().map(m=>`<option value="${n(m)}">${n(m)}</option>`).join("");a.html(`
				<div class="ps-accounts-control">

					<div class="ps-ar-section">
						<div class="ps-ar-section-header">
							<strong>${__("Current Account Restrictions")}</strong>
							${r?`
								<button class="btn btn-xs btn-default ps-ar-clear-btn">
									${frappe.utils.icon("undo","xs")} ${__("Clear All (Allow All)")}
								</button>`:""}
						</div>
						<div class="ps-ar-restrictions-list">${d}</div>
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
										${_}
									</select>
								</div>
								<div style="flex:1;min-width:200px;" id="ps-ar-acct-field"></div>
								<div>
									<button class="btn btn-sm btn-primary ps-ar-add-btn" style="margin-bottom:4px;">
										${frappe.utils.icon("add","xs")} ${__("Add Restriction")}
									</button>
								</div>
							</div>
						</div>
					</div>

					<div class="ps-ar-help">
						${frappe.utils.icon("info","xs")}
						${__("When any Account restriction is set, this user can only access the listed accounts (and linked records). No restrictions = access all accounts.")}
					</div>

				</div>
			`);let h=frappe.ui.form.make_control({df:{fieldtype:"Link",options:"Account",fieldname:"account",placeholder:__("Select Account\u2026"),label:__("Account")},parent:a.find("#ps-ar-acct-field"),render_input:!0});a.find(".ps-ar-company-filter").on("change",function(){let m=$(this).val();h.df.get_query=m?()=>({filters:{company:m,disabled:0}}):()=>({filters:{disabled:0}}),h.set_value("")}),a.find(".ps-ar-add-btn").on("click",()=>{let m=h.get_value();if(!m){frappe.show_alert({message:__("Select an account first."),indicator:"orange"});return}if(l.has(m)){frappe.show_alert({message:__("Account already restricted."),indicator:"orange"});return}frappe.dom.freeze(__("Adding restriction\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.add_user_account_restriction",args:{user:e,account:m},callback:f=>{var u;frappe.dom.unfreeze(),(u=f.message)!=null&&u.success&&(frappe.show_alert({message:__("Restriction added."),indicator:"green"}),t())},error:()=>frappe.dom.unfreeze()})}),a.find(".ps-ar-remove-btn").on("click",m=>{let f=$(m.currentTarget).data("name");frappe.dom.freeze(__("Removing\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.remove_user_account_restriction",args:{perm_name:f},callback:u=>{var y;frappe.dom.unfreeze(),(y=u.message)!=null&&y.success&&(frappe.show_alert({message:__("Restriction removed."),indicator:"green"}),t())},error:()=>frappe.dom.unfreeze()})}),a.find(".ps-ar-clear-btn").on("click",()=>{frappe.confirm(__("Clear ALL account restrictions for {0}? The user will have access to all accounts.",[e]),()=>{frappe.dom.freeze(__("Clearing\u2026")),frappe.call({method:"permission_manager.permission_manager.api.user_profile.clear_user_account_restrictions",args:{user:e},callback:m=>{frappe.dom.unfreeze(),frappe.show_alert({message:__("All restrictions cleared."),indicator:"green"}),t()},error:()=>frappe.dom.unfreeze()})})})};s.set_primary_action(__("Close"),()=>s.hide()),s.show(),t()}_show_quick_tools_dialog(e){let s=new frappe.ui.Dialog({title:__("Quick Tools \u2014 {0}",[e]),size:"large",fields:[{fieldtype:"HTML",fieldname:"tools_html"}]}),a=s.fields_dict.tools_html.$wrapper;a.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`),Promise.all([new Promise(t=>frappe.call({method:"permission_manager.permission_manager.api.quickfix.get_user_roles",args:{user:e},callback:i=>t(i.message||[])})),new Promise(t=>frappe.call({method:"permission_manager.permission_manager.api.quickfix.find_user_issues",args:{user:e},callback:i=>t(i.message||[])}))]).then(([t,i])=>{this._render_quick_tools(a,s,e,t,i)}),s.show()}_render_quick_tools(e,s,a,t,i){let o={error:"\u{1F534}",warning:"\u{1F7E1}",info:"\u{1F535}"},r=t.map(c=>`
			<span class="ps-role-chip ${c.is_custom?"ps-role-custom":""}">
				${n(c.role)}
				${c.is_custom?`<span title="${__("Custom role")}">\u2605</span>`:""}
			</span>
		`).join(""),l=i.length?i.map(c=>`
				<div class="ps-issue-row ps-issue-${c.severity}">
					<span class="ps-issue-icon">${o[c.severity]||"\u2139\uFE0F"}</span>
					<div class="ps-issue-body">
						<strong>${n(c.title)}</strong>
						<div class="ps-issue-desc">${n(c.description)}</div>
					</div>
					${c.fix_label?`
						<button class="btn btn-xs btn-warning ps-fix-btn"
							data-fix="${n(c.fix_type)}"
							data-fix-data='${JSON.stringify(c.fix_data||{})}'
							style="margin-left:auto;flex-shrink:0;">
							${n(c.fix_label)}
						</button>`:""}
				</div>
			`).join(""):`<div class="ps-issue-none">${__("\u2705 No issues found for this user.")}</div>`;e.html(`
			<div class="ps-quick-tools">

				<div class="ps-qt-section">
					<div class="ps-qt-section-header">
						<strong>${__("Current Roles")} (${t.length})</strong>
						<button class="btn btn-xs btn-primary ps-manage-roles-btn">${__("Manage Roles")}</button>
					</div>
					<div class="ps-role-chips">${r||`<em>${__("No roles assigned.")}</em>`}</div>
				</div>

				<div class="ps-qt-section">
					<div class="ps-qt-section-header">
						<strong>${__("Permission Issues")} (${i.length})</strong>
						<button class="btn btn-xs btn-default ps-recheck-btn">${frappe.utils.icon("refresh","xs")} ${__("Re-check")}</button>
					</div>
					<div class="ps-issues-list">${l}</div>
				</div>

				<div class="ps-qt-section">
					<div class="ps-qt-section-header"><strong>${__("More Actions")}</strong></div>
					<div style="display:flex;gap:8px;flex-wrap:wrap;">
						<button class="btn btn-sm btn-default ps-copy-roles-btn">
							${frappe.utils.icon("copy","xs")} ${__("Copy Roles From User")}
						</button>
						<button class="btn btn-sm btn-default ps-clear-custom-btn">
							${frappe.utils.icon("delete","xs")} ${__("Clear All Custom Perms")}
						</button>
					</div>
				</div>

			</div>
		`),e.find(".ps-manage-roles-btn").on("click",()=>{s.hide(),this._show_manage_roles_dialog(a,t)}),e.find(".ps-recheck-btn").on("click",()=>{e.html(`<div class="ps-loading">${__("Checking\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.quickfix.find_user_issues",args:{user:a},callback:c=>this._render_quick_tools(e,s,a,t,c.message||[])})}),e.find(".ps-fix-btn").on("click",c=>{let d=$(c.currentTarget).data("fix"),_=JSON.parse($(c.currentTarget).attr("data-fix-data")||"{}");frappe.dom.freeze(__("Applying fix\u2026")),frappe.call({method:"permission_manager.permission_manager.api.quickfix.apply_quick_fix",args:{user:a,fix_type:d,fix_data:JSON.stringify(_)},callback:h=>{var m;frappe.dom.unfreeze(),frappe.show_alert({message:((m=h.message)==null?void 0:m.msg)||__("Fix applied."),indicator:"green"}),frappe.call({method:"permission_manager.permission_manager.api.quickfix.find_user_issues",args:{user:a},callback:f=>this._render_quick_tools(e,s,a,t,f.message||[])})},error:()=>frappe.dom.unfreeze()})}),e.find(".ps-copy-roles-btn").on("click",()=>{frappe.prompt({fieldtype:"Link",options:"User",fieldname:"source_user",label:__("Copy Roles From"),reqd:1},c=>{frappe.dom.freeze(__("Copying roles\u2026")),frappe.call({method:"permission_manager.permission_manager.api.quickfix.copy_roles_from_user",args:{target_user:a,source_user:c.source_user},callback:d=>{var _;frappe.dom.unfreeze(),frappe.show_alert({message:((_=d.message)==null?void 0:_.msg)||__("Roles copied."),indicator:"green"}),s.hide(),this.load_user_matrix(a)},error:()=>frappe.dom.unfreeze()})},__("Copy Roles From User"),__("Copy"))}),e.find(".ps-clear-custom-btn").on("click",()=>{frappe.confirm(__("Remove all Custom DocPerms for <b>{0}</b>? This resets them to standard role-based permissions.",[a]),()=>{frappe.dom.freeze(__("Clearing\u2026")),frappe.call({method:"permission_manager.permission_manager.api.quickfix.clear_custom_perms_for_user",args:{user:a},callback:c=>{var d;frappe.dom.unfreeze(),frappe.show_alert({message:((d=c.message)==null?void 0:d.msg)||__("Done."),indicator:"green"}),s.hide(),this.load_user_matrix(a)},error:()=>frappe.dom.unfreeze()})})})}_show_manage_roles_dialog(e,s){let a=new Set(s.map(o=>o.role)),t=new frappe.ui.Dialog({title:__("Manage Roles \u2014 {0}",[e]),fields:[{fieldtype:"Link",fieldname:"add_role",options:"Role",label:__("Add Role"),description:__("Type and select a role to add")},{fieldtype:"HTML",fieldname:"current_roles_html"}],primary_action_label:__("Close"),primary_action:()=>t.hide()}),i=()=>{let o=t.fields_dict.current_roles_html.$wrapper,r=[...a].sort().map(l=>`
				<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f3f5;">
					<span style="flex:1;">${n(l)}</span>
					<button class="btn btn-xs btn-danger ps-remove-role-btn" data-role="${n(l)}">
						${frappe.utils.icon("delete","xs")} ${__("Remove")}
					</button>
				</div>
			`).join("");o.html(r||`<em>${__("No roles assigned.")}</em>`),o.find(".ps-remove-role-btn").on("click",l=>{let c=$(l.currentTarget).data("role");frappe.call({method:"permission_manager.permission_manager.api.quickfix.update_user_roles",args:{user:e,add_roles:"[]",remove_roles:JSON.stringify([c])},callback:d=>{var _;(_=d.message)!=null&&_.success&&(a.delete(c),i(),frappe.show_alert({message:__("Role removed."),indicator:"orange"}))}})})};t.fields_dict.add_role.df.change=()=>{let o=t.get_value("add_role");!o||a.has(o)||frappe.call({method:"permission_manager.permission_manager.api.quickfix.update_user_roles",args:{user:e,add_roles:JSON.stringify([o]),remove_roles:"[]"},callback:r=>{var l;(l=r.message)!=null&&l.success&&(a.add(o),t.set_value("add_role",""),i(),frappe.show_alert({message:__("Role added."),indicator:"green"}))}})},i(),t.show()}_open_doctype_edit_dialog(e){let s=new frappe.ui.Dialog({title:__("Edit Permissions \u2014 {0}",[e]),size:"extra-large",fields:[{fieldtype:"HTML",fieldname:"dt_matrix_html"}]}),a=s.fields_dict.dt_matrix_html.$wrapper;a.html(`<div class="ps-loading">${__("Loading\u2026")}</div>`),frappe.call({method:"permission_manager.permission_manager.api.matrix.get_doctype_matrix",args:{doctype:e},callback:t=>{if(!t.message)return;let i=o=>{a.empty(),new O({wrapper:a,data:o,mode:"doctype",on_reload:()=>{frappe.call({method:"permission_manager.permission_manager.api.matrix.get_doctype_matrix",args:{doctype:e},callback:l=>l.message&&i(l.message)})},on_export:(l,c)=>this._export_csv(l,c)})._toggle_edit_mode()};i(t.message)}}),s.show()}_show_bulk_apply_dialog(e){let s=b,a=s.map(i=>({fieldtype:"Check",fieldname:`perm_${i}`,label:x[i]||i,default:0})),t=new frappe.ui.Dialog({title:__("Bulk Apply Role Permissions"),size:"large",fields:[{fieldtype:"HTML",fieldname:"intro_html",options:`<div class="ps-bulk-intro">
						${__("Apply the same permission set for a role across multiple DocTypes at once.")}
					</div>`},{fieldtype:"Link",fieldname:"role",label:__("Role"),options:"Role",reqd:1},{fieldtype:"Section Break",label:__("Permissions to Apply")},...a,{fieldtype:"Check",fieldname:"perm_if_owner",label:__("Only If Creator"),description:__("When checked, all above permissions apply only to documents owned/created by this user"),default:0},{fieldtype:"Section Break",label:__("Target DocTypes")},{fieldtype:"Small Text",fieldname:"doctypes_text",label:__("DocType List"),reqd:1,description:__("One DocType per line. Current DocType is pre-filled."),default:e}],primary_action_label:__("Apply to All"),primary_action:i=>{let o=(i.doctypes_text||"").split(`
`).map(l=>l.trim()).filter(Boolean);if(!o.length){frappe.show_alert({message:__("No DocTypes specified."),indicator:"orange"});return}let r={};s.forEach(l=>{r[l]=i[`perm_${l}`]?1:0}),r.if_owner=i.perm_if_owner?1:0,t.hide(),frappe.dom.freeze(__("Applying permissions\u2026")),frappe.call({method:"permission_manager.permission_manager.api.lookup.bulk_apply_role_permissions",args:{doctypes:JSON.stringify(o),role:i.role,permissions:JSON.stringify(r)},callback:l=>{var d,_,h;frappe.dom.unfreeze();let c=l.message||{};(d=c.success)!=null&&d.length&&frappe.show_alert({message:__("{0} DocTypes updated.",[c.success.length]),indicator:"green"}),(_=c.failed)!=null&&_.length&&frappe.msgprint({title:__("Some DocTypes Failed"),indicator:"red",message:c.failed.map(m=>`<b>${n(m.doctype)}</b>: ${n(m.error)}`).join("<br>")}),(h=c.success)!=null&&h.includes(e)&&this.load_doctype_matrix(e)},error:()=>frappe.dom.unfreeze()})}});t.show()}_export_csv(e,s){frappe.dom.freeze(__("Generating CSV\u2026")),frappe.call({method:"permission_manager.permission_manager.api.lookup.export_matrix_csv",args:{data_type:e,identifier:s},callback:a=>{frappe.dom.unfreeze(),a.message&&(ge(a.message.csv,a.message.filename),frappe.show_alert({message:__("CSV downloaded."),indicator:"green"}))},error:()=>{frappe.dom.unfreeze(),frappe.show_alert({message:__("Export failed."),indicator:"red"})}})}show_why(e,s,a){new z({user:e,doctype:s,ptype:a})}show_restrictions(e){new M({user:e})}_show_skeleton(e=6){let s="";for(let a=0;a<e;a++)s+=`<div class="ps-skeleton-row">
				<div class="ps-skeleton-cell ps-skel-label"></div>
				<div class="ps-skeleton-cell ps-skel-wide"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
				<div class="ps-skeleton-cell ps-skel-sm"></div>
			</div>`;return`<div class="ps-loading">${s}</div>`}_welcome_html(e,s,a){return`<div class="ps-welcome-state">
			<div class="ps-welcome-icon">${e}</div>
			<div class="ps-welcome-title">${s}</div>
			<div class="ps-welcome-desc">${a}</div>
		</div>`}_error_html(e,s){let a="ps-retry-"+Date.now();return setTimeout(()=>{$(`#${a}`).on("click",s)},0),`<div class="ps-error-state">
			<div class="ps-error-icon">${frappe.utils.icon("error","lg")}</div>
			<div class="ps-error-msg">${e}</div>
			<button id="${a}" class="btn btn-sm btn-default">
				${frappe.utils.icon("refresh","xs")} ${__("Retry")}
			</button>
		</div>`}on_show(){}};function ge(p,e){let s=new Blob([p],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(s),t=document.createElement("a");t.href=a,t.download=e,document.body.appendChild(t),t.click(),document.body.removeChild(t),URL.revokeObjectURL(a)}Object.assign(window.permission_manager_studio,{PermissionStudio:Q,MatrixView:O,WhyExplainer:z,UserExplorer:M,RoleExplorer:q,RoleProfileExplorer:I,ReverseLookup:j,RoleComparison:U,HealthDashboard:H,showUserSimulation:K,WorkflowDiagram:W,MATRIX_RIGHTS:b,RIGHT_LABELS:S,PERM_ICONS:B,esc:n});window.pm_approval_inbox={ApprovalInbox:G};})();
//# sourceMappingURL=permission_manager.bundle.HWAXQW7A.js.map
