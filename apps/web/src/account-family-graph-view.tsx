import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	Background, BaseEdge, ControlButton, Controls, Handle, MarkerType, MiniMap, Panel, Position,
	ReactFlow, ReactFlowProvider, getViewportForBounds, useReactFlow, useStore,
	useUpdateNodeInternals,
	type Edge, type EdgeChange, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import { LocateFixed, Maximize2, Minimize2, Scan, Trash2, X } from "lucide-react";
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
	onDeleteRelations?: (relations: Relation[]) => void;
};

function accountLabel(asset: Asset) {
	const username = asset.name.trim() === asset.username.trim() ? "" : asset.username;
	return { username, text: [asset.name, username].filter(Boolean).join(" · ") };
}

function AccountCard({ data }: NodeProps<AccountNode>) {
	const { t } = useTranslation();
	const display = accountLabel(data.asset);
	const label = <span className="asset-graph-label" title={display.text}>
		{data.current && <span className="asset-graph-current">{t("relationGraphCurrent")}</span>}
		<strong>{data.asset.name}</strong>
		{display.username && <small>{display.username}</small>}
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
	return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />;
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

function GraphViewport({ layout, layoutKey, layoutSize, rootId, fitWholeGraph, restore, onSize, onReady }: {
	layout: AccountGraphLayout | null; layoutKey: string; rootId: string; restore: Bookmark | null;
	fitWholeGraph: boolean;
	layoutSize: { width: number; height: number };
	onSize: (size: { width: number; height: number }) => void; onReady: (key: string) => void;
}) {
	const width = useStore((state) => state.width);
	const height = useStore((state) => state.height);
	const measured = useStore((state) => state.nodeLookup.size > 0 && [...state.nodeLookup.values()].every((node) => !!node.measured.width && !!node.measured.height && !!node.internals.handleBounds));
	const updateNodeInternals = useUpdateNodeInternals();
	const { setCenter, setViewport } = useReactFlow();
	const pendingRestore = useRef(restore);
	const appliedLayout = useRef("");
	useEffect(() => { if (width && height) onSize({ width: Math.round(width), height: Math.round(height) }); }, [width, height, onSize]);
	useEffect(() => { if (layout) updateNodeInternals([...layout.nodes.keys()]); }, [layout, updateNodeInternals]);
	useEffect(() => {
		if (!layout || !measured || !width || !height || appliedLayout.current === layoutKey
			|| Math.round(width) !== layoutSize.width || Math.round(height) !== layoutSize.height) return;
		let active = true;
		const frame = requestAnimationFrame(() => {
			const fitted = fittedViewport(layout, width, height, fitWholeGraph ? undefined : rootId);
			const bookmark = pendingRestore.current;
			const anchor = layout.nodes.get(bookmark?.id ?? rootId) ?? layout.nodes.get(rootId);
			const operation = anchor && (bookmark || !fitWholeGraph && fitted.zoom < 11 / 12)
				? setCenter(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2, { zoom: bookmark?.zoom ?? 1 })
				: setViewport(fitted);
			void operation.then(() => { if (active) { appliedLayout.current = layoutKey; pendingRestore.current = null; onReady(layoutKey); } });
		});
		return () => { active = false; cancelAnimationFrame(frame); };
	}, [layout, layoutKey, layoutSize.width, layoutSize.height, measured, width, height, rootId, fitWholeGraph, setCenter, setViewport, onReady]);
	return null;
}

function GraphControls({ layout, rootId, expanded, onExpand, onCollapse }: {
	layout: AccountGraphLayout | null; rootId: string; expanded: boolean;
	onExpand: (bookmark: Bookmark) => void;
	onCollapse: () => void;
}) {
	const { t } = useTranslation();
	const { setCenter, setViewport, getViewport } = useReactFlow();
	const width = useStore((state) => state.width), height = useStore((state) => state.height);
	const [x, y, zoom] = useStore((state) => state.transform);
	const fitted = layout && width && height ? fittedViewport(layout, width, height) : null;
	const root = layout?.nodes.get(rootId);
	const returnToCurrent = !!root && (Math.abs(zoom - 1) > 1 / 12
		|| Math.hypot((root.x + root.width / 2) * zoom + x - width / 2, (root.y + root.height / 2) * zoom + y - height / 2) > 24);
	const viewLabel = t(returnToCurrent ? "accountGraphFocus" : "accountGraphFit");
	const expandLabel = t(expanded ? "accountGraphCollapse" : "accountGraphExpand");
	return <Controls orientation="horizontal" aria-label={t("accountGraphControls")} showInteractive={false} showFitView={false}>
		<ControlButton className="account-graph-view-toggle" title={viewLabel} aria-label={viewLabel} disabled={!fitted} onClick={() => {
			const node = layout?.nodes.get(rootId);
			if (returnToCurrent && node) void setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1 });
			else if (fitted) void setViewport(fitted);
		}}>{returnToCurrent ? <LocateFixed size={18} /> : <Scan size={18} />}</ControlButton>
		<ControlButton id="account-graph-expand" className="account-graph-fullscreen" title={expandLabel} aria-label={expandLabel} aria-pressed={expanded} disabled={!layout} onClick={() => {
			if (expanded) { onCollapse(); return; }
			const view = getViewport();
			const center = { x: (width / 2 - view.x) / view.zoom, y: (height / 2 - view.y) / view.zoom };
			const nearest = layout && [...layout.nodes].sort(([, a], [, b]) => Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y) - Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y))[0];
			onExpand({ id: nearest?.[0] ?? rootId, zoom: view.zoom });
		}}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</ControlButton>
	</Controls>;
}

