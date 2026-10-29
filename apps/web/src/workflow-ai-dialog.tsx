import { type Asset } from "../../../packages/domain/src";
import { AiWorkspaceDialog } from "./AiWorkspaceDialog";

export function AiDialog({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
	return <AiWorkspaceDialog assets={assets} onClose={onClose} />;
}
