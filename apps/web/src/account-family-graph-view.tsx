import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	Background, BaseEdge, ControlButton, Controls, Handle, MarkerType, MiniMap, Panel, Position,
	ReactFlow, ReactFlowProvider, getSmoothStepPath, getViewportForBounds, useReactFlow, useStore,
	useUpdateNodeInternals,
	type Edge, type EdgeChange, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, LocateFixed, Maximize2, Minimize2, Pencil, Scan, Trash2, X } from "lucide-react";
import type { Asset, Relation } from "../../../packages/domain/src";
import { layoutAccountGraph, type AccountGraphLayout, type AccountGraphHandle } from "./account-graph-layout";
import { graphViewState, type GraphCamera } from "./account-family-graph";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { date } from "./view-shared";
import "./account-graph.css";

type AccountNode = Node<{
	asset: Asset; current: boolean; handles: AccountGraphHandle[]; visit: (asset: Asset) => void;
}, "accountCard">;
type Bookmark = GraphCamera;
type Props = {
	root: Asset;
	assets: Asset[];
	relations: Relation[];
	matches: Set<string>;
	selectedEdgeId: string | null;
	onSelectEdge: (id: string | null) => void;
	onVisit: (asset: Asset) => void;
	onDeleteRelation?: (relation: Relation) => void;
	onEditRelation?: (relation: Relation) => void;
	onReturn?: () => void;
	returnLabel?: string;
};

function accountLabel(asset: Asset) {
	const username = asset.name.trim() === asset.username.trim() ? "" : asset.username;
	return { username, text: [asset.name, username].filter(Boolean).join(" · ") };
}

function AccountCard({ data }: NodeProps<AccountNode>) {
	const { t } = useTranslation();
	const display = accountLabel(data.asset);
	const label = <span className="asset-graph-label" title={display.text}>
		{data.current && <span className="asset-graph-current">{t(data.asset.kind === "account" ? "accountGraphCurrent" : "graphCurrentAsset")}</span>}
		<strong>{data.asset.name}</strong>
		{display.username && <small>{display.username}</small>}
	</span>;
	return <>
		<div className="account-graph-card">
			{data.current ? label : <Link draggable={false} className="asset-graph-link" to="/assets/$kind/$id" params={{ kind: data.asset.kind, id: data.asset.id }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); data.visit(data.asset); }}>{label}</Link>}
		</div>
		{data.handles.map((handle) => <Handle key={handle.id} id={handle.id} type={handle.type}
			position={handle.side === "left" ? Position.Left : Position.Right} isConnectable={false}
			data-layout-x={handle.x} data-layout-y={handle.y}
			style={{ top: handle.y, ...(handle.side === "left" ? { left: 0 } : { right: 0 }) }} />)}
	</>;
}

function AccountConnectionEdge(props: EdgeProps) {
	const width = useStore(state => state.width);
	const points = props.data?.points as { x: number; y: number }[] | undefined;
	if (!points?.length) return null;
	// Serialize the layout engine's obstacle-avoiding route without replacing its bends.
	const path = props.data?.moved
		? getSmoothStepPath({ sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition, targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition })[0]
		: points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
	return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={Math.round(width) < 700 ? 32 : 20} />;
}
const nodeTypes = { accountCard: AccountCard };
const edgeTypes = { accountConnection: AccountConnectionEdge };

function anchoredCamera(layout: AccountGraphLayout | null, center: { x: number; y: number; zoom: number }): Bookmark {
	const nearest = layout && [...layout.nodes].sort(([, a], [, b]) => Math.hypot(a.x + a.width / 2 - center.x, a.y + a.height / 2 - center.y) - Math.hypot(b.x + b.width / 2 - center.x, b.y + b.height / 2 - center.y))[0];
	return nearest ? { ...center, anchorId: nearest[0], offsetX: center.x - nearest[1].x - nearest[1].width / 2, offsetY: center.y - nearest[1].y - nearest[1].height / 2 } : center;
}

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