function GraphMiniMap({ rootId }: { rootId: string }) {
	const { setCenter, getViewport } = useReactFlow();
	return <MiniMap style={{ width: 140, height: 64 }} bgColor="var(--paper)" nodeStrokeColor="var(--line)" nodeStrokeWidth={1} maskColor="color-mix(in srgb, var(--ink) 14%, transparent)" maskStrokeColor="var(--line)" maskStrokeWidth={1} pannable zoomable
		onClick={(_, point) => { void setCenter(point.x, point.y, { zoom: getViewport().zoom }); }}
		nodeColor={(node) => node.id === rootId ? "var(--yellow)" : "var(--muted)"} />;
}

function GraphContent({ props, expanded, restore, onExpand, onCollapse }: {
	props: Props; expanded: boolean; restore: Bookmark | null;
	onExpand: (bookmark: Bookmark) => void;
	onCollapse: () => void;
}) {
	const { t } = useTranslation();
	const [size, setSize] = useState({ width: 0, height: 0 });
	const [navigationHost, setNavigationHost] = useState<HTMLDivElement | null>(null);
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
		return [{ id, type: "accountCard", position: { x: node.x, y: node.y }, width: node.width, height: node.height,
			style: { width: node.width, height: node.height },
			className: `${id === props.root.id ? "asset-graph-center" : "asset-graph-neighbor"}${props.matches.has(id) ? " asset-graph-match" : ""}`,
			ariaLabel: accountLabel(asset).text,
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
			markerEnd: group.every((relation) => relation.id.startsWith("pw-link-identifier-")) ? undefined : { type: MarkerType.ArrowClosed }, selected: active, selectable: true, focusable: true, deletable: false, zIndex: active ? 2 : 0,
			className: verified ? "relation-graph-edge--verified" : "relation-graph-edge--pending",
			ariaLabel: `${byId.get(group[0].from)?.name} → ${byId.get(group[0].to)?.name} · ${labels.join(" · ")} · ${t(verified ? "relationGraphVerified" : mixed ? "relationGraphMixed" : "relationGraphPending")}`,
			style: { stroke: verified ? "var(--green)" : "var(--muted)", strokeWidth: active ? 4 : 2, strokeDasharray: verified ? "none" : "5 4", opacity: selected && !active ? 0.25 : 1 } }];
	}) : [];
	function changeEdges(changes: EdgeChange[]) {
		const chosen = changes.filter((change): change is Extract<EdgeChange, { type: "select" }> => change.type === "select" && change.selected).at(-1);
		if (chosen) props.onSelectEdge(chosen.id);
		else if (changes.some((change) => change.type === "select" && change.id === props.selectedEdgeId && !change.selected)) props.onSelectEdge(null);
	}
	return <section className={`graph account-family-graph${props.root.kind !== "account" ? " asset-relations-graph" : ""}${expanded ? " account-family-graph--expanded" : ""}`} aria-label={t("relations")} aria-busy={!ready && !error} data-layout-ready={ready}>
		<div className="account-graph-view-actions"><div className="account-graph-navigation" ref={setNavigationHost} /></div>
		<div className={`account-graph-stage${ready ? " is-ready" : ""}`}>
			<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
				ariaLabelConfig={{ "controls.zoomIn.ariaLabel": t("accountGraphZoomIn"), "controls.zoomOut.ariaLabel": t("accountGraphZoomOut"), "minimap.ariaLabel": t("accountGraphMap") }}
				minZoom={0.01} maxZoom={2} defaultViewport={{ x: 0, y: 0, zoom: 1 }}
				nodesFocusable={false} edgesFocusable onEdgesChange={changeEdges} onPaneClick={() => props.onSelectEdge(null)}
				deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} nodesDraggable={false} nodesConnectable={false}>
				<GraphViewport layout={layout} layoutKey={inputKey} layoutSize={size} rootId={props.root.id} fitWholeGraph={props.root.kind !== "account"} restore={restore} onSize={setSize} onReady={setReadyKey} />
				<Background />
				{navigationHost && createPortal(<><GraphControls layout={layout} rootId={props.root.id} expanded={expanded} onExpand={onExpand} onCollapse={onCollapse} />{props.assets.length > 12 && <GraphMiniMap rootId={props.root.id} />}</>, navigationHost)}
				{selected && <Panel position="bottom-right" className="account-graph-selection-panel nodrag nopan"><section className="account-graph-connection-details" aria-label={t("accountGraphSelection")}>
					<div className="account-graph-selection-header"><p className="account-graph-selection-title"><strong>{byId.get(selected[0].from)?.name}</strong><span aria-hidden="true"> → </span><strong>{byId.get(selected[0].to)?.name}</strong></p><Button className="account-graph-selection-close" aria-label={t("close")} onClick={() => props.onSelectEdge(null)}><X size={18} /></Button></div>
					<ul className="account-graph-selection-labels">{[...new Set(selected.map((relation) => relation.label))].map((label) => <li key={label}>{label}</li>)}</ul>
					<p className="account-graph-selection-status" role="status">{t(selected.every((relation) => !!relation.verifiedAt) ? "relationGraphVerified" : selected.some((relation) => !!relation.verifiedAt) ? "relationGraphMixed" : "relationGraphPending")}</p>
					{props.onDeleteRelations && <Button className="account-graph-disconnect" variant="danger" size="small" onClick={() => props.onDeleteRelations?.(selected)}><Trash2 size={16} />{t("deleteRelation")}</Button>}
				</section></Panel>}
			</ReactFlow>
			{!ready && <p className="account-graph-state" role={error ? "alert" : "status"}>{t(error ? "accountGraphUnavailable" : "loading")}</p>}
		</div>
	</section>;
}

export function AssetRelationGraph(props: Props) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const [restore, setRestore] = useState<{ rootId: string; bookmark: Bookmark } | null>(null);
	const normalBookmark = useRef<{ rootId: string; bookmark: Bookmark } | null>(null);
	function closeExpanded() {
		const previous = normalBookmark.current;
		setRestore({ rootId: props.root.id, bookmark: previous?.rootId === props.root.id ? previous.bookmark : { id: props.root.id, zoom: 1 } });
		setExpanded(false);
	}
	// Keep the dialog mounted while changing accounts; only reset the canvas and its camera.
	const canvas = <GraphContent key={props.root.id} props={props} expanded={expanded} restore={restore?.rootId === props.root.id ? restore.bookmark : null} onCollapse={closeExpanded} onExpand={(bookmark) => { normalBookmark.current = { rootId: props.root.id, bookmark }; setRestore(null); setExpanded(true); }} />;
	return <ReactFlowProvider>{expanded ? <Dialog title={t("relations")} className="account-graph-dialog" focusTitleOnOpen returnFocusTo={() => document.getElementById("account-graph-expand")} onClose={closeExpanded}>{canvas}</Dialog> : canvas}</ReactFlowProvider>;
}
