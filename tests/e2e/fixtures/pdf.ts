export function pdf(lines: string[], chinese = false, options: { inheritedResources?: boolean; fontSize?: number; pageCount?: number; imageOnly?: boolean } = {}) {
	const stream = options.imageOnly ? 'q 1 0 0 1 50 750 cm /Im1 Do Q' : `BT /F1 ${options.fontSize ?? 12} Tf 50 750 Td ${lines.map((line, i) => `${i ? '0 -20 Td ' : ''}${chinese ? `<${Array.from(line).map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>` : `(${line})`} Tj`).join('\n')} ET`;
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
	if (chinese) {
		objects[3] = "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] /ToUnicode 6 0 R >>";
		const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end";
		objects.push(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
	}
	if (options.inheritedResources) objects[1] = objects[1].replace('/Kids', '/Resources << /Font << /F2 4 0 R >> >> /Kids');
	if (options.imageOnly) {
		objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nRGB\nendstream');
		objects[2] = objects[2].replace('/Resources <<', `/Resources << /XObject << /Im1 ${objects.length} 0 R >>`);
	}
	if ((options.pageCount ?? 1) > 1) {
		const kids = ['3 0 R'];
		for (let page = 1; page < (options.pageCount ?? 1); page++) { objects.push(objects[2]); kids.push(`${objects.length} 0 R`); }
		objects[1] = objects[1].replace('/Kids [3 0 R] /Count 1', `/Kids [${kids.join(' ')}] /Count ${kids.length}`);
	}
	let body = "%PDF-1.4\n";
	const offsets = [0];
	objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
	const xref = Buffer.byteLength(body);
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(body);
}
