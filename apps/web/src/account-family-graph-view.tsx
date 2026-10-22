import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	Background, BaseEdge, ControlButton, Controls, Handle, MarkerType, MiniMap, Panel, Position,
	ReactFlow, ReactFlowProvider, getViewportForBounds, useReactFlow, useStore,
	useUpdateNodeInternals,
	type Edge, type EdgeChange, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { Maximize2, X } from "lucide-react";
import type { Asset, Relation } from "../../../packages/domain/src";
import { layoutAccountGraph, type AccountGraphLayout, type AccountGraphHandle } from "./account-graph-layout";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import "./account-graph.css";

type AccountNode = Node<{
	asset: Asset; current: boolean; handles: AccountGraphHandle[]; visit: (asset: Asset) => void;
}, "accountCard">;
type Bookmark = { id: string; zoom: number };
type Props = {
	root: Asset;
	assets: Asset[];
	relations: Relation[];
	matches: Set<string>;
	selectedEdgeId: string | null;
	onSelectEdge: (id: string | null) => void;
	onVisit: (asset: Asset) => void;
};

function AccountCard({ data }: NodeProps<AccountNode>) {
	const { t } = useTranslation();
	const label = <span className="asset-graph-label" title={[data.asset.name, data.asset.username].filter(Boolean).join(" · ")}>
		{data.current && <span className="asset-graph-current">{t("accountGraphCurrent")}</span>}
		<strong>{data.asset.name}</strong>
		{data.asset.username && <small>{data.asset.username}</small>}
	</span>;
	return <>
		<div className="account-graph-card">
			{data.current ? label : <Link className="asset-graph-link" to="/assets/$kind/$id" params={{ kind: data.asset.kind, id: data.asset.id }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); data.visit(data.asset); }}>{label}</Link>}
		</div>
		{data.handles.map((handle) => <Handle key={handle.id} id={handle.id} type={handle.type}
			position={handle.side === "left" ? Position.Left : Position.Right} isConnectable={false}
			data-layout-x={handle.x} data-layout-y={handle.y}
			style={{ top: handle.y, ...(handle.side === "left" ? { left: 0 } : { right: 0 }) }} />)}
	</>;
}

function AccountConnectionEdge(props: EdgeProps) {
	const points = props.data?.points as { x: number; y: number }[] | undefined;
	if (!points?.length) return null;
	// Serialize the layout engine's obstacle-avoiding route without replacing its bends.
	const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
	return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={16} />;
}
const nodeTypes = { accountCard: AccountCard };
const edgeTypes = { accountConnection: AccountConnectionEdge };

function fittedViewport(layout: AccountGraphLayout, width: number, height: number, rootId?: string) {
	let bounds = layout.bounds;
	const root = rootId ? layout.nodes.get(rootId) : undefined;
	if (root) {
		const x = root.x + root.width / 2, y = root.y + root.height / 2;
		const halfWidth = Math.max(x - bounds.x, bounds.x + bounds.width - x);
		const halfHeight = Math.max(y - bounds.y, bounds.y + bounds.height - y);
		bounds = { x: x - halfWidth, y: y - halfHeight, width: halfWidth * 2, height: halfHeight * 2 };
	}
	return getViewportForBounds({ x: bounds.x - 8, y: bounds.y - 8, width: bounds.width + 16, height: bounds.height + 16 }, width, height, 0.01, 1, 0);
}

function GraphViewport({ layout, layoutKey, rootId, restore, onSize, onReady }: {
	layout: AccountGraphLayout | null; layoutKey: string; rootId: string; restore: Bookmark | null;
	onSize: (size: { width: number; height: number }) => void; onReady: (key: string) => void;
}) {
	const width = useStore((state) => state.width);
	const height = useStore((state) => state.height);
	const measured = useStore((state) => state.nodeLookup.size > 0 && [...state.nodeLookup.values()].every((node) => !!node.measured.width && !!node.measured.height && !!node.internals.handleBounds));
	const updateNodeInternals = useUpdateNodeInternals();
	const { setCenter, setViewport } = useReactFlow();
	const pendingRestore = useRef(restore);
	useEffect(() => { if (width && height) onSize({ width: Math.round(width), height: Math.round(height) }); }, [width, height, onSize]);
	useEffect(() => { if (layout) updateNodeInternals([...layout.nodes.keys()]); }, [layout, updateNodeInternals]);
	useEffect(() => {
		if (!layout || !measured || !width || !height) return;
		let active = true;
		const frame = requestAnimationFrame(() => {
			const fitted = fittedViewport(layout, width, height, rootId);
			const bookmark = pendingRestore.current;
			const anchor = layout.nodes.get(bookmark?.id ?? rootId) ?? layout.nodes.get(rootId);
			const operation = anchor && (bookmark || fitted.zoom < 11 / 12)
				? setCenter(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2, { zoom: bookmark?.zoom ?? 1 })
				: setViewport(fitted);
			void operation.then(() => { if (active) { pendingRestore.current = null; onReady(layoutKey); } });
		});
		return () => { active = false; cancelAnimationFrame(frame); };
	}, [layout, layoutKey, measured, width, height, rootId, setCenter, setViewport, onReady]);
	return null;
}

