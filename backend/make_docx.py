import zipfile
from pathlib import Path
root = Path('sample2.docx')
if root.exists():
    root.unlink()
with zipfile.ZipFile(root, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>''')
    z.writestr('_rels/.rels', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>''')
    z.writestr('word/document.xml', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Artificial intelligence: the simulation of human intelligence in machines.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Machine learning: a field of AI that uses algorithms to learn from data.</w:t></w:r></w:p>
    <w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>
  </w:body>
</w:document>''')
print('created', root, 'size', root.stat().st_size)
