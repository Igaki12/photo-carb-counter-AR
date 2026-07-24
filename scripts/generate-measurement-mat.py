from pathlib import Path
import shutil

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "photo-carb-counter-measurement-mat-a4.pdf"
PUBLIC = ROOT / "public" / "assets" / "photo-carb-counter-measurement-mat-a4.pdf"
TAGS = ROOT / "public" / "vendor" / "apriltag"


def draw_tag(pdf: canvas.Canvas, tag_id: int, center_x_mm: float, center_y_mm: float) -> None:
    total_mm = 30
    pdf.drawImage(
        str(TAGS / f"tag36h11-{tag_id}.jpg"),
        (center_x_mm - total_mm / 2) * mm,
        (center_y_mm - total_mm / 2) * mm,
        total_mm * mm,
        total_mm * mm,
        preserveAspectRatio=True,
        anchor="c",
    )
    pdf.setFont("Helvetica-Bold", 8)
    pdf.setFillColor(black)
    pdf.drawCentredString(center_x_mm * mm, (center_y_mm - 18) * mm, f"ID {tag_id}")


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    page_width, page_height = landscape(A4)
    japanese_font = Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")
    if not japanese_font.exists():
        raise RuntimeError("Japanese font not found")
    pdfmetrics.registerFont(TTFont("Hiragino", str(japanese_font)))
    pdf = canvas.Canvas(str(OUTPUT), pagesize=(page_width, page_height), pageCompression=1)
    pdf.setTitle("Photo Carb Counter A4 Measurement Mat")
    pdf.setAuthor("Photo Carb Counter Research")
    pdf.setFillColor(white)
    pdf.rect(0, 0, page_width, page_height, fill=1, stroke=0)

    pdf.setFillColor(HexColor("#073A40"))
    pdf.setFont("Hiragino", 13)
    pdf.drawString(44 * mm, 195 * mm, "カーボカウント AR 計測マット")
    pdf.setFont("Hiragino", 7.5)
    pdf.setFillColor(HexColor("#425A60"))
    pdf.drawRightString(253 * mm, 195 * mm, "A4横 / 実際のサイズ 100% で印刷")

    # Marker centers in millimetres; these coordinates are mirrored in marker.ts.
    draw_tag(pdf, 0, 24, 24)
    draw_tag(pdf, 1, 273, 24)
    draw_tag(pdf, 2, 273, 186)
    draw_tag(pdf, 3, 24, 186)

    pdf.setStrokeColor(HexColor("#8BB8B4"))
    pdf.setLineWidth(0.5)
    pdf.roundRect(54 * mm, 48 * mm, 189 * mm, 114 * mm, 7 * mm, fill=0, stroke=1)
    pdf.setFillColor(HexColor("#557276"))
    pdf.setFont("Hiragino", 9)
    pdf.drawCentredString(148.5 * mm, 107 * mm, "食品または皿をこの範囲内に置く")
    pdf.setFont("Hiragino", 6.5)
    pdf.drawCentredString(148.5 * mm, 100 * mm, "手を写さず、上面と30-50度の斜めから撮影")

    # Sparse feature pattern, kept outside the central food area.
    pdf.setFillColor(HexColor("#C7D9D7"))
    for x_mm in range(45, 256, 14):
        for y_mm in (39, 171):
            radius = 0.45 + ((x_mm + y_mm) % 3) * 0.18
            pdf.circle(x_mm * mm, y_mm * mm, radius * mm, fill=1, stroke=0)

    # Exact 100 mm scale verification line.
    line_x = 98.5
    line_y = 31
    pdf.setStrokeColor(black)
    pdf.setLineWidth(1.2)
    pdf.line(line_x * mm, line_y * mm, (line_x + 100) * mm, line_y * mm)
    pdf.line(line_x * mm, (line_y - 2) * mm, line_x * mm, (line_y + 2) * mm)
    pdf.line((line_x + 100) * mm, (line_y - 2) * mm, (line_x + 100) * mm, (line_y + 2) * mm)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawCentredString((line_x + 50) * mm, (line_y + 3.5) * mm, "100 mm")
    pdf.setFont("Hiragino", 6.5)
    pdf.setFillColor(HexColor("#294A4F"))
    pdf.drawCentredString((line_x + 50) * mm, (line_y - 6) * mm, "印刷後に定規で99-101 mmであることを確認")

    # Optional monochrome/color balance patches.
    colors = ["#FFFFFF", "#B7C2C1", "#101817", "#0A8988"]
    for index, color in enumerate(colors):
        pdf.setFillColor(HexColor(color))
        pdf.setStrokeColor(HexColor("#849795"))
        pdf.rect((118 + index * 15) * mm, 174 * mm, 12 * mm, 6 * mm, fill=1, stroke=1)
    pdf.setFillColor(HexColor("#425A60"))
    pdf.setFont("Hiragino", 5.8)
    pdf.drawCentredString(148.5 * mm, 182.5 * mm, "色・露出確認")

    pdf.showPage()
    pdf.save()
    shutil.copyfile(OUTPUT, PUBLIC)
    print(OUTPUT)


if __name__ == "__main__":
    build()
