/**
 * WorkflowDiagram — SVG-based PM Workflow flowchart renderer
 *
 * Usage:
 *   const diag = new WorkflowDiagram({ wrapper: $el, workflow_name: "My WF" });
 *   diag.load();
 */

export class WorkflowDiagram {
    constructor({ wrapper, workflow_name }) {
        this.$wrapper = $(wrapper);
        this.workflow_name = workflow_name;
        this._data = null;
    }

    load() {
        this.$wrapper.html(`<div class="ps-wfd-loading text-muted text-center py-5">
            ${frappe.utils.icon("refresh", "sm")} Loading diagram…
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
            },
        });
    }

    _render() {
        const { states, transitions } = this._data;

        // BFS layout: assign each state a column (depth) and row
        const layout = this._bfs_layout(states, transitions);

        const NODE_W = 140, NODE_H = 44, H_GAP = 80, V_GAP = 60;
        const PADDING = 40;

        // Compute SVG canvas size
        let maxCol = 0, maxRow = 0;
        Object.values(layout).forEach(({ col, row }) => {
            if (col > maxCol) maxCol = col;
            if (row > maxRow) maxRow = row;
        });
        const svgW = (maxCol + 1) * (NODE_W + H_GAP) + PADDING * 2 - H_GAP;
        const svgH = (maxRow + 1) * (NODE_H + V_GAP) + PADDING * 2 - V_GAP;

        // Node centres
        const centres = {};
        Object.entries(layout).forEach(([state, { col, row }]) => {
            centres[state] = {
                x: PADDING + col * (NODE_W + H_GAP),
                y: PADDING + row * (NODE_H + V_GAP),
            };
        });

        // Build SVG
        const SVG_NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("xmlns", SVG_NS);
        svg.setAttribute("width", svgW);
        svg.setAttribute("height", svgH);
        svg.setAttribute("class", "ps-wfd-svg");
        svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);

        // Arrow-head marker (normal)
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

        // Draw edges first (so nodes sit on top)
        const edgeGroups = this._group_transitions(transitions);
        edgeGroups.forEach((edge) => {
            const from = centres[edge.from_state];
            const to = centres[edge.to_state];
            if (!from || !to) return;

            const isReturn = edge.is_return;
            const isSelf = edge.from_state === edge.to_state;

            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("class", "ps-wfd-edge");

            let pathD;
            if (isSelf) {
                // Loop above the node
                const cx = from.x + NODE_W / 2;
                const cy = from.y;
                pathD = `M ${cx - 20},${cy} C ${cx - 40},${cy - 60} ${cx + 40},${cy - 60} ${cx + 20},${cy}`;
            } else if (from.x === to.x) {
                // Vertical straight line
                pathD = `M ${from.x + NODE_W / 2},${from.y + NODE_H} L ${to.x + NODE_W / 2},${to.y}`;
            } else {
                // Curved bezier between nodes
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

            // Label midpoint
            const label = document.createElementNS(SVG_NS, "text");
            label.setAttribute("class", "ps-wfd-edge-label");
            const actions_text = edge.actions.join(" / ");
            // Find midpoint of path
            const midPt = path.getPointAtLength ? path.getPointAtLength(path.getTotalLength ? path.getTotalLength() / 2 : 50) : null;
            if (midPt) {
                label.setAttribute("x", midPt.x);
                label.setAttribute("y", midPt.y - 6);
            } else {
                label.setAttribute("x", ((from.x + NODE_W + to.x) / 2));
                label.setAttribute("y", ((from.y + to.y) / 2 + NODE_H / 2 - 6));
            }
            label.setAttribute("text-anchor", "middle");
            label.textContent = actions_text;
            g.appendChild(label);

            svg.appendChild(g);
        });

        // Draw nodes
        states.forEach((st) => {
            const pos = centres[st.name];
            if (!pos) return;

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

            // Doc-state badge (if set)
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

        // Legend
        const legend = $(`<div class="ps-wfd-legend">
            <span class="ps-wfd-leg-item ps-wfd-leg--draft">Draft state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--submitted">Submitted state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--cancelled">Cancelled state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--other">Other state</span>
            <span class="ps-wfd-leg-item ps-wfd-leg--return">Return for correction</span>
        </div>`);

        this.$wrapper.empty().append($('<div class="ps-wfd-canvas">').append(svg)).append(legend);
    }

    /**
     * BFS starting from states with no incoming transitions,
     * assigns col (depth) and row (sibling index at that depth).
     */
    _bfs_layout(states, transitions) {
        const children = {}; // from_state → [to_state]
        const inDeg = {};
        states.forEach((s) => { children[s.name] = []; inDeg[s.name] = 0; });
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
        if (!roots.length) roots.push(states[0]?.name);

        const layout = {};
        const queue = roots.map((r) => ({ name: r, col: 0 }));
        const rowCounts = {};
        const visited = new Set();

        while (queue.length) {
            const { name, col } = queue.shift();
            if (visited.has(name)) continue;
            visited.add(name);

            rowCounts[col] = (rowCounts[col] || 0);
            layout[name] = { col, row: rowCounts[col]++ };

            (children[name] || []).forEach((child) => {
                if (!visited.has(child)) {
                    queue.push({ name: child, col: col + 1 });
                }
            });
        }

        // Place any orphan states not reached by BFS
        states.forEach((s) => {
            if (!layout[s.name]) {
                const col = Object.keys(rowCounts).length;
                rowCounts[col] = rowCounts[col] || 0;
                layout[s.name] = { col, row: rowCounts[col]++ };
            }
        });

        return layout;
    }

    /** Merge parallel edges (same from→to) into one edge with combined labels */
    _group_transitions(transitions) {
        const map = {};
        transitions.forEach((t) => {
            const key = `${t.from_state}|||${t.to_state}`;
            if (!map[key]) {
                map[key] = {
                    from_state: t.from_state,
                    to_state: t.to_state,
                    actions: [],
                    is_return: false,
                };
            }
            if (t.action && !map[key].actions.includes(t.action)) map[key].actions.push(t.action);
            if (t.is_return) map[key].is_return = true;
        });
        return Object.values(map);
    }

    _state_class(st) {
        const ds = String(st.doc_status);
        if (ds === "1") return "submitted";
        if (ds === "2") return "cancelled";
        if (ds === "0") return "draft";
        return "other";
    }

    /** Show in a dialog */
    show_dialog() {
        const d = new frappe.ui.Dialog({
            title: __("Workflow Diagram — {0}", [this.workflow_name]),
            size: "extra-large",
        });
        d.show();
        this.$wrapper = $(d.body);
        this.load();
    }
}
