from html import escape
from pathlib import Path

from build_edith_154_audit import DATA, STATUS_COLORS


out = Path(r"C:\Users\arday\Desktop\ai programs\docx_qa_edith154_v1\preview.html")
parts = [
    "<!doctype html><html lang='tr'><head><meta charset='utf-8'><style>",
    "@page{size:Letter;margin:0.72in 0.62in} body{font-family:Aptos,Arial,sans-serif;color:#000;font-size:10pt;line-height:1.25}",
    "h1{font-size:22pt;text-align:center;margin:0 0 8pt} h2{font-size:15pt;margin:16pt 0 7pt;break-after:avoid}",
    "p.intro{font-size:10.5pt;margin:8pt 0 12pt} table{border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 10pt}",
    "th,td{border:1px solid #d9d9d9;padding:5px 6px;vertical-align:middle;overflow-wrap:anywhere} thead{display:table-header-group} thead tr{break-inside:avoid}",
    "th{background:#1f4e78;color:white;font-weight:700;text-align:center} td.no{width:5%;text-align:center} td.req{width:37%}",
    "td.status{width:12%;font-weight:700;text-align:center} td.ev{width:46%;font-size:8.7pt}",
    "tr,td{break-inside:avoid!important;page-break-inside:avoid!important} .summary td{text-align:center;font-weight:700;font-size:11pt}",
    "</style></head><body>",
    "<h1>EDITH 154 Özellik Durum Raporu</h1>",
    "<p class='intro'>Bu baskı önizlemesi, Word belgesindeki 154 maddelik kanıt matrisinin görsel yerleşim kontrolü için aynı veri ve sütun yapısından üretilmiştir.</p>",
]

from collections import Counter
counts = Counter(r[3] for r in DATA)
parts.append("<table class='summary'><tr><th>Toplam</th><th>DONE</th><th>PARTIAL</th><th>NOT STARTED</th><th>BLOCKED</th></tr><tr>")
for key, value in (("TOTAL", 154), ("DONE", counts["DONE"]), ("PARTIAL", counts["PARTIAL"]), ("NOT_STARTED", counts["NOT_STARTED"]), ("BLOCKED", counts["BLOCKED"])):
    color = STATUS_COLORS.get(key, "FFFFFF")
    parts.append(f"<td style='background:#{color}'>{value}</td>")
parts.append("</tr></table>")

category = None
for cat, num, req, status, chat, evidence in DATA:
    if cat != category:
        if category is not None:
            parts.append("</tbody></table>")
        category = cat
        parts.append(f"<h2>{escape(cat)}</h2><table><thead><tr><th style='width:5%'>No</th><th style='width:37%'>Özellik</th><th style='width:12%'>Durum</th><th style='width:46%'>Chat ve kanıt</th></tr></thead><tbody>")
    parts.append(
        f"<tr><td class='no'>{num}</td><td class='req'>{escape(req)}</td>"
        f"<td class='status' style='background:#{STATUS_COLORS[status]}'>{status.replace('_', ' ')}</td>"
        f"<td class='ev'><b>{escape(chat)}</b> - {escape(evidence)}</td></tr>"
    )
parts.append("</tbody></table></body></html>")
out.write_text("".join(parts), encoding="utf-8")
print(out)
