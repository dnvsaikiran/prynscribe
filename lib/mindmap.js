// lib/mindmap.js
// A simple utility to render a top-down concept mindmap using SVG.

export function renderMindmap(svgElement, data) {
    if (!data || !data.nodes || !data.links) return;

    const width = 800;
    const height = 500;
    const nodeWidth = 140;
    const nodeHeight = 50;

    svgElement.innerHTML = ''; // Clear existing

    // Calculate positions (Top-Down Simplistic Layout)
    const levels = {};
    data.nodes.forEach(node => {
        if (!levels[node.level]) levels[node.level] = [];
        levels[node.level].push(node);
    });

    const levelCount = Object.keys(levels).length;
    const levelHeight = height / (levelCount + 1);

    Object.keys(levels).forEach((level, lIndex) => {
        const nodesAtLevel = levels[level];
        const levelY = (lIndex + 1) * levelHeight;
        
        nodesAtLevel.forEach((node, nIndex) => {
            const levelX = (width / (nodesAtLevel.length + 1)) * (nIndex + 1);
            node.x = levelX;
            node.y = levelY;
        });
    });

    // Draw Links
    data.links.forEach(link => {
        const source = data.nodes.find(n => n.id === link.source);
        const target = data.nodes.find(n => n.id === link.target);
        if (source && target) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", source.x);
            line.setAttribute("y1", source.y);
            line.setAttribute("x2", target.x);
            line.setAttribute("y2", target.y);
            line.setAttribute("stroke", "#000000");
            line.setAttribute("stroke-width", "1");
            svgElement.appendChild(line);
        }
    });

    // Draw Nodes
    data.nodes.forEach(node => {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${node.x - nodeWidth/2}, ${node.y - nodeHeight/2})`);

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width", nodeWidth);
        rect.setAttribute("height", nodeHeight);
        rect.setAttribute("rx", "4"); // Sharp but refined
        rect.setAttribute("fill", node.level === 0 ? "#000000" : "#ffffff");
        rect.setAttribute("stroke", "#000000");
        rect.setAttribute("stroke-width", "1.5");
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", nodeWidth / 2);
        text.setAttribute("y", nodeHeight / 2);
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", node.level === 0 ? "#ffffff" : "#000000");
        text.setAttribute("font-size", "11px");
        text.setAttribute("font-weight", "800");
        text.setAttribute("style", "text-transform: uppercase; letter-spacing: 0.05em;");
        text.textContent = node.label;

        g.appendChild(rect);
        g.appendChild(text);
        svgElement.appendChild(g);
    });
}