function GraphActions({ layout, rootId, expanded, onExpand }: {
	layout: AccountGraphLayout | null; rootId: string; expanded: boolean;
	onExpand: (bookmark: Bookmark) => void;
}) {
	const { t } = useTranslation();
	const { setCenter, setViewport, getViewport } = useReactFlow();
	const width = useStore((state) => state.width), height = useStore((state) => state.height);
	return <div className="account-graph-view-actions">
		<Button size="small" disabled={!layout} onClick={() => {
			const node = layout?.nodes.get(rootId);
			if (node) void setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1 });
		}}>{t("accountGraphFocus")}</Button>
		<Button size="small" disabled={!layout || !width || !height} onClick={() => { if (layout) void setViewport(fittedViewport(layout, width, height)); }}>{t("accountGraphFit")}</Button>
		{!expanded && <Button id="account-graph-expand" size="small" disabled={!layout} onClick={() => {
			const view = getViewport();
			const center = { x: (width / 2 - view.x) / view.zoom, y: (height / 2 - view.y) / view.zoom };
			const nearest = layout && [...layout.nodes].sort(([, a], [, b]) => Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y) - Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y))[0];
			onExpand({ id: nearest?.[0] ?? rootId, zoom: view.zoom });
		}}><Maximize2 size={15} />{t("accountGraphExpand")}</Button>}
	</div>;
}

function GraphControls({ layout }: { layout: AccountGraphLayout | null }) {
	const { t } = useTranslation();
	const { setViewport } = useReactFlow();
	const width = useStore((state) => state.width), height = useStore((state) => state.height);
	return <Controls showInteractive={false} showFitView={false}><ControlButton className="react-flow__controls-fitview" aria-label={t("accountGraphFit")} title={t("accountGraphFit")} disabled={!layout} onClick={() => { if (layout && width && height) void setViewport(fittedViewport(layout, width, height)); }}><Maximize2 size={16} /></ControlButton></Controls>;
}

