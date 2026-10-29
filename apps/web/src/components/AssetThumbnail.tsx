import { useEffect, useState } from "react";
import { fileUrl } from "../../../../packages/local-db/src";
import type { Asset } from "../../../../packages/domain/src";
export function AssetThumbnail({ asset, imageId = asset.kind === "item" ? asset.itemMedia?.coverId : asset.attachments[0] }: { asset: Asset; imageId?: string }) {
	const [src, setSrc] = useState("");
	useEffect(() => {
		setSrc("");
		if (!imageId) return;
		let active = true;
		let objectUrl = "";
		void fileUrl(imageId).then((url) => {
			objectUrl = url;
			if (active) setSrc(url);
			else if (url) URL.revokeObjectURL(url);
		}).catch(() => { if (active) setSrc(""); });
		return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
	}, [imageId]);
	return src ? <img src={src} alt="" /> : null;
}

