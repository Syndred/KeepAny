export const projectImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function validateCaptureImage(file: File): Promise<void> {
	if (file.size > 20 * 1024 * 1024 || !projectImageTypes.has(file.type)) throw Error("image-invalid");
	const address = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = address;
		await image.decode();
		if (!image.naturalWidth || !image.naturalHeight) throw Error("image-invalid");
	} finally {
		URL.revokeObjectURL(address);
	}
}