function GraphContent({ props, expanded, restore, onExpand }: {
	props: Props; expanded: boolean; restore: Bookmark | null;
	onExpand: (bookmark: Bookmark) => void;
}) {
	const { t } = useTranslation();
	const [size, setSize] = useState({ width: 0, height: 0 });
	const [result, setResult] = useState<{ key: string; layout: AccountGraphLayout | null; error: boolean }>({ key: "", layout: null, error: false });
	const [readyKey, setReadyKey] = useState("");
	const inputKey = JSON.stringify([props.root.id, props.assets.map((asset) => asset.id).sort(), props.relations.map((relation) => [relation.id, relation.from, relation.to, relation.deleted]).sort(), size.width, size.height]);
	const requestAssets = useRef(props.assets), requestRelations = useRef(props.relations);
	requestAssets.current = props.assets; requestRelations.current = props.relations;
	useEffect(() => {
		if (!size.width || !size.height) return;
		let active = true;
		void layoutAccountGraph(props.root.id, requestAssets.current, requestRelations.current, size)
			.then((layout) => { if (active) setResult({ key: inputKey, layout, error: false }); })
			.catch(() => { if (active) setResult({ key: inputKey, layout: null, error: true }); });
		return () => { active = false; };
	}, [inputKey, props.root.id, size]);
	const layout = result.key === inputKey ? result.layout : null;
	const ready = !!layout && readyKey === inputKey;
	const error = result.key === inputKey && result.error;
	const restoredFocus = useRef(false);
	useEffect(() => {
		if (ready && restore && !expanded && !restoredFocus.current) {
			restoredFocus.current = true;
			document.getElementById("account-graph-expand")?.focus();
		}
	}, [ready, restore, expanded]);
	const byId = new Map(props.assets.map((asset) => [asset.id, asset]));
	const groups = Array.from(props.relations.reduce((all, relation) => {
		if (relation.deleted || !byId.has(relation.from) || !byId.has(relation.to) || relation.from === relation.to) return all;
		const pair = JSON.stringify([relation.from, relation.to]);
		all.set(pair, [...all.get(pair) ?? [], relation]); return all;
	}, new Map<string, Relation[]>()).values());
	const selected = groups.find((group) => group.some((relation) => relation.id === props.selectedEdgeId));
	const nodes: AccountNode[] = layout ? [...layout.nodes].flatMap(([id, node]) => {
		const asset = byId.get(id); if (!asset) return [];
		return [{ id, type: "accountCard", position: { x: node.x, y: node.y },
			style: { width: node.width, height: node.height },
			className: `${id === props.root.id ? "asset-graph-center" : "asset-graph-neighbor"}${props.matches.has(id) ? " asset-graph-match" : ""}`,
			ariaLabel: [asset.name, asset.username].filter(Boolean).join(" · "),
			domAttributes: { "data-node-width": node.width, "data-node-height": node.height } as NonNullable<AccountNode["domAttributes"]> & { "data-node-width": number; "data-node-height": number },
			data: { asset, current: id === props.root.id, handles: node.handles, visit: props.onVisit } }];
	}) : [];
	const edges: Edge[] = layout ? groups.flatMap((group) => {
		const route = layout.edges.get(JSON.stringify([group[0].from, group[0].to])); if (!route) return [];
		const verified = group.every((relation) => !!relation.verifiedAt), mixed = group.some((relation) => !!relation.verifiedAt) && !verified;
		const labels = [...new Set(group.map((relation) => relation.label))];
		const active = group === selected;
		return [{ id: group[0].id, source: group[0].from, target: group[0].to, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
			type: "accountConnection", data: { points: route.points, labels }, label: labels.join(" · "),
			domAttributes: { "data-from": group[0].from, "data-to": group[0].to } as NonNullable<Edge["domAttributes"]> & { "data-from": string; "data-to": string },
			markerEnd: { type: MarkerType.ArrowClosed }, selected: active, selectable: true, focusable: true, deletable: false, zIndex: active ? 2 : 0,
			className: verified ? "relation-graph-edge--verified" : "relation-graph-edge--pending",
			ariaLabel: `${byId.get(group[0].from)?.name} → ${byId.get(group[0].to)?.name} · ${labels.join(" · ")} · ${t(verified ? "relationGraphVerified" : mixed ? "relationGraphMixed" : "relationGraphPending")}`,
			style: { stroke: verified ? "var(--green)" : "var(--muted)", strokeWidth: active ? 4 : 2, strokeDasharray: verified ? "none" : "5 4", opacity: selected && !active ? 0.25 : 1 } }];
	}) : [];
	function changeEdges(changes: EdgeChange[]) {
		const chosen = changes.filter((change): change is Extract<EdgeChange, { type: "select" }> => change.type === "select" && change.selected).at(-1);
		if (chosen) props.onSelectEdge(chosen.id);
		else if (changes.some((change) => change.type === "select" && change.id === props.selectedEdgeId && !change.selected)) props.onSelectEdge(null);
	}
	return <section className={`graph account-family-graph${expanded ? " account-family-graph--expanded" : ""}`} aria-label={t("relations")} aria-busy={!ready && !error} data-layout-ready={ready}>
		<GraphActions layout={layout} rootId={props.root.id} expanded={expanded} onExpand={onExpand} />
		<div className={`account-graph-stage${ready ? " is-ready" : ""}`}>
			<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
				minZoom={0.01} maxZoom={2} defaultViewport={{ x: 0, y: 0, zoom: 1 }}
				nodesFocusable={false} edgesFocusable onEdgesChange={changeEdges} onPaneClick={() => props.onSelectEdge(null)}
				deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} nodesDraggable={false} nodesConnectable={false}>
				<GraphViewport layout={layout} layoutKey={inputKey} rootId={props.root.id} restore={restore} onSize={setSize} onReady={setReadyKey} />
				<Background />
				<GraphControls layout={layout} />
				{nodes.length > 12 && !selected && <MiniMap pannable zoomable nodeColor={(node) => node.id === props.root.id ? "var(--yellow)" : "var(--paper)"} />}
				{selected && <Panel position="bottom-right" className="account-graph-selection-panel nodrag nopan"><section className="account-graph-connection-details" aria-label={t("accountGraphSelection")}>
					<div className="account-graph-selection-header"><p className="account-graph-selection-title"><strong>{byId.get(selected[0].from)?.name}</strong><span aria-hidden="true"> → </span><strong>{byId.get(selected[0].to)?.name}</strong></p><Button className="account-graph-selection-close" aria-label={t("close")} onClick={() => props.onSelectEdge(null)}><X size={18} /></Button></div>
					<ul className="account-graph-selection-labels">{[...new Set(selected.map((relation) => relation.label))].map((label) => <li key={label}>{label}</li>)}</ul>
					<p className="account-graph-selection-status" role="status">{t(selected.every((relation) => !!relation.verifiedAt) ? "relationGraphVerified" : selected.some((relation) => !!relation.verifiedAt) ? "relationGraphMixed" : "relationGraphPending")}</p>
				</section></Panel>}
			</ReactFlow>
			{!ready && <p className="account-graph-state" role={error ? "alert" : "status"}>{t(error ? "accountGraphUnavailable" : "loading")}</p>}
		</div>
	</section>;
}

export function AccountFamilyGraphView(props: Props) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const [restore, setRestore] = useState<Bookmark | null>(null);
	const normalBookmark = useRef<Bookmark | null>(null);
	const canvas = <GraphContent props={props} expanded={expanded} restore={restore} onExpand={(bookmark) => { normalBookmark.current = bookmark; setRestore(null); setExpanded(true); }} />;
	return <ReactFlowProvider>{expanded ? <Dialog title={t("accountGraphTitle")} className="account-graph-dialog" focusTitleOnOpen returnFocusTo={() => document.getElementById("account-graph-expand")} onClose={() => { setRestore(normalBookmark.current); setExpanded(false); }}>{canvas}</Dialog> : canvas}</ReactFlowProvider>;
}
