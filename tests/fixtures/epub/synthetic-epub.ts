import { zipSync, strToU8 } from "fflate";

type FixtureOptions = {
  container?: string;
  chapterOne?: string;
  navigation?: string;
  extraEntries?: Record<string, Uint8Array>;
  chapterCount?: number;
  structuralSpineItems?: boolean;
};

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">synthetic-book</dc:identifier><dc:title>고래의 항해</dc:title><dc:creator>테스트 저자</dc:creator><dc:language>ko</dc:language></metadata>
  <manifest>
    <item id="chapter-1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
</package>`;

const chapterOne = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>첫 항해</title><style>p { color: red; }</style></head><body><script>window.bad = true;</script><h1>첫 항해</h1><p>고래는 바다를 보았다.</p><p onclick="bad()">파도는 조용했다.</p><iframe src="https://example.invalid"/></body></html>`;

const chapterTwo = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>둘째 항해</title></head><body><h1>둘째 항해</h1><p>배는 항구를 떠났다.</p></body></html>`;

const navigation = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/chapter-1.xhtml">첫 항해</a></li><li><a href="text/chapter-2.xhtml">둘째 항해</a></li></ol></nav></body></html>`;

const structuralPackageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">synthetic-book</dc:identifier><dc:title>고래의 항해</dc:title></metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="volume" href="volume.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="nav"/><itemref idref="volume"/><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
</package>`;

const structuralNavigation = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="cover.xhtml">표지</a></li><li><a href="volume.xhtml">첫째 권</a></li><li><a href="text/chapter-1.xhtml">첫 항해</a></li><li><a href="text/chapter-2.xhtml">둘째 항해</a></li></ol></nav></body></html>`;

export function syntheticEpubArchive(options: FixtureOptions = {}): Uint8Array {
  const chapterCount = options.chapterCount ?? 2;
  const generatedChapters = Object.fromEntries(Array.from({ length: chapterCount }, (_, index) => [
    `OPS/text/chapter-${index + 1}.xhtml`,
    strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${index + 1}장</title></head><body><h1>${index + 1}장</h1><p>본문 ${index + 1}</p></body></html>`),
  ]));
  const generatedPackageDocument = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">synthetic-book</dc:identifier><dc:title>고래의 항해</dc:title><dc:creator>테스트 저자</dc:creator><dc:language>ko</dc:language></metadata>
  <manifest>${Array.from({ length: chapterCount }, (_, index) => `<item id="chapter-${index + 1}" href="text/chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
  <spine>${Array.from({ length: chapterCount }, (_, index) => `<itemref idref="chapter-${index + 1}"/>`).join("")}</spine>
</package>`;

  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(options.container ?? container),
    "OPS/package.opf": strToU8(options.structuralSpineItems ? structuralPackageDocument : options.chapterCount === undefined ? packageDocument : generatedPackageDocument),
    ...(options.structuralSpineItems
      ? {
          "OPS/cover.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="cover.jpg"/></body></html>`),
          "OPS/nav.xhtml": strToU8(structuralNavigation),
          "OPS/volume.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>첫째 권</h1></body></html>`),
          "OPS/text/chapter-1.xhtml": strToU8(options.chapterOne ?? chapterOne),
          "OPS/text/chapter-2.xhtml": strToU8(chapterTwo),
        }
      : options.chapterCount === undefined
      ? {
          "OPS/nav.xhtml": strToU8(options.navigation ?? navigation),
          "OPS/text/chapter-1.xhtml": strToU8(options.chapterOne ?? chapterOne),
          "OPS/text/chapter-2.xhtml": strToU8(chapterTwo),
        }
      : generatedChapters),
    ...options.extraEntries,
  });
}

export function syntheticEpubFixture(options: FixtureOptions = {}): Blob {
  const archive = syntheticEpubArchive(options);
  return {
    size: archive.byteLength,
    arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
  } as unknown as Blob;
}
