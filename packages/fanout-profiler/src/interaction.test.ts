import { expect, test } from "bun:test";
import { createInteractionState, projectQuery, resetProjectState, resizePane, restoreQuery, restoreWorkspace, revealSelection, rowExpanded, selectionQuery, setQuery, toggleMaximized, toggleRow } from "./interaction.js";

test("native interaction state preserves linked history, disclosures, panes, and Escape scope", () => {
	const state = createInteractionState("?project=project-1&run=packet%2Frun&sort=duration");
	const node = { kind: "node", id: "work" };
	setQuery(state, selectionQuery(state, node, "packet/run"));
	expect(state.query.toString()).toBe("project=project-1&run=packet%2Frun&sort=duration&kind=node&id=work");
	restoreQuery(state, "?project=project-2&run=packet%2Frun&kind=node&id=other&sort=duration");
	expect(state.query.get("project")).toBe("project-2");
	expect(state.query.get("id")).toBe("other");
	expect(projectQuery(state, "project-3").toString()).toBe("project=project-3&sort=duration");

	revealSelection(state, { kind: "tool", id: "tool-1", nodeId: "work", attemptId: "work:1", turnId: "turn-1" }, "packet/run");
	expect(rowExpanded(state, { kind: "node", id: "node:work", nodeId: "work" }, "packet/run")).toBe(true);
	expect(rowExpanded(state, { kind: "attempt", id: "attempt:work:1" }, "packet/run")).toBe(true);
	expect(rowExpanded(state, { kind: "turn", id: "turn:work:1:turn-1" }, "packet/run")).toBe(true);
	toggleRow(state, { kind: "node", id: "node:other", nodeId: "other" }, "packet/run");
	expect(rowExpanded(state, { kind: "node", id: "node:work", nodeId: "work" }, "packet/run")).toBe(false);
	expect(rowExpanded(state, { kind: "attempt", id: "attempt:work:1" }, "packet/run")).toBe(true);
	resetProjectState(state);
	expect(rowExpanded(state, { kind: "attempt", id: "attempt:work:1" }, "packet/run")).toBe(false);
	expect(rowExpanded(state, { kind: "turn", id: "turn:work:1:turn-1" }, "packet/run")).toBe(false);

	expect(resizePane(state, "dag", 50)).toBe(200);
	expect(resizePane(state, "inspector", 900)).toBe(600);
	expect(toggleMaximized(state, "evidence")).toBe("evidence");
	restoreWorkspace(state);
	expect(state.maximized).toBeNull();
	expect(rowExpanded(state, { kind: "attempt", id: "attempt:work:1" }, "packet/run")).toBe(false);

});
