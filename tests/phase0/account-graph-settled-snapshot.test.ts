import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettledAccountGraphSnapshot } from "../e2e/helpers/account-graph";

// Controlled DOM/frame fixtures test the sampling boundary. These are not
// browser acceptance or a simulation of the renderer's implementation.
function fixture(nodes = 4, edges = 3) {
	const state = {
		nodes: Array.from({ length: nodes }, (_, index) => ({
			dataset: { id: `node-${index}` },
			style: { transform: `translate(${index * 200}px,0px)` },
			offsetWidth: 180,
			offsetHeight: 80,
		})),
		edges: Array.from({ length: edges }, (_, index) => ({
			dataset: { id: `edge-${index}` },
		})),
		paths: Array.from({ length: edges }, () => ({
			getAttribute: () => "M0,0 L100,0",
			getTotalLength: () => 100,
		})),
	};
	const element = {
		getAttribute: (name: string) =>
			name === "data-layout-ready" ? "true" : "false",
		querySelectorAll: (selector: string) => {
			if (selector === ".react-flow__node") return state.nodes;
			if (selector === ".react-flow__edge") return state.edges;
			if (selector === ".react-flow__edge-path") return state.paths;
			throw Error(`unexpected fixture selector: ${selector}`);
		},
	} as unknown as HTMLElement;
	return { state, element };
}

function frames(change?: (frame: number) => void) {
	let frame = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		queueMicrotask(() => {
			change?.(++frame);
			callback(frame);
		});
		return frame;
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("settled graph snapshot cardinality", () => {
	it("returns the exact IDs from a complete stable graph", async () => {
		frames();
		const { element } = fixture();
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 4, edges: 3 }),
		).toEqual({
			nodes: ["node-0", "node-1", "node-2", "node-3"],
			edges: ["edge-0", "edge-1", "edge-2"],
		});
	});

	it("rejects stable empty edges after a prior count could have passed", async () => {
		frames();
		const { element } = fixture(4, 0);
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 4, edges: 3 }),
		).toBeNull();
	});

	it("rejects wrappers whose rendered paths are absent", async () => {
		frames();
		const { state, element } = fixture();
		state.paths = [];
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 4, edges: 3 }),
		).toBeNull();
	});

	it("rechecks node cardinality in the same observation", async () => {
		frames();
		const { element } = fixture(3, 3);
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 4, edges: 3 }),
		).toBeNull();
	});

	it("rejects a graph generation that changes between the two frames", async () => {
		const { state, element } = fixture();
		frames((frame) => {
			if (frame === 1) state.nodes[0].dataset.id = "replacement-node";
		});
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 4, edges: 3 }),
		).toBeNull();
	});

	it("accepts an explicitly expected isolated node with zero edges", async () => {
		frames();
		const { element } = fixture(1, 0);
		expect(
			await readSettledAccountGraphSnapshot(element, { nodes: 1, edges: 0 }),
		).toEqual({ nodes: ["node-0"], edges: [] });
	});
});