function GraphViewport({ layout, layoutKey, layoutSize, rootId, restore, onSize, onReady, refreshKey, positions }: {
	layout: AccountGraphLayout | null; layoutKey: string; rootId: string; restore: Bookmark | null;
	refreshKey: string;
	positions: Record<string, { x: number; y: number }>;
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
	const lastMeasurement = useRef<{ layout: AccountGraphLayout | null; key: string }>({ layout: null, key: "" });
	useEffect(() => { if (appliedLayout.current !== layoutKey) pendingRestore.current = restore; }, [layoutKey, restore]);
	useEffect(() => { if (width && height) onSize({ width: Math.round(width), height: Math.round(height) }); }, [width, height, onSize]);
	useEffect(() => {
		if (!layout || measured && lastMeasurement.current.layout === layout && lastMeasurement.current.key === refreshKey) return;
		lastMeasurement.current = { layout, key: refreshKey };
		updateNodeInternals([...layout.nodes.keys()]);
	}, [layout, measured, refreshKey, updateNodeInternals]);
	useEffect(() => {
		if (!layout || !measured || !width || !height || appliedLayout.current === layoutKey
			|| Math.round(width) !== layoutSize.width || Math.round(height) !== layoutSize.height) return;
		let active = true;
		const frame = requestAnimationFrame(() => {
			const fitted = fittedViewport(layout, width, height, rootId);
			const bookmark = pendingRestore.current;
			const anchor = layout.nodes.get(rootId);
			const restoredAnchor = bookmark?.anchorId ? layout.nodes.get(bookmark.anchorId) : undefined;
			const restoredCenter = restoredAnchor && bookmark?.anchorId ? { x: restoredAnchor.x + restoredAnchor.width / 2 + (positions[bookmark.anchorId]?.x ?? 0) + (bookmark.offsetX ?? 0), y: restoredAnchor.y + restoredAnchor.height / 2 + (positions[bookmark.anchorId]?.y ?? 0) + (bookmark.offsetY ?? 0) } : bookmark;
			const operation = bookmark && restoredCenter ? setCenter(restoredCenter.x, restoredCenter.y, { zoom: bookmark.zoom }) : anchor && fitted.zoom < 11 / 12
				? setCenter(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2, { zoom: 1 })
				: setViewport(fitted);
			void operation.then(() => { if (active) { appliedLayout.current = layoutKey; pendingRestore.current = null; onReady(layoutKey); } });
		});
		return () => { active = false; cancelAnimationFrame(frame); };
	}, [layout, layoutKey, layoutSize.width, layoutSize.height, measured, width, height, rootId, positions, setCenter, setViewport, onReady]);
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
			onExpand(anchoredCamera(layout, { ...center, zoom: view.zoom }));
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
	const { t, i18n } = useTranslation();
	const presentation = graphViewState(props.root.id);
	const [positions, setPositions] = useState(() => ({ ...presentation.positions }));
	const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
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
	const connections = props.relations.filter(relation => !relation.deleted && byId.has(relation.from) && byId.has(relation.to) && relation.from !== relation.to);
	const selectedRelation = connections.find(relation => relation.id === props.selectedEdgeId);
	const selected = selectedRelation ? [selectedRelation] : undefined;
	const positionedLayout = layout ? { ...layout, nodes: new Map([...layout.nodes].map(([id, node]) => [id, { ...node, x: node.x + (positions[id]?.x ?? 0), y: node.y + (positions[id]?.y ?? 0) }])), bounds: { ...layout.bounds } } : null;
	if (positionedLayout?.nodes.size) {
		const entries = [...positionedLayout.nodes.values()];
		const minX = Math.min(...entries.map(node => node.x)), minY = Math.min(...entries.map(node => node.y));
		positionedLayout.bounds = { x: minX - 12, y: minY - 12, width: Math.max(...entries.map(node => node.x + node.width)) - minX + 24, height: Math.max(...entries.map(node => node.y + node.height)) - minY + 24 };
	}
	const nodes: AccountNode[] = positionedLayout ? [...positionedLayout.nodes].flatMap(([id, node]) => {
		const asset = byId.get(id); if (!asset) return [];
		return [{ id, type: "accountCard", position: { x: node.x, y: node.y }, width: node.width, height: node.height,
			measured: measurements[id],
			style: { width: node.width, height: node.height },
			className: `${id === props.root.id ? "asset-graph-center" : "asset-graph-neighbor"}${props.matches.has(id) ? " asset-graph-match" : ""}`,
			ariaLabel: accountLabel(asset).text,
			domAttributes: { "data-node-width": node.width, "data-node-height": node.height } as NonNullable<AccountNode["domAttributes"]> & { "data-node-width": number; "data-node-height": number },
			data: { asset, current: id === props.root.id, handles: node.handles, visit: props.onVisit } }];
	}) : [];
	const edges: Edge[] = layout ? connections.flatMap((relation) => {
		const route = layout.edges.get(relation.id); if (!route) return [];
		const verified = !!relation.verifiedAt, active = relation.id === props.selectedEdgeId;
		return [{ id: relation.id, source: relation.from, target: relation.to, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
			type: "accountConnection", data: { points: route.points, labels: [relation.label], moved: !!positions[relation.from] || !!positions[relation.to] }, label: relation.label,
			domAttributes: { "data-from": relation.from, "data-to": relation.to, "data-relation-id": relation.id } as NonNullable<Edge["domAttributes"]> & { "data-from": string; "data-to": string; "data-relation-id": string },
			markerEnd: { type: MarkerType.ArrowClosed }, selected: active, selectable: true, focusable: true, deletable: false, zIndex: active ? 2 : 0,
			className: verified ? "relation-graph-edge--verified" : "relation-graph-edge--pending",
			ariaLabel: `${byId.get(relation.from)?.name} → ${byId.get(relation.to)?.name} · ${relation.label} · ${t(verified ? "relationGraphVerified" : "relationGraphPending")}`,
			style: { stroke: verified ? "var(--green)" : "var(--muted)", strokeWidth: active ? 4 : 2, strokeDasharray: verified ? "none" : "5 4", opacity: selected && !active ? 0.25 : 1 } }];
	}) : [];
	function changeEdges(changes: EdgeChange[]) {
		const chosen = changes.filter((change): change is Extract<EdgeChange, { type: "select" }> => change.type === "select" && change.selected).at(-1);
		if (chosen) props.onSelectEdge(chosen.id);
		else if (changes.some((change) => change.type === "select" && change.id === props.selectedEdgeId && !change.selected)) props.onSelectEdge(null);
	}
	function changeNodes(changes: NodeChange<AccountNode>[]) {
		const dimensions = changes.filter((change): change is Extract<NodeChange<AccountNode>, { type: "dimensions" }> => change.type === "dimensions" && !!change.dimensions);
		if (dimensions.length) setMeasurements(previous => {
			const next = { ...previous };
			for (const change of dimensions) if (change.dimensions) next[change.id] = change.dimensions;
			return next;
		});
		if (!layout) return;
		const moves = changes.filter(change => change.type === "position" && change.position);
		if (!moves.length) return;
		setPositions(previous => {
			const next = { ...previous };
			for (const move of moves) {
				if (move.type !== "position" || !move.position) continue;
				const original = layout.nodes.get(move.id);
				if (original) next[move.id] = { x: move.position.x - original.x, y: move.position.y - original.y };
			}
			presentation.positions = next;
			return next;
		});
	}
	return <section className={`graph account-family-graph${expanded ? " account-family-graph--expanded" : ""}`} aria-label={t("relations")} aria-busy={!ready && !error} data-layout-ready={ready}>
		<div className="account-graph-view-actions"><div className="account-graph-navigation" ref={setNavigationHost} /></div>
		<div className={`account-graph-stage${ready ? " is-ready" : ""}`}>
			<ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
				ariaLabelConfig={{ "controls.zoomIn.ariaLabel": t("accountGraphZoomIn"), "controls.zoomOut.ariaLabel": t("accountGraphZoomOut"), "minimap.ariaLabel": t("accountGraphMap") }}
				minZoom={0.01} maxZoom={2} defaultViewport={{ x: 0, y: 0, zoom: 1 }}
				nodesFocusable edgesFocusable onNodesChange={changeNodes} onEdgesChange={changeEdges} onPaneClick={() => props.onSelectEdge(null)}
				onMoveEnd={(_, viewport) => {
					if (!ready) return;
					const camera = anchoredCamera(positionedLayout, { x: (size.width / 2 - viewport.x) / viewport.zoom, y: (size.height / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom });
					if (expanded) presentation.expandedCamera = camera; else presentation.camera = camera;
				}}
				deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} nodesDraggable nodesConnectable={false}>
				<GraphViewport layout={layout} positions={positions} layoutKey={inputKey} refreshKey={JSON.stringify(props.relations)} layoutSize={size} rootId={props.root.id} restore={restore} onSize={setSize} onReady={setReadyKey} />
				<Background />
				{navigationHost && createPortal(<><GraphControls layout={positionedLayout} rootId={props.root.id} expanded={expanded} onExpand={onExpand} onCollapse={onCollapse} />{props.assets.length > 12 && <GraphMiniMap rootId={props.root.id} />}{props.onReturn && <Button className="graph-return" size="small" onClick={props.onReturn}><ArrowLeft size={14} />{props.returnLabel}</Button>}</>, navigationHost)}
				{selected && <Panel position="bottom-right" className="account-graph-selection-panel nodrag nopan"><section className="account-graph-connection-details" aria-label={t("accountGraphSelection")}>
					<div className="account-graph-selection-header"><p className="account-graph-selection-title"><strong>{byId.get(selected[0].from)?.name}</strong><span aria-hidden="true"> → </span><strong>{byId.get(selected[0].to)?.name}</strong></p><Button className="account-graph-selection-close" aria-label={t("close")} onClick={() => props.onSelectEdge(null)}><X size={18} /></Button></div>
					<p className="account-graph-selection-status" role="status">{t(selected[0].verifiedAt ? "relationGraphVerified" : "relationGraphPending")}</p>
					<ul className="account-graph-selection-labels">{selected.map((relation) => <li key={relation.id} data-relation-id={relation.id}>
						<strong>{relation.label}</strong>
						<dl className="graph-relation-metadata"><div><dt>{t("relationSource")}</dt><dd>{relation.source || t("graphNotRecorded")}</dd></div><div><dt>{t("verifiedAt")}</dt><dd>{relation.verifiedAt ? date(relation.verifiedAt, i18n.language) : t("graphNotRecorded")}</dd></div></dl>
						<div className="actions graph-relation-actions">
							{props.onEditRelation && <Button size="small" aria-label={`${t("editRelation")} · ${relation.label}`} onClick={() => props.onEditRelation?.(relation)}><Pencil size={14} />{t("edit")}</Button>}
							{props.onDeleteRelation && <Button variant="danger" size="small" aria-label={`${t("deleteRelation")} · ${relation.label}`} onClick={() => props.onDeleteRelation?.(relation)}><Trash2 size={14} />{t("remove")}</Button>}
						</div>
					</li>)}</ul>
				</section></Panel>}
			</ReactFlow>
			{!ready && <p className="account-graph-state" role={error ? "alert" : "status"}>{t(error ? "accountGraphUnavailable" : "loading")}</p>}
		</div>
	</section>;
}

export function AccountFamilyGraphView(props: Props) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const [restore, setRestore] = useState<{ rootId: string; bookmark: Bookmark } | null>(null);
	const normalBookmark = useRef<{ rootId: string; bookmark: Bookmark } | null>(null);
	function closeExpanded() {
		const previous = normalBookmark.current;
		const camera = previous?.rootId === props.root.id ? previous.bookmark : graphViewState(props.root.id).camera;
		setRestore(camera ? { rootId: props.root.id, bookmark: camera } : null);
		setExpanded(false);
	}
	// Keep the dialog mounted while changing accounts; only reset the canvas and its camera.
	const saved = graphViewState(props.root.id);
	const canvas = <GraphContent key={props.root.id} props={props} expanded={expanded} restore={restore?.rootId === props.root.id ? restore.bookmark : expanded ? saved.expandedCamera ?? saved.camera ?? null : saved.camera ?? null} onCollapse={closeExpanded} onExpand={(bookmark) => { normalBookmark.current = { rootId: props.root.id, bookmark }; setRestore(null); saved.camera = bookmark; saved.expandedCamera = bookmark; setExpanded(true); }} />;
	return <ReactFlowProvider>{expanded ? <Dialog title={t(props.root.kind === "account" ? "accountGraphTitle" : "graphTitle")} className="account-graph-dialog" focusTitleOnOpen returnFocusTo={() => document.getElementById("account-graph-expand")} onClose={closeExpanded}>{canvas}</Dialog> : canvas}</ReactFlowProvider>;
}
